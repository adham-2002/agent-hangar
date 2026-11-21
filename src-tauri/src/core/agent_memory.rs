//! Claude Code's memory: the notes it keeps for itself per project in
//! `~/.claude/projects/<slug>/memory/`, and the `CLAUDE.md` instruction files
//! it loads every session.
//!
//! A memory folder holds an index, `MEMORY.md`, whose first lines Claude Code
//! loads at the start of every session, and one file per memory that it reads
//! when the index points it there. The layout is Claude Code's own and not a
//! documented format, so everything here reads it leniently and skips what it
//! does not recognise.
//!
//! The app reviews and cleans up; it does not write memories. Deleting one
//! keeps a copy under the app's own folder, and moving one into the global
//! `CLAUDE.md` writes the global file before it removes the memory.

use std::collections::BTreeSet;
use std::fs;
use std::io::{self, BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use regex::Regex;
use serde::Serialize;

use crate::core::context_cost::body_tokens;
use crate::core::skill_lint::{content_words, split_frontmatter, Finding, Severity};

pub const INDEX_FILE: &str = "MEMORY.md";
/// Claude Code loads only this many lines of `MEMORY.md` into a session.
pub const INDEX_MAX_LINES: usize = 200;
/// A memory this large costs thousands of tokens each time it is read.
pub const LARGE_MEMORY_BYTES: u64 = 16 * 1024;
/// An instruction file above this many tokens is a heavy fixed cost.
pub const LARGE_INSTRUCTIONS_TOKENS: u32 = 5_000;
const MAX_READ_BYTES: u64 = 2 * 1024 * 1024;
const SIMILAR_THRESHOLD: f64 = 0.6;
const SIMILAR_MIN_WORDS: usize = 6;
const MAX_STALE_PATHS: usize = 5;
const TRANSCRIPTS_TO_READ: usize = 5;
const TRANSCRIPT_LINES: usize = 40;
/// Instruction files Claude Code loads from a project's root.
const PROJECT_INSTRUCTIONS: &[&str] = &["CLAUDE.md", ".claude/CLAUDE.md", "CLAUDE.local.md"];

#[derive(Debug, Clone, Serialize)]
pub struct InstructionFile {
    pub path: String,
    pub bytes: u64,
    pub tokens: u32,
    pub findings: Vec<Finding>,
}

#[derive(Debug, Clone, Serialize)]
pub struct MemoryIndex {
    pub lines: usize,
    pub tokens: u32,
    /// Tokens of the part Claude Code loads (the first [`INDEX_MAX_LINES`]).
    pub loaded_tokens: u32,
}

#[derive(Debug, Clone, Serialize)]
pub struct MemoryFile {
    /// File name inside the memory folder.
    pub file: String,
    pub path: String,
    pub name: Option<String>,
    pub description: Option<String>,
    /// `user`, `feedback`, `project`, `reference`, or whatever the file says.
    pub kind: Option<String>,
    pub bytes: u64,
    /// Tokens added when Claude reads it.
    pub tokens: u32,
    /// Unix seconds.
    pub modified: Option<i64>,
    pub in_index: bool,
    pub findings: Vec<Finding>,
}

#[derive(Debug, Clone, Serialize)]
pub struct MemoryProject {
    /// The folder name under `~/.claude/projects`.
    pub slug: String,
    /// The project folder, when it could be worked out.
    pub project_path: Option<String>,
    pub memory_dir: String,
    pub index: Option<MemoryIndex>,
    pub instructions: Vec<InstructionFile>,
    pub memories: Vec<MemoryFile>,
    pub findings: Vec<Finding>,
    /// Tokens loaded into every session in this project, on top of the global ones.
    pub always_on: u32,
}

#[derive(Debug, Clone, Serialize)]
pub struct MemoryReport {
    pub global: Vec<InstructionFile>,
    /// Tokens the global instructions add to every session in every project.
    pub global_always_on: u32,
    pub projects: Vec<MemoryProject>,
}

/// The folder name Claude Code gives a project: every character other than
/// an ASCII letter or digit becomes `-`.
pub fn project_slug(path: &str) -> String {
    path.chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '-' }).collect()
}

fn trim_separators(path: &str) -> &str {
    let trimmed = path.trim_end_matches(['/', '\\']);
    // Keep a drive root such as `C:\` whole.
    if trimmed.ends_with(':') { path } else { trimmed }
}

fn read_small(path: &Path) -> Option<String> {
    let meta = fs::metadata(path).ok()?;
    if !meta.is_file() || meta.len() > MAX_READ_BYTES {
        return None;
    }
    fs::read_to_string(path).ok()
}

fn modified_secs(meta: &fs::Metadata) -> Option<i64> {
    let since = meta.modified().ok()?.duration_since(std::time::UNIX_EPOCH).ok()?;
    Some(since.as_secs() as i64)
}

