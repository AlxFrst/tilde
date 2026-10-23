//! Parsed representation of an `ssh_config` file, `Include`s already expanded.

use std::{fmt, path::PathBuf};

/// One `keyword args…` line.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Directive {
    /// Keyword in lower case (`hostname`, `identityfile`, …).
    pub keyword: String,
    /// Arguments, unquoted. For commands (`ProxyCommand`, `LocalCommand`, …) a single
    /// argument holding the rest of the line verbatim, as OpenSSH does.
    pub args: Vec<String>,
    pub file: PathBuf,
    /// 1-based line number in `file`.
    pub line: usize,
}

/// A section of the configuration, in file order.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Block {
    /// Directives that apply to every host (before the first `Host`/`Match`, or after an
    /// `Include` that ended inside a block).
    Global(Vec<Directive>),
    Host {
        patterns: Vec<String>,
        directives: Vec<Directive>,
        file: PathBuf,
        line: usize,
    },
    /// `Match` criteria as written (`["host", "*.prod", "user", "deploy"]`).
    ///
    /// A `Host` or `Match` found in a file included from inside another `Host`/`Match`
    /// only applies when both match, so it becomes a `Match` whose criteria are the
    /// outer ones followed by the inner ones. An outer `Host` is written as the
    /// pseudo-criterion `@host <patterns joined by commas>` (exact `Host` semantics).
    Match {
        criteria: Vec<String>,
        directives: Vec<Directive>,
        file: PathBuf,
        line: usize,
    },
}

impl Block {
    /// Directives of this block, in file order.
    #[must_use]
    pub fn directives(&self) -> &[Directive] {
        match self {
            Self::Global(directives)
            | Self::Host { directives, .. }
            | Self::Match { directives, .. } => directives,
        }
    }

    pub(crate) fn directives_mut(&mut self) -> &mut Vec<Directive> {
        match self {
            Self::Global(directives)
            | Self::Host { directives, .. }
            | Self::Match { directives, .. } => directives,
        }
    }
}

/// A non-fatal problem found while reading the configuration.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Diagnostic {
    pub file: PathBuf,
    /// 1-based line number; `0` when the problem concerns the whole file.
    pub line: usize,
    pub message: String,
}

impl fmt::Display for Diagnostic {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if self.line == 0 {
            write!(f, "{} : {}", self.file.display(), self.message)
        } else {
            write!(f, "{}:{} : {}", self.file.display(), self.line, self.message)
        }
    }
}

/// A whole configuration: blocks in order, plus what went wrong while reading it.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SshConfig {
    pub blocks: Vec<Block>,
    pub diagnostics: Vec<Diagnostic>,
}
