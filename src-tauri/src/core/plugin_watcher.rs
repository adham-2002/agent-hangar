//! Notice when Claude Code's plugin state changes outside the app — the
//! `claude` CLI, `/plugin` inside a session, a claude.ai sync — and tell the
//! frontend, so the Plugins page and Library update without a refocus.
//!
//! This polls a handful of files instead of using the filesystem watcher:
//! the state lives in `~/.claude`, whose other files (session history, logs)
//! change constantly, and holding an OS watch handle on an agent's config
//! folder is what the main watcher deliberately avoids. Statting four or five
//! files every couple of seconds costs nothing measurable.

use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use tauri::Emitter;

use crate::core::plugin_scanner;

pub const PLUGINS_CHANGED_EVENT: &str = "plugins-changed";
const POLL_INTERVAL: Duration = Duration::from_secs(2);

/// The files whose contents decide what `list_plugins` returns.
pub fn watched_files(claude_home: &Path) -> Vec<PathBuf> {
    let plugins = claude_home.join("plugins");
    let mut files = vec![
        claude_home.join("settings.json"),
        plugins.join("installed_plugins.json"),
        plugins.join("known_marketplaces.json"),
    ];
    if let Ok(accounts) = std::fs::read_dir(plugins.join("synced")) {
        let mut manifests: Vec<PathBuf> = accounts
            .flatten()
            .map(|e| e.path().join("manifest.json"))
            .collect();
        manifests.sort();
        files.extend(manifests);
    }
    files
}

/// What changing a file looks like from outside: its modification time and
/// size, or None while it does not exist (so creating or deleting it counts).
pub type Fingerprint = Vec<(PathBuf, Option<(SystemTime, u64)>)>;

pub fn fingerprint(claude_home: &Path) -> Fingerprint {
    watched_files(claude_home)
        .into_iter()
        .map(|path| {
            let stamp = std::fs::metadata(&path)
                .ok()
                .map(|m| (m.modified().unwrap_or(SystemTime::UNIX_EPOCH), m.len()));
            (path, stamp)
        })
        .collect()
}

pub fn start_plugin_watcher<R: tauri::Runtime>(app: tauri::AppHandle<R>) {
    std::thread::spawn(move || {
        let mut last: Option<Fingerprint> = None;
        loop {
            if let Some(home) = plugin_scanner::claude_home() {
                let now = fingerprint(&home);
                // The first pass only records a baseline; there is nothing to announce yet.
                if last.as_ref().is_some_and(|prev| prev != &now) {
                    if let Err(err) = app.emit(PLUGINS_CHANGED_EVENT, ()) {
                        log::debug!("Failed to emit {PLUGINS_CHANGED_EVENT}: {err}");
                    }
                }
                last = Some(now);
            }
            std::thread::sleep(POLL_INTERVAL);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_change_to_any_plugin_file_changes_the_fingerprint() {
        let home = tempfile::tempdir().unwrap();
        let before = fingerprint(home.path());
        assert!(before.iter().all(|(_, stamp)| stamp.is_none()));

        std::fs::create_dir_all(home.path().join("plugins")).unwrap();
        std::fs::write(home.path().join("plugins/installed_plugins.json"), "{}").unwrap();
        let created = fingerprint(home.path());
        assert_ne!(before, created, "creating a file counts");

        std::fs::write(home.path().join("plugins/installed_plugins.json"), "{\"plugins\": {}}").unwrap();
        assert_ne!(created, fingerprint(home.path()), "a size change counts");
    }

    #[test]
    fn unrelated_files_are_ignored_and_synced_manifests_are_watched() {
        let home = tempfile::tempdir().unwrap();
        let before = fingerprint(home.path());
        std::fs::write(home.path().join("history.jsonl"), "busy").unwrap();
        assert_eq!(before, fingerprint(home.path()), "session history is not plugin state");

        std::fs::create_dir_all(home.path().join("plugins/synced/acct")).unwrap();
        std::fs::write(home.path().join("plugins/synced/acct/manifest.json"), "{}").unwrap();
        let files = watched_files(home.path());
        assert!(files.iter().any(|p| p.ends_with("acct/manifest.json") || p.ends_with("acct\\manifest.json")));
    }
}
