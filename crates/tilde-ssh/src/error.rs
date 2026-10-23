use std::fmt;

/// Which hop of a connection chain an error belongs to (1-based).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HopLabel {
    pub index: usize,
    pub total: usize,
    pub host: String,
}

impl HopLabel {
    /// The final (or only) hop.
    #[must_use]
    pub fn target(host: &str) -> Self {
        Self { index: 1, total: 1, host: host.to_owned() }
    }

    fn is_target(&self) -> bool {
        self.index == self.total
    }
}

impl fmt::Display for HopLabel {
    /// `example.com` for the target, `bastion 2/3 (b2.example)` for a jump host.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if self.is_target() {
            f.write_str(&self.host)
        } else {
            write!(f, "bastion {}/{} ({})", self.index, self.total - 1, self.host)
        }
    }
}

/// Why a connection failed, phrased for the user.
#[derive(Debug, thiserror::Error)]
pub enum ConnectError {
    #[error("{hop} injoignable : {source}")]
    Unreachable { hop: HopLabel, source: std::io::Error },

    #[error("{hop} : délai de connexion dépassé")]
    Timeout { hop: HopLabel },

    #[error("{hop} : clé d'hôte refusée ({reason})")]
    HostKeyRejected { hop: HopLabel, reason: String },

    #[error("authentification refusée par {user}@{hop} — méthodes essayées : {}", tried.join(", "))]
    AuthFailed { hop: HopLabel, user: String, tried: Vec<String> },

    #[error("{message}")]
    Proxy { message: String },

    #[error("connexion annulée")]
    Cancelled,

    #[error("{hop} : erreur SSH : {source}")]
    Ssh { hop: HopLabel, source: russh::Error },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hop_labels_read_naturally() {
        assert_eq!(HopLabel::target("example.com").to_string(), "example.com");
        let b = HopLabel { index: 2, total: 3, host: "b2.example".into() };
        assert_eq!(b.to_string(), "bastion 2/2 (b2.example)");
    }

    #[test]
    fn auth_failure_lists_methods() {
        let e = ConnectError::AuthFailed {
            hop: HopLabel::target("h"),
            user: "alice".into(),
            tried: vec!["agent".into(), "~/.ssh/id_ed25519".into(), "mot de passe".into()],
        };
        assert_eq!(
            e.to_string(),
            "authentification refusée par alice@h — méthodes essayées : agent, ~/.ssh/id_ed25519, mot de passe"
        );
    }
}
