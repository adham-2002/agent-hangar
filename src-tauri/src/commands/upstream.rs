//! The "Original project" page: which commits in skills-manager, the project
//! Agent Hangar is built on, are not yet in the user's Agent Hangar source.
//!
//! The check itself is `scripts/upstream.mjs` in that source folder (the same
//! one `npm run upstream` runs), so the app and the terminal never disagree.
//! It only reads: it fetches the `upstream` remote and tests each commit in
//! memory with `git merge-tree`. Taking a commit stays a deliberate step in
//! the code (see docs/UPSTREAM.md).

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;

use tauri::State;

use crate::core::error::AppError;
use crate::core::skill_store::SkillStore;

const SETTING_KEY: &str = "upstream_source_repo";
const SCRIPT: &str = "scripts/upstream.mjs";

/// A folder qualifies when it is a git checkout holding the report script.
fn validate_source(path: &Path) -> Result<PathBuf, AppError> {
    if !path.join(".git").exists() {
        return Err(AppError::invalid_input(format!(
            "{} is not a git checkout. Choose the folder you cloned Agent Hangar into.",
            path.display()
        )));
    }
    if !path.join(SCRIPT).is_file() {
        return Err(AppError::invalid_input(format!(
            "{} has no {SCRIPT}. Choose an Agent Hangar source folder (update it first if it is older than 1.51).",
            path.display()
        )));
    }
    Ok(path.to_path_buf())
}

fn saved_source(store: &SkillStore) -> Option<String> {
    store
        .get_setting(SETTING_KEY)
        .ok()
        .flatten()
        .filter(|s| !s.trim().is_empty())
}

#[tauri::command]
pub fn get_upstream_source_repo(store: State<'_, Arc<SkillStore>>) -> Option<String> {
    saved_source(&store)
}

/// Saves the Agent Hangar source folder; an empty path forgets it.
#[tauri::command]
pub fn set_upstream_source_repo(path: String, store: State<'_, Arc<SkillStore>>) -> Result<(), AppError> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return store.set_setting(SETTING_KEY, "").map_err(AppError::db);
    }
    let dir = validate_source(Path::new(trimmed))?;
    store
        .set_setting(SETTING_KEY, &dir.to_string_lossy())
        .map_err(AppError::db)
}

fn run_report(dir: &Path, fetch: bool) -> Result<serde_json::Value, AppError> {
    let mut cmd = Command::new("node");
    cmd.arg(SCRIPT).arg("report").arg("--json").current_dir(dir);
    if !fetch {
        cmd.arg("--no-fetch");
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    let output = cmd.output().map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            AppError::not_found("Node.js was not found. Install it (or add it to PATH) to check the original project.")
        } else {
            AppError::io(e)
        }
    })?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let reason = stderr.trim().lines().last().unwrap_or("the check failed").to_string();
        return Err(AppError::internal(format!("Checking the original project failed: {reason}")));
    }
    // The script prints exactly one JSON line in this mode.
    let line = stdout.lines().rev().find(|l| l.trim_start().starts_with('{')).unwrap_or("");
    serde_json::from_str(line)
        .map_err(|e| AppError::internal(format!("Could not read the report: {e}")))
}

/// Runs the report in the saved source folder. `fetch` first downloads
/// upstream's latest commits; without it the last fetched state is used.
#[tauri::command]
pub async fn check_upstream(
    fetch: bool,
    store: State<'_, Arc<SkillStore>>,
) -> Result<serde_json::Value, AppError> {
    let Some(source) = saved_source(&store) else {
        return Err(AppError::invalid_input("Choose your Agent Hangar source folder first."));
    };
    tauri::async_runtime::spawn_blocking(move || {
        let dir = validate_source(Path::new(&source))?;
        run_report(&dir, fetch)
    })
    .await
    .map_err(|e| AppError::internal(e.to_string()))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_source_needs_git_and_the_script() {
        let tmp = tempfile::tempdir().unwrap();
        assert!(validate_source(tmp.path()).is_err());
        std::fs::create_dir(tmp.path().join(".git")).unwrap();
        assert!(validate_source(tmp.path()).is_err());
        std::fs::create_dir_all(tmp.path().join("scripts")).unwrap();
        std::fs::write(tmp.path().join(SCRIPT), "").unwrap();
        assert_eq!(validate_source(tmp.path()).unwrap(), tmp.path());
    }
}