/// Which project folder a slug stands for. The slug cannot be reversed, so
/// it is matched against the paths the caller knows and then against the
/// working directory recorded in the project's recent transcripts.
fn resolve_project(folder: &Path, slug: &str, known: &[PathBuf]) -> Option<String> {
    for path in known {
        let text = path.to_string_lossy();
        let text = trim_separators(&text);
        if project_slug(text) == slug {
            return Some(text.to_string());
        }
    }
    transcript_cwd(folder, slug).or_else(|| path_from_slug(slug))
}

/// Find the folder a slug was made from by walking down from the drive or
/// filesystem root, following the folders whose own slug continues it.
/// Transcripts are cleaned up after a while; the folder usually is not.
fn path_from_slug(slug: &str) -> Option<String> {
    let bytes = slug.as_bytes();
    let (root, rest) = if bytes.len() > 3 && bytes[0].is_ascii_alphabetic() && &slug[1..3] == "--" {
        (PathBuf::from(format!("{}:\\", &slug[..1])), &slug[3..])
    } else if cfg!(not(windows)) && slug.len() > 1 && slug.starts_with('-') {
        (PathBuf::from("/"), &slug[1..])
    } else {
        return None;
    };
    let mut budget = 2_000usize;
    find_slug_path(&root, rest, &mut budget, 0).map(|p| trim_separators(&p.to_string_lossy()).to_string())
}

fn find_slug_path(dir: &Path, rest: &str, budget: &mut usize, depth: usize) -> Option<PathBuf> {
    if depth > 12 || *budget == 0 {
        return None;
    }
    let entries = fs::read_dir(dir).ok()?;
    let mut matches = Vec::new();
    for entry in entries.flatten() {
        if *budget == 0 {
            break;
        }
        *budget -= 1;
        let Some(name) = entry.file_name().to_str().map(str::to_string) else { continue };
        let name_slug = project_slug(&name);
        if (rest == name_slug || rest.starts_with(&format!("{name_slug}-"))) && entry.path().is_dir() {
            matches.push((entry.path(), name_slug.len()));
        }
    }
    // Prefer the longest folder name: `skills-manager` before `skills`.
    matches.sort_by_key(|m| std::cmp::Reverse(m.1));
    for (path, len) in matches {
        if len == rest.len() {
            return Some(path);
        }
        if let Some(found) = find_slug_path(&path, &rest[len + 1..], budget, depth + 1) {
            return Some(found);
        }
    }
    None
}

fn transcript_cwd(folder: &Path, slug: &str) -> Option<String> {
    let mut files: Vec<(PathBuf, Option<std::time::SystemTime>)> = fs::read_dir(folder)
        .ok()?
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.extension().and_then(|x| x.to_str()) == Some("jsonl"))
        .map(|p| {
            let modified = fs::metadata(&p).and_then(|m| m.modified()).ok();
            (p, modified)
        })
        .collect();
    files.sort_by_key(|f| std::cmp::Reverse(f.1));
    for (path, _) in files.into_iter().take(TRANSCRIPTS_TO_READ) {
        let Ok(file) = fs::File::open(&path) else { continue };
        for line in BufReader::new(file).lines().take(TRANSCRIPT_LINES).map_while(Result::ok) {
            if !line.contains("\"cwd\"") {
                continue;
            }
            let Ok(value) = serde_json::from_str::<serde_json::Value>(&line) else { continue };
            if let Some(cwd) = value.get("cwd").and_then(|c| c.as_str()) {
                let cwd = trim_separators(cwd);
                if project_slug(cwd) == slug {
                    return Some(cwd.to_string());
                }
            }
        }
    }
    None
}

struct Meta<'a> {
    name: Option<String>,
    description: Option<String>,
    kind: Option<String>,
    body: &'a str,
}

fn memory_meta(content: &str) -> Meta<'_> {
    let Some((frontmatter, body)) = split_frontmatter(content) else {
        return Meta { name: None, description: None, kind: None, body: content };
    };
    let value: serde_yaml::Value = serde_yaml::from_str(frontmatter).unwrap_or(serde_yaml::Value::Null);
    let text = |v: &serde_yaml::Value, key: &str| {
        v.get(key)
            .and_then(|x| x.as_str())
            .map(|x| x.trim().to_string())
            .filter(|x| !x.is_empty())
    };
    let kind = text(&value, "type").or_else(|| value.get("metadata").and_then(|m| text(m, "type")));
    Meta { name: text(&value, "name"), description: text(&value, "description"), kind, body }
}

fn link_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"\]\(\s*<?([^)\s>]+)>?\s*\)").unwrap())
}

fn code_span_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"`([^`\s]+)`").unwrap())
}

fn line_suffix_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(:\d+)+$").unwrap())
}

/// Local files an index links to, as written (`./` dropped, `/` separators).
pub fn index_links(index: &str) -> Vec<String> {
    link_re()
        .captures_iter(index)
        .filter_map(|c| {
            let target = c[1].split('#').next()?.trim();
            if target.is_empty() || target.contains("://") || target.starts_with("mailto:") {
                return None;
            }
            Some(target.trim_start_matches("./").replace('\\', "/"))
        })
        .collect()
}

/// The last path component of a link target.
fn link_file(target: &str) -> &str {
    target.rsplit('/').next().unwrap_or(target)
}

