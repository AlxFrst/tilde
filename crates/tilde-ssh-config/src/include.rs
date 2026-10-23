//! Reading files into [`SshConfig`], with `Include` expanded in place.

use std::{
    borrow::Cow,
    fs, io,
    path::{Path, PathBuf},
};

use crate::{
    lexer::{LexError, lex},
    model::{Block, Diagnostic, Directive, SshConfig},
};

/// Where `~` and relative `Include` paths point to.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParseOptions {
    /// Replaces `~` in `Include` paths.
    pub home: PathBuf,
    /// Base of relative `Include` paths (`~/.ssh` for a user configuration).
    pub ssh_dir: PathBuf,
}

impl ParseOptions {
    /// `home` and `home/.ssh`.
    #[must_use]
    pub fn with_home(home: impl Into<PathBuf>) -> Self {
        let home = home.into();
        let ssh_dir = home.join(".ssh");
        Self { home, ssh_dir }
    }

    /// The current user's home directory (empty if it cannot be determined).
    #[must_use]
    pub fn from_env() -> Self {
        Self::with_home(dirs::home_dir().unwrap_or_default())
    }
}

/// Reads a user configuration (`~/.ssh/config` or a file given like `ssh -F`).
///
/// Never fails: a missing file gives an empty configuration without diagnostic, an
/// unreadable one an empty configuration with a diagnostic.
#[must_use]
pub fn parse_file(path: &Path) -> SshConfig {
    parse_file_with(path, &ParseOptions::from_env())
}

/// [`parse_file`] with explicit `~` and `~/.ssh` (tests, corpus).
#[must_use]
pub fn parse_file_with(path: &Path, opts: &ParseOptions) -> SshConfig {
    let mut parser = Parser::new(opts);
    match read_text(path) {
        Ok(None) => {}
        Ok(Some((text, lossy))) => {
            if lossy {
                parser.diag(path, 0, NON_UTF8.to_owned());
            }
            parser.stack.push(identity(path));
            parser.parse_text(&text, path, 0, &Cond::Global, None);
        }
        Err(e) => parser.diag(path, 0, format!("lecture impossible : {e}")),
    }
    parser.finish()
}

/// Parses `text` as if it had been read from `origin` (used in diagnostics).
#[must_use]
pub fn parse_str(text: &str, origin: &Path) -> SshConfig {
    parse_str_with(text, origin, &ParseOptions::from_env())
}

/// [`parse_str`] with explicit `~` and `~/.ssh`.
#[must_use]
pub fn parse_str_with(text: &str, origin: &Path, opts: &ParseOptions) -> SshConfig {
    let mut parser = Parser::new(opts);
    parser.stack.push(identity(origin));
    parser.parse_text(
        text.strip_prefix('\u{feff}').unwrap_or(text),
        origin,
        0,
        &Cond::Global,
        None,
    );
    parser.finish()
}

/// OpenSSH `READCONF_MAX_DEPTH`.
const MAX_INCLUDE_DEPTH: usize = 16;

const NON_UTF8: &str = "octets non UTF-8 remplacés par « \u{fffd} »";

/// Condition under which the directives being read apply.
#[derive(Debug, Clone)]
enum Cond {
    Global,
    Host { patterns: Vec<String>, file: PathBuf, line: usize },
    Match { criteria: Vec<String>, file: PathBuf, line: usize },
}

impl Cond {
    fn new_block(&self) -> Block {
        match self.clone() {
            Self::Global => Block::Global(Vec::new()),
            Self::Host { patterns, file, line } => {
                Block::Host { patterns, directives: Vec::new(), file, line }
            }
            Self::Match { criteria, file, line } => {
                Block::Match { criteria, directives: Vec::new(), file, line }
            }
        }
    }

    /// Criteria equivalent to this condition, for nesting inside a `Match`.
    fn as_criteria(&self) -> Vec<String> {
        match self {
            Self::Global => Vec::new(),
            Self::Host { patterns, .. } => vec!["@host".to_owned(), patterns.join(",")],
            Self::Match { criteria, .. } => criteria.clone(),
        }
    }

