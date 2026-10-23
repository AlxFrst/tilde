//! OpenSSH `known_hosts` handling: plain, hashed (`|1|`), `[host]:port` and wildcard
//! entries, `@revoked` (always refused) and `@cert-authority` (ignored for now).

use std::{
    fs,
    io::{self, Write as _},
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use base64::{Engine, engine::general_purpose::STANDARD};
use hmac::{Hmac, Mac};
use russh::keys::{Algorithm, HashAlg, PublicKey};
use sha1::Sha1;

/// Result of looking a server key up in `known_hosts`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HostKeyStatus {
    Known,
    Unknown,
    /// Same host and key type, different key: possible man-in-the-middle.
    Changed {
        file: PathBuf,
        line: usize,
        old_fingerprint: String,
    },
    /// Listed under `@revoked`: never accepted.
    Revoked,
}

/// `SHA256:<base64 without padding>`, as printed by OpenSSH.
#[must_use]
pub fn fingerprint(key: &PublicKey) -> String {
    key.fingerprint(HashAlg::Sha256).to_string()
}

/// The name a host is stored under: `host`, or `[host]:port` for a non-default port.
fn lookup_name(host: &str, port: u16) -> String {
    if port == 22 { host.to_owned() } else { format!("[{host}]:{port}") }
}

enum Marker {
    None,
    Revoked,
    CertAuthority,
}

struct Entry {
    line: usize,
    marker: Marker,
    patterns: String,
    key: PublicKey,
}

/// Parses one line; `None` for comments, blank and malformed lines.
fn parse_line(text: &str, line: usize) -> Option<Entry> {
    let text = text.trim();
    if text.is_empty() || text.starts_with('#') {
        return None;
    }
    let mut fields = text.split_whitespace();
    let mut first = fields.next()?;
    let marker = match first {
        "@revoked" => Marker::Revoked,
        "@cert-authority" => Marker::CertAuthority,
        _ => Marker::None,
    };
    if !matches!(marker, Marker::None) {
        first = fields.next()?;
    }
    let key_type = fields.next()?;
    let key_data = fields.next()?;
    let key = PublicKey::from_openssh(&format!("{key_type} {key_data}")).ok()?;
    Some(Entry { line, marker, patterns: first.to_owned(), key })
}

/// `*` and `?` wildcards, case-insensitive (as OpenSSH's `match_pattern`).
fn wildcard(pattern: &str, text: &str) -> bool {
    fn go(p: &[u8], t: &[u8]) -> bool {
        match (p.first(), t.first()) {
            (None, None) => true,
            (Some(b'*'), _) => go(&p[1..], t) || (!t.is_empty() && go(p, &t[1..])),
            (Some(b'?'), Some(_)) => go(&p[1..], &t[1..]),
            (Some(a), Some(b)) if a.eq_ignore_ascii_case(b) => go(&p[1..], &t[1..]),
            _ => false,
        }
    }
    go(pattern.as_bytes(), text.as_bytes())
}

fn hashed_matches(pattern: &str, name: &str) -> bool {
    let mut parts = pattern.strip_prefix("|1|").unwrap_or_default().split('|');
    let (Some(salt), Some(hash)) = (parts.next(), parts.next()) else { return false };
    let (Ok(salt), Ok(hash)) = (STANDARD.decode(salt), STANDARD.decode(hash)) else {
        return false;
    };
    let Ok(mut mac) = Hmac::<Sha1>::new_from_slice(&salt) else { return false };
    mac.update(name.as_bytes());
    mac.verify_slice(&hash).is_ok()
}

/// Whether the comma-separated `patterns` field designates `name`. A matching negated
/// pattern (`!host`) excludes the host even if another pattern matches.
fn host_matches(patterns: &str, name: &str) -> bool {
    if patterns.starts_with("|1|") {
        return hashed_matches(patterns, name);
    }
    let mut matched = false;
    for p in patterns.split(',') {
        if let Some(negated) = p.strip_prefix('!') {
            if wildcard(negated, name) {
                return false;
            }
        } else if wildcard(p, name) {
            matched = true;
        }
    }
    matched
}

