//! Window background effects (Mica, Acrylic, vibrancy) through Tauri's `set_effects`,
//! which uses the `window-vibrancy` crate.
//!
//! The window is created transparent; the front-end makes its backgrounds translucent
//! (`appearance.window.opacity`) so the effect, or the desktop, shows through.

use serde::Serialize;
use tauri::{
    State, WebviewWindow,
    window::{Effect, EffectState, EffectsBuilder},
};
use tilde_config::WindowEffect;

use crate::state::AppState;

/// Each build constructs only its own platform's variant (the others appear in tests).
#[allow(dead_code)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Platform {
    Windows { build: u32 },
    MacOs,
    Linux,
}

impl Platform {
    #[must_use]
    pub fn current() -> Self {
        #[cfg(windows)]
        {
            Self::Windows { build: windows_version::OsVersion::current().build }
        }
        #[cfg(target_os = "macos")]
        {
            Self::MacOs
        }
        #[cfg(not(any(windows, target_os = "macos")))]
        {
            Self::Linux
        }
    }
}

/// The effect actually shown.
#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AppliedEffect {
    None,
    Mica,
    Acrylic,
    Vibrancy,
}

/// Windows 11 (Mica).
const WIN11: u32 = 22_000;
/// Windows 10 1809 (Acrylic).
const WIN10_1809: u32 = 17_763;

/// What a requested effect becomes on this platform: Mica falls back to Acrylic on
/// Windows 10; anything unsupported means no effect (opacity alone).
#[must_use]
pub fn effect_plan(effect: WindowEffect, platform: Platform) -> AppliedEffect {
    match (effect, platform) {
        (WindowEffect::Mica, Platform::Windows { build }) if build >= WIN11 => AppliedEffect::Mica,
        (WindowEffect::Mica | WindowEffect::Acrylic, Platform::Windows { build })
            if build >= WIN10_1809 =>
        {
            AppliedEffect::Acrylic
        }
        (WindowEffect::Vibrancy, Platform::MacOs) => AppliedEffect::Vibrancy,
        _ => AppliedEffect::None,
    }
}

/// The effects this platform shows as asked (the settings page greys out the others).
#[must_use]
pub fn supported_effects(platform: Platform) -> Vec<WindowEffect> {
    [WindowEffect::None, WindowEffect::Mica, WindowEffect::Acrylic, WindowEffect::Vibrancy]
        .into_iter()
        .filter(|&e| {
            let applied = effect_plan(e, platform);
            matches!(
                (e, applied),
                (WindowEffect::None, AppliedEffect::None)
                    | (WindowEffect::Mica, AppliedEffect::Mica)
                    | (WindowEffect::Acrylic, AppliedEffect::Acrylic)
                    | (WindowEffect::Vibrancy, AppliedEffect::Vibrancy)
            )
        })
        .collect()
}

/// Applies `appearance.window.effect` to the calling window. `dark` picks the Mica
/// variant that matches the theme.
#[tauri::command]
#[allow(clippy::needless_pass_by_value)] // Tauri hands command arguments over by value.
pub fn window_apply_effects(
    window: WebviewWindow,
    state: State<'_, AppState>,
    dark: bool,
) -> AppliedEffect {
    let requested = state.settings.lock().settings().appearance.window.effect;
    let applied = effect_plan(requested, Platform::current());
    let effect = match applied {
        AppliedEffect::None => None,
        AppliedEffect::Mica => Some(if dark { Effect::MicaDark } else { Effect::MicaLight }),
        AppliedEffect::Acrylic => Some(Effect::Acrylic),
        AppliedEffect::Vibrancy => Some(Effect::UnderWindowBackground),
    };
    let config = effect.map(|e| {
        EffectsBuilder::new().effect(e).state(EffectState::FollowsWindowActiveState).build()
    });
    match window.set_effects(config) {
        Ok(()) => applied,
        Err(e) => {
            tracing::warn!(error = %e, ?requested, "window effect could not be applied");
            AppliedEffect::None
        }
    }
}

#[tauri::command]
pub fn window_supported_effects() -> Vec<WindowEffect> {
    supported_effects(Platform::current())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn effect_plan_falls_back_per_platform() {
        let win11 = Platform::Windows { build: 22_631 };
        let win10 = Platform::Windows { build: 19_045 };
        let old = Platform::Windows { build: 17_000 };
        let cases = [
            (WindowEffect::Mica, win11, AppliedEffect::Mica),
            (WindowEffect::Mica, win10, AppliedEffect::Acrylic),
            (WindowEffect::Mica, old, AppliedEffect::None),
            (WindowEffect::Acrylic, win11, AppliedEffect::Acrylic),
            (WindowEffect::Acrylic, old, AppliedEffect::None),
            (WindowEffect::Vibrancy, win11, AppliedEffect::None),
            (WindowEffect::Vibrancy, Platform::MacOs, AppliedEffect::Vibrancy),
            (WindowEffect::Mica, Platform::MacOs, AppliedEffect::None),
            (WindowEffect::Mica, Platform::Linux, AppliedEffect::None),
            (WindowEffect::Vibrancy, Platform::Linux, AppliedEffect::None),
        ];
        for (effect, platform, expected) in cases {
            assert_eq!(effect_plan(effect, platform), expected, "{effect:?} on {platform:?}");
        }
        for platform in [win11, Platform::MacOs, Platform::Linux] {
            assert_eq!(effect_plan(WindowEffect::None, platform), AppliedEffect::None);
        }
    }

    #[test]
    fn supported_effects_per_platform() {
        use WindowEffect::{Acrylic, Mica, None, Vibrancy};
        assert_eq!(supported_effects(Platform::Windows { build: 22_631 }), [None, Mica, Acrylic]);
        assert_eq!(supported_effects(Platform::Windows { build: 19_045 }), [None, Acrylic]);
        assert_eq!(supported_effects(Platform::MacOs), [None, Vibrancy]);
        assert_eq!(supported_effects(Platform::Linux), [None]);
    }
}
