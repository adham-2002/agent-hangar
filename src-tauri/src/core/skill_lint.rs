//! Quality checks for a skill's `SKILL.md`: what stops an agent from finding,
//! loading or choosing the skill.
//!
//! The hard limits follow the Agent Skills format: a `name` of at most 64
//! lowercase letters, digits and hyphens, and a `description` of at most 1024
//! characters. Breaking them is an error, because agents may refuse or
//! truncate the skill. The rest are heuristics about choice: an agent picks a
//! skill from its description alone, so a vague description is never picked
//! and two near-identical ones get confused with each other.
//!
//! Every finding has a stable `code` and `params` for the app to translate,
//! plus an English `message` for the CLI.

use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::path::Path;

pub const NAME_MAX: usize = 64;
pub const DESCRIPTION_MAX: usize = 1024;
/// Below this a description rarely says both what the skill does and when.
pub const DESCRIPTION_MIN: usize = 40;
/// Instructions past this belong in reference files the skill points to.
pub const BODY_MAX_LINES: usize = 500;
/// Two descriptions sharing this share of their words read as the same skill.
/// Sibling skills share boilerplate (argument notes, "use when the user asks"),
/// which reaches about 65% on its own.
const OVERLAP_THRESHOLD: f64 = 0.7;
/// Fewer distinct words than this is too little to call two descriptions alike.
const OVERLAP_MIN_WORDS: usize = 6;
const MAX_BROKEN_LINKS: usize = 5;
const MAX_DOC_BYTES: u64 = 2 * 1024 * 1024;

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    /// The skill is broken or out of spec; saving it is refused.
    Error,
    /// The skill works but an agent may misuse or miss it.
    Warning,
    /// A suggestion.
    Info,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Finding {
    pub code: &'static str,
    pub severity: Severity,
    pub message: String,
    pub params: BTreeMap<String, String>,
}

impl Finding {
    pub(crate) fn new(code: &'static str, severity: Severity, message: impl Into<String>) -> Self {
        Self { code, severity, message: message.into(), params: BTreeMap::new() }
    }

    pub(crate) fn param(mut self, key: &str, value: impl ToString) -> Self {
        self.params.insert(key.to_string(), value.to_string());
        self
    }
}

pub fn has_errors(findings: &[Finding]) -> bool {
    findings.iter().any(|f| f.severity == Severity::Error)
}

/// Whether `name` meets the Agent Skills format: 1–64 of `a-z`, `0-9` and
/// `-`, with no leading, trailing or doubled hyphen.
pub fn is_spec_name(name: &str) -> bool {
    !name.is_empty()
        && name.chars().count() <= NAME_MAX
        && name.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
        && !name.starts_with('-')
        && !name.ends_with('-')
        && !name.contains("--")
}

/// The frontmatter and body of a `SKILL.md`, or `None` when it does not open
/// with a `---` block.
pub(crate) fn split_frontmatter(content: &str) -> Option<(&str, &str)> {
    let content = content.strip_prefix('\u{feff}').unwrap_or(content).trim_start();
    let rest = content.strip_prefix("---")?;
    let rest = rest.strip_prefix("\r\n").or_else(|| rest.strip_prefix('\n'))?;
    let mut offset = 0;
    for line in rest.split_inclusive('\n') {
        if line.trim_end() == "---" {
            return Some((&rest[..offset], &rest[offset + line.len()..]));
        }
        offset += line.len();
    }
    None
}

/// What [`check_content`] read, for checks across skills.
#[derive(Debug, Default, Clone)]
pub struct Checked {
    pub findings: Vec<Finding>,
    pub name: Option<String>,
    pub description: Option<String>,
}

/// Check a `SKILL.md`'s text. `dir` is the skill's folder, when it has one,
/// for checking the files the instructions link to.
pub fn check_content(content: &str, dir: Option<&Path>) -> Vec<Finding> {
    check(content, dir).findings
}