/// Today's date as `YYYY-MM-DD` (UTC), without a date library.
fn today() -> String {
    let days = SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs() / 86_400);
    // Civil-from-days (Howard Hinnant's algorithm).
    let z = i64::try_from(days).unwrap_or(0) + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!("{year:04}-{month:02}-{day:02}")
}

/// The user's `known_hosts` files, the first one receiving new entries.
#[derive(Debug, Clone)]
pub struct KnownHosts {
    files: Vec<PathBuf>,
}

impl KnownHosts {
    #[must_use]
    pub fn new(files: Vec<PathBuf>) -> Self {
        Self { files }
    }

    fn entries(path: &Path) -> Vec<Entry> {
        fs::read_to_string(path)
            .map(|text| {
                text.lines().enumerate().filter_map(|(i, l)| parse_line(l, i + 1)).collect()
            })
            .unwrap_or_default()
    }

    /// Looks `key` up for `host:port`. Precedence: revoked, then an exact match, then a
    /// different key of the same type for that host (changed), else unknown.
    #[must_use]
    pub fn check(&self, host: &str, port: u16, key: &PublicKey) -> HostKeyStatus {
        let name = lookup_name(host, port);
        let mut changed = None;
        let mut known = false;
        for file in &self.files {
            for e in Self::entries(file) {
                match e.marker {
                    Marker::Revoked if e.key.key_data() == key.key_data() => {
                        return HostKeyStatus::Revoked;
                    }
                    Marker::None if host_matches(&e.patterns, &name) => {
                        if e.key.key_data() == key.key_data() {
                            known = true;
                        } else if e.key.algorithm() == key.algorithm() && changed.is_none() {
                            changed = Some(HostKeyStatus::Changed {
                                file: file.clone(),
                                line: e.line,
                                old_fingerprint: fingerprint(&e.key),
                            });
                        }
                    }
                    _ => {}
                }
            }
        }
        if known { HostKeyStatus::Known } else { changed.unwrap_or(HostKeyStatus::Unknown) }
    }

    /// Key types recorded for `host:port` (revoked keys aside), first seen first.
    #[must_use]
    pub fn known_algorithms(&self, host: &str, port: u16) -> Vec<Algorithm> {
        let name = lookup_name(host, port);
        let mut found: Vec<Algorithm> = Vec::new();
        for file in &self.files {
            for e in Self::entries(file) {
                if matches!(e.marker, Marker::None)
                    && host_matches(&e.patterns, &name)
                    && !found.contains(&e.key.algorithm())
                {
                    found.push(e.key.algorithm());
                }
            }
        }
        found
    }

    fn primary(&self) -> io::Result<&PathBuf> {
        self.files.first().ok_or_else(|| io::Error::other("aucun fichier known_hosts configuré"))
    }

    /// Appends `host key` (plain, OpenSSH format) to the first file.
    ///
    /// # Errors
    ///
    /// I/O errors writing the file.
    pub fn add(&self, host: &str, port: u16, key: &PublicKey) -> io::Result<()> {
        let file = self.primary()?;
        if let Some(dir) = file.parent() {
            fs::create_dir_all(dir)?;
        }
        let openssh = key.to_openssh().map_err(io::Error::other)?;
        let mut line = format!("{} {}", lookup_name(host, port), openssh.trim());
        // Keep the file well-formed if it doesn't end with a newline.
        let existing = fs::read(file).unwrap_or_default();
        if !existing.is_empty() && !existing.ends_with(b"\n") {
            line.insert(0, '\n');
        }
        let mut f = fs::OpenOptions::new().create(true).append(true).open(file)?;
        writeln!(f, "{line}")
    }

    /// Comments out this host's entries of the same key type in the first file, then adds
    /// the new key. Only called after the user explicitly accepted a changed key.
    ///
    /// # Errors
    ///
    /// I/O errors reading or writing the file.
    pub fn replace(&self, host: &str, port: u16, key: &PublicKey) -> io::Result<()> {
        let file = self.primary()?;
        let name = lookup_name(host, port);
        let date = today();
        if let Ok(text) = fs::read_to_string(file) {
            let rewritten: Vec<String> = text
                .lines()
                .enumerate()
                .map(|(i, l)| match parse_line(l, i + 1) {
                    Some(e)
                        if matches!(e.marker, Marker::None)
                            && host_matches(&e.patterns, &name)
                            && e.key.algorithm() == key.algorithm() =>
                    {
                        format!("# remplacée par Tilde le {date} : {l}")
                    }
                    _ => l.to_owned(),
                })
                .collect();
            fs::write(file, rewritten.join("\n") + "\n")?;
        }
        self.add(host, port, key)
    }
}

