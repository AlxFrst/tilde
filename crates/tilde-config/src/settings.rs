//! The typed settings model. JSON keys are camelCase; every struct is
//! `#[serde(default)]` so a partial `settings.json` is filled with defaults.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::{ConfigError, FieldError};

/// Current on-disk format version of `settings.json`.
pub const SETTINGS_VERSION: u32 = 1;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(default, rename_all = "camelCase")]
pub struct Settings {
    pub version: u32,
    pub appearance: Appearance,
    pub terminal: Terminal,
    pub ssh: Ssh,
    pub sftp: Sftp,
    pub general: General,
    /// User profiles. One whose `id` matches a detected shell overrides it.
    pub profiles: Vec<Profile>,
}

/// A user-defined shell profile, or overrides for a detected one (same `id`).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(default, rename_all = "camelCase")]
pub struct Profile {
    pub id: String,
    pub name: String,
    pub command: String,
    pub args: Vec<String>,
    pub cwd: Option<String>,
    pub env: std::collections::BTreeMap<String, String>,
    pub icon: Option<String>,
    pub color: Option<String>,
    /// Hides a detected shell from the profile list.
    pub hidden: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            version: SETTINGS_VERSION,
            appearance: Appearance::default(),
            terminal: Terminal::default(),
            ssh: Ssh::default(),
            sftp: Sftp::default(),
            general: General::default(),
            profiles: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum ColorScheme {
    #[default]
    System,
    Dark,
    Light,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum Density {
    Compact,
    #[default]
    Comfortable,
    Spacious,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum SidebarPosition {
    #[default]
    Left,
    Right,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum WindowEffect {
    #[default]
    None,
    Mica,
    Acrylic,
    Vibrancy,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum CursorStyle {
    #[default]
    Block,
    Bar,
    Underline,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum RightClick {
    #[default]
    Menu,
    Paste,
    CopyPaste,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum EditorMode {
    #[default]
    External,
    Builtin,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(default, rename_all = "camelCase")]
pub struct Appearance {
    pub color_scheme: ColorScheme,
    pub theme_dark: String,
    pub theme_light: String,
    pub ui_font_family: String,
    #[schemars(range(min = 10, max = 20))]
    pub ui_font_size: u8,
    pub density: Density,
    pub sidebar_position: SidebarPosition,
    #[schemars(range(min = 180, max = 480))]
    pub sidebar_width: u16,
    pub window: WindowAppearance,
    /// Hosts of `~/.ssh/config` listed in the sidebar.
    pub ssh_config_hosts: SshConfigHosts,
}

impl Default for Appearance {
    fn default() -> Self {
        Self {
            color_scheme: ColorScheme::System,
            theme_dark: "tilde-dark".into(),
            theme_light: "tilde-light".into(),
            ui_font_family: "Geist Variable".into(),
            ui_font_size: 13,
            density: Density::Comfortable,
            sidebar_position: SidebarPosition::Left,
            sidebar_width: 260,
            window: WindowAppearance::default(),
            ssh_config_hosts: SshConfigHosts::default(),
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(default, rename_all = "camelCase")]
pub struct SshConfigHosts {
    /// Aliases tucked away in the section's collapsed "Masqués" group (still adoptable).
    pub hidden: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(default, rename_all = "camelCase")]
pub struct WindowAppearance {
    pub effect: WindowEffect,
    #[schemars(range(min = 0.3, max = 1.0))]
    pub opacity: f64,
}

impl Default for WindowAppearance {
    fn default() -> Self {
        Self { effect: WindowEffect::None, opacity: 1.0 }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(default, rename_all = "camelCase")]
#[allow(clippy::struct_excessive_bools)]
pub struct Terminal {
    pub font_family: String,
    #[schemars(range(min = 6, max = 72))]
    pub font_size: u8,
    #[schemars(range(min = 0.8, max = 3.0))]
    pub line_height: f64,
    pub ligatures: bool,
    pub cursor_style: CursorStyle,
    pub cursor_blink: bool,
    #[schemars(range(min = 0, max = 1_000_000))]
    pub scrollback: u32,
    pub default_profile: Option<String>,
    pub copy_on_select: bool,
    pub right_click: RightClick,
    pub confirm_close: bool,
}

impl Default for Terminal {
    fn default() -> Self {
        Self {
            font_family: "JetBrains Mono Variable".into(),
            font_size: 14,
            line_height: 1.2,
            ligatures: true,
            cursor_style: CursorStyle::Block,
            cursor_blink: true,
            scrollback: 10_000,
            default_profile: None,
            copy_on_select: false,
            right_click: RightClick::Menu,
            confirm_close: true,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(default, rename_all = "camelCase")]
pub struct Ssh {
    #[schemars(range(min = 0, max = 3600))]
    pub keepalive_interval_secs: u32,
    #[schemars(range(min = 1, max = 100))]
    pub keepalive_count_max: u32,
    pub auto_reconnect: bool,
    pub confirm_close_ssh: bool,
    /// The strip under SSH terminals with the server's CPU, memory, disk and network.
    pub status_bar: bool,
}

impl Default for Ssh {
    fn default() -> Self {
        Self {
            keepalive_interval_secs: 15,
            keepalive_count_max: 3,
            auto_reconnect: true,
            confirm_close_ssh: true,
            status_bar: true,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(default, rename_all = "camelCase")]
pub struct Sftp {
    #[schemars(range(min = 1, max = 16))]
    pub concurrency: u8,
    pub editor_mode: EditorMode,
    pub external_editor: Option<String>,
}

impl Default for Sftp {
    fn default() -> Self {
        Self { concurrency: 3, editor_mode: EditorMode::External, external_editor: None }
    }
}

/// The interface's language. `Auto` follows the system: French on a French system,
/// English everywhere else.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum Language {
    #[default]
    Auto,
    Fr,
    En,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(default, rename_all = "camelCase")]
pub struct General {
    pub language: Language,
    pub restore_session: bool,
    pub quake: Quake,
    /// Look for a new version on GitHub at startup (at most once a day).
    pub check_updates: bool,
    /// "Ouvrir dans Tilde" in Windows Explorer's context menu (folders, drives, the
    /// background of an open folder). Ignored on other systems.
    pub explorer_menu: bool,
}

impl Default for General {
    fn default() -> Self {
        Self {
            language: Language::Auto,
            restore_session: true,
            quake: Quake::default(),
            check_updates: true,
            explorer_menu: true,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(default, rename_all = "camelCase")]
pub struct Quake {
    pub enabled: bool,
    pub shortcut: String,
}

impl Default for Quake {
    fn default() -> Self {
        // Not a symbol key: global shortcuts follow virtual keys, which move with the layout.
        Self { enabled: false, shortcut: "Alt+F12".into() }
    }
}

/// Collects range violations; bounds mirror the `#[schemars(range)]` attributes.
struct RangeCheck(Vec<FieldError>);

impl RangeCheck {
    fn check<T: PartialOrd + std::fmt::Display + Copy>(
        &mut self,
        path: &str,
        value: T,
        min: T,
        max: T,
    ) {
        if !(min <= value && value <= max) {
            self.0.push(FieldError {
                path: path.to_owned(),
                message: format!("{value} n'est pas entre {min} et {max}"),
            });
        }
    }
}

impl Settings {
    /// Checks every bounded field and reports **all** violations at once.
    ///
    /// # Errors
    ///
    /// Returns [`ConfigError::Invalid`] listing each out-of-range field.
    pub fn validate(&self) -> Result<(), ConfigError> {
        let mut c = RangeCheck(Vec::new());
        let a = &self.appearance;
        c.check("appearance.uiFontSize", a.ui_font_size, 10, 20);
        c.check("appearance.sidebarWidth", a.sidebar_width, 180, 480);
        c.check("appearance.window.opacity", a.window.opacity, 0.3, 1.0);
        let t = &self.terminal;
        c.check("terminal.fontSize", t.font_size, 6, 72);
        c.check("terminal.lineHeight", t.line_height, 0.8, 3.0);
        c.check("terminal.scrollback", t.scrollback, 0, 1_000_000);
        c.check("ssh.keepaliveIntervalSecs", self.ssh.keepalive_interval_secs, 0, 3600);
        c.check("ssh.keepaliveCountMax", self.ssh.keepalive_count_max, 1, 100);
        c.check("sftp.concurrency", self.sftp.concurrency, 1, 16);
        if c.0.is_empty() { Ok(()) } else { Err(ConfigError::Invalid(c.0)) }
    }
}

/// JSON Schema for `settings.json`, used for editor autocompletion and TS type generation.
///
/// The `$id` is an identifier only; nothing is ever fetched from it.
///
/// # Panics
///
/// Never in practice: a derived schema always serializes to JSON.
#[must_use]
pub fn settings_schema() -> serde_json::Value {
    let mut schema = serde_json::to_value(schemars::schema_for!(Settings))
        .expect("a derived JSON schema always serializes");
    if let Some(obj) = schema.as_object_mut() {
        obj.insert("$id".into(), "https://tilde.dev/schemas/settings.schema.json".into());
        // Every settings.json starts with a `$schema` key; declare it so editors don't flag it.
        if let Some(props) = obj.get_mut("properties").and_then(|p| p.as_object_mut()) {
            props.insert("$schema".into(), serde_json::json!({ "type": "string" }));
        }
    }
    schema
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ConfigError;

    #[test]
    fn language_follows_the_system_unless_chosen() {
        assert_eq!(Settings::default().general.language, Language::Auto);
        let en: Settings = serde_json::from_str(r#"{"general":{"language":"en"}}"#).unwrap();
        assert_eq!(en.general.language, Language::En);
        assert!(serde_json::from_str::<Settings>(r#"{"general":{"language":"de"}}"#).is_err());
    }

    #[test]
    fn defaults_are_valid() {
        let s = Settings::default();
        assert!(s.validate().is_ok());
        assert_eq!(s.version, SETTINGS_VERSION);
    }

    #[test]
    fn update_checks_are_on_by_default_and_can_be_turned_off() {
        let s: Settings = serde_json::from_str(r#"{"general":{"restoreSession":false}}"#).unwrap();
        assert!(s.general.check_updates);
        let off: Settings = serde_json::from_str(r#"{"general":{"checkUpdates":false}}"#).unwrap();
        assert!(!off.general.check_updates);
    }

    #[test]
    fn no_ssh_host_is_tucked_away_and_the_status_bar_shows_by_default() {
        let s = Settings::default();
        assert_eq!(s.appearance.ssh_config_hosts, SshConfigHosts::default());
        assert!(s.ssh.status_bar);
        let custom: Settings = serde_json::from_str(
            r#"{"appearance":{"sshConfigHosts":{"hidden":["old-box"]}},"ssh":{"statusBar":false}}"#,
        )
        .unwrap();
        assert_eq!(custom.appearance.ssh_config_hosts.hidden, ["old-box"]);
        assert!(!custom.ssh.status_bar);
    }

    #[test]
    fn open_in_tilde_is_offered_in_explorer_by_default() {
        assert!(Settings::default().general.explorer_menu);
        let off: Settings = serde_json::from_str(r#"{"general":{"explorerMenu":false}}"#).unwrap();
        assert!(!off.general.explorer_menu);
    }

    #[test]
    fn partial_json_fills_defaults() {
        let s: Settings = serde_json::from_str(r#"{"terminal":{"fontSize":16}}"#).unwrap();
        assert_eq!(s.terminal.font_size, 16);
        assert!((s.terminal.line_height - 1.2).abs() < f64::EPSILON);
        assert_eq!(s.appearance.theme_dark, "tilde-dark");
        assert_eq!(s.profiles, []);
    }

    #[test]
    fn profiles_roundtrip() {
        let s: Settings =
            serde_json::from_str(r#"{"profiles":[{"id":"x","name":"X","command":"bash"}]}"#)
                .unwrap();
        let p = &s.profiles[0];
        assert_eq!((p.id.as_str(), p.command.as_str()), ("x", "bash"));
        assert_eq!(p.args, Vec::<String>::new());
        assert!(!p.hidden);
    }

    #[test]
    fn validate_reports_all_out_of_range_fields() {
        let mut s = Settings::default();
        s.terminal.font_size = 2;
        s.appearance.window.opacity = 0.1;
        let Err(ConfigError::Invalid(errors)) = s.validate() else {
            panic!("expected Invalid");
        };
        let paths: Vec<_> = errors.iter().map(|e| e.path.as_str()).collect();
        assert_eq!(paths.len(), 2);
        assert!(paths.contains(&"terminal.fontSize"));
        assert!(paths.contains(&"appearance.window.opacity"));
    }

    #[test]
    fn schema_snapshot() {
        insta::assert_json_snapshot!(settings_schema());
    }
}
