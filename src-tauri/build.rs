fn main() {
    support_secret();
    tauri_build::build()
}

/// Bakes in the software provider's secret for support unlock codes (see `danish_core::recovery`). It never
/// goes into git: it comes from `DANISH_SUPPORT_SECRET` or `%USERPROFILE%\.danish-fitness\support-secret.txt`
/// (`npm run support:unlock -- --init`). Without it the app still builds, but a forgotten owner PIN can then
/// only be reset with the recovery key.
fn support_secret() {
    println!("cargo:rerun-if-env-changed=DANISH_SUPPORT_SECRET");
    let file = std::env::var_os("USERPROFILE")
        .map(|home| std::path::PathBuf::from(home).join(".danish-fitness").join("support-secret.txt"));
    if let Some(file) = &file {
        println!("cargo:rerun-if-changed={}", file.display());
    }
    let secret = std::env::var("DANISH_SUPPORT_SECRET")
        .ok()
        .or_else(|| file.and_then(|f| std::fs::read_to_string(f).ok()))
        .map(|s| s.trim().to_string())
        .filter(|s| s.len() >= 32 && !s.contains(char::is_whitespace));
    match secret {
        Some(secret) => println!("cargo:rustc-env=DANISH_SUPPORT_SECRET={secret}"),
        None => println!("cargo:warning=No support secret found: support unlock codes are disabled in this build"),
    }
}
