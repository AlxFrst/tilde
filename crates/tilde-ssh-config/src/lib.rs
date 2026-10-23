//! OpenSSH-compatible `ssh_config` parser for Tilde.
//!
//! Pure library: no Tauri, no network. Reading a configuration never fails: problems
//! become [`Diagnostic`]s that carry the file and the line, and every valid host stays
//! usable.

mod include;
mod lexer;
mod model;

pub use include::{ParseOptions, parse_file, parse_file_with, parse_str, parse_str_with};
pub use lexer::lex_line;
pub use model::{Block, Diagnostic, Directive, SshConfig};
