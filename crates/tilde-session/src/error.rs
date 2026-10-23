use crate::SessionId;

#[derive(Debug, thiserror::Error)]
pub enum SessionError {
    #[error("impossible de lancer « {command} » : {source}")]
    Spawn { command: String, source: Box<dyn std::error::Error + Send + Sync> },

    #[error("session {0} introuvable")]
    NotFound(SessionId),

    #[error(transparent)]
    Io(#[from] std::io::Error),
}
