//! Keeps the app at its designed scale. WebView2 would otherwise let a touchpad or touch-screen pinch (or
//! Ctrl + mouse wheel) magnify the whole page and crop it, which looks like the layout "stretched" and does not
//! reset by itself. Bigger text is a setting in the app (Appearance → Text size), which re-flows the layout
//! instead. The UI also ignores zoom gestures (`src/lib/zoom-lock.ts`) in case a setting below is unavailable.

use tauri::WebviewWindow;

pub fn lock_zoom(window: &WebviewWindow) {
    let reached = window.with_webview(|webview| {
        #[cfg(windows)]
        apply(&webview);
        #[cfg(not(windows))]
        let _ = webview;
    });
    if let Err(e) = reached {
        log::warn!("could not reach the webview to lock zoom: {e}");
    }
}

/// Each setting needs a newer WebView2 runtime than the last, so they are applied one by one.
#[cfg(windows)]
fn apply(webview: &tauri::webview::PlatformWebview) {
    use webview2_com::Microsoft::Web::WebView2::Win32::{ICoreWebView2Settings, ICoreWebView2Settings5, ICoreWebView2Settings6};
    use windows_core::Interface;

    // SAFETY: COM calls on the UI thread (inside `with_webview`) on interfaces owned by the live webview.
    let settings: windows_core::Result<ICoreWebView2Settings> = unsafe { webview.controller().CoreWebView2().and_then(|w| w.Settings()) };
    let settings = match settings {
        Ok(s) => s,
        Err(e) => return log::warn!("could not read the webview settings: {e}"),
    };
    let steps: [(&str, windows_core::Result<()>); 3] = unsafe {
        [
            // Ctrl + mouse wheel and Ctrl + / - / 0.
            ("zoom keys", settings.SetIsZoomControlEnabled(false)),
            // Touchpad and touch-screen pinch.
            ("pinch zoom", settings.cast::<ICoreWebView2Settings5>().and_then(|s| s.SetIsPinchZoomEnabled(false))),
            // Touch-screen swipe = back / forward between screens.
            ("swipe navigation", settings.cast::<ICoreWebView2Settings6>().and_then(|s| s.SetIsSwipeNavigationEnabled(false))),
        ]
    };
    for (what, result) in steps {
        if let Err(e) = result {
            log::warn!("could not turn off {what}: {e}");
        }
    }
}