/// Paths written in backticks that no longer exist. Only a path whose first
/// folder is still there is reported, so a path from another machine or a
/// made-up example does not count.
fn stale_paths(text: &str, root: Option<&Path>, home: Option<&Path>) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for capture in code_span_re().captures_iter(text) {
        let raw = line_suffix_re().replace(&capture[1], "").to_string();
        let candidate = raw.trim_end_matches(['.', ',', ';', ')']);
        if candidate.len() > 260
            || !(candidate.contains('/') || candidate.contains('\\'))
            || candidate.contains("://")
            || candidate.starts_with(['-', '/'])
            || candidate.chars().any(|c| "<>*{}$|?\"'%".contains(c))
        {
            continue;
        }
        let missing = if let Some(rest) = candidate.strip_prefix("~/").or_else(|| candidate.strip_prefix("~\\")) {
            home.map(|h| h.join(rest)).filter(|p| !p.exists() && p.parent().is_some_and(Path::exists))
        } else if Path::new(candidate).is_absolute() {
            let p = PathBuf::from(candidate);
            (!p.exists() && p.parent().is_some_and(Path::exists)).then_some(p)
        } else {
            let Some(root) = root.filter(|r| r.is_dir()) else { continue };
            let first = candidate.split(['/', '\\']).next().unwrap_or("");
            if first.is_empty() || first == "." || first == ".." || first == "~" {
                continue;
            }
            let in_root = root.join(candidate);
            let in_home = home.map(|h| h.join(candidate));
            let gone = !in_root.exists() && !in_home.as_ref().is_some_and(|p| p.exists());
            (gone && root.join(first).exists() && root.join(first) != in_root).then_some(in_root)
        };
        if missing.is_some() && !out.iter().any(|o| o == candidate) {
            out.push(candidate.to_string());
            if out.len() == MAX_STALE_PATHS {
                break;
            }
        }
    }
    out
}

/// What kind of secret a text seems to hold. The secret itself is never
/// returned, so it cannot end up in a message or a log.
pub fn secret_kind(text: &str) -> Option<&'static str> {
    if text.contains("-----BEGIN") && text.contains("PRIVATE KEY-----") {
        return Some("private key");
    }
    for token in text.split(|c: char| !(c.is_ascii_alphanumeric() || c == '_' || c == '-')) {
        let long = |prefix: &str, rest: usize| {
            token.starts_with(prefix)
                && token.len() >= prefix.len() + rest
                && token[prefix.len()..].chars().any(|c| c.is_ascii_digit())
        };
        if long("sk-ant-", 20) {
            return Some("Anthropic API key");
        }
        if long("ghp_", 30) || long("gho_", 30) || long("github_pat_", 30) {
            return Some("GitHub token");
        }
        if long("xoxb-", 20) || long("xoxp-", 20) {
            return Some("Slack token");
        }
        if long("AIza", 35) {
            return Some("Google API key");
        }
        if token.len() == 20
            && token.starts_with("AKIA")
            && token[4..].chars().all(|c| c.is_ascii_uppercase() || c.is_ascii_digit())
        {
            return Some("AWS access key");
        }
        if long("sk-", 32) {
            return Some("API key");
        }
    }
    None
}

fn secret_finding(text: &str) -> Option<Finding> {
    secret_kind(text).map(|kind| {
        Finding::new(
            "secret_like",
            Severity::Warning,
            format!("Looks like it contains a {kind}; anything here is sent to the model every time it is read"),
        )
        .param("kind", kind)
    })
}

fn instruction_file(path: &Path) -> Option<InstructionFile> {
    let content = read_small(path)?;
    let tokens = body_tokens(&content);
    let mut findings = Vec::new();
    findings.extend(secret_finding(&content));
    if tokens > LARGE_INSTRUCTIONS_TOKENS {
        findings.push(
            Finding::new(
                "instructions_large",
                Severity::Info,
                format!("About {tokens} tokens are loaded into every session; move rarely needed parts into a skill"),
            )
            .param("tokens", tokens),
        );
    }
    Some(InstructionFile {
        path: path.to_string_lossy().into_owned(),
        bytes: content.len() as u64,
        tokens,
        findings,
    })
}

/// What a memory says, for spotting near-duplicates: its description, or
/// the start of its body when the description is too short to compare.
fn memory_words(meta: &Meta) -> BTreeSet<String> {
    let from_description = meta.description.as_deref().map(content_words).unwrap_or_default();
    if from_description.len() >= SIMILAR_MIN_WORDS {
        return from_description;
    }
    content_words(&meta.body.chars().take(600).collect::<String>())
}

