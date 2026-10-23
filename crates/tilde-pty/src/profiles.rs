//! Merging detected shells with the user's profiles from settings.json.

use std::collections::BTreeMap;

use serde::Serialize;
use tilde_config::Profile;

use crate::ShellCandidate;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ProfileSource {
    Detected,
    User,
}

/// A launchable profile, as shown in the UI.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedProfile {
    pub id: String,
    pub name: String,
    pub command: String,
    pub args: Vec<String>,
    pub cwd: Option<String>,
    pub env: BTreeMap<String, String>,
    pub icon: String,
    pub color: Option<String>,
    pub source: ProfileSource,
}

fn non_empty(s: &str) -> Option<String> {
    (!s.is_empty()).then(|| s.to_owned())
}

/// Detected shells first (in detection order), each optionally overridden or hidden
/// by a user profile of the same id; then the user's own profiles.
#[must_use]
pub fn resolve_profiles(detected: &[ShellCandidate], user: &[Profile]) -> Vec<ResolvedProfile> {
    let by_id = |id: &str| user.iter().find(|p| p.id == id);
    let mut out: Vec<ResolvedProfile> = detected
        .iter()
        .filter(|d| !by_id(&d.id).is_some_and(|u| u.hidden))
        .map(|d| {
            let mut r = ResolvedProfile {
                id: d.id.clone(),
                name: d.name.clone(),
                command: d.command.clone(),
                args: d.args.clone(),
                cwd: None,
                env: BTreeMap::new(),
                icon: d.icon.to_owned(),
                color: None,
                source: ProfileSource::Detected,
            };
            if let Some(u) = by_id(&d.id) {
                r.name = non_empty(&u.name).unwrap_or(r.name);
                r.command = non_empty(&u.command).unwrap_or(r.command);
                if !u.args.is_empty() {
                    r.args.clone_from(&u.args);
                }
                r.cwd.clone_from(&u.cwd);
                r.env.extend(u.env.clone());
                r.icon = u.icon.clone().unwrap_or(r.icon);
                r.color.clone_from(&u.color);
            }
            r
        })
        .collect();

    for u in user {
        let is_new = !detected.iter().any(|d| d.id == u.id);
        if is_new && !u.hidden && !u.command.is_empty() {
            out.push(ResolvedProfile {
                id: u.id.clone(),
                name: non_empty(&u.name).unwrap_or_else(|| u.id.clone()),
                command: u.command.clone(),
                args: u.args.clone(),
                cwd: u.cwd.clone(),
                env: u.env.clone(),
                icon: u.icon.clone().unwrap_or_else(|| "terminal".into()),
                color: u.color.clone(),
                source: ProfileSource::User,
            });
        } else if is_new && !u.hidden {
            tracing::warn!(id = %u.id, "profile ignored: it has no command");
        }
    }
    out
}

/// The profile named `wanted` if it exists, otherwise the first one.
#[must_use]
pub fn pick_default<'a>(
    profiles: &'a [ResolvedProfile],
    wanted: Option<&str>,
) -> Option<&'a ResolvedProfile> {
    wanted.and_then(|w| profiles.iter().find(|p| p.id == w)).or_else(|| profiles.first())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pwsh() -> ShellCandidate {
        ShellCandidate {
            id: "pwsh".into(),
            name: "PowerShell".into(),
            command: "pwsh.exe".into(),
            args: vec![],
            icon: "powershell",
        }
    }

    fn cmd() -> ShellCandidate {
        ShellCandidate {
            id: "cmd".into(),
            name: "Invite de commandes".into(),
            command: "cmd.exe".into(),
            args: vec![],
            icon: "cmd",
        }
    }

    fn user(id: &str) -> Profile {
        Profile { id: id.into(), ..Profile::default() }
    }

    #[test]
    fn user_profile_overrides_detected_fields() {
        let mut p = user("pwsh");
        p.color = Some("#7AA2F7".into());
        p.env.insert("FOO".into(), "1".into());
        let out = resolve_profiles(&[pwsh()], &[p]);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].name, "PowerShell");
        assert_eq!(out[0].command, "pwsh.exe");
        assert_eq!(out[0].color.as_deref(), Some("#7AA2F7"));
        assert_eq!(out[0].env["FOO"], "1");
        assert_eq!(out[0].source, ProfileSource::Detected);
    }

    #[test]
    fn hidden_user_profile_removes_detected() {
        let mut p = user("cmd");
        p.hidden = true;
        let out = resolve_profiles(&[pwsh(), cmd()], &[p]);
        assert!(out.iter().all(|r| r.id != "cmd"));
        assert_eq!(out.len(), 1);
    }

    #[test]
    fn custom_user_profile_is_appended() {
        let mut htop = user("htop");
        htop.name = "htop".into();
        htop.command = "wsl.exe".into();
        htop.args = vec!["-e".into(), "htop".into()];
        let no_command = user("broken");
        let out = resolve_profiles(&[pwsh()], &[htop, no_command]);
        assert_eq!(out.len(), 2);
        let last = &out[1];
        assert_eq!((last.id.as_str(), last.source), ("htop", ProfileSource::User));
        assert_eq!(last.icon, "terminal");
        assert_eq!(last.args, ["-e", "htop"]);
    }

    #[test]
    fn unknown_default_falls_back_to_first() {
        let profiles = resolve_profiles(&[pwsh(), cmd()], &[]);
        assert_eq!(pick_default(&profiles, Some("nope")).unwrap().id, "pwsh");
        assert_eq!(pick_default(&profiles, Some("cmd")).unwrap().id, "cmd");
        assert_eq!(pick_default(&profiles, None).unwrap().id, "pwsh");
        assert!(pick_default(&[], Some("cmd")).is_none());
    }
}
