//! OpenSSH-compatible `ssh_config` parser for Tilde.
//!
//! Pure library: no Tauri, no network. Reading a configuration never fails: problems
//! become [`Diagnostic`]s that carry the file and the line, and every valid host stays
//! usable.
//!
//! [`SshConfig::resolve`] follows `ssh -G`: blocks are read in order and the first
//! value obtained wins, except for the cumulative `IdentityFile`, `LocalForward` and
//! `RemoteForward`. `Match` supports `all`, `host`, `originalhost`, `user`,
//! `localuser`, `canonical` and `final` (with OpenSSH's second pass); `exec` and the
//! other criteria are reported and never match. Values `ssh` would reject are reported
//! when the file is read and ignored when resolving.

mod forward;
mod include;
mod jump;
mod lexer;
mod model;
mod pattern;
mod resolve;
mod tokens;
mod validate;

pub use forward::{Forward, parse_forward};
pub use include::{ParseOptions, parse_file, parse_file_with, parse_str, parse_str_with};
pub use jump::{JumpHost, parse_proxy_jump};
pub use lexer::lex_line;
pub use model::{Block, Diagnostic, Directive, SshConfig};
pub use pattern::host_matches;
pub use resolve::{ResolveContext, ResolvedHost};