fn check(content: &str, dir: Option<&Path>) -> Checked {
    let mut out = Checked::default();
    if let Some(finding) = invisible_chars(content) {
        out.findings.push(finding);
    }

    let Some((yaml, body)) = split_frontmatter(content) else {
        out.findings.push(Finding::new(
            "no_frontmatter",
            Severity::Error,
            "SKILL.md must start with a --- frontmatter block holding name and description",
        ));
        return out;
    };

    match serde_yaml::from_str::<serde_yaml::Value>(yaml) {
        Ok(value) if value.is_mapping() || value.is_null() => {
            out.name = frontmatter_str(&value, "name");
            out.description = frontmatter_str(&value, "description");
            check_name(out.name.as_deref(), &mut out.findings);
            check_description(out.description.as_deref(), &mut out.findings);
        }
        Ok(_) => out.findings.push(Finding::new(
            "frontmatter_invalid",
            Severity::Error,
            "The frontmatter must be a list of key: value fields",
        )),
        Err(e) => {
            let reason = e.to_string();
            out.findings.push(
                Finding::new(
                    "frontmatter_invalid",
                    Severity::Error,
                    format!("The frontmatter is not valid YAML: {reason}"),
                )
                .param("reason", reason),
            );
        }
    }

    check_body(body, dir, &mut out.findings);
    out.findings.sort_by_key(|f| f.severity);
    out
}

fn frontmatter_str(value: &serde_yaml::Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

fn check_name(name: Option<&str>, findings: &mut Vec<Finding>) {
    let Some(name) = name else {
        // Claude Code and most agents fall back to the folder name, so the
        // skill still loads; the format requires it all the same.
        findings.push(Finding::new(
            "name_missing",
            Severity::Warning,
            "The frontmatter has no name; agents that follow the Agent Skills format require one",
        ));
        return;
    };
    let len = name.chars().count();
    if len > NAME_MAX {
        findings.push(
            Finding::new(
                "name_too_long",
                Severity::Error,
                format!("The name is {len} characters; the limit is {NAME_MAX}"),
            )
            .param("length", len)
            .param("max", NAME_MAX),
        );
    } else if !is_spec_name(name) {
        findings.push(Finding::new(
            "name_format",
            Severity::Warning,
            "Use only lowercase letters, digits and single hyphens in the name; some agents reject other names",
        ));
    }
}

fn check_description(description: Option<&str>, findings: &mut Vec<Finding>) {
    let Some(description) = description else {
        findings.push(Finding::new(
            "description_missing",
            Severity::Error,
            "The frontmatter has no description; agents choose skills by it",
        ));
        return;
    };
    let len = description.chars().count();
    if len > DESCRIPTION_MAX {
        findings.push(
            Finding::new(
                "description_too_long",
                Severity::Error,
                format!("The description is {len} characters; the limit is {DESCRIPTION_MAX}"),
            )
            .param("length", len)
            .param("max", DESCRIPTION_MAX),
        );
    } else if len < DESCRIPTION_MIN {
        findings.push(
            Finding::new(
                "description_short",
                Severity::Warning,
                "The description is too short for an agent to know when to use the skill",
            )
            .param("length", len)
            .param("min", DESCRIPTION_MIN),
        );
    }
    if len >= DESCRIPTION_MIN && is_mostly_ascii(description) && !says_when(description) {
        findings.push(Finding::new(
            "description_no_when",
            Severity::Info,
            "Say when to use the skill (\"Use when …\"), not only what it does",
        ));
    }
}

/// The when-to-use check reads English words, so it only runs on text that is
/// mostly Latin letters.
fn is_mostly_ascii(text: &str) -> bool {
    let letters: Vec<char> = text.chars().filter(|c| c.is_alphabetic()).collect();
    !letters.is_empty() && letters.iter().filter(|c| c.is_ascii()).count() * 10 >= letters.len() * 8
}

fn says_when(description: &str) -> bool {
    const CUES: &[&str] = &["when", "whenever", "use", "used", "trigger", "triggers", "triggered", "if"];
    words(description).any(|w| CUES.contains(&w.as_str()))
}

fn words(text: &str) -> impl Iterator<Item = String> + '_ {
    text.split(|c: char| !c.is_alphanumeric())
        .filter(|w| !w.is_empty())
        .map(|w| w.to_lowercase())
}

