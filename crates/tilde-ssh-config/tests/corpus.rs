//! Realistic configurations (`tests/corpus/*.conf`): every concrete host is resolved
//! and snapshotted with the diagnostics, and (on Unix, when `ssh` is installed) the
//! main fields are compared with `ssh -G`.
//!
//! A corpus file whose text contains `corpus: no-ssh-g` is not compared with `ssh -G`
//! (the comment says why).

use std::{
    fmt::Write as _,
    fs,
    path::{Path, PathBuf},
};

use tilde_ssh_config::{ParseOptions, ResolveContext, ResolvedHost, SshConfig, parse_file_with};

fn corpus_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests").join("corpus")
}

/// `*.conf` directly in the corpus directory (included files live in `include.d/`).
fn corpus_files() -> Vec<PathBuf> {
    let mut files: Vec<PathBuf> = fs::read_dir(corpus_dir())
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .filter(|path| path.extension().is_some_and(|ext| ext == "conf"))
        .collect();
    files.sort();
    files
}

/// The corpus directory stands for `~/.ssh`.
fn parse_corpus_file(path: &Path, home: &Path) -> SshConfig {
    parse_file_with(path, &ParseOptions { home: home.to_path_buf(), ssh_dir: corpus_dir() })
}

/// Diagnostic text, stable across platforms: the corpus directory becomes `<corpus>`
/// and separators become `/` (no corpus diagnostic quotes a Windows path).
fn normalize(text: &str) -> String {
    text.replace(&corpus_dir().display().to_string(), "<corpus>").replace('\\', "/")
}

fn render(cfg: &SshConfig, ctx: &ResolveContext) -> String {
    let mut out = String::from("diagnostics:\n");
    if cfg.diagnostics.is_empty() {
        out.push_str("  (none)\n");
    }
    for d in &cfg.diagnostics {
        let file = normalize(&d.file.display().to_string());
        writeln!(out, "  {file}:{} : {}", d.line, normalize(&d.message)).unwrap();
    }
    for alias in cfg.concrete_hosts() {
        out.push('\n');
        render_host(&mut out, &cfg.resolve(&alias, ctx));
    }
    out
}

fn render_host(out: &mut String, h: &ResolvedHost) {
    let list = |items: Vec<String>| {
        if items.is_empty() { "[]".to_owned() } else { format!("[{}]", items.join(", ")) }
    };
    let paths = |p: &[PathBuf]| list(p.iter().map(|p| p.display().to_string()).collect());
    let opt = |v: Option<String>| v.unwrap_or_else(|| "-".to_owned());
    writeln!(out, "{}:", h.alias).unwrap();
    writeln!(out, "  hostname: {}", h.hostname).unwrap();
    writeln!(out, "  port: {}", h.port).unwrap();
    writeln!(out, "  user: {}", h.user).unwrap();
    writeln!(out, "  identity_files: {}", paths(&h.identity_files)).unwrap();
    writeln!(out, "  identities_only: {}", h.identities_only).unwrap();
    let jumps = h
        .proxy_jump
        .iter()
        .map(|j| {
            let user = j.user.as_ref().map(|u| format!("{u}@")).unwrap_or_default();
            let port = j.port.map(|p| format!(":{p}")).unwrap_or_default();
            format!("{user}{}{port}", j.host)
        })
        .collect();
    writeln!(out, "  proxy_jump: {}", list(jumps)).unwrap();
    writeln!(out, "  proxy_command: {}", opt(h.proxy_command.clone())).unwrap();
    writeln!(out, "  forward_agent: {}", h.forward_agent).unwrap();
    let forwards = |fs: &[tilde_ssh_config::Forward]| {
        list(
            fs.iter()
                .map(|f| {
                    let bind = match &f.bind {
                        Some(b) if b.contains(':') => format!("[{b}]:"),
                        Some(b) => format!("{b}:"),
                        None => String::new(),
                    };
                    format!("{bind}{} -> {}:{}", f.listen_port, f.host, f.port)
                })
                .collect(),
        )
    };
    writeln!(out, "  local_forwards: {}", forwards(&h.local_forwards)).unwrap();
    writeln!(out, "  remote_forwards: {}", forwards(&h.remote_forwards)).unwrap();
    writeln!(out, "  user_known_hosts_files: {}", paths(&h.user_known_hosts_files)).unwrap();
    writeln!(
        out,
        "  server_alive_interval: {}",
        opt(h.server_alive_interval.map(|v| v.to_string()))
    )
    .unwrap();
    writeln!(
        out,
        "  server_alive_count_max: {}",
        opt(h.server_alive_count_max.map(|v| v.to_string()))
    )
    .unwrap();
    writeln!(out, "  connect_timeout: {}", opt(h.connect_timeout.map(|v| v.to_string()))).unwrap();
    writeln!(out, "  strict_host_key_checking: {}", opt(h.strict_host_key_checking.clone()))
        .unwrap();
}

#[test]
fn corpus_snapshots() {
    let ctx = ResolveContext { local_user: "alice".into(), home: PathBuf::from("/home/alice") };
    let files = corpus_files();
    assert!(files.len() >= 8, "the corpus must hold at least 8 configurations");
    for path in files {
        let cfg = parse_corpus_file(&path, &ctx.home);
        let name = path.file_stem().unwrap().to_string_lossy().into_owned();
        insta::assert_snapshot!(name, render(&cfg, &ctx));
    }
}

