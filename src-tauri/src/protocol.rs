//! `photo://` protocol: serves member photos straight from SQLite with long-lived cache headers.
//!
//! URL format (Windows WebView2): `http://photo.localhost/<member-id>?v=<version>&thumb=1`.
//! The version changes whenever the photo changes, so cached images never go stale.

use tauri::http::{Request, Response, StatusCode};
use tauri::{AppHandle, Manager, Runtime, UriSchemeResponder};

use crate::state::AppState;

pub fn handle<R: Runtime>(app: AppHandle<R>, request: Request<Vec<u8>>, responder: UriSchemeResponder) {
    let uri = request.uri().clone();
    tauri::async_runtime::spawn(async move {
        let id: String = uri.path().trim_matches('/').chars().take(64).collect();
        let thumb = uri.query().map(|q| q.split('&').any(|kv| kv == "thumb=1" || kv == "thumb")).unwrap_or(false);
        let found = if id.is_empty() {
            None
        } else {
            let state = app.state::<AppState>();
            state.open(move |c, _| danish_core::members::get_photo(c, &id, thumb)).await.ok().flatten()
        };
        let response = match found {
            Some((bytes, mime)) => Response::builder()
                .status(StatusCode::OK)
                .header("Content-Type", mime)
                .header("Cache-Control", "public, max-age=31536000, immutable")
                .header("Access-Control-Allow-Origin", "*")
                .body(bytes),
            None => Response::builder()
                .status(StatusCode::NOT_FOUND)
                .header("Content-Type", "text/plain")
                .header("Cache-Control", "no-store")
                .body(b"no photo".to_vec()),
        };
        match response {
            Ok(r) => responder.respond(r),
            Err(e) => log::error!("photo protocol response error: {e}"),
        }
    });
}
