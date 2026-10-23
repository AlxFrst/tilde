//! Sequential, pure migrations of the raw `settings.json` value.

use serde_json::Value;

use crate::{ConfigError, SETTINGS_VERSION};

/// `MIGRATIONS[n]` turns a version-`n` document into a version-`n + 1` one.
const MIGRATIONS: &[fn(Value) -> Value] = &[v0_to_v1];

const _: () = assert!(MIGRATIONS.len() == SETTINGS_VERSION as usize);

/// v0 is any file without a `version` key (hand-written or pre-release).
fn v0_to_v1(mut raw: Value) -> Value {
    if let Some(obj) = raw.as_object_mut() {
        obj.insert("version".into(), 1.into());
    }
    raw
}

/// Brings `raw` up to [`SETTINGS_VERSION`].
///
/// Returns the migrated value and, if anything changed, the version it started from.
///
/// # Errors
///
/// [`ConfigError::FutureVersion`] if the file is newer than this build understands,
/// [`ConfigError::Type`] if `raw` is not an object or `version` is not an integer.
pub fn migrate(mut raw: Value) -> Result<(Value, Option<u32>), ConfigError> {
    let Some(obj) = raw.as_object() else {
        return Err(ConfigError::Type {
            path: String::new(),
            message: "le fichier doit contenir un objet JSON".into(),
        });
    };
    let found = match obj.get("version") {
        None => 0,
        Some(v) => v
            .as_u64()
            .and_then(|v| u32::try_from(v).ok())
            .ok_or_else(|| ConfigError::Type {
                path: "version".into(),
                message: "doit être un entier positif".into(),
            })?,
    };
    if found > SETTINGS_VERSION {
        return Err(ConfigError::FutureVersion {
            found,
            supported: SETTINGS_VERSION,
        });
    }
    if found == SETTINGS_VERSION {
        return Ok((raw, None));
    }
    for step in &MIGRATIONS[found as usize..] {
        raw = step(raw);
    }
    Ok((raw, Some(found)))
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn current_version_is_untouched() {
        let (v, from) = migrate(json!({"version": 1, "x": 2})).unwrap();
        assert_eq!(v, json!({"version": 1, "x": 2}));
        assert_eq!(from, None);
    }

    #[test]
    fn non_integer_version_is_a_type_error() {
        let err = migrate(json!({"version": "one"})).unwrap_err();
        assert!(matches!(err, ConfigError::Type { ref path, .. } if path == "version"));
    }
}
