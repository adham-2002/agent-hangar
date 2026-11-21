//! How often each skill is actually used, read from Claude Code's session
//! transcripts (`~/.claude/projects/**/*.jsonl`).
//!
//! Two signals count as a use: Claude calling the `Skill` tool (`input.skill`
//! is the skill's name, `plugin:skill` for a plugin's), counted only when its
//! result was not an error, and the user typing `/skill` (recorded as
//! `<command-name>/skill</command-name>`). Only names, times and the project
//! folder are kept; nothing of the conversation is read beyond that.
//!
//! Transcripts are large (hundreds of MB is normal), so a line is parsed only
//! when it can carry one of those signals, and each file's events are cached
//! by size and modification time: after the first scan only changed files are
//! read again.

use serde::Serialize;
use serde_json::Value;
use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::SystemTime;

/// One use of a skill.
#[derive(Debug, Clone, PartialEq)]
pub struct UsageEvent {
    /// As invoked: `name`, or `plugin:skill`.
    pub name: String,
    /// Unix seconds, when the transcript records it.
    pub ts: Option<i64>,
    pub cwd: Option<String>,
    pub kind: EventKind,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EventKind {
    /// Claude used the skill and it loaded.
    Invoked,
    /// Claude tried and the skill did not load (unknown name, error).
    Failed,
    /// The user typed `/name`.
    Typed,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct SkillUsage {
    pub name: String,
    pub invoked: u32,
    pub failed: u32,
    pub typed: u32,
    /// Successful uses (invoked + typed) in the last 30 days.
    pub last_30_days: u32,
    /// Unix seconds of the latest successful use.
    pub last_used: Option<i64>,
    /// Project folders it was used in, most uses first, at most five.
    pub projects: Vec<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct UsageReport {
    pub sessions: usize,
    /// Unix seconds of the oldest event seen: usage before it is unknown,
    /// because Claude Code deletes old transcripts.
    pub since: Option<i64>,
    pub skills: Vec<SkillUsage>,
}

/// Parse an RFC 3339 timestamp (`2026-11-20T18:00:45.352Z`) to Unix seconds.
fn parse_ts(raw: &str) -> Option<i64> {
    chrono::DateTime::parse_from_rfc3339(raw).ok().map(|d| d.timestamp())
}

/// The command name in `<command-name>/name</command-name>`.
fn typed_command(text: &str) -> Option<&str> {
    let start = text.find("<command-name>/")? + "<command-name>/".len();
    let end = text[start..].find("</command-name>")? + start;
    let name = text[start..end].trim();
    (!name.is_empty()).then_some(name)
}

fn text_of(content: &Value) -> String {
    match content {
        Value::String(s) => s.clone(),
        Value::Array(parts) => parts
            .iter()
            .filter(|p| p.get("type").and_then(Value::as_str) == Some("text"))
            .filter_map(|p| p.get("text").and_then(Value::as_str))
            .collect::<Vec<_>>()
            .join(""),
        _ => String::new(),
    }
}

/// Events in one transcript. Lines that cannot carry a signal are skipped
/// before parsing; unreadable lines are ignored.
pub fn events_in(reader: impl BufRead) -> Vec<UsageEvent> {
    let mut out = Vec::new();
    // tool_use id → (skill, ts, cwd), until its result arrives.
    let mut pending: HashMap<String, (String, Option<i64>, Option<String>)> = HashMap::new();

    for line in reader.lines().map_while(Result::ok) {
        let may_invoke = line.contains("\"Skill\"");
        let may_answer = !pending.is_empty() && line.contains("tool_result");
        let may_type = line.contains("<command-name>/");
        if !(may_invoke || may_answer || may_type) {
            continue;
        }
        let Ok(entry) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        let ts = entry.get("timestamp").and_then(Value::as_str).and_then(parse_ts);
        let cwd = entry.get("cwd").and_then(Value::as_str).map(str::to_string);
        let content = entry.get("message").and_then(|m| m.get("content"));

        match entry.get("type").and_then(Value::as_str) {
            Some("assistant") => {
                for part in content.and_then(Value::as_array).into_iter().flatten() {
                    let is_skill = part.get("type").and_then(Value::as_str) == Some("tool_use")
                        && part.get("name").and_then(Value::as_str) == Some("Skill");
                    if !is_skill {
                        continue;
                    }
                    let skill = part.get("input").and_then(|i| i.get("skill")).and_then(Value::as_str);
                    let id = part.get("id").and_then(Value::as_str);
                    if let (Some(skill), Some(id)) = (skill, id) {
                        pending.insert(id.to_string(), (skill.to_string(), ts, cwd.clone()));
                    }
                }
            }
            Some("user") => {
                if let Some(parts) = content.and_then(Value::as_array) {
                    for part in parts {
                        if part.get("type").and_then(Value::as_str) != Some("tool_result") {
                            continue;
                        }
                        let Some(id) = part.get("tool_use_id").and_then(Value::as_str) else {
                            continue;
                        };
                        if let Some((name, ts, cwd)) = pending.remove(id) {
                            let failed = part.get("is_error").and_then(Value::as_bool) == Some(true);
                            out.push(UsageEvent {
                                name,
                                ts,
                                cwd,
                                kind: if failed { EventKind::Failed } else { EventKind::Invoked },
                            });
                        }
                    }
                }
                if let Some(name) = content.map(text_of).as_deref().and_then(typed_command) {
                    out.push(UsageEvent { name: name.to_string(), ts, cwd, kind: EventKind::Typed });
                }
            }
            _ => {}
        }
    }
    out
}

/// Every transcript under `projects_dir`, nested sub-agent sessions included.
fn transcripts(projects_dir: &Path) -> Vec<PathBuf> {
    walkdir::WalkDir::new(projects_dir)
        .into_iter()
        .flatten()
        .filter(|e| e.file_type().is_file())
        .filter(|e| e.path().extension().and_then(|x| x.to_str()) == Some("jsonl"))
        .map(|e| e.into_path())
        .collect()
}

type CacheKey = (u64, Option<SystemTime>);

fn cache() -> &'static Mutex<HashMap<PathBuf, (CacheKey, Vec<UsageEvent>)>> {
    static CACHE: OnceLock<Mutex<HashMap<PathBuf, (CacheKey, Vec<UsageEvent>)>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// All events under `projects_dir`, reading only files that changed since the
/// last call. Returns the events and how many transcripts there are.
pub fn collect_events(projects_dir: &Path) -> (Vec<UsageEvent>, usize) {
    let files = transcripts(projects_dir);
    let mut cache = cache().lock().unwrap_or_else(|p| p.into_inner());
    cache.retain(|path, _| files.contains(path));
    let mut all = Vec::new();
    for path in &files {
        let Ok(meta) = fs::metadata(path) else { continue };
        let key: CacheKey = (meta.len(), meta.modified().ok());
        let fresh = cache.get(path).is_some_and(|(k, _)| *k == key);
        if !fresh {
            let events = fs::File::open(path)
                .map(|f| events_in(BufReader::new(f)))
                .unwrap_or_default();
            cache.insert(path.clone(), (key, events));
        }
        all.extend(cache[path].1.iter().cloned());
    }
    (all, files.len())
}

/// Fold events into one row per skill name, busiest first.
pub fn summarize(events: &[UsageEvent], sessions: usize, now: i64) -> UsageReport {
    const THIRTY_DAYS: i64 = 30 * 24 * 3600;
    let mut rows: BTreeMap<&str, (SkillUsage, BTreeMap<&str, u32>)> = BTreeMap::new();
    for e in events {
        let (row, projects) = rows.entry(e.name.as_str()).or_insert_with(|| {
            (
                SkillUsage {
                    name: e.name.clone(),
                    invoked: 0,
                    failed: 0,
                    typed: 0,
                    last_30_days: 0,
                    last_used: None,
                    projects: vec![],
                },
                BTreeMap::new(),
            )
        });
        match e.kind {
            EventKind::Failed => {
                row.failed += 1;
                continue;
            }
            EventKind::Invoked => row.invoked += 1,
            EventKind::Typed => row.typed += 1,
        }
        if let Some(ts) = e.ts {
            if now - ts <= THIRTY_DAYS {
                row.last_30_days += 1;
            }
            row.last_used = Some(row.last_used.map_or(ts, |t| t.max(ts)));
        }
        if let Some(cwd) = e.cwd.as_deref() {
            *projects.entry(cwd).or_insert(0) += 1;
        }
    }
    let mut skills: Vec<SkillUsage> = rows
        .into_values()
        .map(|(mut row, projects)| {
            let mut by_use: Vec<(&str, u32)> = projects.into_iter().collect();
            by_use.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(b.0)));
            row.projects = by_use.into_iter().take(5).map(|(p, _)| p.to_string()).collect();
            row
        })
        .collect();
    skills.sort_by(|a, b| (b.invoked + b.typed).cmp(&(a.invoked + a.typed)).then(a.name.cmp(&b.name)));
    UsageReport {
        sessions,
        since: events.iter().filter_map(|e| e.ts).min(),
        skills,
    }
}

pub fn usage_report(claude_home: &Path) -> UsageReport {
    let (events, sessions) = collect_events(&claude_home.join("projects"));
    summarize(&events, sessions, chrono::Utc::now().timestamp())
}

#[cfg(test)]
mod tests {
    use super::*;