fn scan_project(folder: &Path, slug: &str, known: &[PathBuf], home: Option<&Path>) -> Option<(MemoryProject, Vec<BTreeSet<String>>)> {
    let memory_dir = folder.join("memory");
    let project_path = resolve_project(folder, slug, known);
    let root = project_path.as_deref().map(Path::new);

    let instructions: Vec<InstructionFile> = root
        .filter(|r| r.is_dir())
        .map(|r| PROJECT_INSTRUCTIONS.iter().filter_map(|f| instruction_file(&r.join(f))).collect())
        .unwrap_or_default();

    let index_text = read_small(&memory_dir.join(INDEX_FILE));
    let links: Vec<String> = index_text.as_deref().map(index_links).unwrap_or_default();

    let mut memories = Vec::new();
    let mut word_sets = Vec::new();
    if let Ok(entries) = fs::read_dir(&memory_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            let Some(file) = path.file_name().and_then(|n| n.to_str()).map(str::to_string) else { continue };
            let is_md = path.extension().and_then(|x| x.to_str()).is_some_and(|x| x.eq_ignore_ascii_case("md"));
            if !is_md || file.eq_ignore_ascii_case(INDEX_FILE) || !path.is_file() {
                continue;
            }
            let meta_fs = entry.metadata().ok();
            let content = read_small(&path).unwrap_or_default();
            let meta = memory_meta(&content);
            let in_index = links.iter().any(|l| link_file(l).eq_ignore_ascii_case(&file))
                || index_text.as_deref().is_some_and(|t| t.contains(&file));

            let bytes = meta_fs.as_ref().map(|m| m.len()).unwrap_or(content.len() as u64);
            let mut findings = Vec::new();
            findings.extend(secret_finding(&content));
            if index_text.is_some() && !in_index {
                findings.push(Finding::new(
                    "not_in_index",
                    Severity::Warning,
                    "MEMORY.md does not mention it, so Claude does not know it is there",
                ));
            }
            if bytes > LARGE_MEMORY_BYTES {
                findings.push(
                    Finding::new(
                        "memory_large",
                        Severity::Warning,
                        format!("{} KB: reading it costs thousands of tokens; split it or turn it into a skill", bytes / 1024),
                    )
                    .param("kb", bytes / 1024),
                );
            }
            let stale = stale_paths(meta.body, root, home);
            if !stale.is_empty() {
                findings.push(
                    Finding::new(
                        "stale_path",
                        Severity::Warning,
                        format!("Names files that cannot be found on this computer: {}", stale.join(", ")),
                    )
                    .param("paths", stale.join(", ")),
                );
            }
            if matches!(meta.kind.as_deref(), Some("user" | "feedback")) {
                findings.push(Finding::new(
                    "global_candidate",
                    Severity::Info,
                    "It is about you rather than this project; it may belong in your global CLAUDE.md",
                ));
            }
            word_sets.push(memory_words(&meta));
            memories.push(MemoryFile {
                file,
                path: path.to_string_lossy().into_owned(),
                name: meta.name,
                description: meta.description,
                kind: meta.kind,
                bytes,
                tokens: body_tokens(&content),
                modified: meta_fs.as_ref().and_then(modified_secs),
                in_index,
                findings,
            });
        }
    }

    let mut findings = Vec::new();
    let index = index_text.as_deref().map(|text| {
        let lines = text.lines().count();
        let loaded: String = text.lines().take(INDEX_MAX_LINES).collect::<Vec<_>>().join("\n");
        MemoryIndex { lines, tokens: body_tokens(text), loaded_tokens: body_tokens(&loaded) }
    });
    if let Some(index) = &index {
        if index.lines > INDEX_MAX_LINES {
            findings.push(
                Finding::new(
                    "index_too_long",
                    Severity::Warning,
                    format!(
                        "MEMORY.md has {} lines; Claude Code loads only the first {INDEX_MAX_LINES}",
                        index.lines
                    ),
                )
                .param("lines", index.lines)
                .param("max", INDEX_MAX_LINES),
            );
        }
        let mut seen = BTreeSet::new();
        for link in &links {
            if link.ends_with(".md") && !memory_dir.join(link).is_file() && seen.insert(link.clone()) {
                findings.push(
                    Finding::new("index_broken_link", Severity::Error, format!("MEMORY.md points to {link}, which is gone"))
                        .param("file", link),
                );
            }
        }
    } else if !memories.is_empty() {
        findings.push(Finding::new(
            "index_missing",
            Severity::Warning,
            "There is no MEMORY.md, so Claude starts each session without knowing these memories exist",
        ));
    }

    if memories.is_empty() && index.is_none() && instructions.is_empty() {
        return None;
    }

    // Reorder memories and their word sets together, newest first.
    let mut paired: Vec<(MemoryFile, BTreeSet<String>)> = memories.into_iter().zip(word_sets).collect();
    paired.sort_by(|a, b| b.0.modified.cmp(&a.0.modified).then_with(|| a.0.file.cmp(&b.0.file)));
    let (memories, word_sets): (Vec<_>, Vec<_>) = paired.into_iter().unzip();

    let always_on = index.as_ref().map_or(0, |i| i.loaded_tokens) + instructions.iter().map(|i| i.tokens).sum::<u32>();
    Some((
        MemoryProject {
            slug: slug.to_string(),
            project_path,
            memory_dir: memory_dir.to_string_lossy().into_owned(),
            index,
            instructions,
            memories,
            findings,
            always_on,
        },
        word_sets,
    ))
}

