//! Claude Code's memory and instruction files: review, health checks and
//! clean-up. See `core::agent_memory`.

use std::path::PathBuf;
use std::sync::Arc;

use tauri::State;

use crate::core::agent_memory::{self, MemoryReport};
use crate::core::central_repo;
use crate::core::error::AppError;
use crate::core::plugin_scanner;
use crate::core::skill_store::SkillStore;

fn claude_home() -> Result<PathBuf, AppError> {
    plugin_scanner::claude_home().ok_or_else(|| AppError::not_found("Claude Code's folder was not found"))
}

/// Where deleted memories are kept, in case one is wanted back.
pub fn memory_trash_dir() -> PathBuf {
    central_repo::base_dir().join("memory-trash")
}

fn io_error(e: std::io::Error) -> AppError {
    match e.kind() {
        std::io::ErrorKind::NotFound => AppError::not_found(e.to_string()),
        std::io::ErrorKind::InvalidInput => AppError::invalid_input(e.to_string()),
        _ => AppError::io(e),
    }
}

#[tauri::command]
pub async fn get_agent_memory(store: State<'_, Arc<SkillStore>>) -> Result<MemoryReport, AppError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let home = dirs::home_dir();
        let Some(claude) = plugin_scanner::claude_home().filter(|h| h.is_dir()) else {
            return Ok(MemoryReport { global: vec![], global_always_on: 0, projects: vec![] });
        };
        let mut known: Vec<PathBuf> = store
            .get_all_projects()
            .map_err(AppError::db)?
            .into_iter()
            .map(|p| PathBuf::from(p.path))
            .collect();
        known.extend(home.clone());
        Ok(agent_memory::scan(&claude, &known, home.as_deref()))
    })
    .await?
}

#[tauri::command]
pub async fn read_agent_memory(slug: String, file: String) -> Result<String, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        agent_memory::read_memory(&claude_home()?, &slug, &file).map_err(io_error)
    })
    .await?
}

/// Delete a memory. Returns where its copy was kept.
#[tauri::command]
pub async fn delete_agent_memory(slug: String, file: String) -> Result<String, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        agent_memory::delete_memory(&claude_home()?, &memory_trash_dir(), &slug, &file)
            .map(|p| p.to_string_lossy().into_owned())
            .map_err(io_error)
    })
    .await?
}

/// Move a memory into the global CLAUDE.md, so every project gets it.
#[tauri::command]
pub async fn move_agent_memory_to_global(slug: String, file: String) -> Result<String, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        agent_memory::move_to_global(&claude_home()?, &memory_trash_dir(), &slug, &file)
            .map(|p| p.to_string_lossy().into_owned())
            .map_err(io_error)
    })
    .await?
}