    const TRANSCRIPT: &str = r#"{"type":"mode","mode":"default"}
{"type":"assistant","timestamp":"2026-11-20T18:00:00Z","cwd":"/work/app","message":{"content":[{"type":"tool_use","id":"t1","name":"Skill","input":{"skill":"superpowers:brainstorming"}}]}}
{"type":"user","timestamp":"2026-11-20T18:00:01Z","message":{"content":[{"type":"tool_result","tool_use_id":"t1","content":"Launching skill: superpowers:brainstorming"}]}}
{"type":"assistant","timestamp":"2026-11-20T18:05:00Z","cwd":"/work/app","message":{"content":[{"type":"tool_use","id":"t2","name":"Skill","input":{"skill":"missing"}}]}}
{"type":"user","timestamp":"2026-11-20T18:05:01Z","message":{"content":[{"type":"tool_result","tool_use_id":"t2","is_error":true,"content":"Unknown skill"}]}}
{"type":"user","timestamp":"2026-11-21T09:00:00Z","cwd":"/work/site","message":{"content":"<command-message>seo</command-message>\n<command-name>/seo</command-name>"}}
{"type":"assistant","timestamp":"2026-11-21T09:01:00Z","message":{"content":[{"type":"tool_use","id":"t3","name":"Bash","input":{"command":"echo Skill"}}]}}
not json at all "Skill"
"#;

