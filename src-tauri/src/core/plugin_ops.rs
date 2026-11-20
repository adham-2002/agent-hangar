//! Every plugin operation, in one place, for both the app and
//! `skills-manager-cli`: reading Claude's files for listing and on/off, and
//! driving `claude plugin` for install, update, uninstall and marketplaces.
//! Each change is recorded in the activity log, the way skill changes are.

use serde::Serialize;
use std::path::{Path, PathBuf};
use std::time::Duration;

use crate::core::audit_log::AuditDraft;
use crate::core::claude_cli::{self, CatalogEntry, CliOutcome, MarketplaceInfo};
use crate::core::error::AppError;
use crate::core::plugin_scanner::{self, PluginDetail, PluginInfo};
use crate::core::skill_store::SkillStore;

/// Plugins only exist for Claude Code, so that is the agent every entry names.
pub const CLAUDE_CODE: &str = "claude_code";

#[derive(Debug, Serialize)]
pub struct ClaudeCliStatus {
    pub available: bool,
    pub path: Option<String>,
}

fn require_home() -> Result<PathBuf, AppError> {
    plugin_scanner::claude_home()
        .ok_or_else(|| AppError::not_found("Cannot determine the Claude config directory"))
}

fn require_cli() -> Result<PathBuf, AppError> {
    claude_cli::find_claude().ok_or_else(|| {
        AppError::not_found(
            "The claude command was not found. Install Claude Code (the native installer) to install or update plugins.",
        )
    })
}

fn strings(args: &[&str]) -> Vec<String> {
    args.iter().map(|s| s.to_string()).collect()
}