fn project_label(project: &MemoryProject) -> String {
    project
        .project_path
        .as_deref()
        .and_then(|p| Path::new(p).file_name().and_then(|n| n.to_str()).map(str::to_string))
        .unwrap_or_else(|| project.slug.clone())
}

/// Flag memories that say nearly the same thing, in one project or across several.
fn flag_similar(projects: &mut [MemoryProject], words: &[Vec<BTreeSet<String>>]) {
    let refs: Vec<(usize, usize)> = projects
        .iter()
        .enumerate()
        .flat_map(|(p, project)| (0..project.memories.len()).map(move |m| (p, m)))
        .collect();
    let mut pending: Vec<((usize, usize), Finding)> = Vec::new();
    for (i, &(pa, ma)) in refs.iter().enumerate() {
        for &(pb, mb) in &refs[i + 1..] {
            let (a, b) = (&words[pa][ma], &words[pb][mb]);
            if a.len() < SIMILAR_MIN_WORDS || b.len() < SIMILAR_MIN_WORDS {
                continue;
            }
            let similarity = a.intersection(b).count() as f64 * 2.0 / (a.len() + b.len()) as f64;
            if similarity < SIMILAR_THRESHOLD {
                continue;
            }
            let percent = (similarity * 100.0).round() as u32;
            for ((me_p, me_m), (other_p, other_m)) in [((pa, ma), (pb, mb)), ((pb, mb), (pa, ma))] {
                let other = format!("{} / {}", project_label(&projects[other_p]), projects[other_p].memories[other_m].file);
                let same_project = me_p == other_p;
                pending.push((
                    (me_p, me_m),
                    Finding::new(
                        "similar_memory",
                        Severity::Warning,
                        if same_project {
                            format!("{percent}% the same as {other}; keep one")
                        } else {
                            format!("{percent}% the same as {other}; if it is true everywhere, move it to your global CLAUDE.md")
                        },
                    )
                    .param("other", other)
                    .param("percent", percent),
                ));
            }
        }
    }
    for ((p, m), finding) in pending {
        projects[p].memories[m].findings.push(finding);
    }
}

/// Every project's memory and instructions, plus the global instructions.
/// `known` are project folders the caller knows about; they help match a
/// memory folder to its project when transcripts are gone.
pub fn scan(claude_home: &Path, known: &[PathBuf], home: Option<&Path>) -> MemoryReport {
    let global: Vec<InstructionFile> = instruction_file(&claude_home.join("CLAUDE.md")).into_iter().collect();
    let global_always_on = global.iter().map(|g| g.tokens).sum();

    let mut projects = Vec::new();
    let mut words = Vec::new();
    if let Ok(entries) = fs::read_dir(claude_home.join("projects")) {
        for entry in entries.flatten() {
            let folder = entry.path();
            if !folder.is_dir() {
                continue;
            }
            let Some(slug) = folder.file_name().and_then(|n| n.to_str()).map(str::to_string) else { continue };
            if let Some((project, word_sets)) = scan_project(&folder, &slug, known, home) {
                projects.push(project);
                words.push(word_sets);
            }
        }
    }
    flag_similar(&mut projects, &words);
    for project in &mut projects {
        for memory in &mut project.memories {
            memory.findings.sort_by_key(|f| f.severity);
        }
        project.findings.sort_by_key(|f| f.severity);
    }
    // Most recently touched first.
    let latest = |p: &MemoryProject| p.memories.iter().filter_map(|m| m.modified).max().unwrap_or(0);
    projects.sort_by(|a, b| latest(b).cmp(&latest(a)).then_with(|| a.slug.cmp(&b.slug)));
    MemoryReport { global, global_always_on, projects }
}

fn invalid(msg: impl Into<String>) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidInput, msg.into())
}

/// The path of one memory file, refusing anything that is not a plain
/// memory file inside Claude's projects folder.
pub fn memory_file_path(claude_home: &Path, slug: &str, file: &str) -> io::Result<PathBuf> {
    let plain = |s: &str| !s.is_empty() && !s.contains(['/', '\\', ':']) && s != "." && s != ".." && !s.starts_with('.');
    if !plain(slug) || !plain(file) {
        return Err(invalid("not a memory file"));
    }
    if !file.to_ascii_lowercase().ends_with(".md") || file.eq_ignore_ascii_case(INDEX_FILE) {
        return Err(invalid("not a memory file"));
    }
    let projects = claude_home.join("projects");
    let path = projects.join(slug).join("memory").join(file);
    if !crate::core::path_guard::is_path_safe(&projects, &path) {
        return Err(invalid("not a memory file"));
    }
    if !path.is_file() {
        return Err(io::Error::new(io::ErrorKind::NotFound, format!("{file} is gone")));
    }
    Ok(path)
}

pub fn read_memory(claude_home: &Path, slug: &str, file: &str) -> io::Result<String> {
    let path = memory_file_path(claude_home, slug, file)?;
    read_small(&path).ok_or_else(|| invalid(format!("{file} is too large to show")))
}

