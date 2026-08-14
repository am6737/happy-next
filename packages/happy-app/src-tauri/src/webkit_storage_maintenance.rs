use std::{
    fs,
    path::{Path, PathBuf},
};

const RESET_MARKER_FILE: &str = ".webkit-localstorage-reset-v1";

pub fn run(identifier: &str) {
    let Some(home) = std::env::var_os("HOME").map(PathBuf::from) else {
        eprintln!("WebKit LocalStorage reset skipped: HOME is unavailable");
        return;
    };
    if let Err(error) = run_for_home(&home, identifier) {
        // Keep the marker absent so transient filesystem errors are retried next launch.
        eprintln!("WebKit LocalStorage reset deferred: {error}");
    }
}

fn run_for_home(home: &Path, identifier: &str) -> Result<(), String> {
    let app_support = home.join("Library/Application Support").join(identifier);
    let marker = app_support.join(RESET_MARKER_FILE);
    if marker.exists() {
        return Ok(());
    }

    let webkit_root = home.join("Library/WebKit").join(identifier);
    let mut local_storage_directories = Vec::new();
    collect_local_storage_directories(&webkit_root, &mut local_storage_directories)?;

    let mut removed = 0_usize;
    for directory in local_storage_directories {
        fs::remove_dir_all(&directory)
            .map_err(|error| format!("could not remove {}: {error}", directory.display()))?;
        removed += 1;
    }

    fs::create_dir_all(&app_support)
        .map_err(|error| format!("could not create {}: {error}", app_support.display()))?;
    let marker_temp = marker.with_extension("tmp");
    fs::write(&marker_temp, b"completed\n")
        .map_err(|error| format!("could not write {}: {error}", marker_temp.display()))?;
    fs::rename(&marker_temp, &marker)
        .map_err(|error| format!("could not replace {}: {error}", marker.display()))?;

    if removed > 0 {
        eprintln!("WebKit LocalStorage reset removed {removed} storage directories");
    }
    Ok(())
}

fn collect_local_storage_directories(
    root: &Path,
    directories: &mut Vec<PathBuf>,
) -> Result<(), String> {
    let entries = match fs::read_dir(root) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(format!("could not scan {}: {error}", root.display())),
    };

    for entry in entries {
        let entry = entry.map_err(|error| format!("could not scan {}: {error}", root.display()))?;
        let file_type = entry
            .file_type()
            .map_err(|error| format!("could not inspect {}: {error}", entry.path().display()))?;
        if !file_type.is_dir() {
            continue;
        }
        if entry.file_name() == "LocalStorage" {
            directories.push(entry.path());
        } else {
            collect_local_storage_directories(&entry.path(), directories)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temporary_home(name: &str) -> PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!("happy-{name}-{suffix}"));
        fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn resets_local_storage_once_without_removing_indexed_db() {
        let home = temporary_home("webkit-reset");
        let origin = home.join("Library/WebKit/com.example.happy/WebsiteData/Default/origin");
        let local_storage = origin.join("LocalStorage");
        let indexed_db = origin.join("IndexedDB/database");
        fs::create_dir_all(&local_storage).unwrap();
        fs::create_dir_all(&indexed_db).unwrap();
        fs::write(local_storage.join("localstorage.sqlite3"), b"main").unwrap();
        fs::write(local_storage.join("localstorage.sqlite3-wal"), b"wal").unwrap();
        fs::write(local_storage.join("localstorage.sqlite3-shm"), b"shm").unwrap();
        fs::write(indexed_db.join("IndexedDB.sqlite3"), b"messages").unwrap();

        run_for_home(&home, "com.example.happy").unwrap();

        assert!(!local_storage.exists());
        assert!(indexed_db.join("IndexedDB.sqlite3").exists());
        assert_eq!(
            fs::read_to_string(
                home.join("Library/Application Support/com.example.happy")
                    .join(RESET_MARKER_FILE)
            )
            .unwrap(),
            "completed\n"
        );
        fs::remove_dir_all(home).unwrap();
    }

    #[test]
    fn completed_marker_prevents_another_reset() {
        let home = temporary_home("webkit-reset-marker");
        let app_support = home.join("Library/Application Support/com.example.happy");
        let local_storage =
            home.join("Library/WebKit/com.example.happy/WebsiteData/Default/origin/LocalStorage");
        fs::create_dir_all(&app_support).unwrap();
        fs::create_dir_all(&local_storage).unwrap();
        fs::write(app_support.join(RESET_MARKER_FILE), b"completed\n").unwrap();
        fs::write(local_storage.join("localstorage.sqlite3"), b"new data").unwrap();

        run_for_home(&home, "com.example.happy").unwrap();

        assert!(local_storage.join("localstorage.sqlite3").exists());
        fs::remove_dir_all(home).unwrap();
    }

    #[test]
    fn fresh_install_is_marked_without_creating_webkit_data() {
        let home = temporary_home("webkit-reset-fresh");

        run_for_home(&home, "com.example.happy").unwrap();

        assert!(home
            .join("Library/Application Support/com.example.happy")
            .join(RESET_MARKER_FILE)
            .exists());
        assert!(!home.join("Library/WebKit/com.example.happy").exists());
        fs::remove_dir_all(home).unwrap();
    }
}
