//! Tauri commands exposed to the front-end. Keep this the only IPC surface.
//!
//! Tauri hands command arguments (`AppHandle`, `State`, payloads) over by value.
#![allow(clippy::needless_pass_by_value)]

pub mod app;
pub mod settings;
