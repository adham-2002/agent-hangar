//! Drive `claude plugin …` for what Claude's files alone cannot do: fetching,
//! installing, updating and removing plugins, and managing marketplaces.
//!
//! Every call goes straight to the executable with an argument vector, never
//! through a shell, and every user-supplied value is checked so it cannot be
//! read as an option. A marketplace may declare a command it runs to install a
//! plugin; the CLI refuses to run it unattended and reports it instead. That
//! report is passed back to the user, and only the hash they approved is ever
//! sent back with `--accept-command` — never a blanket `-y`.

use serde::Serialize;
use serde_json::Value;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use crate::core::error::AppError;

/// Installs clone repositories; generous, but a hung CLI must not hang the app.
pub const LONG_TIMEOUT: Duration = Duration::from_secs(300);
pub const SHORT_TIMEOUT: Duration = Duration::from_secs(60);

#[cfg(target_os = "windows")]
const EXECUTABLE_NAMES: &[&str] = &["claude.exe"];
#[cfg(not(target_os = "windows"))]
const EXECUTABLE_NAMES: &[&str] = &["claude"];

/// Find the `claude` executable: on PATH first, then where the installers put
/// it. A GUI app launched from the desktop often has a shorter PATH than a
/// terminal, which is why the fallbacks matter. On Windows only `claude.exe`
/// is accepted: an npm `claude.cmd` shim would have to run through `cmd.exe`,
/// whose argument parsing is not safe for values the user typed.
pub fn find_claude() -> Option<PathBuf> {
    let mut dirs: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).collect())
        .unwrap_or_default();
    if let Some(home) = dirs::home_dir() {
        dirs.push(home.join(".local").join("bin"));
        dirs.push(home.join(".claude").join("local"));
    }
    #[cfg(not(target_os = "windows"))]
    {
        dirs.push(PathBuf::from("/opt/homebrew/bin"));
        dirs.push(PathBuf::from("/usr/local/bin"));
    }
    dirs.iter()
        .flat_map(|dir| EXECUTABLE_NAMES.iter().map(move |name| dir.join(name)))
        .find(|candidate| candidate.is_file())
}

fn base_command(exe: &Path) -> Command {
    #[allow(unused_mut)]
    let mut cmd = Command::new(exe);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    #[cfg(target_os = "linux")]
    if std::env::var_os("APPDIR").is_some() {
        cmd.env_remove("LD_LIBRARY_PATH");
    }
    cmd.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    cmd
}

pub struct RawOutput {
    pub success: bool,
    pub stdout: String,
    pub stderr: String,
}

/// Run `claude <args>` with a deadline. Output is drained on reader threads so
/// a large result (the plugin catalog runs to megabytes) cannot fill a pipe and
/// deadlock the child.
pub fn run(exe: &Path, args: &[String], timeout: Duration) -> Result<RawOutput, AppError> {
    let mut child = base_command(exe)
        .args(args)
        .spawn()
        .map_err(|e| AppError::io(format!("Could not start {}: {e}", exe.display())))?;

    let mut out_pipe = child.stdout.take();
    let mut err_pipe = child.stderr.take();
    let out_reader = std::thread::spawn(move || {
        let mut s = String::new();
        if let Some(p) = out_pipe.as_mut() {
            let _ = p.read_to_string(&mut s);
        }
        s
    });
    let err_reader = std::thread::spawn(move || {
        let mut s = String::new();
        if let Some(p) = err_pipe.as_mut() {
            let _ = p.read_to_string(&mut s);
        }
        s
    });

    let deadline = Instant::now() + timeout;
    let status = loop {
        if let Some(status) = child.try_wait()? {
            break status;
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            return Err(AppError::io(format!(
                "claude {} did not finish within {} seconds",
                args.first().map(String::as_str).unwrap_or(""),
                timeout.as_secs()
            )));
        }
        std::thread::sleep(Duration::from_millis(100));
    };

    Ok(RawOutput {
        success: status.success(),
        stdout: out_reader.join().unwrap_or_default(),
        stderr: err_reader.join().unwrap_or_default(),
    })
}

// ── Argument checks ──

fn is_name(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 200
        && !value.starts_with('-')
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
}

/// `name` or `name@marketplace`, neither part able to pass for an option.
pub fn validate_plugin_id(id: &str) -> Result<(), AppError> {
    let ok = match id.split_once('@') {
        Some((name, market)) => is_name(name) && is_name(market),
        None => is_name(id),
    };
    if ok {
        Ok(())
    } else {
        Err(AppError::invalid_input(format!("Invalid plugin id '{id}'")))
    }
}

