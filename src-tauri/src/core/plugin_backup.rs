//! Carry the user's Claude Code plugin set across their computers through the
//! skill backup, so a second machine can offer what the first one has.
//!
//! What travels is a list, not plugin files: which marketplaces and which
//! user-installed plugins, and whether each is on. Plugin folders are a cache
//! Claude rebuilds and can hold a plugin's private data; they stay put.
//!
//! Each computer writes only its own `.skills-manager/plugins-<device id>.json`.
//! The backup merge treats a top-level file there as one whole file (newest
//! wins on conflict), so a single shared list would let one computer's set
//! overwrite another's; one file per computer never conflicts. It has to be a
//! top-level file: the merge does not descend into unknown subfolders.
//!
//! Nothing is ever installed automatically. Plugins run code, and some need a
//! marketplace command the user must approve, so another computer's plugins
//! are only offered.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::Path;

use crate::core::error::AppError;
use crate::core::git_backup;
use crate::core::plugin_scanner::{self, PluginInfo};
use crate::core::skill_store::SkillStore;
use crate::core::sync_metadata;

const SCHEMA_VERSION: u32 = 1;
const FILE_PREFIX: &str = "plugins-";
/// Local only (the settings database is not backed up): one id per computer.
const DEVICE_ID_SETTING: &str = "plugin_backup_device_id";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct MarketplaceRef {
    pub name: String,
    /// What `claude plugin marketplace add` accepts: `owner/repo` or a URL.
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PluginRef {
    /// `name@marketplace`.
    pub id: String,
    pub enabled: bool,
}

/// One computer's plugin set. No timestamp: an unchanged set must produce an
/// identical file, or every backup would commit a change.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DeviceManifest {
    pub schema_version: u32,
    pub device_id: String,
    pub device_name: String,
    pub marketplaces: Vec<MarketplaceRef>,
    pub plugins: Vec<PluginRef>,
}

/// A plugin another computer has on that this one does not have installed.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct OfferedPlugin {
    pub id: String,
    pub name: String,
    pub marketplace: String,
    /// The marketplace's source, when this computer does not know the
    /// marketplace yet; installing then adds it first.
    pub marketplace_source: Option<String>,
    /// Names of the computers that have it switched on.
    pub devices: Vec<String>,
}

/// This computer's id, created on first use.
pub fn device_id(store: &SkillStore) -> String {
    if let Ok(Some(id)) = store.get_setting(DEVICE_ID_SETTING) {
        if !id.trim().is_empty() {
            return id;
        }
    }
    let id = uuid::Uuid::new_v4().to_string();
    if let Err(e) = store.set_setting(DEVICE_ID_SETTING, &id) {
        log::warn!("plugin backup: could not persist device id: {e:#}");
    }
    id
}

/// The device name backups are signed with, as Settings shows it.
fn device_name(store: &SkillStore) -> String {
    store
        .get_setting("backup_device_name")
        .ok()
        .flatten()
        .map(|v| git_backup::sanitize_device_name(&v))
        .filter(|v| !v.is_empty())
        .unwrap_or_else(git_backup::default_device_name)
}