/// Write through a temporary file, so a crash never leaves half a file.
fn write_atomic(path: &Path, content: &str) -> io::Result<()> {
    let tmp = path.with_file_name(format!(
        ".{}.{}.tmp",
        path.file_name().and_then(|n| n.to_str()).unwrap_or("file"),
        uuid::Uuid::new_v4().simple()
    ));
    fs::write(&tmp, content)?;
    fs::rename(&tmp, path).inspect_err(|_| {
        let _ = fs::remove_file(&tmp);
    })
}

/// Drop the index lines that link to `file`. Returns whether any changed.
fn remove_index_entries(memory_dir: &Path, file: &str) -> io::Result<bool> {
    let index_path = memory_dir.join(INDEX_FILE);
    let Ok(text) = fs::read_to_string(&index_path) else { return Ok(false) };
    let mut changed = false;
    let kept: String = text
        .split_inclusive('\n')
        .filter(|line| {
            let points_here = index_links(line).iter().any(|l| link_file(l).eq_ignore_ascii_case(file));
            changed |= points_here;
            !points_here
        })
        .collect();
    if changed {
        write_atomic(&index_path, &kept)?;
    }
    Ok(changed)
}

/// Delete a memory, keeping a copy in `trash_root`, and take it out of the
/// index. Returns where the copy is.
pub fn delete_memory(claude_home: &Path, trash_root: &Path, slug: &str, file: &str) -> io::Result<PathBuf> {
    let path = memory_file_path(claude_home, slug, file)?;
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let backup_dir = trash_root.join(slug);
    fs::create_dir_all(&backup_dir)?;
    let backup = backup_dir.join(format!("{stamp}-{file}"));
    fs::copy(&path, &backup)?;
    fs::remove_file(&path)?;
    remove_index_entries(path.parent().unwrap_or(Path::new(".")), file)?;
    Ok(backup)
}