    /// `self` (the condition of the block holding an `Include`) and `inner` (a block of
    /// the included file) must both hold, as with OpenSSH's `SSHCONF_NEVERMATCH`.
    fn and(&self, inner: Self) -> Self {
        let outer_is_everything = match self {
            Self::Global => true,
            Self::Host { patterns, .. } => {
                patterns.iter().any(|p| p == "*") && !patterns.iter().any(|p| p.starts_with('!'))
            }
            Self::Match { .. } => false,
        };
        if outer_is_everything {
            return inner;
        }
        let (file, line) = match &inner {
            Self::Host { file, line, .. } | Self::Match { file, line, .. } => (file.clone(), *line),
            Self::Global => return self.clone(),
        };
        let mut criteria = self.as_criteria();
        criteria.extend(inner.as_criteria());
        // `all` is implied once combined with other criteria.
        if criteria.len() > 1 {
            criteria.retain(|c| !c.eq_ignore_ascii_case("all"));
        }
        Self::Match { criteria, file, line }
    }
}

struct Parser<'a> {
    opts: &'a ParseOptions,
    blocks: Vec<Block>,
    diagnostics: Vec<Diagnostic>,
    /// Files being read, outermost first (cycle detection).
    stack: Vec<PathBuf>,
}

impl<'a> Parser<'a> {
    fn new(opts: &'a ParseOptions) -> Self {
        Self { opts, blocks: Vec::new(), diagnostics: Vec::new(), stack: Vec::new() }
    }

    fn finish(self) -> SshConfig {
        SshConfig { blocks: self.blocks, diagnostics: self.diagnostics }
    }

    fn diag(&mut self, file: &Path, line: usize, message: String) {
        self.diagnostics.push(Diagnostic { file: file.to_path_buf(), line, message });
    }

    /// Reads `text` under `outer`. `current` is the block directives go to until the
    /// first `Host`/`Match` (the block holding the `Include`, if any).
    fn parse_text(
        &mut self,
        text: &str,
        file: &Path,
        depth: usize,
        outer: &Cond,
        mut current: Option<usize>,
    ) {
        let mut cond = outer.clone();
        for (index, raw) in text.lines().enumerate() {
            let line = index + 1;
            let (keyword, args) = match lex(raw) {
                Ok(Some(lexed)) => lexed,
                Ok(None) => continue,
                Err(e) => {
                    self.diag(file, line, e.message());
                    if let LexError::MissingArgument { keyword } = &e
                        && (keyword == "host" || keyword == "match")
                    {
                        // A section header we cannot read: open a section that never
                        // matches so its directives do not leak into the previous one.
                        cond =
                            outer.and(Cond::Host { patterns: Vec::new(), file: file.into(), line });
                        current = Some(self.push(cond.new_block()));
                    }
                    continue;
                }
            };
            match keyword.as_str() {
                "host" => {
                    cond = outer.and(Cond::Host { patterns: args, file: file.into(), line });
                    current = Some(self.push(cond.new_block()));
                }
                "match" => {
                    cond = outer.and(Cond::Match { criteria: args, file: file.into(), line });
                    current = Some(self.push(cond.new_block()));
                }
                "include" => {
                    for arg in &args {
                        self.include(arg, file, line, depth, &cond, current);
                    }
                }
                _ => {
                    let index = self.block_for(&cond, current);
                    current = Some(index);
                    self.blocks[index].directives_mut().push(Directive {
                        keyword,
                        args,
                        file: file.to_path_buf(),
                        line,
                    });
                }
            }
        }
    }

    fn push(&mut self, block: Block) -> usize {
        self.blocks.push(block);
        self.blocks.len() - 1
    }