/// The marketplaces Claude knows, as portable sources. A local-directory
/// marketplace is wiring for this machine only and is left out, like other
/// machine-specific settings the backup never carries.
fn portable_marketplaces(claude_home: &Path) -> Vec<MarketplaceRef> {
    let path = claude_home.join("plugins").join("known_marketplaces.json");
    let Some(Value::Object(map)) = fs::read_to_string(path)
        .ok()
        .and_then(|t| serde_json::from_str::<Value>(&t).ok())
    else {
        return vec![];
    };
    let mut out: Vec<MarketplaceRef> = map
        .iter()
        .filter_map(|(name, entry)| {
            let source = entry.get("source")?;
            let portable = match source.get("source").and_then(Value::as_str) {
                Some("github") => source.get("repo").and_then(Value::as_str),
                Some("directory") | Some("file") => None,
                _ => source.get("url").and_then(Value::as_str),
            }?;
            Some(MarketplaceRef { name: name.clone(), source: portable.to_string() })
        })
        .collect();
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

/// Plugins the user installed on this computer for themselves. Synced
/// (claude.ai) plugins follow the account on their own, and project-scoped
/// ones belong to a repository, so neither is carried.
fn carried(plugins: &[PluginInfo]) -> Vec<PluginRef> {
    let mut out: Vec<PluginRef> = plugins
        .iter()
        .filter(|p| p.installed && p.scope == "user")
        .map(|p| PluginRef { id: p.id.clone(), enabled: p.enabled })
        .collect();
    out.sort_by(|a, b| a.id.cmp(&b.id));
    out
}

pub fn build_manifest(claude_home: &Path, device_id: &str, device_name: &str) -> DeviceManifest {
    let plugins = plugin_scanner::list_plugins(claude_home).unwrap_or_default();
    DeviceManifest {
        schema_version: SCHEMA_VERSION,
        device_id: device_id.to_string(),
        device_name: device_name.to_string(),
        marketplaces: portable_marketplaces(claude_home),
        plugins: carried(&plugins),
    }
}

fn manifest_file_name(device_id: &str) -> String {
    format!("{FILE_PREFIX}{device_id}.json")
}

/// Write this computer's manifest into `metadata_dir`, only when it changed.
/// Returns whether the file was written.
pub fn write_manifest_to(metadata_dir: &Path, manifest: &DeviceManifest) -> Result<bool, AppError> {
    let path = metadata_dir.join(manifest_file_name(&manifest.device_id));
    let mut text = serde_json::to_string_pretty(manifest).map_err(AppError::internal)?;
    text.push('\n');
    if fs::read_to_string(&path).ok().as_deref() == Some(text.as_str()) {
        return Ok(false);
    }
    fs::create_dir_all(metadata_dir)?;
    // `<file>.tmp.<uuid>` is the pattern the backup treats as junk, so a
    // leftover from a crash is never committed or merged.
    let tmp = metadata_dir.join(format!(
        "{}.tmp.{}",
        manifest_file_name(&manifest.device_id),
        uuid::Uuid::new_v4()
    ));
    fs::write(&tmp, &text)?;
    fs::rename(&tmp, &path)?;
    Ok(true)
}

/// Before a backup: record this computer's plugin set alongside the skills.
/// Best effort; a plugin problem must never block a backup.
pub fn write_device_manifest(store: &SkillStore) {
    let Some(home) = plugin_scanner::claude_home().filter(|h| h.is_dir()) else {
        return;
    };
    let manifest = build_manifest(&home, &device_id(store), &device_name(store));
    if let Err(e) = write_manifest_to(&sync_metadata::metadata_dir(), &manifest) {
        log::warn!("plugin backup: could not write the plugin list: {e:#}");
    }
}

/// Every other computer's manifest found in `metadata_dir`.
pub fn read_other_manifests(metadata_dir: &Path, own_device_id: &str) -> Vec<DeviceManifest> {
    let Ok(entries) = fs::read_dir(metadata_dir) else {
        return vec![];
    };
    let mut out: Vec<DeviceManifest> = entries
        .flatten()
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            (name.starts_with(FILE_PREFIX) && name.ends_with(".json")).then(|| e.path())
        })
        .filter_map(|path| {
            let text = fs::read_to_string(path).ok()?;
            serde_json::from_str::<DeviceManifest>(&text).ok()
        })
        .filter(|m| m.device_id != own_device_id && m.schema_version <= SCHEMA_VERSION)
        .collect();
    out.sort_by(|a, b| a.device_name.cmp(&b.device_name));
    out
}

