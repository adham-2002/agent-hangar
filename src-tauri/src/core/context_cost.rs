//! What a skill or plugin costs in an agent's context, estimated from its
//! files.
//!
//! An agent lists every enabled skill by name and description in each
//! session ("always-on"), and reads the full SKILL.md only when the skill is
//! used ("on-invoke"). A plugin's skills, commands and agents are listed the
//! same way. Bundled MCP servers add tool definitions Claude may load lazily,
//! which cannot be read from files, so they are not counted.
//!
//! Without the model's tokenizer these are estimates. The ratios are
//! calibrated against `claude plugin details`, which reports both numbers for
//! plugins: a description listing runs ~3.3 characters per token, a markdown
//! body ~2.85. For a plugin's always-on cost Claude's own figure is used when
//! the `claude` command is available, because its listing carries more than
//! the files show (argument hints, agent definitions); the estimate is the
//! fallback, and each plugin says which it got.

use serde::Serialize;
use std::fs;
use std::path::Path;

use crate::core::plugin_scanner::{self, PluginInfo};

const LISTING_CHARS_PER_TOKEN: f64 = 3.3;
const BODY_CHARS_PER_TOKEN: f64 = 2.85;
/// A SKILL.md larger than this is not read: such a file is not context
/// anyone loads whole, and reading it would only slow the page.
const MAX_DOC_BYTES: u64 = 2 * 1024 * 1024;

#[derive(Debug, Clone, Copy, Default, Serialize, PartialEq, Eq)]
pub struct Cost {
    /// Tokens added to every session while enabled.
    pub always_on: u32,
    /// Tokens added when it is used.
    pub on_invoke: u32,
}

impl std::ops::AddAssign for Cost {
    fn add_assign(&mut self, other: Cost) {
        self.always_on += other.always_on;
        self.on_invoke += other.on_invoke;
    }
}

fn tokens(chars: usize, per_token: f64) -> u32 {
    (chars as f64 / per_token).ceil() as u32
}

/// `name` and `description` from YAML frontmatter, read leniently: one-line
/// values, optional quotes, and folded (`>`/`|`) descriptions.
pub fn frontmatter(doc: &str) -> (Option<String>, Option<String>) {
    let (name, description, _) = frontmatter_fields(doc);
    (name, description)
}

/// `name`, `description` and `argument-hint`.
fn frontmatter_fields(doc: &str) -> (Option<String>, Option<String>, Option<String>) {
    let doc = doc.strip_prefix('\u{feff}').unwrap_or(doc);
    let Some(rest) = doc.strip_prefix("---\n").or_else(|| doc.strip_prefix("---\r\n")) else {
        return (None, None, None);
    };
    let block = rest
        .split("\n---")
        .next()
        .unwrap_or("");
    let unquote = |v: &str| v.trim().trim_matches(|c| c == '"' || c == '\'').to_string();
    let mut name = None;
    let mut description = None;
    let mut hint = None;
    let mut lines = block.lines().peekable();
    while let Some(line) = lines.next() {
        if let Some(v) = line.strip_prefix("name:") {
            name = Some(unquote(v));
        } else if let Some(v) = line.strip_prefix("argument-hint:") {
            hint = Some(unquote(v));
        } else if let Some(v) = line.strip_prefix("description:") {
            let v = v.trim();
            if v == ">" || v == "|" || v == ">-" || v == "|-" {
                let mut folded = Vec::new();
                while let Some(next) = lines.peek() {
                    if next.starts_with(' ') || next.starts_with('\t') {
                        folded.push(next.trim().to_string());
                        lines.next();
                    } else {
                        break;
                    }
                }
                description = Some(folded.join(" "));
            } else {
                description = Some(unquote(v));
            }
        }
    }
    (
        name.filter(|s| !s.is_empty()),
        description.filter(|s| !s.is_empty()),
        hint.filter(|s| !s.is_empty()),
    )
}

/// Cost of one listed item: its `- name: description` line always, its whole
/// document when used.
fn item_cost(doc: &str, fallback_name: &str) -> Cost {
    let (name, description, hint) = frontmatter_fields(doc);
    let listing = format!(
        "- {}{}: {}",
        name.as_deref().unwrap_or(fallback_name),
        hint.map(|h| format!(" {h}")).unwrap_or_default(),
        description.as_deref().unwrap_or("")
    );
    Cost {
        always_on: tokens(listing.chars().count(), LISTING_CHARS_PER_TOKEN),
        on_invoke: tokens(doc.chars().count(), BODY_CHARS_PER_TOKEN),
    }
}

fn read_small(path: &Path) -> Option<String> {
    let meta = fs::metadata(path).ok()?;
    if !meta.is_file() || meta.len() > MAX_DOC_BYTES {
        return None;
    }
    fs::read_to_string(path).ok()
}