/// Compares `hostname`, `port`, `user`, `identityfile` and `proxyjump` with
/// `ssh -G -F <file> <host>` for every concrete host of the corpus.
#[cfg(unix)]
#[test]
fn matches_openssh_dash_g() {
    use std::process::Command;

    use tilde_ssh_config::parse_proxy_jump;

    if Command::new("ssh").arg("-V").output().is_err() {
        eprintln!("ssh introuvable : comparaison avec `ssh -G` ignorée");
        return;
    }
    let ctx = ResolveContext::from_env();
    let home = ctx.home.display().to_string();

    // ssh resolves relative Includes against the real ~/.ssh: give it a copy of the
    // corpus whose Includes are absolute.
    let tmp = tempfile::tempdir().unwrap();
    copy_with_absolute_includes(&corpus_dir(), tmp.path(), tmp.path());

    let mut compared = 0;
    for source in corpus_files() {
        let text = fs::read_to_string(&source).unwrap_or_default();
        if text.contains("corpus: no-ssh-g") {
            continue;
        }
        let file = tmp.path().join(source.file_name().unwrap());
        let cfg = parse_file_with(
            &file,
            &ParseOptions { home: ctx.home.clone(), ssh_dir: tmp.path().into() },
        );
        for alias in cfg.concrete_hosts() {
            let output =
                Command::new("ssh").arg("-G").arg("-F").arg(&file).arg(&alias).output().unwrap();
            let stderr = String::from_utf8_lossy(&output.stderr);
            if !output.status.success() {
                if stderr.contains("Unsupported Match attribute")
                    || stderr.contains("Bad configuration option")
                {
                    eprintln!(
                        "{}: ssh trop ancien pour ce fichier ({stderr}), ignoré",
                        source.display()
                    );
                    break;
                }
                panic!("ssh -G {alias} a échoué pour {} : {stderr}", source.display());
            }
            let stdout = String::from_utf8_lossy(&output.stdout);
            let values = |key: &str| -> Vec<String> {
                stdout
                    .lines()
                    .filter_map(|line| line.split_once(' '))
                    .filter(|(k, _)| *k == key)
                    .map(|(_, v)| v.to_owned())
                    .collect()
            };
            let first = |key: &str| values(key).into_iter().next().unwrap_or_default();
            let ours = cfg.resolve(&alias, &ctx);
            let at = format!("{} / {alias}", source.display());
            assert_eq!(ours.hostname, first("hostname"), "hostname, {at}");
            assert_eq!(ours.port.to_string(), first("port"), "port, {at}");
            assert_eq!(ours.user, first("user"), "user, {at}");
            let theirs_jump =
                values("proxyjump").first().map_or_else(Vec::new, |v| parse_proxy_jump(v).unwrap());
            assert_eq!(ours.proxy_jump, theirs_jump, "proxyjump, {at}");
            if !ours.identity_files.is_empty() {
                // ssh -G may print them unexpanded: expand like ssh would.
                let expand = |raw: &str| {
                    let raw = match raw.strip_prefix("~/") {
                        Some(rest) => format!("{home}/{rest}"),
                        None => raw.to_owned(),
                    };
                    raw.replace("%%", "\u{0}")
                        .replace("%h", &ours.hostname)
                        .replace("%p", &ours.port.to_string())
                        .replace("%r", &ours.user)
                        .replace("%u", &ctx.local_user)
                        .replace("%d", &home)
                        .replace("%n", &alias)
                        .replace('\u{0}', "%")
                };
                let theirs: Vec<PathBuf> =
                    values("identityfile").iter().map(|v| PathBuf::from(expand(v))).collect();
                assert_eq!(ours.identity_files, theirs, "identityfile, {at}");
            }
            compared += 1;
        }
    }
    assert!(compared > 20, "only {compared} hosts compared");
}

/// Copies `from` into `to`, rewriting relative `Include` arguments to absolute paths
/// under `ssh_dir`.
#[cfg(unix)]
fn copy_with_absolute_includes(from: &Path, to: &Path, ssh_dir: &Path) {
    fs::create_dir_all(to).unwrap();
    for entry in fs::read_dir(from).unwrap() {
        let entry = entry.unwrap();
        let target = to.join(entry.file_name());
        if entry.file_type().unwrap().is_dir() {
            copy_with_absolute_includes(&entry.path(), &target, ssh_dir);
            continue;
        }
        let bytes = fs::read(entry.path()).unwrap();
        let Ok(text) = String::from_utf8(bytes.clone()) else {
            fs::write(&target, bytes).unwrap();
            continue;
        };
        let rewritten: Vec<String> = text
            .split('\n')
            .map(|line| match tilde_ssh_config::lex_line(line) {
                Some((keyword, args)) if keyword == "include" => {
                    let args: Vec<String> = args
                        .iter()
                        .map(|arg| {
                            if arg.starts_with('/') || arg.starts_with('~') {
                                arg.clone()
                            } else {
                                let path = ssh_dir.join(arg).display().to_string();
                                format!("\"{}\"", path.replace('\\', "/"))
                            }
                        })
                        .collect();
                    format!("Include {}", args.join(" "))
                }
                _ => line.to_owned(),
            })
            .collect();
        fs::write(&target, rewritten.join("\n")).unwrap();
    }
}