/// What other computers have switched on that this one has not installed.
/// A plugin switched off everywhere else is not offered: the user turned it
/// off on purpose.
pub fn offered(
    others: &[DeviceManifest],
    installed_here: &[PluginInfo],
    local_marketplaces: &BTreeSet<String>,
) -> Vec<OfferedPlugin> {
    let here: BTreeSet<&str> = installed_here
        .iter()
        .filter(|p| p.installed)
        .map(|p| p.id.as_str())
        .collect();
    let mut by_id: BTreeMap<String, OfferedPlugin> = BTreeMap::new();
    for manifest in others {
        for plugin in manifest.plugins.iter().filter(|p| p.enabled) {
            if here.contains(plugin.id.as_str()) {
                continue;
            }
            let Some((name, marketplace)) = plugin.id.rsplit_once('@') else {
                continue;
            };
            let entry = by_id.entry(plugin.id.clone()).or_insert_with(|| OfferedPlugin {
                id: plugin.id.clone(),
                name: name.to_string(),
                marketplace: marketplace.to_string(),
                marketplace_source: None,
                devices: vec![],
            });
            if !local_marketplaces.contains(marketplace) && entry.marketplace_source.is_none() {
                entry.marketplace_source = manifest
                    .marketplaces
                    .iter()
                    .find(|m| m.name == marketplace)
                    .map(|m| m.source.clone());
            }
            if !entry.devices.contains(&manifest.device_name) {
                entry.devices.push(manifest.device_name.clone());
            }
        }
    }
    by_id.into_values().collect()
}