    /// The block a directive read under `cond` goes to: `current` while nothing was
    /// added after it, otherwise a new block with the same condition.
    fn block_for(&mut self, cond: &Cond, current: Option<usize>) -> usize {
        let last = self.blocks.len().checked_sub(1);
        if current.is_some() && current == last {
            return current.unwrap_or_default();
        }
        if matches!(cond, Cond::Global)
            && let Some(last) = last
            && matches!(self.blocks[last], Block::Global(_))
        {
            return last;
        }
        self.push(cond.new_block())
    }

    fn include(
        &mut self,
        arg: &str,
        file: &Path,
        line: usize,
        depth: usize,
        cond: &Cond,
        current: Option<usize>,
    ) {
        let pattern = self.include_pattern(arg);
        let options = glob::MatchOptions {
            case_sensitive: true,
            require_literal_separator: true,
            require_literal_leading_dot: true,
        };
        let paths = match glob::glob_with(&pattern, options) {
            Ok(paths) => {
                let mut paths: Vec<PathBuf> = paths.filter_map(Result::ok).collect();
                paths.sort();
                paths
            }
            Err(e) => {
                self.diag(file, line, format!("Include « {arg} » : motif invalide ({e})"));
                return;
            }
        };
        for path in paths {
            if depth + 1 > MAX_INCLUDE_DEPTH {
                self.diag(
                    file,
                    line,
                    format!(
                        "Include de {} ignoré : profondeur maximale ({MAX_INCLUDE_DEPTH}) atteinte",
                        path.display()
                    ),
                );
                continue;
            }
            let id = identity(&path);
            if self.stack.contains(&id) {
                self.diag(
                    file,
                    line,
                    format!(
                        "Include circulaire ignoré : {} est déjà en cours de lecture",
                        path.display()
                    ),
                );
                continue;
            }
            match read_text(&path) {
                Ok(None) => {}
                Ok(Some((text, lossy))) => {
                    if lossy {
                        self.diag(&path, 0, NON_UTF8.to_owned());
                    }
                    self.stack.push(id);
                    self.parse_text(&text, &path, depth + 1, cond, current);
                    self.stack.pop();
                }
                Err(e) => self.diag(
                    file,
                    line,
                    format!("Include de {} : lecture impossible : {e}", path.display()),
                ),
            }
        }
    }

    /// Glob pattern for an `Include` argument: `~` → home, relative → `~/.ssh`.
    fn include_pattern(&self, arg: &str) -> String {
        let escape = |p: &Path| glob::Pattern::escape(&p.to_string_lossy());
        if arg == "~" {
            return escape(&self.opts.home);
        }
        if let Some(rest) = arg.strip_prefix("~/").or_else(|| arg.strip_prefix("~\\")) {
            return format!("{}/{rest}", escape(&self.opts.home));
        }
        if arg.starts_with('/') || arg.starts_with('\\') || Path::new(arg).is_absolute() {
            return arg.to_owned();
        }
        format!("{}/{arg}", escape(&self.opts.ssh_dir))
    }
}

/// Identity of a file for cycle detection (canonical path when it exists).
fn identity(path: &Path) -> PathBuf {
    fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf())
}

