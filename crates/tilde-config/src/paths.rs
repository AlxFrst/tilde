use std::path::PathBuf;

/// Location of Tilde's configuration files.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConfigPaths {
    pub root: PathBuf,
}

impl ConfigPaths {
    #[must_use]
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }

    /// `TILDE_CONFIG_DIR` when set (a portable install, a demo or test profile), else the
    /// OS-standard config directory (`%APPDATA%\Tilde`, `~/.config/Tilde`, …).
    #[must_use]
    pub fn from_os() -> Option<Self> {
        Self::from_override(std::env::var_os("TILDE_CONFIG_DIR"))
    }

    pub(crate) fn from_override(dir: Option<std::ffi::OsString>) -> Option<Self> {
        match dir {
            Some(d) if !d.is_empty() => Some(Self::new(d)),
            _ => Self::from_os_dirs(),
        }
    }

    pub(crate) fn from_os_dirs() -> Option<Self> {
        dirs::config_dir().map(|d| Self::new(d.join("Tilde")))
    }

    #[must_use]
    pub fn settings_file(&self) -> PathBuf {
        self.root.join("settings.json")
    }

    #[must_use]
    pub fn schema_file(&self) -> PathBuf {
        self.root.join("settings.schema.json")
    }

    #[must_use]
    pub fn connections_file(&self) -> PathBuf {
        self.root.join("connections.json")
    }

    #[must_use]
    pub fn connections_schema_file(&self) -> PathBuf {
        self.root.join("connections.schema.json")
    }

    #[must_use]
    pub fn workspace_file(&self) -> PathBuf {
        self.root.join("workspace.json")
    }

    /// User themes, one `<id>.json` each.
    #[must_use]
    pub fn themes_dir(&self) -> PathBuf {
        self.root.join("themes")
    }

    #[must_use]
    pub fn keybindings_file(&self) -> PathBuf {
        self.root.join("keybindings.json")
    }

    #[must_use]
    pub fn keybindings_schema_file(&self) -> PathBuf {
        self.root.join("keybindings.schema.json")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_explicit_config_dir_wins_over_the_os_one() {
        let paths = ConfigPaths::from_override(Some("D:/demo/Tilde".into())).unwrap();
        assert_eq!(paths.root, PathBuf::from("D:/demo/Tilde"));
        assert_eq!(ConfigPaths::from_override(Some("".into())), ConfigPaths::from_os_dirs());
        assert_eq!(ConfigPaths::from_override(None), ConfigPaths::from_os_dirs());
    }
}