fn check_body(body: &str, dir: Option<&Path>, findings: &mut Vec<Finding>) {
    if body.trim().is_empty() {
        findings.push(Finding::new(
            "body_empty",
            Severity::Warning,
            "The skill has no instructions below the frontmatter",
        ));
        return;
    }
    let lines = body.lines().count();
    if lines > BODY_MAX_LINES {
        findings.push(
            Finding::new(
                "body_long",
                Severity::Warning,
                format!(
                    "The instructions are {lines} lines; past {BODY_MAX_LINES}, move detail into files the skill links to"
                ),
            )
            .param("lines", lines)
            .param("max", BODY_MAX_LINES),
        );
    }
    if let Some(dir) = dir {
        for target in broken_links(body, dir) {
            findings.push(
                Finding::new(
                    "broken_link",
                    Severity::Warning,
                    format!("The instructions link to {target}, which is not in the skill's folder"),
                )
                .param("target", target),
            );
        }
    }
}

/// Relative markdown link targets (`[text](path)`) that do not exist under
/// `dir`. Links inside code fences are examples, not references.
fn broken_links(body: &str, dir: &Path) -> Vec<String> {
    let mut missing = Vec::new();
    let mut in_fence = false;
    for line in body.lines() {
        let trimmed = line.trim_start();
        if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
            in_fence = !in_fence;
            continue;
        }
        if in_fence {
            continue;
        }
        let mut rest = line;
        while let Some(start) = rest.find("](") {
            let after = &rest[start + 2..];
            let Some(end) = after.find(')') else { break };
            rest = &after[end + 1..];
            let Some(target) = local_target(&after[..end]) else { continue };
            if !dir.join(&target).exists() && !missing.contains(&target) {
                missing.push(target);
                if missing.len() == MAX_BROKEN_LINKS {
                    return missing;
                }
            }
        }
    }
    missing
}

/// The file a link points to inside the skill, or `None` for URLs, anchors
/// and absolute paths.
fn local_target(raw: &str) -> Option<String> {
    let raw = raw.trim();
    // `[x](<path with spaces>)` and `[x](path "title")`.
    let raw = match raw.strip_prefix('<') {
        Some(inner) => inner.split('>').next().unwrap_or(""),
        None => raw.split_whitespace().next().unwrap_or(""),
    };
    if raw.is_empty()
        || raw.starts_with('#')
        || raw.starts_with('/')
        || raw.starts_with('\\')
        || raw.contains(':')
    {
        return None;
    }
    let path = raw.split(['#', '?']).next().unwrap_or("").replace("%20", " ");
    // `[#131](link)` is a placeholder in an example, not a file: a reference
    // to a file has a folder or an extension.
    (path.contains('/') || path.contains('\\') || path.contains('.')).then_some(path)
}

/// Characters a reader cannot see: zero-width and joiner characters, text
/// direction overrides and Unicode tag characters. They can hide text from a
/// person reviewing a skill while the agent still reads it.
fn invisible_chars(content: &str) -> Option<Finding> {
    let is_hidden = |c: char| {
        matches!(c,
            '\u{200B}'..='\u{200F}'
            | '\u{202A}'..='\u{202E}'
            | '\u{2060}'..='\u{2064}'
            | '\u{2066}'..='\u{2069}'
            | '\u{FEFF}'
            | '\u{E0000}'..='\u{E007F}')
    };
    let body = content.strip_prefix('\u{feff}').unwrap_or(content);
    let count = body.chars().filter(|&c| is_hidden(c)).count();
    if count == 0 {
        return None;
    }
    let line = body.lines().position(|l| l.chars().any(is_hidden)).map_or(1, |i| i + 1);
    Some(
        Finding::new(
            "invisible_chars",
            Severity::Warning,
            format!("SKILL.md holds {count} invisible character(s), first on line {line}; they can hide text from a reviewer"),
        )
        .param("count", count)
        .param("line", line),
    )
}

