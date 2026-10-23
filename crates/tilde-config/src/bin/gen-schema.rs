//! Writes the settings JSON Schema to disk (default: `schemas/settings.schema.json`).

use std::{env, fs, path::PathBuf, process::ExitCode};

fn main() -> ExitCode {
    let out = env::args_os().nth(1).map_or_else(
        || PathBuf::from("schemas/settings.schema.json"),
        PathBuf::from,
    );
    let json =
        serde_json::to_string_pretty(&tilde_config::settings_schema()).expect("schema serializes");
    if let Some(parent) = out.parent()
        && let Err(e) = fs::create_dir_all(parent)
    {
        eprintln!("cannot create {}: {e}", parent.display());
        return ExitCode::FAILURE;
    }
    match fs::write(&out, json + "\n") {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("cannot write {}: {e}", out.display());
            ExitCode::FAILURE
        }
    }
}
