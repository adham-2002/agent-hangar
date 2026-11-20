//! Read and toggle Claude Code plugins by reading Claude's own files.
//!
//! The app keeps no copy of plugin state: `installed_plugins.json` says what is
//! installed, `settings.json` `enabledPlugins` says what is on, and the plugin
//! folder says what it bundles. Only `enabledPlugins` is ever written, so the
//! app and the `claude` CLI cannot disagree.

use serde::Serialize;
use serde_json::{Map, Value};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use crate::core::error::AppError;
use crate::core::path_guard;

const INSTALLED_FILE: &str = "installed_plugins.json";
const SETTINGS_FILE: &str = "settings.json";

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct PluginInfo {
    pub id: String,
    pub name: String,
    pub marketplace: String,
    pub version: Option<String>,
    pub scope: String,
    pub enabled: bool,
    pub install_path: Option<String>,
    /// Listed in `installed_plugins.json`. False for a stale `enabledPlugins` key.
    pub installed: bool,
    /// The install folder exists on disk.
    pub files_present: bool,
}

#[derive(Debug, Clone, Default, Serialize, PartialEq)]
pub struct PluginDetail {
    pub description: Option<String>,
    pub author: Option<String>,
    pub skills: Vec<String>,
    pub commands: Vec<String>,
    pub agents: Vec<String>,
    pub hooks: bool,
    pub mcp_servers: Vec<String>,
}

/// Claude's config directory: `CLAUDE_CONFIG_DIR` when set (as Claude Code
/// itself honors), otherwise `~/.claude`.
pub fn claude_home() -> Option<PathBuf> {
    if let Some(dir) = std::env::var_os("CLAUDE_CONFIG_DIR").filter(|v| !v.is_empty()) {
        return Some(PathBuf::from(dir));
    }
    dirs::home_dir().map(|h| h.join(".claude"))
}

fn plugins_dir(claude_home: &Path) -> PathBuf {
    claude_home.join("plugins")
}

/// Read a JSON file. `Ok(None)` when it does not exist; an error naming the
/// file when it exists but cannot be read or parsed.
fn read_json(path: &Path) -> Result<Option<Value>, AppError> {
    let text = match fs::read_to_string(path) {
        Ok(t) => t,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(AppError::io(format!("{}: {e}", path.display()))),
    };
    if text.trim().is_empty() {
        return Ok(None);
    }
    serde_json::from_str(&text)
        .map(Some)
        .map_err(|e| AppError::invalid_input(format!("{} is not valid JSON: {e}", path.display())))
}

fn split_id(id: &str) -> (String, String) {
    match id.rsplit_once('@') {
        Some((name, marketplace)) => (name.to_string(), marketplace.to_string()),
        None => (id.to_string(), String::new()),
    }
}