pub fn validate_marketplace_name(name: &str) -> Result<(), AppError> {
    if is_name(name) {
        Ok(())
    } else {
        Err(AppError::invalid_input(format!("Invalid marketplace name '{name}'")))
    }
}

/// A marketplace source: `owner/repo`, a URL or a path. Free-form, so only
/// what could change how the CLI reads it is refused.
pub fn validate_marketplace_source(source: &str) -> Result<(), AppError> {
    let trimmed = source.trim();
    if trimmed.is_empty()
        || trimmed.len() > 512
        || trimmed.starts_with('-')
        || trimmed.chars().any(char::is_control)
    {
        return Err(AppError::invalid_input("Invalid marketplace source"));
    }
    Ok(())
}

pub fn validate_scope(scope: &str) -> Result<(), AppError> {
    if matches!(scope, "user" | "project" | "local") {
        Ok(())
    } else {
        Err(AppError::invalid_input(format!("Invalid scope '{scope}'")))
    }
}

pub fn validate_command_hash(hash: &str) -> Result<(), AppError> {
    if hash.len() == 64 && hash.chars().all(|c| c.is_ascii_hexdigit()) {
        Ok(())
    } else {
        Err(AppError::invalid_input("Invalid command hash"))
    }
}

// ── Results ──

/// A command a marketplace wants to run, shown to the user before it may run.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct ShownCommand {
    /// What to show: the command line, or the CLI's whole description of it.
    pub text: String,
    pub sha256: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct CliOutcome {
    pub ok: bool,
    /// The CLI's own outcome word (`installed`, `failed`, …) when it gave one.
    pub outcome: Option<String>,
    pub message: Option<String>,
    pub failure_code: Option<String>,
    /// Set when the operation is waiting for the user to approve this command.
    pub shown_command: Option<ShownCommand>,
}

/// The last stdout line that is a JSON object: `--json` prints exactly one
/// result line, after anything else the CLI chose to print.
fn last_json_line(stdout: &str) -> Option<Value> {
    stdout
        .lines()
        .rev()
        .map(str::trim)
        .filter(|l| l.starts_with('{'))
        .find_map(|l| serde_json::from_str::<Value>(l).ok())
}

fn shown_command(value: &Value) -> Option<ShownCommand> {
    let shown = value.get("shownCommand")?;
    let sha256 = shown.get("sha256").and_then(Value::as_str)?.to_string();
    let text = ["command", "commandLine", "display", "text"]
        .iter()
        .find_map(|k| shown.get(*k).and_then(Value::as_str))
        .map(str::to_string)
        .unwrap_or_else(|| serde_json::to_string_pretty(shown).unwrap_or_default());
    Some(ShownCommand { text, sha256 })
}