#[cfg(test)]
mod tests {
    use std::fs;

    use base64::{Engine, engine::general_purpose::STANDARD};
    use hmac::{Hmac, Mac};
    use sha1::Sha1;

    use super::*;

    // Test-only keys (generated with ssh-keygen, private halves discarded).
    const KEY_A: &str =
        "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAICqku/9Fq6P2YIkfapLwWqPNs5oTPYzRTjhBvYZd+tV/";
    const KEY_B: &str =
        "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIKwjh3ttDj1fxALvLyKE0SnZudZKO1GNnQh1//KjXpOv";

    const KEY_EC: &str = "ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBJqLRO9t8uISIOZjNCALFnIiYHRSEResayEKUbWXuAn93fBDI0TYSlnOYSikNSKxMqIjImlpBK9WqoehqTbRpUU=";

    #[test]
    fn known_algorithms_lists_the_types_recorded_for_the_host() {
        let (_d, kh, _) = setup(&format!(
            "example.com {KEY_EC}\n[example.com]:2222 {KEY_A}\nother {KEY_B}\n@revoked example.com {KEY_B}\n"
        ));
        let names = |port| -> Vec<String> {
            kh.known_algorithms("example.com", port).iter().map(|a| a.as_str().to_owned()).collect()
        };
        assert_eq!(names(22), ["ecdsa-sha2-nistp256"]);
        assert_eq!(names(2222), ["ssh-ed25519"]);
        assert_eq!(kh.known_algorithms("nowhere", 22), vec![]);
    }

    fn key(s: &str) -> PublicKey {
        PublicKey::from_openssh(s).unwrap()
    }

    fn setup(contents: &str) -> (tempfile::TempDir, KnownHosts, PathBuf) {
        let dir = tempfile::TempDir::new().unwrap();
        let file = dir.path().join("known_hosts");
        fs::write(&file, contents).unwrap();
        (dir, KnownHosts::new(vec![file.clone()]), file)
    }

    fn hashed(host: &str) -> String {
        let salt = b"0123456789abcdefghij";
        let mut mac = Hmac::<Sha1>::new_from_slice(salt).unwrap();
        mac.update(host.as_bytes());
        format!("|1|{}|{}", STANDARD.encode(salt), STANDARD.encode(mac.finalize().into_bytes()))
    }

    #[test]
    fn unknown_then_known_after_add() {
        let (_d, kh, file) = setup("");
        assert_eq!(kh.check("example.com", 22, &key(KEY_A)), HostKeyStatus::Unknown);
        kh.add("example.com", 22, &key(KEY_A)).unwrap();
        assert_eq!(kh.check("example.com", 22, &key(KEY_A)), HostKeyStatus::Known);
        let text = fs::read_to_string(file).unwrap();
        assert!(text.starts_with("example.com ssh-ed25519 AAAA"), "{text}");
    }

    #[test]
    fn add_creates_missing_directory_and_file() {
        let dir = tempfile::TempDir::new().unwrap();
        let file = dir.path().join("sub").join("known_hosts");
        let kh = KnownHosts::new(vec![file.clone()]);
        kh.add("h", 22, &key(KEY_A)).unwrap();
        assert!(file.exists());
    }

    #[test]
    fn non_default_port_uses_brackets() {
        let (_d, kh, file) = setup("");
        kh.add("h", 2222, &key(KEY_A)).unwrap();
        assert!(fs::read_to_string(file).unwrap().starts_with("[h]:2222 "));
        assert_eq!(kh.check("h", 2222, &key(KEY_A)), HostKeyStatus::Known);
        assert_eq!(kh.check("h", 22, &key(KEY_A)), HostKeyStatus::Unknown);
    }

