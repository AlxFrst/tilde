use tauri::State;
use tilde_pty::{ResolvedProfile, ShellCandidate, detect_shells, resolve_profiles};

use crate::state::AppState;

/// Detected shells (cached; detection runs `wsl.exe`, which takes a moment)
/// merged with the user's profiles from the current settings.
pub(crate) fn current_profiles(state: &AppState) -> Vec<ResolvedProfile> {
    let detected = detected_shells(state);
    let user = state.settings.lock().settings().profiles.clone();
    resolve_profiles(&detected, &user)
}

pub(crate) fn detected_shells(state: &AppState) -> Vec<ShellCandidate> {
    let mut cache = state.shells.lock();
    cache.get_or_insert_with(detect_shells).clone()
}

#[tauri::command]
pub async fn profiles_list(state: State<'_, AppState>) -> Result<Vec<ResolvedProfile>, ()> {
    Ok(current_profiles(&state))
}

/// Re-runs shell detection (e.g. after installing a WSL distribution).
#[tauri::command]
pub async fn profiles_refresh(state: State<'_, AppState>) -> Result<Vec<ResolvedProfile>, ()> {
    *state.shells.lock() = None;
    Ok(current_profiles(&state))
}