/// A skill directory's cost, from its SKILL.md. Zero when there is none.
pub fn skill_dir_cost(dir: &Path) -> Cost {
    let fallback = dir.file_name().and_then(|n| n.to_str()).unwrap_or("skill");
    ["SKILL.md", "skill.md"]
        .iter()
        .find_map(|f| read_small(&dir.join(f)))
        .map(|doc| item_cost(&doc, fallback))
        .unwrap_or_default()
}

/// Every `*.md` in a commands/ or agents/ folder, each listed by its description.
fn markdown_items_cost(dir: &Path) -> Cost {
    let mut total = Cost::default();
    let Ok(entries) = fs::read_dir(dir) else {
        return total;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|x| x.to_str()) != Some("md") {
            continue;
        }
        if let Some(doc) = read_small(&path) {
            let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("item");
            total += item_cost(&doc, stem);
        }
    }
    total
}

/// A plugin's cost: its skills, commands and agents. Bundled MCP servers are
/// not counted (see the module docs).
pub fn plugin_cost(install_path: &Path) -> Cost {
    let mut total = Cost::default();
    if let Ok(skills) = fs::read_dir(install_path.join("skills")) {
        for skill in skills.flatten().filter(|e| e.path().is_dir()) {
            total += skill_dir_cost(&skill.path());
        }
    }
    total += markdown_items_cost(&install_path.join("commands"));
    total += markdown_items_cost(&install_path.join("agents"));
    total
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct PluginCost {
    pub id: String,
    pub cost: Cost,
    /// `claude` when always-on is Claude's own figure, `estimate` otherwise.
    pub source: &'static str,
}

/// The `Always-on: ~5,127 tok` figure from `claude plugin details`.
pub fn parse_cli_always_on(text: &str) -> Option<u32> {
    let line = text.lines().find(|l| l.trim_start().starts_with("Always-on:"))?;
    let after = line.split_once('~')?.1.trim_start();
    let number: String = after
        .chars()
        .take_while(|c| c.is_ascii_digit() || *c == ',' || *c == '.')
        .collect();
    let value: f64 = number.replace(',', "").parse().ok()?;
    let rest = &after[number.len()..];
    let value = if rest.starts_with('k') { value * 1000.0 } else { value };
    Some(value.round() as u32)
}

type CliCostCache = std::sync::Mutex<std::collections::HashMap<(String, Option<String>), Option<u32>>>;

fn cli_cache() -> &'static CliCostCache {
    static CACHE: std::sync::OnceLock<CliCostCache> = std::sync::OnceLock::new();
    CACHE.get_or_init(Default::default)
}

/// Claude's always-on figure for one plugin, cached per version.
fn cli_always_on(exe: &Path, plugin: &PluginInfo) -> Option<u32> {
    let key = (plugin.id.clone(), plugin.version.clone());
    if let Some(hit) = cli_cache().lock().ok()?.get(&key) {
        return *hit;
    }
    let value = crate::core::claude_cli::validate_plugin_id(&plugin.id)
        .ok()
        .and_then(|_| {
            let args = ["plugin", "details", plugin.id.as_str()].map(String::from).to_vec();
            crate::core::claude_cli::run(exe, &args, crate::core::claude_cli::SHORT_TIMEOUT).ok()
        })
        .filter(|raw| raw.success)
        .and_then(|raw| parse_cli_always_on(&raw.stdout));
    if let Ok(mut cache) = cli_cache().lock() {
        cache.insert(key, value);
    }
    value
}

/// Costs of the installed plugins whose files are on disk. Each path is
/// checked to be inside Claude's plugins directory before it is read.
pub fn plugin_costs(claude_home: &Path, plugins: &[PluginInfo]) -> Vec<PluginCost> {
    let root = claude_home.join("plugins");
    plugins
        .iter()
        .filter(|p| p.installed && p.files_present)
        .filter_map(|p| {
            let path = Path::new(p.install_path.as_deref()?);
            crate::core::path_guard::is_path_safe(&root, path).then(|| PluginCost {
                id: p.id.clone(),
                cost: plugin_cost(path),
                source: "estimate",
            })
        })
        .collect()
}

/// Replace estimated always-on figures with Claude's own, where it gives one.
/// Queried in parallel: each `claude` run takes about a second.
fn with_cli_figures(exe: &Path, plugins: &[PluginInfo], mut costs: Vec<PluginCost>) -> Vec<PluginCost> {
    let figures: Vec<(String, Option<u32>)> = std::thread::scope(|scope| {
        let handles: Vec<_> = costs
            .iter()
            .filter_map(|c| plugins.iter().find(|p| p.id == c.id))
            .map(|p| scope.spawn(move || (p.id.clone(), cli_always_on(exe, p))))
            .collect();
        handles.into_iter().filter_map(|h| h.join().ok()).collect()
    });
    for cost in &mut costs {
        if let Some((_, Some(always_on))) = figures.iter().find(|(id, _)| id == &cost.id) {
            cost.cost.always_on = *always_on;
            cost.source = "claude";
        }
    }
    costs
}

