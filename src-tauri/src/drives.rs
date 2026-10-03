//! Picks a safe default backup folder. A second fixed drive (D:, E:, …) survives a Windows reinstall, which
//! usually formats only the system drive — so backups kept there are not lost with Windows.

use std::path::{Path, PathBuf};

/// Room a drive needs before it is suggested for backups.
const MIN_FREE_BYTES: u64 = 1 << 30;

/// `<drive>:\Danish Fitness\Backups` on the first fixed (not USB / CD) non-system drive with free space.
#[cfg(windows)]
pub fn second_drive_backup_dir() -> Option<PathBuf> {
    use windows_sys::Win32::Storage::FileSystem::{GetDiskFreeSpaceExW, GetDriveTypeW, GetLogicalDrives};
    const DRIVE_FIXED: u32 = 3;

    let system = std::env::var("SystemDrive").unwrap_or_else(|_| "C:".into()).to_ascii_uppercase();
    // SAFETY: plain Win32 calls with NUL-terminated UTF-16 paths and valid out-pointers.
    let mask = unsafe { GetLogicalDrives() };
    for (bit, letter) in (b'A'..=b'Z').map(char::from).enumerate() {
        if mask & (1 << bit) == 0 || letter < 'C' || system.starts_with(letter) {
            continue;
        }
        let root = format!("{letter}:\\");
        let wide: Vec<u16> = root.encode_utf16().chain(std::iter::once(0)).collect();
        if unsafe { GetDriveTypeW(wide.as_ptr()) } != DRIVE_FIXED {
            continue;
        }
        let mut free = 0u64;
        let ok = unsafe { GetDiskFreeSpaceExW(wide.as_ptr(), &mut free, std::ptr::null_mut(), std::ptr::null_mut()) };
        if ok != 0 && free >= MIN_FREE_BYTES {
            return Some(Path::new(&root).join("Danish Fitness").join("Backups"));
        }
    }
    None
}

#[cfg(not(windows))]
pub fn second_drive_backup_dir() -> Option<PathBuf> {
    None
}

/// Drive letter (or root) of a path, upper-cased, for "same drive?" checks: `C:`.
pub fn drive_of(path: &Path) -> Option<String> {
    match path.components().next()? {
        std::path::Component::Prefix(p) => Some(p.as_os_str().to_string_lossy().to_ascii_uppercase()),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn drive_letters() {
        assert_eq!(drive_of(Path::new(r"d:\Danish Fitness\Backups")).as_deref(), Some("D:"));
        assert_eq!(drive_of(Path::new(r"C:\Users\x")).as_deref(), Some("C:"));
        assert_eq!(drive_of(Path::new("relative")), None);
    }

    #[test]
    fn suggested_folder_is_never_on_the_system_drive() {
        if let Some(dir) = second_drive_backup_dir() {
            let system = std::env::var("SystemDrive").unwrap_or_else(|_| "C:".into()).to_ascii_uppercase();
            assert_ne!(drive_of(&dir), Some(system));
            assert!(dir.ends_with(r"Danish Fitness\Backups"));
        }
    }
}
