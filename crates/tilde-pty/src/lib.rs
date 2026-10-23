//! Shell detection and profile resolution. No Tauri dependency.

mod detect;
mod profiles;

pub use detect::{ShellCandidate, detect_shells, parse_etc_shells, parse_wsl_list};
pub use profiles::{ProfileSource, ResolvedProfile, pick_default, resolve_profiles};