/// Find the `SKILL.md` in a skill folder.
pub fn skill_md_path(dir: &Path) -> Option<std::path::PathBuf> {
    ["SKILL.md", "skill.md"].iter().map(|n| dir.join(n)).find(|p| p.is_file())
}

/// Check a skill folder.
pub fn check_dir(dir: &Path) -> Checked {
    let Some(path) = skill_md_path(dir) else {
        return Checked {
            findings: vec![Finding::new("no_skill_md", Severity::Error, "The folder has no SKILL.md")],
            ..Checked::default()
        };
    };
    let too_big = std::fs::metadata(&path).map(|m| m.len() > MAX_DOC_BYTES).unwrap_or(false);
    let content = if too_big { None } else { std::fs::read_to_string(&path).ok() };
    match content {
        Some(content) => check(&content, Some(dir)),
        None => Checked {
            findings: vec![Finding::new(
                "unreadable",
                Severity::Error,
                "SKILL.md could not be read as text, or is larger than 2 MB",
            )],
            ..Checked::default()
        },
    }
}

/// One library skill to check.
#[derive(Debug, Clone, Copy)]
pub struct LibrarySkill<'a> {
    pub id: &'a str,
    pub name: &'a str,
    pub dir: &'a Path,
}

/// Check every skill, plus what only shows across skills: two skills under
/// one name, and descriptions so alike an agent cannot tell them apart.
/// Skills with nothing to report are left out.
pub fn check_library(skills: &[LibrarySkill]) -> BTreeMap<String, Vec<Finding>> {
    let checked: Vec<Checked> = skills.iter().map(|s| check_dir(s.dir)).collect();
    let mut out: BTreeMap<String, Vec<Finding>> = BTreeMap::new();
    let cross = cross_findings(skills, &checked);
    for ((skill, c), extra) in skills.iter().zip(checked).zip(cross) {
        let mut findings = c.findings;
        findings.extend(extra);
        if !findings.is_empty() {
            findings.sort_by_key(|f| f.severity);
            out.insert(skill.id.to_string(), findings);
        }
    }
    out
}

/// What only shows when skills are loaded together: two under one name, and
/// descriptions so alike an agent cannot tell them apart. `checked[i]` is
/// what [`check_dir`] read for `skills[i]`; the result is one list per skill.
pub fn cross_findings(skills: &[LibrarySkill], checked: &[Checked]) -> Vec<Vec<Finding>> {
    let mut by_name: HashMap<String, Vec<usize>> = HashMap::new();
    for (i, c) in checked.iter().enumerate() {
        if let Some(name) = &c.name {
            by_name.entry(name.to_lowercase()).or_default().push(i);
        }
    }
    let mut cross: Vec<Vec<Finding>> = vec![Vec::new(); skills.len()];
    for indices in by_name.values().filter(|v| v.len() > 1) {
        for &i in indices {
            let names = others(skills, indices, i);
            cross[i].push(
                Finding::new(
                    "duplicate_name",
                    Severity::Warning,
                    format!("{names} has the same name; an agent with both sees one of them"),
                )
                .param("other", names),
            );
        }
    }

    let word_sets: Vec<BTreeSet<String>> = checked
        .iter()
        .map(|c| c.description.as_deref().map(content_words).unwrap_or_default())
        .collect();
    for i in 0..skills.len() {
        for j in i + 1..skills.len() {
            let (a, b) = (&word_sets[i], &word_sets[j]);
            if a.len() < OVERLAP_MIN_WORDS || b.len() < OVERLAP_MIN_WORDS {
                continue;
            }
            let shared = a.intersection(b).count() as f64;
            let similarity = shared / (a.len() + b.len()) as f64 * 2.0;
            if similarity < OVERLAP_THRESHOLD {
                continue;
            }
            let percent = (similarity * 100.0).round() as u32;
            for (me, other) in [(i, j), (j, i)] {
                cross[me].push(
                    Finding::new(
                        "description_overlap",
                        Severity::Warning,
                        format!(
                            "The description is {percent}% the same as {}'s; an agent may pick the wrong one",
                            skills[other].name
                        ),
                    )
                    .param("other", skills[other].name)
                    .param("percent", percent),
                );
            }
        }
    }
    cross
}

