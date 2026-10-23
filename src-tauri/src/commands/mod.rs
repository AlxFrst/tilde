//! Tauri commands exposed to the front-end. Keep this the only IPC surface.
//!
//! Tauri hands command arguments (`AppHandle`, `State`, payloads) over by value.
#![allow(clippy::needless_pass_by_value)]

pub mod app;
pub mod connections;
pub mod profiles;
pub mod session;
pub mod settings;
pub mod sftp;
pub mod ssh;
pub mod themes;
pub mod workspace;
