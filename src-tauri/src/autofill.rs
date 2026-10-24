//! `WebView2` remembers what is typed in fields (hosts, users, names) in its own profile and
//! offers it back in a popup: neither the place for that data nor a themed widget. Its
//! general autofill and password autosave are turned off for every Tilde window. Other
//! platforms' web views have no such store.

/// Turns off `WebView2`'s autofill and password autosave for `window`.
#[cfg(windows)]
pub fn disable(window: &tauri::WebviewWindow) {
    use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Settings4;
    use windows::core::Interface;

    let result = window.with_webview(|webview| {
        // SAFETY: COM calls on the controller Tauri hands over, on its own thread.
        let settings = unsafe { webview.controller().CoreWebView2().and_then(|c| c.Settings()) };
        let Ok(settings) = settings.and_then(|s| s.cast::<ICoreWebView2Settings4>()) else {
            tracing::warn!("WebView2 settings unavailable: autofill left on");
            return;
        };
        // SAFETY: plain setters on a live settings object.
        unsafe {
            let _ = settings.SetIsGeneralAutofillEnabled(false);
            let _ = settings.SetIsPasswordAutosaveEnabled(false);
        }
    });
    if let Err(e) = result {
        tracing::warn!(error = %e, "WebView2 autofill not turned off");
    }
}

#[cfg(not(windows))]
pub fn disable(_window: &tauri::WebviewWindow) {}
