//! Insights: how often skills are used (from Claude Code's transcripts) and
//! what they cost in an agent's context. Read-only.

use std::path::Path;
use std::sync::Arc;

use serde::Serialize;
use tauri::State;

use crate::core::context_cost::{self, Cost, PluginCost};
use crate::core::error::AppError;
use crate::core::plugin_scanner;
use crate::core::skill_store::SkillStore;
use crate::core::skill_usage::{self, UsageReport};

/// Usage of every skill Claude Code has used, as far back as its transcripts go.
#[tauri::command]
pub async fn get_skill_usage() -> Result<UsageReport, AppError> {
    tokio::task::spawn_blocking(|| {
        Ok(match plugin_scanner::claude_home().filter(|h| h.is_dir()) {
            Some(home) => skill_usage::usage_report(&home),
            None => UsageReport { sessions: 0, since: None, skills: vec![] },
        })
    })
    .await?
}

#[derive(Debug, Serialize)]
pub struct SkillCost {
    pub id: String,
    pub cost: Cost,
}

#[derive(Debug, Serialize)]
pub struct ContextCosts {
    pub skills: Vec<SkillCost>,
    pub plugins: Vec<PluginCost>,
}

/// Estimated context cost of every library skill and installed plugin.
#[tauri::command]
pub async fn get_context_costs(store: State<'_, Arc<SkillStore>>) -> Result<ContextCosts, AppError> {
    let store = store.inner().clone();
    tokio::task::spawn_blocking(move || {
        let skills = store
            .get_all_skills()
            .map_err(AppError::db)?
            .into_iter()
            .map(|s| SkillCost {
                cost: context_cost::skill_dir_cost(Path::new(&s.central_path)),
                id: s.id,
            })
            .collect();
        Ok(ContextCosts { skills, plugins: context_cost::installed_plugin_costs() })
    })
    .await?
}
