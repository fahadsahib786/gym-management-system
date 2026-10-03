//! "Save as PDF": prints what is currently in the print view (`#print-root`, the same content `window.print()`
//! would print) straight to a PDF file with WebView2's PrintToPdf — selectable text, embedded fonts, no dialog.

use std::path::PathBuf;
use std::sync::mpsc;
use std::time::Duration;

use danish_core::{CoreError, CoreResult};
use serde::Deserialize;
use tauri::WebviewWindow;

/// Page set-up of a PDF; matches the `@page` rule the UI uses for the same document.
#[derive(Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PdfPaper {
    /// Receipts.
    A5,
    /// Invoices and reports.
    A4,
    /// Member cards: A4 with narrow top/bottom margins.
    Cards,
}

impl PdfPaper {
    /// (width, height, top/bottom margin, left/right margin) in inches.
    fn layout(self) -> (f64, f64, f64, f64) {
        const MM: f64 = 1.0 / 25.4;
        match self {
            PdfPaper::A5 => (148.0 * MM, 210.0 * MM, 10.0 * MM, 10.0 * MM),
            PdfPaper::A4 => (210.0 * MM, 297.0 * MM, 12.0 * MM, 12.0 * MM),
            PdfPaper::Cards => (210.0 * MM, 297.0 * MM, 7.0 * MM, 0.0),
        }
    }
}

/// Writes the window's print view to `path`. Waits (off the UI thread) until WebView2 reports completion.
pub async fn save(window: &WebviewWindow, path: PathBuf, paper: PdfPaper) -> CoreResult<()> {
    let (tx, rx) = mpsc::channel::<Result<(), String>>();
    let target = path.clone();
    window
        .with_webview(move |webview| {
            #[cfg(windows)]
            {
                let done = tx.clone();
                if let Err(e) = print_to_pdf(&webview, &target, paper, tx) {
                    let _ = done.send(Err(e.message()));
                }
            }
            #[cfg(not(windows))]
            {
                let _ = (webview, target, paper);
                let _ = tx.send(Err("Saving as PDF is only available on Windows.".into()));
            }
        })
        .map_err(|e| CoreError::other(format!("Could not create the PDF: {e}")))?;
    let outcome = tauri::async_runtime::spawn_blocking(move || rx.recv_timeout(Duration::from_secs(60)))
        .await
        .map_err(|e| CoreError::other(format!("background task failed: {e}")))?;
    match outcome {
        Ok(Ok(())) if path.is_file() => Ok(()),
        Ok(Ok(())) => Err(CoreError::other("The PDF was not written. Choose another folder and try again.")),
        Ok(Err(msg)) => Err(CoreError::other(format!("Could not create the PDF: {msg}"))),
        Err(_) => Err(CoreError::other("Creating the PDF took too long. Try again.")),
    }
}

#[cfg(windows)]
fn print_to_pdf(
    webview: &tauri::webview::PlatformWebview,
    path: &std::path::Path,
    paper: PdfPaper,
    done: mpsc::Sender<Result<(), String>>,
) -> windows_core::Result<()> {
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2Controller2, ICoreWebView2Environment6, ICoreWebView2_7, COREWEBVIEW2_COLOR,
        COREWEBVIEW2_PRINT_ORIENTATION_PORTRAIT,
    };
    use webview2_com::PrintToPdfCompletedHandler;
    use windows_core::{Interface, HSTRING};

    let (width, height, margin_y, margin_x) = paper.layout();
    // SAFETY: COM calls on the UI thread (inside `with_webview`) on interfaces owned by the live webview.
    unsafe {
        let controller = webview.controller();
        let webview7: ICoreWebView2_7 = controller.CoreWebView2()?.cast()?;
        let environment: ICoreWebView2Environment6 = webview.environment().cast()?;
        let settings = environment.CreatePrintSettings()?;
        settings.SetOrientation(COREWEBVIEW2_PRINT_ORIENTATION_PORTRAIT)?;
        settings.SetPageWidth(width)?;
        settings.SetPageHeight(height)?;
        settings.SetMarginTop(margin_y)?;
        settings.SetMarginBottom(margin_y)?;
        settings.SetMarginLeft(margin_x)?;
        settings.SetMarginRight(margin_x)?;
        settings.SetShouldPrintBackgrounds(true)?;
        settings.SetShouldPrintHeaderAndFooter(false)?;

        // The page margins show the webview's own background (the window colour): paper-white while printing.
        let background: ICoreWebView2Controller2 = controller.cast()?;
        let mut previous = COREWEBVIEW2_COLOR { A: 255, R: 255, G: 255, B: 255 };
        background.DefaultBackgroundColor(&mut previous)?;
        background.SetDefaultBackgroundColor(COREWEBVIEW2_COLOR { A: 255, R: 255, G: 255, B: 255 })?;
        let restore = background.clone();
        let handler = PrintToPdfCompletedHandler::create(Box::new(move |result, written| {
            let _ = restore.SetDefaultBackgroundColor(previous);
            if !written || result.is_err() {
                log::warn!("PDF not written: {result:?}");
            }
            let _ = done.send(match result {
                Ok(()) if written => Ok(()),
                Ok(()) => Err("the file could not be written (is it open in another program?)".into()),
                Err(e) => Err(e.message()),
            });
            Ok(())
        }));
        let started = webview7.PrintToPdf(&HSTRING::from(path.as_os_str()), &settings, &handler);
        if started.is_err() {
            let _ = background.SetDefaultBackgroundColor(previous);
        }
        started
    }
}