/// For the Plugins page: plugins from the user's other computers.
pub fn offered_here(store: &SkillStore) -> Result<Vec<OfferedPlugin>, AppError> {
    let others = read_other_manifests(&sync_metadata::metadata_dir(), &device_id(store));
    if others.is_empty() {
        return Ok(vec![]);
    }
    let home = plugin_scanner::claude_home();
    let installed = match &home {
        Some(h) if h.is_dir() => plugin_scanner::list_plugins(h)?,
        _ => vec![],
    };
    let local: BTreeSet<String> = home
        .as_deref()
        .map(portable_marketplaces)
        .unwrap_or_default()
        .into_iter()
        .map(|m| m.name)
        .collect();
    Ok(offered(&others, &installed, &local))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(path: &Path, text: &str) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, text).unwrap();
    }

    fn claude_fixture(home: &Path) {
        write(
            &home.join("plugins/installed_plugins.json"),
            r#"{"plugins": {
                "seo@market": [{"scope": "user", "installPath": "/x"}],
                "proj@market": [{"scope": "project", "installPath": "/y"}]}}"#,
        );
        write(&home.join("settings.json"), r#"{"enabledPlugins": {"seo@market": false}}"#);
        write(
            &home.join("plugins/known_marketplaces.json"),
            r#"{"market": {"source": {"source": "github", "repo": "o/market"}},
                "web": {"source": {"source": "url", "url": "https://x/m.git"}},
                "mine": {"source": {"source": "directory", "path": "C:/dev/mine"}}}"#,
        );
        write(&home.join("plugins/synced/acct/manifest.json"), r#"{"plugins": [{"name": "f"}]}"#);
        write(&home.join("plugins/synced/acct/f/.claude-plugin/plugin.json"), r#"{"name": "design"}"#);
    }

    #[test]
    fn the_manifest_carries_user_plugins_and_portable_marketplaces_only() {
        let home = tempfile::tempdir().unwrap();
        claude_fixture(home.path());
        let m = build_manifest(home.path(), "dev-a", "Laptop");
        assert_eq!(m.plugins, vec![PluginRef { id: "seo@market".into(), enabled: false }]);
        let names: Vec<&str> = m.marketplaces.iter().map(|x| x.name.as_str()).collect();
        assert_eq!(names, vec!["market", "web"], "a local directory never leaves the machine");
        assert_eq!(m.marketplaces[0].source, "o/market");
    }

    #[test]
    fn an_unchanged_manifest_is_not_rewritten() {
        let dir = tempfile::tempdir().unwrap();
        let m = DeviceManifest {
            schema_version: 1,
            device_id: "dev-a".into(),
            device_name: "Laptop".into(),
            marketplaces: vec![],
            plugins: vec![PluginRef { id: "a@m".into(), enabled: true }],
        };
        assert!(write_manifest_to(dir.path(), &m).unwrap());
        assert!(!write_manifest_to(dir.path(), &m).unwrap(), "same set, no new commit");
        assert!(dir.path().join("plugins-dev-a.json").is_file());
        assert!(fs::read_dir(dir.path()).unwrap().all(|e| !e.unwrap().file_name().to_string_lossy().contains(".tmp")));
    }

    fn manifest(id: &str, name: &str, plugins: &[(&str, bool)], markets: &[(&str, &str)]) -> DeviceManifest {
        DeviceManifest {
            schema_version: 1,
            device_id: id.into(),
            device_name: name.into(),
            marketplaces: markets
                .iter()
                .map(|(n, s)| MarketplaceRef { name: (*n).into(), source: (*s).into() })
                .collect(),
            plugins: plugins
                .iter()
                .map(|(p, e)| PluginRef { id: (*p).into(), enabled: *e })
                .collect(),
        }
    }

    #[test]
    fn other_computers_are_read_and_this_one_is_skipped() {
        let dir = tempfile::tempdir().unwrap();
        for m in [manifest("me", "This", &[], &[]), manifest("b", "Desktop", &[], &[])] {
            write_manifest_to(dir.path(), &m).unwrap();
        }
        write(&dir.path().join("plugins-broken.json"), "{nope");
        write(&dir.path().join("schema.json"), "{}");
        let others = read_other_manifests(dir.path(), "me");
        assert_eq!(others.len(), 1);
        assert_eq!(others[0].device_name, "Desktop");
    }

    #[test]
    fn offers_what_is_on_elsewhere_and_missing_here() {
        let others = vec![
            manifest(
                "b",
                "Desktop",
                &[("superpowers@obra", true), ("seo@market", true), ("off@market", false)],
                &[("obra", "obra/superpowers-marketplace"), ("market", "o/market")],
            ),
            manifest("c", "Work", &[("superpowers@obra", true)], &[]),
        ];
        let here = vec![PluginInfo {
            id: "seo@market".into(),
            name: "seo".into(),
            marketplace: "market".into(),
            version: None,
            scope: "user".into(),
            enabled: true,
            install_path: None,
            installed: true,
            files_present: true,
            source_repo: None,
            latest_version: None,
            update_available: false,
        }];
        let local = BTreeSet::from(["market".to_string()]);
        let offers = offered(&others, &here, &local);
        assert_eq!(offers.len(), 1, "installed here and switched off elsewhere are not offered");
        let sp = &offers[0];
        assert_eq!(sp.id, "superpowers@obra");
        assert_eq!(sp.devices, vec!["Desktop", "Work"]);
        assert_eq!(sp.marketplace_source.as_deref(), Some("obra/superpowers-marketplace"));
    }

    #[test]
    fn a_known_marketplace_needs_no_source() {
        let others = vec![manifest("b", "Desktop", &[("x@market", true)], &[("market", "o/market")])];
        let offers = offered(&others, &[], &BTreeSet::from(["market".to_string()]));
        assert_eq!(offers[0].marketplace_source, None);
    }

    /// Read-only check against this machine's real Claude setup:
    /// `cargo test --lib live_plugin_manifest -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn live_plugin_manifest() {
        let home = plugin_scanner::claude_home().expect("a Claude config directory");
        let m = build_manifest(&home, "live", "This computer");
        assert!(m.plugins.iter().all(|p| !p.id.ends_with("@synced")), "synced plugins never travel");
        println!("{}", serde_json::to_string_pretty(&m).unwrap());
    }
}