fn others(skills: &[LibrarySkill], indices: &[usize], me: usize) -> String {
    indices
        .iter()
        .filter(|&&i| i != me)
        .map(|&i| skills[i].name)
        .collect::<Vec<_>>()
        .join(", ")
}

/// The words of a description that carry its meaning.
pub(crate) fn content_words(text: &str) -> BTreeSet<String> {
    const STOP: &[&str] = &[
        "the", "and", "for", "with", "this", "that", "use", "when", "user", "from", "into", "your",
        "you", "are", "can", "will", "any", "all", "its", "via", "not", "but", "also", "such",
        "skill", "skills", "asks", "wants", "like", "using", "about", "them", "they", "their",
        "should", "whenever", "only", "other", "more", "than", "then", "each", "has", "have",
    ];
    words(text).filter(|w| w.chars().count() >= 3 && !STOP.contains(&w.as_str())).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    const GOOD_DESC: &str = "Format SQL queries into a consistent style. Use when the user asks to tidy or review SQL.";

    fn doc(name: &str, description: &str, body: &str) -> String {
        format!("---\nname: {name}\ndescription: {description}\n---\n{body}")
    }

    fn codes(findings: &[Finding]) -> Vec<&'static str> {
        findings.iter().map(|f| f.code).collect()
    }

    #[test]
    fn a_good_skill_has_no_findings() {
        let content = doc("sql-format", GOOD_DESC, "\n# SQL format\n\nRun the formatter.\n");
        assert_eq!(codes(&check_content(&content, None)), Vec::<&str>::new());
    }

    #[test]
    fn missing_frontmatter_is_an_error() {
        let findings = check_content("# Just a heading\n", None);
        assert_eq!(codes(&findings), ["no_frontmatter"]);
        assert!(has_errors(&findings));
    }

    #[test]
    fn unterminated_frontmatter_counts_as_missing() {
        assert_eq!(codes(&check_content("---\nname: x\n", None)), ["no_frontmatter"]);
    }

    #[test]
    fn crlf_and_bom_are_accepted() {
        let content = format!("\u{feff}---\r\nname: sql-format\r\ndescription: {GOOD_DESC}\r\n---\r\nBody\r\n");
        assert_eq!(codes(&check_content(&content, None)), Vec::<&str>::new());
    }

    #[test]
    fn invalid_yaml_is_reported_with_its_reason() {
        let findings = check_content("---\nname: [unclosed\n---\nBody\n", None);
        assert_eq!(findings[0].code, "frontmatter_invalid");
        assert!(findings[0].params.contains_key("reason"));
    }

    #[test]
    fn name_and_description_are_required() {
        let findings = check_content("---\nauthor: me\n---\nBody\n", None);
        assert_eq!(codes(&findings), ["description_missing", "name_missing"]);
        assert_eq!(findings[1].severity, Severity::Warning);
    }

    #[test]
    fn name_rules() {
        assert!(is_spec_name("pdf-tools2"));
        for bad in ["PDF", "-a", "a-", "a--b", "a_b", "a b", ""] {
            assert!(!is_spec_name(bad), "{bad}");
        }
        let long = "a".repeat(NAME_MAX + 1);
        assert_eq!(codes(&check_content(&doc(&long, GOOD_DESC, "Body"), None)), ["name_too_long"]);
        assert_eq!(codes(&check_content(&doc("My Skill", GOOD_DESC, "Body"), None)), ["name_format"]);
    }

    #[test]
    fn description_length_limits() {
        let long = "word ".repeat(300);
        let findings = check_content(&doc("a", long.trim(), "Body"), None);
        assert_eq!(findings[0].code, "description_too_long");
        assert!(has_errors(&findings));

        let findings = check_content(&doc("a", "Formats SQL.", "Body"), None);
        assert_eq!(codes(&findings), ["description_short"]);
        assert!(!has_errors(&findings));
    }

    #[test]
    fn description_should_say_when() {
        let what_only = "Formats SQL queries into a consistent house style with aligned keywords.";
        assert_eq!(codes(&check_content(&doc("a", what_only, "Body"), None)), ["description_no_when"]);
        // Not English: not judged.
        let chinese = "格式化 SQL 查询语句，统一缩进和关键字大小写，让团队的代码风格保持一致，便于代码审查和维护工作。";
        assert_eq!(codes(&check_content(&doc("a", chinese, "Body"), None)), Vec::<&str>::new());
    }

    #[test]
    fn body_rules() {
        assert_eq!(codes(&check_content(&doc("a", GOOD_DESC, "\n  \n"), None)), ["body_empty"]);
        let long = "line\n".repeat(BODY_MAX_LINES + 1);
        assert_eq!(codes(&check_content(&doc("a", GOOD_DESC, &long), None)), ["body_long"]);
    }

    #[test]
    fn broken_links_are_found_relative_to_the_skill() {
        let dir = tempdir().unwrap();
        fs::create_dir(dir.path().join("refs")).unwrap();
        fs::write(dir.path().join("refs/style guide.md"), "x").unwrap();
        let body = "\
See [style](<refs/style guide.md>) and [api](refs/api.md#auth \"API\").
Also [site](https://example.com), [top](#top), [abs](/etc/x), [#131](link).
```
[example](not/real.md)
```
";
        let findings = check_content(&doc("a", GOOD_DESC, body), Some(dir.path()));
        assert_eq!(codes(&findings), ["broken_link"]);
        assert_eq!(findings[0].params["target"], "refs/api.md");
    }

    #[test]
    fn invisible_characters_are_flagged_with_their_line() {
        let content = doc("a", GOOD_DESC, "Line one\nIgnore\u{200B} this\n");
        let findings = check_content(&content, None);
        assert_eq!(codes(&findings), ["invisible_chars"]);
        assert_eq!(findings[0].params["line"], "6");
    }

    #[test]
    fn check_dir_reports_a_missing_skill_md() {
        let dir = tempdir().unwrap();
        assert_eq!(codes(&check_dir(dir.path()).findings), ["no_skill_md"]);
    }

    #[test]
    fn library_finds_duplicate_names_and_overlapping_descriptions() {
        let root = tempdir().unwrap();
        let write = |dir: &str, content: String| {
            let path = root.path().join(dir);
            fs::create_dir(&path).unwrap();
            fs::write(path.join("SKILL.md"), content).unwrap();
            path
        };
        let a = write("a", doc("sql", GOOD_DESC, "Body"));
        let b = write("b", doc("sql", "Format SQL queries into a consistent style. Use when the user asks to tidy SQL.", "Body"));
        let c = write("c", doc("pdf", "Extract tables and text from PDF files. Use when the user shares a PDF.", "Body"));
        let skills = [
            LibrarySkill { id: "1", name: "sql", dir: &a },
            LibrarySkill { id: "2", name: "sql-2", dir: &b },
            LibrarySkill { id: "3", name: "pdf", dir: &c },
        ];
        let out = check_library(&skills);
        assert_eq!(codes(&out["1"]), ["duplicate_name", "description_overlap"]);
        assert_eq!(out["1"][0].params["other"], "sql-2");
        assert_eq!(out["2"][1].params["other"], "sql");
        assert!(!out.contains_key("3"));
    }
}