    #[test]
    fn hashed_entries_match() {
        let (_d, kh, _f) = setup(&format!("{} {KEY_A}\n", hashed("secret.example")));
        assert_eq!(kh.check("secret.example", 22, &key(KEY_A)), HostKeyStatus::Known);
        assert_eq!(kh.check("other.example", 22, &key(KEY_A)), HostKeyStatus::Unknown);
        let (_d2, kh2, _f2) = setup(&format!("{} {KEY_A}\n", hashed("[h]:2222")));
        assert_eq!(kh2.check("h", 2222, &key(KEY_A)), HostKeyStatus::Known);
    }

    #[test]
    fn changed_key_reports_file_and_line() {
        let (_d, kh, file) = setup(&format!("# comment\nother {KEY_B}\nh,h.alias {KEY_A}\n"));
        let HostKeyStatus::Changed { file: f, line, old_fingerprint } =
            kh.check("h", 22, &key(KEY_B))
        else {
            panic!("expected Changed")
        };
        assert_eq!((f, line), (file, 3));
        assert_eq!(old_fingerprint, fingerprint(&key(KEY_A)));
    }

    #[test]
    fn revoked_key_is_rejected() {
        let (_d, kh, _f) = setup(&format!("h {KEY_A}\n@revoked * {KEY_A}\n"));
        assert_eq!(kh.check("h", 22, &key(KEY_A)), HostKeyStatus::Revoked);
    }

    #[test]
    fn cert_authority_lines_are_ignored() {
        let (_d, kh, _f) = setup(&format!("@cert-authority *.example {KEY_A}\n"));
        assert_eq!(kh.check("a.example", 22, &key(KEY_A)), HostKeyStatus::Unknown);
    }

    #[test]
    fn negated_and_wildcard_patterns() {
        let (_d, kh, _f) = setup(&format!("*.prod,!db.prod {KEY_A}\n"));
        assert_eq!(kh.check("web.prod", 22, &key(KEY_A)), HostKeyStatus::Known);
        assert_eq!(kh.check("db.prod", 22, &key(KEY_A)), HostKeyStatus::Unknown);
        assert_eq!(kh.check("WEB.PROD", 22, &key(KEY_A)), HostKeyStatus::Known);
    }

    #[test]
    fn a_matching_key_wins_over_another_key_for_the_same_host() {
        let (_d, kh, _f) = setup(&format!("h {KEY_B}\nh {KEY_A}\n"));
        assert_eq!(kh.check("h", 22, &key(KEY_A)), HostKeyStatus::Known);
    }

    #[test]
    fn malformed_lines_are_skipped() {
        let (_d, kh, _f) = setup(&format!("garbage\nh ssh-ed25519 !!!\n\nh {KEY_A}\n"));
        assert_eq!(kh.check("h", 22, &key(KEY_A)), HostKeyStatus::Known);
    }

    #[test]
    fn replace_comments_old_line() {
        let (_d, kh, file) = setup(&format!("keep {KEY_A}\nh {KEY_A}\n"));
        kh.replace("h", 22, &key(KEY_B)).unwrap();
        let text = fs::read_to_string(&file).unwrap();
        let lines: Vec<_> = text.lines().collect();
        assert!(lines[0].starts_with("keep "));
        assert!(lines[1].starts_with("# remplacée par Tilde le "), "{text}");
        assert!(lines[1].ends_with(&format!("h {KEY_A}")));
        assert_eq!(kh.check("h", 22, &key(KEY_B)), HostKeyStatus::Known);
        assert_eq!(kh.check("keep", 22, &key(KEY_A)), HostKeyStatus::Known);
    }

    #[test]
    fn fingerprint_format() {
        let fp = fingerprint(&key(KEY_A));
        assert!(fp.starts_with("SHA256:"), "{fp}");
        assert!(!fp.contains('='));
        assert_eq!(fp.len(), "SHA256:".len() + 43);
    }

    #[test]
    fn missing_files_are_unknown() {
        let kh = KnownHosts::new(vec![PathBuf::from("/definitely/missing/known_hosts")]);
        assert_eq!(kh.check("h", 22, &key(KEY_A)), HostKeyStatus::Unknown);
    }

    #[test]
    fn today_is_a_plausible_date() {
        let d = today();
        assert_eq!(d.len(), 10);
        assert!(d.starts_with("20"), "{d}");
    }
}