/// Read a `--json` run. Success needs both a zero exit and an outcome other
/// than `failed`; without a JSON line the stderr text becomes the message, so
/// the user always sees why something did not work.
pub fn parse_outcome(raw: &RawOutput) -> CliOutcome {
    let json = last_json_line(&raw.stdout);
    let str_field = |k: &str| {
        json.as_ref()
            .and_then(|j| j.get(k))
            .and_then(Value::as_str)
            .map(str::to_string)
    };
    let outcome = str_field("outcome");
    let shown = json.as_ref().and_then(shown_command);
    let message = str_field("message").or_else(|| {
        let text = raw.stderr.trim();
        (!text.is_empty()).then(|| text.lines().last().unwrap_or(text).to_string())
    });
    CliOutcome {
        ok: raw.success && outcome.as_deref() != Some("failed") && shown.is_none(),
        outcome,
        message,
        failure_code: str_field("failureCode"),
        shown_command: shown,
    }
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct CatalogEntry {
    pub plugin_id: String,
    pub name: String,
    pub description: Option<String>,
    pub marketplace: String,
    pub install_count: Option<u64>,
    pub installed: bool,
}

/// `claude plugin list --available --json`: `{installed: [{id}], available: [...]}`.
///
/// `available` leaves out what is already installed, so installed plugins are
/// added back from `installed`, marked as such: a search for a plugin the
/// user has must find it, not suggest it does not exist.
pub fn parse_catalog(stdout: &str) -> Result<Vec<CatalogEntry>, AppError> {
    let root: Value = serde_json::from_str(stdout.trim())
        .map_err(|e| AppError::internal(format!("Unreadable plugin catalog: {e}")))?;
    let installed_ids: Vec<&str> = root
        .get("installed")
        .and_then(Value::as_array)
        .map(|list| list.iter().filter_map(|p| p.get("id")?.as_str()).collect())
        .unwrap_or_default();
    let installed: std::collections::HashSet<&str> = installed_ids.iter().copied().collect();
    let available = root
        .get("available")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or(&[]);
    let mut entries: Vec<CatalogEntry> = available
        .iter()
        .filter_map(|p| {
            let plugin_id = p.get("pluginId")?.as_str()?.to_string();
            let str_field = |k: &str| p.get(k).and_then(Value::as_str).map(str::to_string);
            Some(CatalogEntry {
                installed: installed.contains(plugin_id.as_str()),
                name: str_field("name").unwrap_or_else(|| {
                    plugin_id.split('@').next().unwrap_or(&plugin_id).to_string()
                }),
                description: str_field("description"),
                marketplace: str_field("marketplaceName").unwrap_or_default(),
                install_count: p.get("installCount").and_then(Value::as_u64),
                plugin_id,
            })
        })
        .collect();

    let listed: std::collections::HashSet<String> =
        entries.iter().map(|e| e.plugin_id.clone()).collect();
    for id in installed_ids {
        if listed.contains(id) {
            continue;
        }
        let (name, marketplace) = id.split_once('@').unwrap_or((id, ""));
        entries.push(CatalogEntry {
            plugin_id: id.to_string(),
            name: name.to_string(),
            description: None,
            marketplace: marketplace.to_string(),
            install_count: None,
            installed: true,
        });
    }
    Ok(entries)
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct MarketplaceInfo {
    pub name: String,
    /// `github`, `git`, `url`, `directory`, … as the CLI reports it.
    pub kind: Option<String>,
    /// The repo, URL or path it comes from.
    pub location: Option<String>,
}

pub fn parse_marketplaces(stdout: &str) -> Result<Vec<MarketplaceInfo>, AppError> {
    let root: Value = serde_json::from_str(stdout.trim())
        .map_err(|e| AppError::internal(format!("Unreadable marketplace list: {e}")))?;
    Ok(root
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or(&[])
        .iter()
        .filter_map(|m| {
            let name = m.get("name")?.as_str()?.to_string();
            let location = ["repo", "url", "path"]
                .iter()
                .find_map(|k| m.get(*k).and_then(Value::as_str))
                .map(str::to_string);
            Some(MarketplaceInfo {
                name,
                kind: m.get("source").and_then(Value::as_str).map(str::to_string),
                location,
            })
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn raw(success: bool, stdout: &str, stderr: &str) -> RawOutput {
        RawOutput { success, stdout: stdout.into(), stderr: stderr.into() }
    }

    #[test]
    fn plugin_ids_cannot_pass_for_options() {
        assert!(validate_plugin_id("superpowers@obra").is_ok());
        assert!(validate_plugin_id("seo").is_ok());
        assert!(validate_plugin_id("--yes").is_err());
        assert!(validate_plugin_id("a@-y").is_err());
        assert!(validate_plugin_id("a b@m").is_err());
        assert!(validate_plugin_id("a;rm@m").is_err());
        assert!(validate_plugin_id("").is_err());
    }

    #[test]
    fn marketplace_inputs_are_checked() {
        assert!(validate_marketplace_source("obra/superpowers-marketplace").is_ok());
        assert!(validate_marketplace_source("https://github.com/a/b.git").is_ok());
        assert!(validate_marketplace_source("--sparse").is_err());
        assert!(validate_marketplace_source("a\nb").is_err());
        assert!(validate_marketplace_source("   ").is_err());
        assert!(validate_marketplace_name("claude-plugins-official").is_ok());
        assert!(validate_marketplace_name("-x").is_err());
        assert!(validate_scope("project").is_ok());
        assert!(validate_scope("everywhere").is_err());
        assert!(validate_command_hash(&"a".repeat(64)).is_ok());
        assert!(validate_command_hash("abc").is_err());
    }

    #[test]
    fn failure_line_is_read_from_real_cli_output() {
        // Captured from `claude plugin install <missing> --json`.
        let out = parse_outcome(&raw(
            false,
            r#"{"command":"install","outcome":"failed","plugin":"x@m","scope":"user","message":"Plugin \"x\" not found in marketplace \"m\"","failureCode":"not_found"}"#,
            "✘ Failed to install plugin",
        ));
        assert!(!out.ok);
        assert_eq!(out.failure_code.as_deref(), Some("not_found"));
        assert!(out.message.unwrap().contains("not found"));
    }

    #[test]
    fn success_needs_zero_exit_and_no_failed_outcome() {
        let ok = parse_outcome(&raw(true, "progress…\n{\"outcome\":\"installed\",\"message\":\"Done\"}\n", ""));
        assert!(ok.ok);
        assert_eq!(ok.outcome.as_deref(), Some("installed"));
        let failed_but_zero = parse_outcome(&raw(true, r#"{"outcome":"failed"}"#, ""));
        assert!(!failed_but_zero.ok);
    }

    #[test]
    fn a_declared_command_is_surfaced_not_accepted() {
        let out = parse_outcome(&raw(
            false,
            r#"{"outcome":"failed","shownCommand":{"command":"npx some-installer","sha256":"ab12"}}"#,
            "",
        ));
        assert!(!out.ok);
        let shown = out.shown_command.unwrap();
        assert_eq!(shown.text, "npx some-installer");
        assert_eq!(shown.sha256, "ab12");
    }

    #[test]
    fn stderr_explains_a_failure_without_json() {
        let out = parse_outcome(&raw(false, "", "error: unknown option\nUsage: …"));
        assert!(!out.ok);
        assert_eq!(out.message.as_deref(), Some("Usage: …"));
    }

    #[test]
    fn catalog_adds_back_installed_plugins() {
        // The real CLI leaves installed plugins out of `available`.
        let entries = parse_catalog(
            r#"{"installed":[{"id":"seo@market"}],"available":[
                {"pluginId":"b@m","name":"b","description":"B","marketplaceName":"m","installCount":5},
                {"pluginId":"c@m","marketplaceName":"m"},
                {"name":"no-id"}]}"#,
        )
        .unwrap();
        assert_eq!(entries.len(), 3);
        assert!(!entries[0].installed);
        assert_eq!(entries[0].install_count, Some(5));
        assert_eq!(entries[1].name, "c");
        let seo = &entries[2];
        assert!(seo.installed);
        assert_eq!((seo.name.as_str(), seo.marketplace.as_str()), ("seo", "market"));
    }

    #[test]
    fn catalog_does_not_duplicate_an_installed_plugin_that_is_also_listed() {
        let entries = parse_catalog(
            r#"{"installed":[{"id":"a@m"}],"available":[{"pluginId":"a@m","name":"a","marketplaceName":"m"}]}"#,
        )
        .unwrap();
        assert_eq!(entries.len(), 1);
        assert!(entries[0].installed);
    }

    #[test]
    fn marketplace_list_reads_each_source_form() {
        let list = parse_marketplaces(
            r#"[{"name":"a","source":"github","repo":"o/r"},{"name":"b","source":"url","url":"https://x"},{"name":"c","source":"directory","path":"/p"}]"#,
        )
        .unwrap();
        assert_eq!(list[0].location.as_deref(), Some("o/r"));
        assert_eq!(list[1].location.as_deref(), Some("https://x"));
        assert_eq!(list[2].kind.as_deref(), Some("directory"));
    }

    #[test]
    fn run_times_out_and_reports_it() {
        // Any executable that outlives the deadline will do.
        #[cfg(target_os = "windows")]
        let (exe, args) = (PathBuf::from("C:/Windows/System32/ping.exe"), vec!["-n".to_string(), "5".into(), "127.0.0.1".into()]);
        #[cfg(not(target_os = "windows"))]
        let (exe, args) = (PathBuf::from("/bin/sleep"), vec!["5".to_string()]);
        let err = run(&exe, &args, Duration::from_millis(300)).err().expect("should time out");
        assert!(err.message.contains("did not finish"));
    }

    /// Read-only check against the real CLI on this machine:
    /// `cargo test --lib live_claude_cli -- --ignored`.
    #[test]
    #[ignore]
    fn live_claude_cli_catalog_and_marketplaces() {
        let exe = find_claude().expect("claude on this machine");
        let args = |a: &[&str]| a.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        let catalog = run(&exe, &args(&["plugin", "list", "--available", "--json"]), SHORT_TIMEOUT).unwrap();
        assert!(catalog.success, "{}", catalog.stderr);
        let entries = parse_catalog(&catalog.stdout).unwrap();
        assert!(!entries.is_empty());
        assert!(entries.iter().any(|e| e.installed));
        let markets = run(&exe, &args(&["plugin", "marketplace", "list", "--json"]), SHORT_TIMEOUT).unwrap();
        let markets = parse_marketplaces(&markets.stdout).unwrap();
        assert!(markets.iter().all(|m| m.location.is_some()));
        let missing = parse_outcome(
            &run(&exe, &args(&["plugin", "install", "definitely-not-a-plugin-xyz@claude-plugins-official", "--json"]), SHORT_TIMEOUT).unwrap(),
        );
        assert!(!missing.ok);
        assert_eq!(missing.failure_code.as_deref(), Some("not_found"));
        println!("catalog {} entries, {} installed, {} marketplaces", entries.len(), entries.iter().filter(|e| e.installed).count(), markets.len());
    }
}