/// Move a memory into the global `CLAUDE.md` as its own section, then
/// delete it. The global file is written first, so a failure part-way
/// leaves the text in two places rather than none.
pub fn move_to_global(claude_home: &Path, trash_root: &Path, slug: &str, file: &str) -> io::Result<PathBuf> {
    let content = read_memory(claude_home, slug, file)?;
    let meta = memory_meta(&content);
    let body = meta.body.trim();
    let body = if body.is_empty() { meta.description.as_deref().unwrap_or("").trim() } else { body };
    if body.is_empty() {
        return Err(invalid(format!("{file} is empty")));
    }
    let heading = meta
        .description
        .as_deref()
        .filter(|d| d.chars().count() <= 80)
        .or(meta.name.as_deref())
        .map(str::to_string)
        .unwrap_or_else(|| file.trim_end_matches(".md").replace(['-', '_'], " "));

    let global_path = claude_home.join("CLAUDE.md");
    let existing = fs::read_to_string(&global_path).unwrap_or_default();
    if !existing.contains(body) {
        let crlf = existing.contains("\r\n");
        let mut section = String::new();
        if !existing.is_empty() {
            section.push_str(if existing.ends_with('\n') { "\n" } else { "\n\n" });
        }
        section.push_str(&format!("## {heading}\n\n{body}\n"));
        let section = if crlf { section.replace("\r\n", "\n").replace('\n', "\r\n") } else { section };
        fs::create_dir_all(claude_home)?;
        write_atomic(&global_path, &format!("{existing}{section}"))?;
    }
    delete_memory(claude_home, trash_root, slug, file)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn write(path: &Path, text: &str) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, text).unwrap();
    }

    fn memory(name: &str, kind: &str, description: &str, body: &str) -> String {
        format!("---\nname: {name}\ndescription: {description}\nmetadata:\n  type: {kind}\n---\n\n{body}\n")
    }

    fn codes(findings: &[Finding]) -> Vec<&'static str> {
        findings.iter().map(|f| f.code).collect()
    }

    #[test]
    fn slugs_match_claude_code_folder_names() {
        assert_eq!(project_slug(r"E:\MyGitHub2025\skills-manager"), "E--MyGitHub2025-skills-manager");
        assert_eq!(project_slug("/home/me/work.app"), "-home-me-work-app");
        assert_eq!(trim_separators(r"C:\work\"), r"C:\work");
        assert_eq!(trim_separators(r"C:\"), r"C:\");
    }

    #[test]
    fn reads_the_index_and_flags_its_problems() {
        let home = tempdir().unwrap();
        let claude = home.path().join(".claude");
        let project = home.path().join("app");
        fs::create_dir_all(project.join("src")).unwrap();
        let slug = project_slug(&project.to_string_lossy());
        let dir = claude.join("projects").join(&slug).join("memory");
        write(&dir.join("listed.md"), &memory("listed", "project", "how the build works", "Run `src/build.rs` then `src/gone.rs:12`."));
        write(&dir.join("hidden.md"), &memory("hidden", "user", "who the user is", "Senior developer."));
        write(&dir.join("src/build.rs"), "");
        fs::write(project.join("src/build.rs"), "").unwrap();
        let index = format!("- [Listed](listed.md) — build\n- [Old](./removed.md) — gone\n{}", "x\n".repeat(INDEX_MAX_LINES));
        write(&dir.join(INDEX_FILE), &index);

        let report = scan(&claude, &[project.clone()], Some(home.path()));
        let p = &report.projects[0];
        assert_eq!(p.project_path.as_deref(), Some(project.to_string_lossy().as_ref()));
        assert_eq!(codes(&p.findings), vec!["index_broken_link", "index_too_long"]);
        let listed = p.memories.iter().find(|m| m.file == "listed.md").unwrap();
        assert!(listed.in_index);
        assert_eq!(codes(&listed.findings), vec!["stale_path"]);
        assert_eq!(listed.findings[0].params["paths"], "src/gone.rs");
        let hidden = p.memories.iter().find(|m| m.file == "hidden.md").unwrap();
        assert_eq!(hidden.kind.as_deref(), Some("user"));
        assert_eq!(codes(&hidden.findings), vec!["not_in_index", "global_candidate"]);
        let loaded = p.index.as_ref().unwrap().loaded_tokens;
        assert!(loaded < p.index.as_ref().unwrap().tokens);
        assert_eq!(p.always_on, loaded);
    }

    #[test]
    fn a_missing_index_and_instruction_files_are_reported() {
        let home = tempdir().unwrap();
        let claude = home.path().join(".claude");
        let project = home.path().join("site");
        write(&project.join("CLAUDE.md"), &"rule\n".repeat(10));
        write(&claude.join("CLAUDE.md"), "global rule");
        let slug = project_slug(&project.to_string_lossy());
        write(&claude.join("projects").join(&slug).join("memory/a.md"), "just text");
        // An unrelated folder with nothing in it is left out.
        fs::create_dir_all(claude.join("projects/empty")).unwrap();

        let report = scan(&claude, &[project.clone()], None);
        assert_eq!(report.global.len(), 1);
        assert!(report.global_always_on > 0);
        assert_eq!(report.projects.len(), 1);
        let p = &report.projects[0];
        assert_eq!(codes(&p.findings), vec!["index_missing"]);
        assert_eq!(p.instructions.len(), 1);
        assert_eq!(p.always_on, p.instructions[0].tokens);
        assert!(p.memories[0].findings.is_empty(), "no index, so not_in_index is not repeated");
    }

    #[test]
    fn the_project_folder_comes_from_transcripts_when_unknown() {
        let home = tempdir().unwrap();
        let claude = home.path().join(".claude");
        let project = home.path().join("crm");
        fs::create_dir_all(&project).unwrap();
        let cwd = project.to_string_lossy().to_string();
        let slug = project_slug(&cwd);
        let folder = claude.join("projects").join(&slug);
        write(&folder.join("memory/a.md"), "note");
        write(
            &folder.join("s.jsonl"),
            &format!("{{\"type\":\"summary\"}}\n{}\n", serde_json::json!({ "type": "user", "cwd": cwd })),
        );
        let report = scan(&claude, &[], None);
        assert_eq!(report.projects[0].project_path.as_deref(), Some(cwd.as_str()));
    }

    #[test]
    fn a_slug_is_followed_down_the_folders_it_was_made_from() {
        let root = tempdir().unwrap();
        fs::create_dir_all(root.path().join("my work/skills-manager")).unwrap();
        fs::create_dir_all(root.path().join("my work/skills")).unwrap();
        let mut budget = 100;
        let found = find_slug_path(root.path(), "my-work-skills-manager", &mut budget, 0).unwrap();
        assert_eq!(found, root.path().join("my work").join("skills-manager"));
        let mut budget = 100;
        assert!(find_slug_path(root.path(), "my-work-gone", &mut budget, 0).is_none());
    }

    #[test]
    fn similar_memories_across_projects_are_flagged_on_both() {
        let home = tempdir().unwrap();
        let claude = home.path().join(".claude");
        let description = "Confirm with the developer before running destructive database migrations or deleting production records";
        write(&claude.join("projects/one/memory/a.md"), &memory("a", "feedback", description, "x"));
        write(&claude.join("projects/two/memory/b.md"), &memory("b", "feedback", description, "y"));
        write(&claude.join("projects/two/memory/c.md"), &memory("c", "project", "Payments service uses Stripe webhooks with idempotency keys stored in Redis", "z"));
        let report = scan(&claude, &[], None);
        let all: Vec<&MemoryFile> = report.projects.iter().flat_map(|p| &p.memories).collect();
        let a = all.iter().find(|m| m.file == "a.md").unwrap();
        let c = all.iter().find(|m| m.file == "c.md").unwrap();
        assert!(codes(&a.findings).contains(&"similar_memory"));
        assert_eq!(a.findings.iter().find(|f| f.code == "similar_memory").unwrap().params["other"], "two / b.md");
        assert!(!codes(&c.findings).contains(&"similar_memory"));
    }

    #[test]
    fn secrets_are_named_by_kind_only() {
        assert_eq!(secret_kind("token ghp_abcdefghijklmnopqrstuvwxyz0123456789 here"), Some("GitHub token"));
        assert_eq!(secret_kind("key AKIAABCDEFGHIJ012345"), Some("AWS access key"));
        assert_eq!(secret_kind("sk-ant-api03-abcdefghij0123456789xyz"), Some("Anthropic API key"));
        assert_eq!(secret_kind("-----BEGIN RSA PRIVATE KEY-----"), Some("private key"));
        assert_eq!(secret_kind("use skills-manager-cli and sk-learn"), None);
        let finding = secret_finding("ghp_abcdefghijklmnopqrstuvwxyz0123456789").unwrap();
        assert!(!finding.message.contains("ghp_"));
    }

    #[test]
    fn paths_that_only_look_like_paths_are_not_reported() {
        let root = tempdir().unwrap();
        fs::create_dir_all(root.path().join("src")).unwrap();
        let text = "`src/*.ts` `<project>/x.md` `https://a.b/c` `docs/none.md` `-p a/b` `src/real.rs` `../up/x`";
        fs::write(root.path().join("src/real.rs"), "").unwrap();
        assert!(stale_paths(text, Some(root.path()), None).is_empty());
        assert_eq!(stale_paths("`src/old.rs`", Some(root.path()), None), vec!["src/old.rs"]);
        assert!(stale_paths("`src/old.rs`", None, None).is_empty(), "no project folder, no guess");
    }

    #[test]
    fn deleting_keeps_a_copy_and_drops_the_index_line() {
        let home = tempdir().unwrap();
        let claude = home.path().join(".claude");
        let trash = home.path().join("trash");
        let dir = claude.join("projects/p/memory");
        write(&dir.join("a.md"), "note a");
        write(&dir.join("b.md"), "note b");
        write(&dir.join(INDEX_FILE), "- [A](a.md) — first\r\n- [B](b.md) — second\r\n");

        let backup = delete_memory(&claude, &trash, "p", "a.md").unwrap();
        assert_eq!(fs::read_to_string(backup).unwrap(), "note a");
        assert!(!dir.join("a.md").exists());
        assert_eq!(fs::read_to_string(dir.join(INDEX_FILE)).unwrap(), "- [B](b.md) — second\r\n");
    }

    #[test]
    fn only_plain_memory_files_can_be_touched() {
        let home = tempdir().unwrap();
        let claude = home.path().join(".claude");
        write(&claude.join("projects/p/memory/a.md"), "x");
        write(&claude.join("projects/p/memory/MEMORY.md"), "x");
        write(&claude.join("CLAUDE.md"), "x");
        for (slug, file) in [("p", "MEMORY.md"), ("p", "../../../CLAUDE.md"), ("..", "a.md"), ("p", "a.txt"), ("p/../p", "a.md"), ("", "a.md")] {
            assert!(memory_file_path(&claude, slug, file).is_err(), "{slug} {file}");
        }
        assert!(memory_file_path(&claude, "p", "a.md").is_ok());
        assert_eq!(memory_file_path(&claude, "p", "gone.md").unwrap_err().kind(), io::ErrorKind::NotFound);
    }

    #[test]
    fn moving_to_global_appends_a_section_once_and_removes_the_memory() {
        let home = tempdir().unwrap();
        let claude = home.path().join(".claude");
        let trash = home.path().join("trash");
        write(&claude.join("CLAUDE.md"), "# Me\r\n\r\nExisting rule.\r\n");
        let dir = claude.join("projects/p/memory");
        write(&dir.join("a.md"), &memory("ask-first", "feedback", "Ask before big changes", "Ask before any large refactor."));
        write(&dir.join(INDEX_FILE), "- [Ask](a.md) — ask\n");

        move_to_global(&claude, &trash, "p", "a.md").unwrap();
        let global = fs::read_to_string(claude.join("CLAUDE.md")).unwrap();
        assert_eq!(global, "# Me\r\n\r\nExisting rule.\r\n\r\n## Ask before big changes\r\n\r\nAsk before any large refactor.\r\n");
        assert!(!dir.join("a.md").exists());
        assert_eq!(fs::read_to_string(dir.join(INDEX_FILE)).unwrap(), "");

        // The same text from a second project is not appended twice.
        let dir2 = claude.join("projects/q/memory");
        write(&dir2.join("b.md"), &memory("ask", "feedback", "Ask", "Ask before any large refactor."));
        move_to_global(&claude, &trash, "q", "b.md").unwrap();
        assert_eq!(fs::read_to_string(claude.join("CLAUDE.md")).unwrap(), global);
        assert!(!dir2.join("b.md").exists());
    }

    /// Read-only: prints this machine's memory report.
    #[test]
    #[ignore]
    fn live_memory_report() {
        let claude = crate::core::plugin_scanner::claude_home().unwrap();
        let home = dirs::home_dir();
        let report = scan(&claude, &home.iter().cloned().collect::<Vec<_>>(), home.as_deref());
        println!("global always-on {}", report.global_always_on);
        for p in &report.projects {
            println!("{} -> {:?} always-on {}", p.slug, p.project_path, p.always_on);
            for f in &p.findings {
                println!("   ! {} {}", f.code, f.message);
            }
            for m in &p.memories {
                println!("   {} ({} B) {:?}", m.file, m.bytes, codes(&m.findings));
            }
        }
    }
}