pub fn list_plugins(claude_home: &Path) -> Result<Vec<PluginInfo>, AppError> {
    let installed = read_json(&plugins_dir(claude_home).join(INSTALLED_FILE))?;
    let settings = read_json(&claude_home.join(SETTINGS_FILE))?;

    let enabled_map = settings
        .as_ref()
        .and_then(|s| s.get("enabledPlugins"))
        .and_then(Value::as_object);
    let is_enabled = |id: &str| {
        enabled_map
            .and_then(|m| m.get(id))
            .and_then(Value::as_bool)
            .unwrap_or(false)
    };

    let mut out: Vec<PluginInfo> = Vec::new();

    if let Some(plugins) = installed
        .as_ref()
        .and_then(|v| v.get("plugins"))
        .and_then(Value::as_object)
    {
        for (id, entries) in plugins {
            let entries = entries.as_array().map(Vec::as_slice).unwrap_or(&[]);
            // One row per id; prefer the user-scope entry.
            let entry = entries
                .iter()
                .find(|e| e.get("scope").and_then(Value::as_str) == Some("user"))
                .or_else(|| entries.first());
            let install_path = entry
                .and_then(|e| e.get("installPath"))
                .and_then(Value::as_str)
                .map(str::to_string);
            let (name, marketplace) = split_id(id);
            out.push(PluginInfo {
                id: id.clone(),
                name,
                marketplace,
                version: entry
                    .and_then(|e| e.get("version"))
                    .and_then(Value::as_str)
                    .map(str::to_string),
                scope: entry
                    .and_then(|e| e.get("scope"))
                    .and_then(Value::as_str)
                    .unwrap_or("user")
                    .to_string(),
                enabled: is_enabled(id),
                files_present: install_path
                    .as_deref()
                    .map(|p| Path::new(p).is_dir())
                    .unwrap_or(false),
                install_path,
                installed: true,
            });
        }
    }

    // Stale entries: switched on in settings but no longer installed.
    if let Some(map) = enabled_map {
        for id in map.keys() {
            if out.iter().any(|p| &p.id == id) {
                continue;
            }
            let (name, marketplace) = split_id(id);
            out.push(PluginInfo {
                id: id.clone(),
                name,
                marketplace,
                version: None,
                scope: "user".into(),
                enabled: is_enabled(id),
                install_path: None,
                installed: false,
                files_present: false,
            });
        }
    }

    Ok(out)
}

fn sorted_names(mut v: Vec<String>) -> Vec<String> {
    v.sort();
    v
}

fn md_stems(dir: &Path) -> Vec<String> {
    let Ok(rd) = fs::read_dir(dir) else {
        return vec![];
    };
    sorted_names(
        rd.flatten()
            .filter_map(|e| {
                let p = e.path();
                (p.extension().and_then(|x| x.to_str()) == Some("md"))
                    .then(|| p.file_stem()?.to_str().map(str::to_string))
                    .flatten()
            })
            .collect(),
    )
}

fn skill_names(dir: &Path) -> Vec<String> {
    let Ok(rd) = fs::read_dir(dir) else {
        return vec![];
    };
    sorted_names(
        rd.flatten()
            .filter(|e| e.path().join("SKILL.md").is_file())
            .filter_map(|e| e.file_name().to_str().map(str::to_string))
            .collect(),
    )
}

fn mcp_server_names(v: &Value) -> Vec<String> {
    // `.mcp.json` is either `{ "mcpServers": { name: ... } }` or `{ name: ... }`.
    let servers = v.get("mcpServers").unwrap_or(v);
    servers
        .as_object()
        .map(|m| m.keys().cloned().collect())
        .unwrap_or_default()
}

pub fn inspect_plugin(claude_home: &Path, install_path: &Path) -> Result<PluginDetail, AppError> {
    if !path_guard::is_path_safe(&plugins_dir(claude_home), install_path) {
        return Err(AppError::invalid_input(
            "Plugin path is outside the Claude plugins directory",
        ));
    }
    if !install_path.is_dir() {
        return Ok(PluginDetail::default());
    }

    let manifest = read_json(&install_path.join(".claude-plugin").join("plugin.json"))
        .ok()
        .flatten();
    let description = manifest
        .as_ref()
        .and_then(|m| m.get("description"))
        .and_then(Value::as_str)
        .map(str::to_string);
    let author = manifest.as_ref().and_then(|m| m.get("author")).and_then(|a| {
        a.as_str()
            .map(str::to_string)
            .or_else(|| a.get("name").and_then(Value::as_str).map(str::to_string))
    });

    let mut mcp = read_json(&install_path.join(".mcp.json"))
        .ok()
        .flatten()
        .map(|v| mcp_server_names(&v))
        .unwrap_or_default();
    if let Some(m) = manifest.as_ref().and_then(|m| m.get("mcpServers")) {
        mcp.extend(mcp_server_names(m));
    }
    mcp.dedup();

    let hooks = install_path.join("hooks").join("hooks.json").is_file()
        || manifest.as_ref().is_some_and(|m| m.get("hooks").is_some());

    Ok(PluginDetail {
        description,
        author,
        skills: skill_names(&install_path.join("skills")),
        commands: md_stems(&install_path.join("commands")),
        agents: md_stems(&install_path.join("agents")),
        hooks,
        mcp_servers: sorted_names(mcp),
    })
}

