//! Which authentication methods to try, and in what order (OpenSSH's order, spec §4.4).

use std::path::{Path, PathBuf};

use tilde_ssh_config::ResolvedHost;

/// One authentication attempt.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AuthStep {
    /// Every identity the SSH agent offers.
    Agent,
    /// A private key file (from `IdentityFile`, or a default key that exists).
    Key(PathBuf),
    KeyboardInteractive,
    Password,
}

/// Default keys tried when the config lists none, as OpenSSH does.
pub const DEFAULT_KEYS: [&str; 3] = ["id_ed25519", "id_ecdsa", "id_rsa"];

/// The ordered plan: agent → `IdentityFile`s → default keys that exist on disk →
/// keyboard-interactive → password. `IdentitiesOnly yes` skips the agent and the
/// default keys.
#[must_use]
pub fn auth_plan(host: &ResolvedHost, home: &Path, agent_available: bool) -> Vec<AuthStep> {
    let mut plan = Vec::new();
    if agent_available && !host.identities_only {
        plan.push(AuthStep::Agent);
    }
    plan.extend(host.identity_files.iter().cloned().map(AuthStep::Key));
    if !host.identities_only {
        for name in DEFAULT_KEYS {
            let path = home.join(".ssh").join(name);
            if path.is_file() && !host.identity_files.contains(&path) {
                plan.push(AuthStep::Key(path));
            }
        }
    }
    plan.push(AuthStep::KeyboardInteractive);
    plan.push(AuthStep::Password);
    plan
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tilde_ssh_config::{ResolveContext, parse_str};

    use super::*;

    fn resolve(config: &str, home: &Path) -> ResolvedHost {
        let ctx = ResolveContext { local_user: "me".into(), home: home.to_path_buf() };
        parse_str(config, &home.join(".ssh/config")).resolve("h", &ctx)
    }

    #[test]
    fn full_order_with_agent() {
        let home = tempfile::TempDir::new().unwrap();
        let host = resolve("Host h\n IdentityFile ~/.ssh/work\n", home.path());
        let plan = auth_plan(&host, home.path(), true);
        assert_eq!(
            plan,
            [
                AuthStep::Agent,
                AuthStep::Key(home.path().join(".ssh/work")),
                AuthStep::KeyboardInteractive,
                AuthStep::Password,
            ]
        );
    }

    #[test]
    fn default_keys_are_tried_only_if_they_exist() {
        let home = tempfile::TempDir::new().unwrap();
        let ssh = home.path().join(".ssh");
        fs::create_dir_all(&ssh).unwrap();
        fs::write(ssh.join("id_rsa"), "x").unwrap();
        let host = resolve("Host h\n", home.path());
        let plan = auth_plan(&host, home.path(), false);
        assert_eq!(
            plan,
            [AuthStep::Key(ssh.join("id_rsa")), AuthStep::KeyboardInteractive, AuthStep::Password]
        );
    }

    #[test]
    fn auth_order_respects_identities_only() {
        let home = tempfile::TempDir::new().unwrap();
        let ssh = home.path().join(".ssh");
        fs::create_dir_all(&ssh).unwrap();
        fs::write(ssh.join("id_ed25519"), "x").unwrap();
        let host = resolve("Host h\n IdentitiesOnly yes\n IdentityFile ~/.ssh/only\n", home.path());
        let plan = auth_plan(&host, home.path(), true);
        assert_eq!(
            plan,
            [AuthStep::Key(ssh.join("only")), AuthStep::KeyboardInteractive, AuthStep::Password]
        );
    }

    #[test]
    fn explicit_identity_file_is_not_repeated_as_a_default() {
        let home = tempfile::TempDir::new().unwrap();
        let ssh = home.path().join(".ssh");
        fs::create_dir_all(&ssh).unwrap();
        fs::write(ssh.join("id_rsa"), "x").unwrap();
        let host = resolve("Host h\n IdentityFile ~/.ssh/id_rsa\n", home.path());
        let keys: Vec<_> = auth_plan(&host, home.path(), false)
            .into_iter()
            .filter(|s| matches!(s, AuthStep::Key(_)))
            .collect();
        assert_eq!(keys, [AuthStep::Key(ssh.join("id_rsa"))]);
    }
}