    #[test]
    fn reads_invocations_failures_and_typed_commands() {
        let events = events_in(TRANSCRIPT.as_bytes());
        assert_eq!(events.len(), 3, "{events:?}");
        assert_eq!(events[0].name, "superpowers:brainstorming");
        assert_eq!(events[0].kind, EventKind::Invoked);
        assert_eq!(events[0].cwd.as_deref(), Some("/work/app"));
        assert_eq!(events[1].kind, EventKind::Failed);
        assert_eq!(events[2], UsageEvent {
            name: "seo".into(),
            ts: parse_ts("2026-11-21T09:00:00Z"),
            cwd: Some("/work/site".into()),
            kind: EventKind::Typed,
        });
    }

    #[test]
    fn a_tool_call_without_a_result_is_not_counted() {
        let line = r#"{"type":"assistant","message":{"content":[{"type":"tool_use","id":"x","name":"Skill","input":{"skill":"a"}}]}}"#;
        assert!(events_in(line.as_bytes()).is_empty());
    }

    #[test]
    fn summary_counts_successes_recency_and_projects() {
        let now = parse_ts("2026-11-22T00:00:00Z").unwrap();
        let ev = |name: &str, ts: &str, cwd: &str, kind| UsageEvent {
            name: name.into(),
            ts: parse_ts(ts),
            cwd: Some(cwd.into()),
            kind,
        };
        let events = vec![
            ev("a", "2026-11-20T00:00:00Z", "/p1", EventKind::Invoked),
            ev("a", "2026-11-21T00:00:00Z", "/p2", EventKind::Typed),
            ev("a", "2026-11-21T00:00:00Z", "/p2", EventKind::Invoked),
            ev("a", "2026-01-01T00:00:00Z", "/p1", EventKind::Invoked),
            ev("a", "2026-11-21T00:00:00Z", "/p3", EventKind::Failed),
            ev("b", "2026-11-19T00:00:00Z", "/p1", EventKind::Invoked),
        ];
        let report = summarize(&events, 4, now);
        assert_eq!(report.sessions, 4);
        assert_eq!(report.since, parse_ts("2026-01-01T00:00:00Z"));
        let a = &report.skills[0];
        assert_eq!((a.name.as_str(), a.invoked, a.typed, a.failed), ("a", 3, 1, 1));
        assert_eq!(a.last_30_days, 3, "the January use is older than 30 days");
        assert_eq!(a.last_used, parse_ts("2026-11-21T00:00:00Z"));
        assert_eq!(a.projects, vec!["/p1", "/p2"], "a failure does not count a project");
        assert_eq!(report.skills[1].name, "b");
    }

    #[test]
    fn changed_files_are_read_again_and_unchanged_ones_are_cached() {
        let dir = tempfile::tempdir().unwrap();
        let nested = dir.path().join("proj/session/subagents");
        fs::create_dir_all(&nested).unwrap();
        fs::write(dir.path().join("proj/s1.jsonl"), TRANSCRIPT).unwrap();
        fs::write(nested.join("agent.jsonl"), TRANSCRIPT).unwrap();
        fs::write(dir.path().join("proj/notes.txt"), TRANSCRIPT).unwrap();
        let (events, sessions) = collect_events(dir.path());
        assert_eq!(sessions, 2, "nested sub-agent transcripts count, other files do not");
        assert_eq!(events.len(), 6);

        let mut more = String::from(TRANSCRIPT);
        more.push_str(r#"{"type":"user","timestamp":"2026-11-21T10:00:00Z","message":{"content":"<command-name>/seo</command-name>"}}"#);
        more.push('\n');
        fs::write(dir.path().join("proj/s1.jsonl"), more).unwrap();
        let (events, _) = collect_events(dir.path());
        assert_eq!(events.len(), 7);
    }

    /// Read-only, on this machine's real transcripts:
    /// `cargo test --lib live_skill_usage -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn live_skill_usage() {
        let home = crate::core::plugin_scanner::claude_home().unwrap();
        let first = std::time::Instant::now();
        let report = usage_report(&home);
        let cold = first.elapsed();
        let again = std::time::Instant::now();
        let _ = usage_report(&home);
        println!("sessions {} cold {:?} cached {:?}", report.sessions, cold, again.elapsed());
        for s in report.skills.iter().take(8) {
            println!("{:<36} invoked {:>3} typed {:>2} failed {} 30d {}", s.name, s.invoked, s.typed, s.failed, s.last_30_days);
        }
    }
}