/// The leading whitespace of the first indented line, so a rewrite keeps the
/// file's own indentation. Defaults to two spaces.
fn detect_indent(text: &str) -> String {
    text.lines()
        .find(|l| l.starts_with(' ') || l.starts_with('\t'))
        .map(|l| {
            l.chars()
                .take_while(|c| *c == ' ' || *c == '\t')
                .collect::<String>()
        })
        .unwrap_or_else(|| "  ".to_string())
}

/// Set `enabledPlugins[id]` in `settings.json`, touching nothing else.
///
/// The file is read immediately before the write so a change Claude made a
/// moment ago is merged rather than overwritten, and the write goes through a
/// temp file in the same directory and an atomic rename.
pub fn set_plugin_enabled(claude_home: &Path, id: &str, enabled: bool) -> Result<(), AppError> {
    match id.rsplit_once('@') {
        Some((name, market)) if !name.is_empty() && !market.is_empty() => {}
        _ => {
            return Err(AppError::invalid_input(format!(
                "Invalid plugin id '{id}' (expected name@marketplace)"
            )))
        }
    }
    if !claude_home.is_dir() {
        return Err(AppError::not_found(format!(
            "Claude config directory not found: {}",
            claude_home.display()
        )));
    }

    let path = claude_home.join(SETTINGS_FILE);
    let (mut root, indent, trailing_newline) = match fs::read_to_string(&path) {
        Ok(text) if !text.trim().is_empty() => {
            let value: Value = serde_json::from_str(&text).map_err(|e| {
                AppError::invalid_input(format!("{} is not valid JSON: {e}", path.display()))
            })?;
            (value, detect_indent(&text), text.ends_with('\n'))
        }
        Ok(_) => (Value::Object(Map::new()), "  ".to_string(), true),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            (Value::Object(Map::new()), "  ".to_string(), true)
        }
        Err(e) => return Err(AppError::io(format!("{}: {e}", path.display()))),
    };

    let obj = root.as_object_mut().ok_or_else(|| {
        AppError::invalid_input(format!("{} is not a JSON object", path.display()))
    })?;
    let plugins = obj
        .entry("enabledPlugins")
        .or_insert_with(|| Value::Object(Map::new()))
        .as_object_mut()
        .ok_or_else(|| {
            AppError::invalid_input(format!(
                "'enabledPlugins' in {} is not an object",
                path.display()
            ))
        })?;
    plugins.insert(id.to_string(), Value::Bool(enabled));

    let mut buf = Vec::new();
    let formatter = serde_json::ser::PrettyFormatter::with_indent(indent.as_bytes());
    let mut ser = serde_json::Serializer::with_formatter(&mut buf, formatter);
    serde::Serialize::serialize(&root, &mut ser).map_err(AppError::internal)?;
    if trailing_newline {
        buf.push(b'\n');
    }

    let mut tmp = tempfile::NamedTempFile::new_in(claude_home)?;
    tmp.write_all(&buf)?;
    tmp.flush()?;
    tmp.persist(&path)
        .map_err(|e| AppError::io(format!("{}: {}", path.display(), e.error)))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn write(path: &Path, text: &str) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, text).unwrap();
    }

    fn installed_json(entries: &[(&str, &str, &Path)]) -> String {
        let plugins: Vec<String> = entries
            .iter()
            .map(|(id, scope, p)| {
                format!(
                    r#""{id}": [{{"scope": "{scope}", "installPath": {}, "version": "1.0.0"}}]"#,
                    serde_json::to_string(&p.to_string_lossy()).unwrap()
                )
            })
            .collect();
        format!(r#"{{"version": 2, "plugins": {{{}}}}}"#, plugins.join(","))
    }

    #[test]
    fn lists_installed_with_enabled_state() {
        let home = tempdir().unwrap();
        let a = home.path().join("plugins/cache/m/a/1.0.0");
        let b = home.path().join("plugins/cache/m/b/1.0.0");
        fs::create_dir_all(&a).unwrap();
        fs::create_dir_all(&b).unwrap();
        write(
            &home.path().join("plugins/installed_plugins.json"),
            &installed_json(&[("a@m", "user", &a), ("b@m", "user", &b)]),
        );
        write(
            &home.path().join("settings.json"),
            r#"{"enabledPlugins": {"a@m": true}}"#,
        );

        let list = list_plugins(home.path()).unwrap();
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].id, "a@m");
        assert_eq!(list[0].name, "a");
        assert_eq!(list[0].marketplace, "m");
        assert_eq!(list[0].version.as_deref(), Some("1.0.0"));
        assert!(list[0].enabled && list[0].installed && list[0].files_present);
        assert!(!list[1].enabled);
    }

    #[test]
    fn enabled_but_not_installed_is_reported_missing() {
        let home = tempdir().unwrap();
        write(
            &home.path().join("settings.json"),
            r#"{"enabledPlugins": {"ghost@m": true}}"#,
        );
        let list = list_plugins(home.path()).unwrap();
        assert_eq!(list.len(), 1);
        assert!(!list[0].installed && list[0].enabled);
        assert!(!list[0].files_present);
    }

    #[test]
    fn multiple_entries_one_row_user_scope_first() {
        let home = tempdir().unwrap();
        write(
            &home.path().join("plugins/installed_plugins.json"),
            r#"{"plugins": {"a@m": [
                {"scope": "project", "installPath": "/p", "version": "2.0.0"},
                {"scope": "user", "installPath": "/u", "version": "1.0.0"}]}}"#,
        );
        let list = list_plugins(home.path()).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].scope, "user");
        assert_eq!(list[0].version.as_deref(), Some("1.0.0"));
    }

    #[test]
    fn missing_claude_home_is_empty() {
        let home = tempdir().unwrap();
        let list = list_plugins(&home.path().join("nope")).unwrap();
        assert!(list.is_empty());
    }

    #[test]
    fn malformed_installed_plugins_errors_naming_file() {
        let home = tempdir().unwrap();
        write(&home.path().join("plugins/installed_plugins.json"), "{oops");
        let err = list_plugins(home.path()).unwrap_err();
        assert!(err.message.contains("installed_plugins.json"));
    }

    #[test]
    fn plugin_folder_missing_sets_files_present_false() {
        let home = tempdir().unwrap();
        let gone = home.path().join("plugins/cache/m/a/1.0.0");
        write(
            &home.path().join("plugins/installed_plugins.json"),
            &installed_json(&[("a@m", "user", &gone)]),
        );
        let list = list_plugins(home.path()).unwrap();
        assert!(list[0].installed && !list[0].files_present);
        let detail = inspect_plugin(home.path(), &gone).unwrap();
        assert_eq!(detail, PluginDetail::default());
    }

    #[test]
    fn inspect_counts_bundle_contents() {
        let home = tempdir().unwrap();
        let p = home.path().join("plugins/cache/m/a/1.0.0");
        write(&p.join("skills/one/SKILL.md"), "x");
        write(&p.join("skills/two/SKILL.md"), "x");
        write(&p.join("skills/not-a-skill/readme.txt"), "x");
        write(&p.join("commands/go.md"), "x");
        write(&p.join("agents/helper.md"), "x");
        write(&p.join("hooks/hooks.json"), "{}");
        write(&p.join(".mcp.json"), r#"{"mcpServers": {"srv": {}}}"#);
        write(
            &p.join(".claude-plugin/plugin.json"),
            r#"{"description": "Does things", "author": {"name": "Ada"}}"#,
        );

        let d = inspect_plugin(home.path(), &p).unwrap();
        assert_eq!(d.description.as_deref(), Some("Does things"));
        assert_eq!(d.author.as_deref(), Some("Ada"));
        assert_eq!(d.skills, vec!["one", "two"]);
        assert_eq!(d.commands, vec!["go"]);
        assert_eq!(d.agents, vec!["helper"]);
        assert!(d.hooks);
        assert_eq!(d.mcp_servers, vec!["srv"]);
    }

    #[test]
    fn inspect_rejects_path_outside_plugins_dir() {
        let home = tempdir().unwrap();
        let outside = tempdir().unwrap();
        fs::create_dir_all(home.path().join("plugins")).unwrap();
        let err = inspect_plugin(home.path(), outside.path()).unwrap_err();
        assert!(err.message.contains("outside"));
    }

    const SETTINGS: &str = r#"{
  "model": "opus",
  "hooks": {
    "Stop": []
  },
  "enabledPlugins": {
    "a@m": true
  },
  "permissions": {
    "allow": []
  }
}
"#;

    #[test]
    fn toggle_preserves_other_keys_and_order() {
        let home = tempdir().unwrap();
        write(&home.path().join("settings.json"), SETTINGS);
        set_plugin_enabled(home.path(), "a@m", false).unwrap();
        let after = fs::read_to_string(home.path().join("settings.json")).unwrap();
        assert_eq!(after, SETTINGS.replace("\"a@m\": true", "\"a@m\": false"));
    }

    #[test]
    fn toggle_creates_enabled_plugins_when_absent() {
        let home = tempdir().unwrap();
        write(&home.path().join("settings.json"), "{\n  \"model\": \"opus\"\n}\n");
        set_plugin_enabled(home.path(), "a@m", true).unwrap();
        let v: Value =
            serde_json::from_str(&fs::read_to_string(home.path().join("settings.json")).unwrap())
                .unwrap();
        assert_eq!(v["model"], "opus");
        assert_eq!(v["enabledPlugins"]["a@m"], true);
    }

    #[test]
    fn toggle_missing_settings_file_creates_it_with_only_that_key() {
        let home = tempdir().unwrap();
        set_plugin_enabled(home.path(), "a@m", true).unwrap();
        let v: Value =
            serde_json::from_str(&fs::read_to_string(home.path().join("settings.json")).unwrap())
                .unwrap();
        assert_eq!(v, serde_json::json!({"enabledPlugins": {"a@m": true}}));
    }

    #[test]
    fn toggle_invalid_json_refuses_and_leaves_file_untouched() {
        let home = tempdir().unwrap();
        write(&home.path().join("settings.json"), "{ not json");
        let err = set_plugin_enabled(home.path(), "a@m", true).unwrap_err();
        assert!(err.message.contains("settings.json"));
        assert_eq!(
            fs::read_to_string(home.path().join("settings.json")).unwrap(),
            "{ not json"
        );
    }

    #[test]
    fn toggle_rejects_id_without_at_sign() {
        let home = tempdir().unwrap();
        assert!(set_plugin_enabled(home.path(), "plain", true).is_err());
        assert!(set_plugin_enabled(home.path(), "@m", true).is_err());
        assert!(!home.path().join("settings.json").exists());
    }

    #[test]
    fn toggle_detects_indent_of_four_spaces() {
        let home = tempdir().unwrap();
        write(
            &home.path().join("settings.json"),
            "{\n    \"enabledPlugins\": {\n        \"a@m\": true\n    }\n}\n",
        );
        set_plugin_enabled(home.path(), "a@m", false).unwrap();
        assert_eq!(
            fs::read_to_string(home.path().join("settings.json")).unwrap(),
            "{\n    \"enabledPlugins\": {\n        \"a@m\": false\n    }\n}\n"
        );
    }
}