/// File content without BOM; `Ok(None)` if the file does not exist. The flag tells
/// whether invalid UTF-8 was replaced.
fn read_text(path: &Path) -> io::Result<Option<(String, bool)>> {
    let bytes = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e),
    };
    let bytes = bytes.strip_prefix(b"\xef\xbb\xbf").unwrap_or(&bytes);
    Ok(Some(match String::from_utf8_lossy(bytes) {
        Cow::Borrowed(text) => (text.to_owned(), false),
        Cow::Owned(text) => (text, true),
    }))
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::*;
    use crate::model::{Block, Directive};

    fn d(keyword: &str, args: &[&str], file: &Path, line: usize) -> Directive {
        Directive {
            keyword: keyword.into(),
            args: args.iter().map(|a| (*a).to_owned()).collect(),
            file: file.to_path_buf(),
            line,
        }
    }

    /// A fake home with `.ssh/` and the given files (path relative to `.ssh`, content).
    fn home_with(files: &[(&str, &str)]) -> (tempfile::TempDir, ParseOptions) {
        let home = tempfile::tempdir().unwrap();
        let opts = ParseOptions::with_home(home.path());
        for (rel, content) in files {
            let path = opts.ssh_dir.join(rel);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, content).unwrap();
        }
        (home, opts)
    }

    fn host_patterns(block: &Block) -> Vec<String> {
        match block {
            Block::Host { patterns, .. } => patterns.clone(),
            other => panic!("expected Host, got {other:?}"),
        }
    }

    fn keywords(block: &Block) -> Vec<(&str, &str)> {
        block
            .directives()
            .iter()
            .map(|d| (d.keyword.as_str(), d.args.first().map_or("", String::as_str)))
            .collect()
    }

    #[test]
    fn global_then_host_blocks_keep_file_order() {
        let origin = Path::new("cfg");
        let cfg = parse_str("User def\n\nHost a b\n  Port 2222\nHost c\n", origin);
        assert_eq!(
            cfg.blocks,
            vec![
                Block::Global(vec![d("user", &["def"], origin, 1)]),
                Block::Host {
                    patterns: vec!["a".into(), "b".into()],
                    directives: vec![d("port", &["2222"], origin, 4)],
                    file: origin.into(),
                    line: 3,
                },
                Block::Host {
                    patterns: vec!["c".into()],
                    directives: vec![],
                    file: origin.into(),
                    line: 5,
                },
            ]
        );
        assert_eq!(cfg.diagnostics, []);
    }

    #[test]
    fn crlf_bom_and_tabs() {
        let origin = Path::new("cfg");
        let cfg = parse_str("\u{feff}Host a\r\n\tHostName\t1.2.3.4\r\n", origin);
        assert_eq!(
            cfg.blocks,
            vec![Block::Host {
                patterns: vec!["a".into()],
                directives: vec![d("hostname", &["1.2.3.4"], origin, 2)],
                file: origin.into(),
                line: 1,
            }]
        );
        assert_eq!(cfg.diagnostics, []);
    }

    #[test]
    fn match_blocks_keep_their_criteria() {
        let cfg = parse_str("Match host *.prod user deploy\n  Port 2200\n", Path::new("cfg"));
        let Block::Match { criteria, directives, line, .. } = &cfg.blocks[0] else {
            panic!("expected Match: {:?}", cfg.blocks)
        };
        assert_eq!(criteria, &["host", "*.prod", "user", "deploy"]);
        assert_eq!(directives.len(), 1);
        assert_eq!(*line, 1);
    }

    #[test]
    fn unknown_keywords_are_kept() {
        let cfg = parse_str("Host a\n  FrobnicateLevel 11\n", Path::new("cfg"));
        assert_eq!(keywords(&cfg.blocks[0]), vec![("frobnicatelevel", "11")]);
        assert_eq!(cfg.diagnostics, []);
    }

    #[test]
    fn malformed_lines_give_a_diagnostic_with_the_line_and_are_skipped() {
        let origin = Path::new("cfg");
        let cfg = parse_str("Host a\n  User \"alice\n  Port\n  Port 22\n", origin);
        assert_eq!(keywords(&cfg.blocks[0]), vec![("port", "22")]);
        let lines: Vec<usize> = cfg.diagnostics.iter().map(|d| d.line).collect();
        assert_eq!(lines, vec![2, 3]);
        assert!(cfg.diagnostics.iter().all(|d| d.file == origin));
    }

    #[test]
    fn host_without_pattern_is_reported_and_never_matches() {
        let cfg = parse_str("Host\n  User x\n", Path::new("cfg"));
        // The lexer rejects it ("sans argument"); its directives must not leak into
        // the global section.
        assert_eq!(cfg.diagnostics.len(), 1);
        assert_eq!(cfg.diagnostics[0].line, 1);
        assert!(!cfg.blocks.iter().any(|b| matches!(b, Block::Global(_))), "{:?}", cfg.blocks);
    }

    #[test]
    fn missing_file_is_empty_without_diagnostic() {
        let (_home, opts) = home_with(&[]);
        let cfg = parse_file_with(&opts.ssh_dir.join("config"), &opts);
        assert_eq!(cfg, SshConfig::default());
    }

    #[test]
    fn missing_include_is_silent_like_openssh() {
        let (_home, opts) = home_with(&[("config", "Include nope.conf\nHost a\n")]);
        let cfg = parse_file_with(&opts.ssh_dir.join("config"), &opts);
        assert!(cfg.diagnostics.is_empty(), "{:?}", cfg.diagnostics);
        assert_eq!(cfg.blocks.len(), 1);
    }

    #[test]
    fn unreadable_file_gives_a_diagnostic() {
        let (_home, opts) = home_with(&[("conf.d/x", "")]);
        // A directory cannot be read as a file.
        let cfg = parse_file_with(&opts.ssh_dir.join("conf.d"), &opts);
        assert_eq!(cfg.blocks, []);
        assert_eq!(cfg.diagnostics.len(), 1);
        assert_eq!(cfg.diagnostics[0].line, 0);
    }

    /// `tests/fixtures`, used as `~/.ssh`.
    fn fixtures() -> ParseOptions {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests").join("fixtures");
        ParseOptions { home: dir.clone(), ssh_dir: dir }
    }

    #[test]
    fn include_glob_is_expanded_in_order() {
        let opts = fixtures();
        let cfg = parse_file_with(&opts.ssh_dir.join("glob.conf"), &opts);
        let hosts: Vec<Vec<String>> = cfg.blocks.iter().map(host_patterns).collect();
        assert_eq!(hosts, vec![vec!["a"], vec!["b"], vec!["last"]]);
        let Block::Host { file, line, .. } = &cfg.blocks[0] else { unreachable!() };
        assert!(file.ends_with("a.conf"), "{}", file.display());
        assert_eq!(*line, 1);
        assert!(cfg.diagnostics.is_empty(), "{:?}", cfg.diagnostics);
    }

    #[test]
    fn include_accepts_absolute_and_tilde_paths() {
        let (home, opts) = home_with(&[("abs.conf", "Host abs\n"), ("tilde.conf", "Host tilde\n")]);
        let abs = opts.ssh_dir.join("abs.conf");
        let text = format!("Include \"{}\"\nInclude ~/.ssh/tilde.conf\n", abs.display());
        let cfg = parse_str_with(&text, &home.path().join("cfg"), &opts);
        let hosts: Vec<Vec<String>> = cfg.blocks.iter().map(host_patterns).collect();
        assert_eq!(hosts, vec![vec!["abs"], vec!["tilde"]]);
    }

    #[test]
    fn include_inside_host_applies_to_that_host() {
        let (_home, opts) = home_with(&[
            ("config", "Host web\n  Include web.conf\n  Port 2222\nHost other\n"),
            ("web.conf", "User deploy\nIdentityFile ~/.ssh/web\n"),
        ]);
        let cfg = parse_file_with(&opts.ssh_dir.join("config"), &opts);
        assert_eq!(cfg.blocks.len(), 2, "{:?}", cfg.blocks);
        assert_eq!(host_patterns(&cfg.blocks[0]), vec!["web"]);
        assert_eq!(
            keywords(&cfg.blocks[0]),
            vec![("user", "deploy"), ("identityfile", "~/.ssh/web"), ("port", "2222")]
        );
        assert!(cfg.blocks[0].directives()[0].file.ends_with("web.conf"));
    }

    #[test]
    fn host_inside_an_included_file_inside_a_host_needs_both() {
        let (_home, opts) = home_with(&[
            ("config", "Host web*\n  Include inner.conf\n  Port 2222\n"),
            ("inner.conf", "User deploy\nHost web1\n  User one\n"),
        ]);
        let cfg = parse_file_with(&opts.ssh_dir.join("config"), &opts);
        assert_eq!(cfg.blocks.len(), 3, "{:?}", cfg.blocks);
        assert_eq!(keywords(&cfg.blocks[0]), vec![("user", "deploy")]);
        let Block::Match { criteria, .. } = &cfg.blocks[1] else {
            panic!("expected Match: {:?}", cfg.blocks[1])
        };
        assert_eq!(criteria, &["@host", "web*", "@host", "web1"]);
        assert_eq!(keywords(&cfg.blocks[1]), vec![("user", "one")]);
        // Back in the outer block after the Include.
        assert_eq!(host_patterns(&cfg.blocks[2]), vec!["web*"]);
        assert_eq!(keywords(&cfg.blocks[2]), vec![("port", "2222")]);
    }

    #[test]
    fn include_inside_host_star_keeps_plain_host_blocks() {
        let (_home, opts) = home_with(&[
            ("config", "Host *\n  Include hosts.conf\n"),
            ("hosts.conf", "Host db\n  User pg\n"),
        ]);
        let cfg = parse_file_with(&opts.ssh_dir.join("config"), &opts);
        assert_eq!(host_patterns(&cfg.blocks[1]), vec!["db"]);
    }

    #[test]
    fn top_level_include_returns_to_global_section() {
        let (_home, opts) = home_with(&[
            ("config", "Include hosts.conf\nUser after\n"),
            ("hosts.conf", "User inc\nHost db\n  Port 5\n"),
        ]);
        let cfg = parse_file_with(&opts.ssh_dir.join("config"), &opts);
        assert_eq!(cfg.blocks.len(), 3, "{:?}", cfg.blocks);
        assert!(matches!(cfg.blocks[0], Block::Global(_)));
        assert_eq!(host_patterns(&cfg.blocks[1]), vec!["db"]);
        assert!(matches!(&cfg.blocks[2], Block::Global(d) if d[0].args == ["after"]));
    }

    #[test]
    fn include_cycle_is_cut() {
        let opts = fixtures();
        let cfg = parse_file_with(&opts.ssh_dir.join("cycle-a.conf"), &opts);
        let hosts: Vec<Vec<String>> = cfg.blocks.iter().map(host_patterns).collect();
        assert_eq!(hosts, vec![vec!["b"], vec!["a"]]);
        assert_eq!(cfg.diagnostics.len(), 1, "{:?}", cfg.diagnostics);
        let diag = &cfg.diagnostics[0];
        assert!(diag.file.ends_with("cycle-b.conf"));
        assert_eq!(diag.line, 1);
        assert!(diag.message.contains("cycle-a.conf"), "{}", diag.message);
    }

    #[test]
    fn include_depth_is_limited_to_16() {
        let files: Vec<(String, String)> = (0..20)
            .map(|i| (format!("f{i}.conf"), format!("Host h{i}\nInclude f{}.conf\n", i + 1)))
            .collect();
        let refs: Vec<(&str, &str)> = files.iter().map(|(n, c)| (n.as_str(), c.as_str())).collect();
        let (_home, opts) = home_with(&refs);
        let cfg = parse_file_with(&opts.ssh_dir.join("f0.conf"), &opts);
        // f0 is depth 0; f1..f16 are includes of depth 1..16; f17 would be 17.
        assert_eq!(cfg.blocks.len(), 17);
        assert_eq!(cfg.diagnostics.len(), 1, "{:?}", cfg.diagnostics);
        assert!(cfg.diagnostics[0].file.ends_with("f16.conf"));
        assert!(cfg.diagnostics[0].message.contains("16"));
    }

    #[test]
    fn non_utf8_bytes_are_replaced_with_a_diagnostic() {
        let home = tempfile::tempdir().unwrap();
        let opts = ParseOptions::with_home(home.path());
        let path = home.path().join("cfg");
        fs::write(&path, b"Host a\n  User \xff\n").unwrap();
        let cfg = parse_file_with(&path, &opts);
        assert_eq!(cfg.blocks.len(), 1);
        assert_eq!(cfg.diagnostics.len(), 1);
    }
}
