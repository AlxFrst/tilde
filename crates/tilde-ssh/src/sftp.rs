//! SFTP over an existing SSH connection: listing, file operations, safe local names.
//!
//! The session is opened on demand on the connection the shell already uses: no second
//! authentication.

use std::{
    sync::atomic::{AtomicBool, Ordering},
    time::Duration,
};

use russh_sftp::{
    client::{SftpSession, error::Error as SessionError, fs::Metadata},
    protocol::{FileAttributes, FileType, OpenFlags},
};
use serde::Serialize;

use crate::chain::Connection;

/// Bound on opening the SFTP subsystem (a server without one may never answer).
const OPEN_TIMEOUT: Duration = Duration::from_secs(15);
/// Bound on the liveness probe after a failed transfer.
const PROBE_TIMEOUT: Duration = Duration::from_secs(3);
/// A recursive delete stops past this many entries.
pub const MAX_REMOVE: u64 = 100_000;
/// Longest local file name we produce, in UTF-8 bytes (NTFS/ext4 allow 255).
const MAX_NAME_BYTES: usize = 200;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum EntryKind {
    File,
    Dir,
    Symlink,
    Other,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteEntry {
    pub name: String,
    pub path: String,
    pub kind: EntryKind,
    pub size: u64,
    /// Seconds since the Unix epoch.
    pub modified: Option<u64>,
    /// `st_mode` permission bits (`0o7777`).
    pub permissions: Option<u32>,
}

/// Why an SFTP operation failed, phrased for the user.
#[derive(Debug, thiserror::Error)]
pub enum SftpError {
    #[error("SFTP indisponible : {0}")]
    Unavailable(String),
    #[error("{path} : {message}")]
    Io { path: String, message: String },
    #[error("trop d'éléments à supprimer (plus de {MAX_REMOVE}) : opération arrêtée")]
    TooMany,
}

fn io(path: &str, e: impl std::fmt::Display) -> SftpError {
    SftpError::Io { path: path.to_owned(), message: e.to_string() }
}

/// `dir` + `/` + `name`, POSIX style, without doubled slashes.
#[must_use]
pub fn join_remote(dir: &str, name: &str) -> String {
    if dir.is_empty() {
        name.to_owned()
    } else if dir.ends_with('/') {
        format!("{dir}{name}")
    } else {
        format!("{dir}/{name}")
    }
}

fn is_reserved(stem: &str) -> bool {
    let upper = stem.to_ascii_uppercase();
    matches!(upper.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || (upper.len() == 4
            && (upper.starts_with("COM") || upper.starts_with("LPT"))
            && upper.as_bytes()[3].is_ascii_digit()
            && upper.as_bytes()[3] != b'0')
}

/// Keeps the longest prefix of `s` that fits in `max` bytes (on a char boundary).
fn truncate_bytes(s: &str, max: usize) -> &str {
    let mut end = max.min(s.len());
    while !s.is_char_boundary(end) {
        end -= 1;
    }
    &s[..end]
}

/// A local file name for a remote one that can never escape the destination folder:
/// last path segment only, characters Windows refuses replaced, reserved device names
/// (`CON`, `NUL`…) prefixed, trailing dots and spaces removed, length bounded.
#[must_use]
pub fn safe_local_name(remote: &str) -> String {
    let last = remote.rsplit(['/', '\\']).next().unwrap_or_default();
    let mut name: String = last
        .chars()
        .map(|c| if "<>:\"|?*".contains(c) || c.is_control() { '_' } else { c })
        .collect();
    let trim_end = |s: &mut String| {
        while s.ends_with('.') || s.ends_with(' ') {
            s.pop();
        }
    };
    trim_end(&mut name);
    if name.is_empty() {
        return "fichier".to_owned();
    }
    if name.len() > MAX_NAME_BYTES {
        // Keep a short extension; shorten the rest.
        let ext =
            name.rfind('.').filter(|&i| i > 0 && name.len() - i <= 16).map_or("", |i| &name[i..]);
        let mut stem =
            truncate_bytes(&name[..name.len() - ext.len()], MAX_NAME_BYTES - ext.len()).to_owned();
        trim_end(&mut stem);
        name = format!("{stem}{ext}");
    }
    if is_reserved(name.split('.').next().unwrap_or_default()) {
        name.insert(0, '_');
    }
    name
}

fn kind_of(t: FileType) -> EntryKind {
    match t {
        FileType::Dir => EntryKind::Dir,
        FileType::File => EntryKind::File,
        FileType::Symlink => EntryKind::Symlink,
        FileType::Other => EntryKind::Other,
    }
}

fn entry(name: String, path: String, m: &Metadata) -> RemoteEntry {
    RemoteEntry {
        name,
        path,
        kind: kind_of(m.file_type()),
        size: m.size.unwrap_or(0),
        modified: m.mtime.map(u64::from),
        permissions: m.permissions.map(|p| p & 0o7777),
    }
}

/// An SFTP session on one SSH connection.
pub struct SftpClient {
    session: SftpSession,
    /// The channel failed (not a refusal by the server): the session must be reopened.
    dead: AtomicBool,
}

impl SftpClient {
    /// Opens the `sftp` subsystem on the connection's target.
    ///
    /// # Errors
    ///
    /// [`SftpError::Unavailable`] when the server refuses or does not answer in time.
    pub async fn open(connection: &Connection) -> Result<Self, SftpError> {
        let unavailable = |e: &dyn std::fmt::Display| SftpError::Unavailable(e.to_string());
        let open = async {
            let channel =
                connection.target().channel_open_session().await.map_err(|e| unavailable(&e))?;
            channel.request_subsystem(true, "sftp").await.map_err(|e| unavailable(&e))?;
            SftpSession::new(channel.into_stream()).await.map_err(|e| unavailable(&e))
        };
        let session = tokio::time::timeout(OPEN_TIMEOUT, open)
            .await
            .map_err(|_| SftpError::Unavailable("le serveur ne répond pas".into()))??;
        Ok(Self { session, dead: AtomicBool::new(false) })
    }

    /// The channel broke (connection, `sftp-server` gone…): open a new session.
    #[must_use]
    pub fn is_dead(&self) -> bool {
        self.dead.load(Ordering::Acquire)
    }

    /// After a failure whose cause is unclear (a transfer cut): a cheap request tells
    /// whether the session still answers.
    pub async fn check_alive(&self) {
        let probe = tokio::time::timeout(PROBE_TIMEOUT, self.session.canonicalize(".")).await;
        if !matches!(probe, Ok(Ok(_))) {
            self.dead.store(true, Ordering::Release);
        }
    }

    /// Maps a library error; anything but a refusal by the server marks the session dead.
    fn fail(&self, path: &str, e: SessionError) -> SftpError {
        if !matches!(e, SessionError::Status(_)) {
            self.dead.store(true, Ordering::Release);
        }
        io(path, e)
    }

    #[must_use]
    pub fn inner(&self) -> &SftpSession {
        &self.session
    }

    /// The login directory.
    ///
    /// # Errors
    ///
    /// The server cannot resolve `.`.
    pub async fn home(&self) -> Result<String, SftpError> {
        self.session.canonicalize(".").await.map_err(|e| self.fail(".", e))
    }

    /// Directories first, then by name (case-insensitive); `.` and `..` left out.
    ///
    /// # Errors
    ///
    /// The directory cannot be read.
    pub async fn list(&self, path: &str) -> Result<Vec<RemoteEntry>, SftpError> {
        let dir = self.session.read_dir(path).await.map_err(|e| self.fail(path, e))?;
        let mut entries: Vec<RemoteEntry> = dir
            .filter(|e| e.file_name() != "." && e.file_name() != "..")
            .map(|e| entry(e.file_name(), join_remote(path, &e.file_name()), &e.metadata()))
            .collect();
        entries.sort_by(|a, b| {
            (a.kind != EntryKind::Dir)
                .cmp(&(b.kind != EntryKind::Dir))
                .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
        });
        Ok(entries)
    }

    /// # Errors
    ///
    /// The path does not exist or cannot be read.
    pub async fn stat(&self, path: &str) -> Result<RemoteEntry, SftpError> {
        let m = self.session.metadata(path).await.map_err(|e| self.fail(path, e))?;
        let name = path.rsplit('/').next().unwrap_or(path).to_owned();
        Ok(entry(name, path.to_owned(), &m))
    }

    /// # Errors
    ///
    /// The directory cannot be created.
    pub async fn mkdir(&self, path: &str) -> Result<(), SftpError> {
        self.session.create_dir(path).await.map_err(|e| self.fail(path, e))
    }

    /// Creates an empty file. An existing file is never overwritten: that is an error.
    ///
    /// # Errors
    ///
    /// The file already exists or cannot be created.
    pub async fn create_file(&self, path: &str) -> Result<(), SftpError> {
        let flags = OpenFlags::WRITE | OpenFlags::CREATE | OpenFlags::EXCLUDE;
        let file =
            self.session.open_with_flags(path, flags).await.map_err(|e| self.fail(path, e))?;
        file.close().await.map_err(|e| io(path, e))
    }

    /// # Errors
    ///
    /// The rename is refused.
    pub async fn rename(&self, from: &str, to: &str) -> Result<(), SftpError> {
        self.session.rename(from, to).await.map_err(|e| self.fail(from, e))
    }

    /// Sets the permission bits (`0o7777`), keeping the file type.
    ///
    /// # Errors
    ///
    /// The change is refused.
    pub async fn chmod(&self, path: &str, mode: u32) -> Result<(), SftpError> {
        let attrs = FileAttributes { permissions: Some(mode & 0o7777), ..FileAttributes::empty() };
        self.session.set_metadata(path, attrs).await.map_err(|e| self.fail(path, e))
    }

    /// Deletes a file, a link or a whole directory tree; returns how many entries went.
    /// Symbolic links are removed themselves, never followed.
    ///
    /// # Errors
    ///
    /// The first failure, or [`SftpError::TooMany`] past [`MAX_REMOVE`] entries.
    pub async fn remove(&self, path: &str) -> Result<u64, SftpError> {
        let m = self.session.symlink_metadata(path).await.map_err(|e| self.fail(path, e))?;
        if m.file_type() != FileType::Dir {
            self.session.remove_file(path).await.map_err(|e| self.fail(path, e))?;
            return Ok(1);
        }
        // Depth-first, without recursion: directories are removed once emptied.
        let mut removed = 0;
        let mut stack = vec![(path.to_owned(), false)];
        while let Some((dir, emptied)) = stack.pop() {
            if emptied {
                self.session.remove_dir(&dir).await.map_err(|e| self.fail(&dir, e))?;
                removed += 1;
                continue;
            }
            stack.push((dir.clone(), true));
            let listing = self.session.read_dir(&dir).await.map_err(|e| self.fail(&dir, e))?;
            for e in listing {
                let name = e.file_name();
                if name == "." || name == ".." {
                    continue;
                }
                let child = join_remote(&dir, &name);
                // `read_dir` reports links as links (lstat): never descended into.
                if e.file_type() == FileType::Dir {
                    stack.push((child, false));
                } else {
                    self.session.remove_file(&child).await.map_err(|e| self.fail(&child, e))?;
                    removed += 1;
                }
                if removed > MAX_REMOVE {
                    return Err(SftpError::TooMany);
                }
            }
        }
        Ok(removed)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const RESERVED: [&str; 6] = ["CON", "prn", "Aux", "NUL", "com1", "LPT9"];

    fn assert_safe(name: &str) {
        assert!(!name.contains('/') && !name.contains('\\'), "{name}");
        assert!(name != "." && name != ".." && !name.is_empty(), "{name}");
        assert!(name.len() <= MAX_NAME_BYTES, "{} bytes", name.len());
        assert!(!name.ends_with('.') && !name.ends_with(' '), "{name:?}");
        assert!(!name.chars().any(|c| "<>:\"|?*".contains(c) || c.is_control()), "{name}");
        let stem = name.split('.').next().unwrap_or(name).to_ascii_uppercase();
        assert!(!RESERVED.iter().any(|r| r.eq_ignore_ascii_case(&stem)), "{name}");
    }

    #[test]
    fn remote_names_never_escape_the_destination() {
        let long = format!("{}.tar.gz", "é".repeat(300));
        let hostile = [
            "../x",
            "../../etc/passwd",
            "a/b",
            "a\\b",
            "..",
            ".",
            "",
            "CON",
            "nul.txt",
            "com1.log",
            "x:y",
            "what?",
            "tab\there",
            "trailing. ",
            "dots...",
            &long,
            "/abs/path/file",
            "C:\\Windows\\evil.dll",
        ];
        for h in hostile {
            assert_safe(&safe_local_name(h));
        }
        assert_eq!(safe_local_name("../x"), "x");
        assert_eq!(safe_local_name("rapport final.pdf"), "rapport final.pdf");
        assert_eq!(safe_local_name("nul.txt"), "_nul.txt");
        assert_eq!(safe_local_name("x:y"), "x_y");
        assert_eq!(safe_local_name(".."), "fichier");
        assert_eq!(
            safe_local_name(&long).rsplit_once('.').map(|(_, e)| e),
            Some("gz"),
            "keeps the extension"
        );
    }

    #[test]
    fn join_remote_handles_slashes() {
        assert_eq!(join_remote("/home/me", "f"), "/home/me/f");
        assert_eq!(join_remote("/home/me/", "f"), "/home/me/f");
        assert_eq!(join_remote("/", "etc"), "/etc");
        assert_eq!(join_remote("", "f"), "f");
    }
}
