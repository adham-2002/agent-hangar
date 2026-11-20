use std::path::{Path, PathBuf};

use std::sync::Arc;

use tauri::State;

use crate::core::audit_log::AuditDraft;
use crate::core::error::AppError;
use crate::core::plugin_scanner::{self, PluginDetail, PluginInfo};
use crate::core::skill_store::SkillStore;

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
pub async fn set_plugin_enabled(
    id: String,
    enabled: bool,
    store: State<'_, Arc<SkillStore>>,
) -> Result<(), AppError> {
    let subject = id.clone();
    let result = tokio::task::spawn_blocking(move || {
        let home = require_home()?;
        plugin_scanner::set_plugin_enabled(&home, &id, enabled)
    })
    .await?;
    let draft = AuditDraft::new(if enabled { "plugin_enable" } else { "plugin_disable" })
        .tool(CLAUDE_CODE);
    store.log_audit(match &result {
        Ok(()) => draft.ok().detail(subject),
        Err(e) => draft.fail(format!("{subject}: {e}")),
    });
    result
}

/// Plugins only exist for Claude Code, so that is the agent every entry names.
const CLAUDE_CODE: &str = "claude_code";

/// Record a CLI plugin operation in the activity log, like skill operations.
/// A run that stopped to show a marketplace command did nothing yet, so it is
/// not recorded; the approved re-run is.
fn log_plugin_op(
    store: &SkillStore,
    action: &str,
    subject: &str,
    result: &Result<CliOutcome, AppError>,
) {
    let draft = AuditDraft::new(action).tool(CLAUDE_CODE);
    let draft = match result {
        Ok(outcome) if outcome.shown_command.is_some() => return,
        Ok(outcome) if outcome.ok => draft.ok().detail(subject),
        Ok(outcome) => draft.fail(format!(
            "{subject}: {}",
            outcome.message.as_deref().unwrap_or("failed")
        )),
        Err(e) => draft.fail(format!("{subject}: {e}")),
    };
    store.log_audit(draft);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn outcome(ok: bool, shown: bool) -> CliOutcome {
        CliOutcome {
            ok,
            outcome: Some(if ok { "installed" } else { "failed" }.into()),
            message: (!ok).then(|| "network down".to_string()),
            failure_code: None,
            shown_command: shown.then(|| claude_cli::ShownCommand { text: "npx x".into(), sha256: "ab".into() }),
        }
    }

    #[test]
    fn plugin_operations_are_recorded_except_while_awaiting_approval() {
        let tmp = tempfile::tempdir().unwrap();
        let store = SkillStore::new(&tmp.path().join("skills.db")).unwrap();
        log_plugin_op(&store, "plugin_install", "risky@m", &Ok(outcome(false, true)));
        assert!(store.list_audit(None).unwrap().is_empty(), "nothing ran yet");

        log_plugin_op(&store, "plugin_install", "seo@m", &Ok(outcome(true, false)));
        log_plugin_op(&store, "plugin_update", "seo@m", &Ok(outcome(false, false)));
        log_plugin_op(&store, "plugin_uninstall", "x@m", &Err(AppError::io("boom")));
        let entries = store.list_audit(None).unwrap();
        assert_eq!(entries.len(), 3);
        let by_action = |a: &str| entries.iter().find(|e| e.action == a).unwrap().clone();
        let install = by_action("plugin_install");
        assert!(install.success);
        assert_eq!(install.tool.as_deref(), Some("claude_code"));
        assert_eq!(install.detail.as_deref(), Some("seo@m"));
        let update = by_action("plugin_update");
        assert!(!update.success);
        assert_eq!(update.detail.as_deref(), Some("seo@m: network down"));
        assert!(by_action("plugin_uninstall").detail.unwrap().contains("boom"));
    }

    #[test]
    fn list_plugins_returns_empty_when_claude_home_absent() {
        let dir = tempfile::tempdir().unwrap();
        assert!(list_in(Some(dir.path().join("nope"))).unwrap().is_empty());
        assert!(list_in(None).unwrap().is_empty());
    }
}

// ── Phase 2: drive the claude CLI ──

use crate::core::claude_cli::{self, CatalogEntry, CliOutcome, MarketplaceInfo};

#[derive(Debug, serde::Serialize)]
pub struct ClaudeCliStatus {
    pub available: bool,
    pub path: Option<String>,
}

fn require_cli() -> Result<PathBuf, AppError> {
    claude_cli::find_claude().ok_or_else(|| {
        AppError::not_found(
            "The claude command was not found. Install Claude Code (the native installer) to install or update plugins from here.",
        )
    })
}

/// Run a `--json` plugin command and read its result line.
fn run_outcome(args: Vec<String>, timeout: std::time::Duration) -> Result<CliOutcome, AppError> {
    let exe = require_cli()?;
    let raw = claude_cli::run(&exe, &args, timeout)?;
    Ok(claude_cli::parse_outcome(&raw))
}

/// `--accept-command <hash>` only for the exact hash the user approved.
fn push_accept(args: &mut Vec<String>, accept_command: Option<String>) -> Result<(), AppError> {
    if let Some(hash) = accept_command {
        claude_cli::validate_command_hash(&hash)?;
        args.push("--accept-command".into());
        args.push(hash);
    }
    Ok(())
}