/// For the app: every installed plugin's cost.
pub fn installed_plugin_costs() -> Vec<PluginCost> {
    match plugin_scanner::claude_home().filter(|h| h.is_dir()) {
        Some(home) => {
            let plugins = plugin_scanner::list_plugins(&home).unwrap_or_default();
            let costs = plugin_costs(&home, &plugins);
            match crate::core::claude_cli::find_claude() {
                Some(exe) => with_cli_figures(&exe, &plugins, costs),
                None => costs,
            }
        }
        None => vec![],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(path: &Path, text: &str) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, text).unwrap();
    }

    #[test]
    fn frontmatter_reads_plain_quoted_and_folded_values() {
        assert_eq!(
            frontmatter("---\nname: tdd\ndescription: \"Use when testing\"\n---\n# Body"),
            (Some("tdd".into()), Some("Use when testing".into()))
        );
        assert_eq!(
            frontmatter("---\r\nname: x\r\ndescription: >\r\n  first line\r\n  second\r\nother: 1\r\n---\r\n"),
            (Some("x".into()), Some("first line second".into()))
        );
        assert_eq!(frontmatter("# no frontmatter"), (None, None));
    }

    #[test]
    fn estimates_match_claude_plugin_details_for_a_known_skill() {
        // writing-plans from superpowers 7.0.2: the CLI reports ~30 always-on
        // and ~3.7k on-invoke; its listing is 101 characters, the file 10317.
        let description = "Use when you have a spec or requirements for a multi-step task, before touching code";
        let doc = format!("---\nname: writing-plans\ndescription: {description}\n---\n{}", "x".repeat(10_317 - 105 - description.len()));
        let cost = item_cost(&doc, "writing-plans");
        assert!((28..=34).contains(&cost.always_on), "{cost:?}");
        assert!((3_500..=3_800).contains(&cost.on_invoke), "{cost:?}");
    }

    #[test]
    fn a_plugin_counts_its_skills_commands_and_agents() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path();
        write(&p.join("skills/a/SKILL.md"), "---\nname: a\ndescription: does a\n---\nbody");
        write(&p.join("skills/b/SKILL.md"), "---\nname: b\ndescription: does b\n---\nbody");
        write(&p.join("commands/go.md"), "---\ndescription: run it\n---\nsteps");
        write(&p.join("agents/helper.md"), "---\nname: helper\ndescription: helps\n---\n");
        write(&p.join("README.md"), &"x".repeat(50_000));
        let total = plugin_cost(p);
        let one = skill_dir_cost(&p.join("skills/a"));
        assert!(total.always_on >= one.always_on * 4 - 4, "{total:?}");
        assert!(total.on_invoke < 1_000, "a README is not context: {total:?}");
    }

    #[test]
    fn reads_claude_s_always_on_figure() {
        assert_eq!(parse_cli_always_on("x\n  Always-on:   ~5,127 tok   added to every session\n"), Some(5127));
        assert_eq!(parse_cli_always_on("  Always-on:   ~848 tok   added"), Some(848));
        assert_eq!(parse_cli_always_on("  Always-on:   ~1.2k tok"), Some(1200));
        assert_eq!(parse_cli_always_on("Projected token cost\n(none)"), None);
    }

    #[test]
    fn an_argument_hint_is_part_of_the_listing() {
        let without = item_cost("---\nname: a\ndescription: does a\n---\n", "a");
        let with = item_cost("---\nname: a\ndescription: does a\nargument-hint: \"[command] [url]\"\n---\n", "a");
        assert!(with.always_on > without.always_on);
    }

    #[test]
    fn missing_or_oversized_documents_cost_nothing() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(skill_dir_cost(dir.path()), Cost::default());
        let big = "x".repeat((MAX_DOC_BYTES + 1) as usize);
        write(&dir.path().join("SKILL.md"), &big);
        assert_eq!(skill_dir_cost(dir.path()), Cost::default());
    }

    /// Read-only: compare with `claude plugin details superpowers` (~848 always-on).
    #[test]
    #[ignore]
    fn live_plugin_costs() {
        for c in installed_plugin_costs() {
            println!("{:<45} always-on {:>6} on-invoke {:>7}", c.id, c.cost.always_on, c.cost.on_invoke);
        }
    }
}
