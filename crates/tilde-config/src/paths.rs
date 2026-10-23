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

    /// The OS-standard config directory (`%APPDATA%\Tilde`, `~/.config/Tilde`, …).
    #[must_use]
    pub fn from_os() -> Option<Self> {
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