#[tauri::command]
pub async fn get_claude_cli_status() -> Result<ClaudeCliStatus, AppError> {
    Ok(tokio::task::spawn_blocking(|| {
        let path = claude_cli::find_claude();
        ClaudeCliStatus {
            available: path.is_some(),
            path: path.map(|p| p.to_string_lossy().to_string()),
        }
    })
    .await?)
}

#[tauri::command]
pub async fn get_plugin_catalog() -> Result<Vec<CatalogEntry>, AppError> {
    tokio::task::spawn_blocking(|| {
        let exe = require_cli()?;
        let args: Vec<String> = ["plugin", "list", "--available", "--json"]
            .iter()
            .map(|s| s.to_string())
            .collect();
        let raw = claude_cli::run(&exe, &args, claude_cli::SHORT_TIMEOUT)?;
        if !raw.success {
            return Err(AppError::io(raw.stderr.trim().to_string()));
        }
        claude_cli::parse_catalog(&raw.stdout)
    })
    .await?
}

#[tauri::command]
pub async fn install_plugin(id: String, accept_command: Option<String>, store: State<'_, Arc<SkillStore>>) -> Result<CliOutcome, AppError> {
    let subject = id.clone();
    let result = tokio::task::spawn_blocking(move || {
        claude_cli::validate_plugin_id(&id)?;
        let mut args = vec!["plugin".into(), "install".into(), id, "--json".into()];
        push_accept(&mut args, accept_command)?;
        run_outcome(args, claude_cli::LONG_TIMEOUT)
    })
    .await?;
    log_plugin_op(&store, "plugin_install", &subject, &result);
    result
}

#[tauri::command]
pub async fn update_plugin(id: String, accept_command: Option<String>, store: State<'_, Arc<SkillStore>>) -> Result<CliOutcome, AppError> {
    let subject = id.clone();
    let result = tokio::task::spawn_blocking(move || {
        claude_cli::validate_plugin_id(&id)?;
        let mut args = vec!["plugin".into(), "update".into(), id, "--json".into()];
        push_accept(&mut args, accept_command)?;
        run_outcome(args, claude_cli::LONG_TIMEOUT)
    })
    .await?;
    log_plugin_op(&store, "plugin_update", &subject, &result);
    result
}

#[tauri::command]
pub async fn uninstall_plugin(id: String, scope: String, store: State<'_, Arc<SkillStore>>) -> Result<CliOutcome, AppError> {
    let subject = id.clone();
    let result = tokio::task::spawn_blocking(move || {
        claude_cli::validate_plugin_id(&id)?;
        claude_cli::validate_scope(&scope)?;
        let args = vec![
            "plugin".into(),
            "uninstall".into(),
            id,
            "--scope".into(),
            scope,
            "--json".into(),
        ];
        run_outcome(args, claude_cli::SHORT_TIMEOUT)
    })
    .await?;
    log_plugin_op(&store, "plugin_uninstall", &subject, &result);
    result
}

#[tauri::command]
pub async fn list_marketplaces() -> Result<Vec<MarketplaceInfo>, AppError> {
    tokio::task::spawn_blocking(|| {
        let exe = require_cli()?;
        let args: Vec<String> = ["plugin", "marketplace", "list", "--json"]
            .iter()
            .map(|s| s.to_string())
            .collect();
        let raw = claude_cli::run(&exe, &args, claude_cli::SHORT_TIMEOUT)?;
        if !raw.success {
            return Err(AppError::io(raw.stderr.trim().to_string()));
        }
        claude_cli::parse_marketplaces(&raw.stdout)
    })
    .await?
}

#[tauri::command]
pub async fn add_marketplace(source: String, store: State<'_, Arc<SkillStore>>) -> Result<CliOutcome, AppError> {
    let subject = source.trim().to_string();
    let result = tokio::task::spawn_blocking(move || {
        claude_cli::validate_marketplace_source(&source)?;
        let args = vec![
            "plugin".into(),
            "marketplace".into(),
            "add".into(),
            source.trim().to_string(),
            "--json".into(),
        ];
        run_outcome(args, claude_cli::LONG_TIMEOUT)
    })
    .await?;
    log_plugin_op(&store, "marketplace_add", &subject, &result);
    result
}

#[tauri::command]
pub async fn remove_marketplace(name: String, store: State<'_, Arc<SkillStore>>) -> Result<CliOutcome, AppError> {
    let subject = name.clone();
    let result = tokio::task::spawn_blocking(move || {
        claude_cli::validate_marketplace_name(&name)?;
        run_outcome(
            vec!["plugin".into(), "marketplace".into(), "remove".into(), name],
            claude_cli::SHORT_TIMEOUT,
        )
    })
    .await?;
    log_plugin_op(&store, "marketplace_remove", &subject, &result);
    result
}

/// Refresh one marketplace's catalog, or all of them when `name` is None.
#[tauri::command]
pub async fn update_marketplaces(name: Option<String>, store: State<'_, Arc<SkillStore>>) -> Result<CliOutcome, AppError> {
    let subject = name.clone().unwrap_or_else(|| "all".into());
    let result = tokio::task::spawn_blocking(move || {
        let mut args: Vec<String> = vec!["plugin".into(), "marketplace".into(), "update".into()];
        if let Some(name) = name {
            claude_cli::validate_marketplace_name(&name)?;
            args.push(name);
        }
        run_outcome(args, claude_cli::LONG_TIMEOUT)
    })
    .await?;
    log_plugin_op(&store, "marketplace_update", &subject, &result);
    result
}
