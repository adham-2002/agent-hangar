//! Tauri commands for plugins: thin wrappers over `core::plugin_ops`, which
//! `skills-manager-cli` shares, run off the async runtime.

use std::path::PathBuf;
use std::sync::Arc;

use tauri::State;

use crate::core::claude_cli::{CatalogEntry, CliOutcome, MarketplaceInfo};
use crate::core::error::AppError;
use crate::core::plugin_ops::{self, ClaudeCliStatus};
use crate::core::plugin_scanner::{PluginDetail, PluginInfo, PluginSkillDocument};
use crate::core::skill_store::SkillStore;

async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, AppError> + Send + 'static,
) -> Result<T, AppError> {
    tokio::task::spawn_blocking(f).await?
}

#[tauri::command]
pub async fn list_plugins() -> Result<Vec<PluginInfo>, AppError> {
    blocking(plugin_ops::list).await
}

#[tauri::command]
pub async fn get_plugin_detail(install_path: String) -> Result<PluginDetail, AppError> {
    blocking(move || plugin_ops::detail(&PathBuf::from(install_path))).await
}

#[tauri::command]
pub async fn get_plugin_skill_document(
    install_path: String,
    skill: String,
) -> Result<PluginSkillDocument, AppError> {
    blocking(move || plugin_ops::skill_document(&PathBuf::from(install_path), &skill)).await
}

#[tauri::command]
pub async fn set_plugin_enabled(
    id: String,
    enabled: bool,
    store: State<'_, Arc<SkillStore>>,
) -> Result<(), AppError> {
    let store = store.inner().clone();
    blocking(move || plugin_ops::set_enabled(&store, &id, enabled)).await
}

#[tauri::command]
pub async fn get_claude_cli_status() -> Result<ClaudeCliStatus, AppError> {
    blocking(|| Ok(plugin_ops::cli_status())).await
}

#[tauri::command]
pub async fn get_plugin_catalog() -> Result<Vec<CatalogEntry>, AppError> {
    blocking(plugin_ops::catalog).await
}

#[tauri::command]
pub async fn install_plugin(
    id: String,
    accept_command: Option<String>,
    store: State<'_, Arc<SkillStore>>,
) -> Result<CliOutcome, AppError> {
    let store = store.inner().clone();
    blocking(move || plugin_ops::install(&store, &id, accept_command)).await
}

#[tauri::command]
pub async fn update_plugin(
    id: String,
    accept_command: Option<String>,
    store: State<'_, Arc<SkillStore>>,
) -> Result<CliOutcome, AppError> {
    let store = store.inner().clone();
    blocking(move || plugin_ops::update(&store, &id, accept_command)).await
}

#[tauri::command]
pub async fn uninstall_plugin(
    id: String,
    scope: String,
    store: State<'_, Arc<SkillStore>>,
) -> Result<CliOutcome, AppError> {
    let store = store.inner().clone();
    blocking(move || plugin_ops::uninstall(&store, &id, &scope)).await
}

#[tauri::command]
pub async fn list_marketplaces() -> Result<Vec<MarketplaceInfo>, AppError> {
    blocking(plugin_ops::marketplaces).await
}

#[tauri::command]
pub async fn add_marketplace(
    source: String,
    store: State<'_, Arc<SkillStore>>,
) -> Result<CliOutcome, AppError> {
    let store = store.inner().clone();
    blocking(move || plugin_ops::marketplace_add(&store, &source)).await
}

#[tauri::command]
pub async fn remove_marketplace(
    name: String,
    store: State<'_, Arc<SkillStore>>,
) -> Result<CliOutcome, AppError> {
    let store = store.inner().clone();
    blocking(move || plugin_ops::marketplace_remove(&store, &name)).await
}

/// Refresh one marketplace's catalog, or all of them when `name` is None.
#[tauri::command]
pub async fn update_marketplaces(
    name: Option<String>,
    store: State<'_, Arc<SkillStore>>,
) -> Result<CliOutcome, AppError> {
    let store = store.inner().clone();
    blocking(move || plugin_ops::marketplace_update(&store, name.as_deref())).await
}
