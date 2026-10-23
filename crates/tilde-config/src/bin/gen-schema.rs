//! Writes the settings JSON Schema (default: `schemas/settings.schema.json`) and, next to
//! it, `connections.schema.json`.

use std::{env, fs, path::PathBuf, process::ExitCode};

fn main() -> ExitCode {
    let out = env::args_os()
        .nth(1)
        .map_or_else(|| PathBuf::from("schemas/settings.schema.json"), PathBuf::from);
    let connections = out.with_file_name("connections.schema.json");
    if let Some(parent) = out.parent()
        && let Err(e) = fs::create_dir_all(parent)
    {
        eprintln!("cannot create {}: {e}", parent.display());
        return ExitCode::FAILURE;
    }
    for (path, schema) in [
        (&out, tilde_config::settings_schema()),
        (&connections, tilde_config::connections_schema()),
    ] {
        let json = serde_json::to_string_pretty(&schema).expect("schema serializes");
        if let Err(e) = fs::write(path, json + "\n") {
            eprintln!("cannot write {}: {e}", path.display());
            return ExitCode::FAILURE;
        }
    }
    ExitCode::SUCCESS
}
