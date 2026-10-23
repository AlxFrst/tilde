//! Remembered passwords and key passphrases. Only the OS keyring ever stores them on disk.

use std::{collections::HashMap, path::Path};

use parking_lot::Mutex;

/// Where secrets the user chose to remember are kept.
pub trait SecretStore: Send + Sync {
    fn get(&self, account: &str) -> Option<String>;
    /// Returns false if the secret could not be stored.
    fn set(&self, account: &str, secret: &str) -> bool;
    fn delete(&self, account: &str);
    /// False when no keyring is usable (e.g. Linux without a Secret Service).
    fn available(&self) -> bool;
}

const SERVICE: &str = "dev.tilde.app";

/// Keyring account for a login password.
#[must_use]
pub fn password_account(user: &str, host: &str, port: u16) -> String {
    format!("ssh-password:{user}@{host}:{port}")
}

/// Keyring account for a private key's passphrase (by absolute path).
#[must_use]
pub fn passphrase_account(key: &Path) -> String {
    let abs = std::path::absolute(key).unwrap_or_else(|_| key.to_path_buf());
    format!("ssh-passphrase:{}", abs.display())
}

/// The OS keyring (Windows Credential Manager, macOS Keychain, Secret Service).
/// Errors are logged without the secret and treated as "not stored".
#[derive(Debug, Default)]
pub struct KeyringStore {
    available: std::sync::OnceLock<bool>,
}

impl KeyringStore {
    fn entry(account: &str) -> Option<keyring::Entry> {
        keyring::Entry::new(SERVICE, account)
            .inspect_err(|e| tracing::warn!(error = %e, "keyring entry unavailable"))
            .ok()
    }
}

impl SecretStore for KeyringStore {
    fn get(&self, account: &str) -> Option<String> {
        match Self::entry(account)?.get_password() {
            Ok(secret) => Some(secret),
            Err(keyring::Error::NoEntry) => None,
            Err(e) => {
                tracing::warn!(error = %e, "keyring read failed");
                None
            }
        }
    }

    fn set(&self, account: &str, secret: &str) -> bool {
        Self::entry(account).is_some_and(|e| {
            e.set_password(secret)
                .inspect_err(|e| tracing::warn!(error = %e, "keyring write failed"))
                .is_ok()
        })
    }

    fn delete(&self, account: &str) {
        if let Some(e) = Self::entry(account) {
            let _ = e.delete_credential();
        }
    }

    /// Probes the platform store once: a missing entry means it works.
    fn available(&self) -> bool {
        *self.available.get_or_init(|| {
            Self::entry("tilde-probe")
                .is_some_and(|e| matches!(e.get_password(), Ok(_) | Err(keyring::Error::NoEntry)))
        })
    }
}

/// In-memory store: tests, and the per-session fallback when no keyring is available.
#[derive(Debug, Default)]
pub struct MemoryStore(Mutex<HashMap<String, String>>);

impl SecretStore for MemoryStore {
    fn get(&self, account: &str) -> Option<String> {
        self.0.lock().get(account).cloned()
    }
    fn set(&self, account: &str, secret: &str) -> bool {
        self.0.lock().insert(account.to_owned(), secret.to_owned());
        true
    }
    fn delete(&self, account: &str) {
        self.0.lock().remove(account);
    }
    fn available(&self) -> bool {
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn memory_store_roundtrip() {
        let s = MemoryStore::default();
        assert!(s.available());
        assert_eq!(s.get("a"), None);
        assert!(s.set("a", "secret"));
        assert_eq!(s.get("a").as_deref(), Some("secret"));
        s.delete("a");
        assert_eq!(s.get("a"), None);
    }

    #[test]
    fn secret_accounts_are_namespaced() {
        assert_eq!(password_account("alice", "h", 22), "ssh-password:alice@h:22");
        let acc = passphrase_account(Path::new("/keys/id_ed25519"));
        assert!(acc.starts_with("ssh-passphrase:"), "{acc}");
        assert!(acc.ends_with("id_ed25519"), "{acc}");
    }

    #[test]
    fn passphrase_account_uses_an_absolute_path() {
        let acc = passphrase_account(Path::new("relative/key"));
        let path = acc.trim_start_matches("ssh-passphrase:");
        assert!(Path::new(path).is_absolute(), "{acc}");
    }
}