/// Run a `--json` plugin command and read its result line.
fn run_outcome(args: Vec<String>, timeout: Duration) -> Result<CliOutcome, AppError> {
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

/// Record a CLI plugin operation in the activity log. A run that stopped to
/// show a marketplace command did nothing yet, so it is not recorded; the
/// approved re-run is.
pub fn log_plugin_op(
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

fn logged(
    store: &SkillStore,
    action: &str,
    subject: String,
    result: Result<CliOutcome, AppError>,
) -> Result<CliOutcome, AppError> {
    log_plugin_op(store, action, &subject, &result);
    result
}

// ── Claude's files ──

/// Installed plugins; empty when Claude's config directory does not exist.
pub fn list_in(home: Option<PathBuf>) -> Result<Vec<PluginInfo>, AppError> {
    match home {
        Some(h) if h.is_dir() => plugin_scanner::list_plugins(&h),
        _ => Ok(vec![]),
    }
}

pub fn list() -> Result<Vec<PluginInfo>, AppError> {
    list_in(plugin_scanner::claude_home())
}

pub fn detail(install_path: &Path) -> Result<PluginDetail, AppError> {
    plugin_scanner::inspect_plugin(&require_home()?, install_path)
}

pub fn set_enabled(store: &SkillStore, id: &str, enabled: bool) -> Result<(), AppError> {
    let result = require_home().and_then(|home| plugin_scanner::set_plugin_enabled(&home, id, enabled));
    let draft = AuditDraft::new(if enabled { "plugin_enable" } else { "plugin_disable" })
        .tool(CLAUDE_CODE);
    store.log_audit(match &result {
        Ok(()) => draft.ok().detail(id),
        Err(e) => draft.fail(format!("{id}: {e}")),
    });
    result
}

// ── The claude CLI ──

pub fn cli_status() -> ClaudeCliStatus {
    let path = claude_cli::find_claude();
    ClaudeCliStatus {
        available: path.is_some(),
        path: path.map(|p| p.to_string_lossy().to_string()),
    }
}

pub fn catalog() -> Result<Vec<CatalogEntry>, AppError> {
    let raw = claude_cli::run(
        &require_cli()?,
        &strings(&["plugin", "list", "--available", "--json"]),
        claude_cli::SHORT_TIMEOUT,
    )?;
    if !raw.success {
        return Err(AppError::io(raw.stderr.trim().to_string()));
    }
    claude_cli::parse_catalog(&raw.stdout)
}

pub fn marketplaces() -> Result<Vec<MarketplaceInfo>, AppError> {
    let raw = claude_cli::run(
        &require_cli()?,
        &strings(&["plugin", "marketplace", "list", "--json"]),
        claude_cli::SHORT_TIMEOUT,
    )?;
    if !raw.success {
        return Err(AppError::io(raw.stderr.trim().to_string()));
    }
    claude_cli::parse_marketplaces(&raw.stdout)
}

pub fn install(
    store: &SkillStore,
    id: &str,
    accept_command: Option<String>,
) -> Result<CliOutcome, AppError> {
    let result = (|| {
        claude_cli::validate_plugin_id(id)?;
        let mut args = strings(&["plugin", "install", id, "--json"]);
        push_accept(&mut args, accept_command)?;
        run_outcome(args, claude_cli::LONG_TIMEOUT)
    })();
    logged(store, "plugin_install", id.to_string(), result)
}

pub fn update(
    store: &SkillStore,
    id: &str,
    accept_command: Option<String>,
) -> Result<CliOutcome, AppError> {
    let result = (|| {
        claude_cli::validate_plugin_id(id)?;
        let mut args = strings(&["plugin", "update", id, "--json"]);
        push_accept(&mut args, accept_command)?;
        run_outcome(args, claude_cli::LONG_TIMEOUT)
    })();
    logged(store, "plugin_update", id.to_string(), result)
}

pub fn uninstall(store: &SkillStore, id: &str, scope: &str) -> Result<CliOutcome, AppError> {
    let result = (|| {
        claude_cli::validate_plugin_id(id)?;
        claude_cli::validate_scope(scope)?;
        run_outcome(
            strings(&["plugin", "uninstall", id, "--scope", scope, "--json"]),
            claude_cli::SHORT_TIMEOUT,
        )
    })();
    logged(store, "plugin_uninstall", id.to_string(), result)
}

pub fn marketplace_add(store: &SkillStore, source: &str) -> Result<CliOutcome, AppError> {
    let source = source.trim();
    let result = (|| {
        claude_cli::validate_marketplace_source(source)?;
        run_outcome(
            strings(&["plugin", "marketplace", "add", source, "--json"]),
            claude_cli::LONG_TIMEOUT,
        )
    })();
    logged(store, "marketplace_add", source.to_string(), result)
}

pub fn marketplace_remove(store: &SkillStore, name: &str) -> Result<CliOutcome, AppError> {
    let result = (|| {
        claude_cli::validate_marketplace_name(name)?;
        run_outcome(
            strings(&["plugin", "marketplace", "remove", name]),
            claude_cli::SHORT_TIMEOUT,
        )
    })();
    logged(store, "marketplace_remove", name.to_string(), result)
}

/// Refresh one marketplace's catalog, or all of them when `name` is None.
pub fn marketplace_update(store: &SkillStore, name: Option<&str>) -> Result<CliOutcome, AppError> {
    let result = (|| {
        let mut args = strings(&["plugin", "marketplace", "update"]);
        if let Some(name) = name {
            claude_cli::validate_marketplace_name(name)?;
            args.push(name.to_string());
        }
        run_outcome(args, claude_cli::LONG_TIMEOUT)
    })();
    logged(store, "marketplace_update", name.unwrap_or("all").to_string(), result)
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
            shown_command: shown
                .then(|| claude_cli::ShownCommand { text: "npx x".into(), sha256: "ab".into() }),
        }
    }

    fn store() -> (tempfile::TempDir, SkillStore) {
        let tmp = tempfile::tempdir().unwrap();
        let store = SkillStore::new(&tmp.path().join("skills.db")).unwrap();
        (tmp, store)
    }

    #[test]
    fn plugin_operations_are_recorded_except_while_awaiting_approval() {
        let (_tmp, store) = store();
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
    fn a_rejected_argument_is_logged_as_a_failure_without_running_anything() {
        let (_tmp, store) = store();
        assert!(install(&store, "--yes", None).is_err());
        assert!(marketplace_add(&store, "--sparse").is_err());
        let entries = store.list_audit(None).unwrap();
        assert_eq!(entries.len(), 2);
        assert!(entries.iter().all(|e| !e.success));
    }

    #[test]
    fn list_is_empty_when_claude_home_is_absent() {
        let dir = tempfile::tempdir().unwrap();
        assert!(list_in(Some(dir.path().join("nope"))).unwrap().is_empty());
        assert!(list_in(None).unwrap().is_empty());
    }
}
