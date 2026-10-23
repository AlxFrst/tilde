use std::{io, path::PathBuf};

use serde::Serialize;

/// A single validation failure, addressed by its camelCase JSON path.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct FieldError {
    /// Dotted path of the offending key, e.g. `terminal.fontSize`.
    pub path: String,
    pub message: String,
}

/// Everything that can go wrong while loading, validating or saving configuration.
#[derive(Debug, thiserror::Error)]
pub enum ConfigError {
    #[error("impossible d'accéder à {path}: {source}")]
    Io { path: PathBuf, source: io::Error },

    #[error("JSON invalide (ligne {line}, colonne {column}) : {message}")]
    Parse { message: String, line: usize, column: usize },

    #[error("type incorrect pour « {path} » : {message}")]
    Type { path: String, message: String },

    #[error("valeurs hors limites : {}", format_fields(.0))]
    Invalid(Vec<FieldError>),

    #[error(
        "ce fichier a été écrit par une version plus récente de Tilde (version {found}, \
         version supportée {supported}) ; il est ouvert en lecture seule"
    )]
    FutureVersion { found: u32, supported: u32 },

    #[error("settings.json contient une erreur : corrigez-le avant de modifier les réglages")]
    ReadOnly,
}

fn format_fields(fields: &[FieldError]) -> String {
    fields.iter().map(|f| format!("{} ({})", f.path, f.message)).collect::<Vec<_>>().join(", ")
}

/// Serializable view of [`ConfigError`] sent to the front-end.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigErrorDto {
    /// One of `io`, `parse`, `type`, `invalid`, `futureVersion`, `readOnly`.
    pub kind: &'static str,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub column: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
}

impl From<&ConfigError> for ConfigErrorDto {
    fn from(err: &ConfigError) -> Self {
        let (kind, line, column, path) = match err {
            ConfigError::Io { .. } => ("io", None, None, None),
            ConfigError::Parse { line, column, .. } => ("parse", Some(*line), Some(*column), None),
            ConfigError::Type { path, .. } => ("type", None, None, Some(path.clone())),
            ConfigError::Invalid(fields) => {
                ("invalid", None, None, fields.first().map(|f| f.path.clone()))
            }
            ConfigError::FutureVersion { .. } => ("futureVersion", None, None, None),
            ConfigError::ReadOnly => ("readOnly", None, None, None),
        };
        // For parse errors the UI formats the position itself from `line`/`column`.
        let message = match err {
            ConfigError::Parse { message, .. } => message.clone(),
            other => other.to_string(),
        };
        Self { kind, message, line, column, path }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_dto_carries_bare_message_and_position() {
        let err = ConfigError::Parse { message: "EOF".into(), line: 3, column: 5 };
        let dto = ConfigErrorDto::from(&err);
        assert_eq!((dto.kind, dto.message.as_str()), ("parse", "EOF"));
        assert_eq!((dto.line, dto.column), (Some(3), Some(5)));
    }
}
