//! Settings model, persistence, migrations and hot reload for Tilde.
//!
//! This crate has no Tauri dependency so it can be tested with `cargo test` alone.

mod error;
mod settings;

pub use error::{ConfigError, ConfigErrorDto, FieldError};
pub use settings::*;
