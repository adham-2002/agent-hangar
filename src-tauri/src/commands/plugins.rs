use std::path::{Path, PathBuf};

use crate::core::error::AppError;
use crate::core::plugin_scanner::{self, PluginDetail, PluginInfo};

fn list_in(home: Option<PathBuf>) -> Result<Vec<PluginInfo>, AppError> {
    match home {
        Some(h) if h.is_dir() => plugin_scanner::list_plugins(&h),
        _ => Ok(vec![]),
    }
}

fn require_home() -> Result<PathBuf, AppError> {
    plugin_scanner::claude_home()
        .ok_or_else(|| AppError::not_found("Cannot determine the Claude config directory"))
}

#[tauri::command]
pub async fn list_plugins() -> Result<Vec<PluginInfo>, AppError> {
    tokio::task::spawn_blocking(|| list_in(plugin_scanner::claude_home())).await?
}

#[tauri::command]
pub async fn get_plugin_detail(install_path: String) -> Result<PluginDetail, AppError> {
    tokio::task::spawn_blocking(move || {
        let home = require_home()?;
        plugin_scanner::inspect_plugin(&home, Path::new(&install_path))
    })
    .await?
}

#[tauri::command]
pub async fn set_plugin_enabled(id: String, enabled: bool) -> Result<(), AppError> {
    tokio::task::spawn_blocking(move || {
        let home = require_home()?;
        plugin_scanner::set_plugin_enabled(&home, &id, enabled)
    })
    .await?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn list_plugins_returns_empty_when_claude_home_absent() {
        let dir = tempfile::tempdir().unwrap();
        assert!(list_in(Some(dir.path().join("nope"))).unwrap().is_empty());
        assert!(list_in(None).unwrap().is_empty());
    }
}
