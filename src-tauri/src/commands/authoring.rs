//! Writing skills in the app, and checking them: create a new skill, edit a
//! library skill's SKILL.md, and run the quality checks in `skill_lint` on one
//! draft or on the whole library.

use std::path::Path;
use std::sync::Arc;

use serde::Serialize;
use tauri::State;

use super::skills::{resync_copy_targets, store_installed_skill_unlocked, InstallSourceMetadata};
use crate::core::audit_log::AuditDraft;
use crate::core::central_repo;
use crate::core::error::AppError;
use crate::core::installer;
use crate::core::repo_lock::RepoLock;
use crate::core::skill_lint::{self, Finding, LibrarySkill};
use crate::core::skill_store::SkillStore;

#[derive(Debug, Serialize)]
pub struct SkillQuality {
    pub skill_id: String,
    pub findings: Vec<Finding>,
}

/// Quality findings for every library skill that has any.
#[tauri::command]
pub async fn check_library_quality(
    store: State<'_, Arc<SkillStore>>,
) -> Result<Vec<SkillQuality>, AppError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || check_library_quality_internal(&store)).await?
}

pub fn check_library_quality_internal(store: &SkillStore) -> Result<Vec<SkillQuality>, AppError> {
    let skills = store.get_all_skills().map_err(AppError::db)?;
    let entries: Vec<LibrarySkill> = skills
        .iter()
        .map(|s| LibrarySkill { id: &s.id, name: &s.name, dir: Path::new(&s.central_path) })
        .collect();
    Ok(skill_lint::check_library(&entries)
        .into_iter()
        .map(|(skill_id, findings)| SkillQuality { skill_id, findings })
        .collect())
}

#[derive(Debug, Serialize)]
pub struct PresetQuality {
    pub preset_id: String,
    /// Skills that clash with another skill of the same preset, and how.
    pub skills: Vec<SkillQuality>,
}

/// For each preset, what goes wrong when its skills are loaded together:
/// two under one name, or descriptions an agent cannot tell apart. Each
/// skill's own problems are left to [`check_library_quality`].
#[tauri::command]
pub async fn check_preset_quality(
    store: State<'_, Arc<SkillStore>>,
) -> Result<Vec<PresetQuality>, AppError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || check_preset_quality_internal(&store)).await?
}

pub fn check_preset_quality_internal(store: &SkillStore) -> Result<Vec<PresetQuality>, AppError> {
    let skills = store.get_all_skills().map_err(AppError::db)?;
    // Each skill folder is read once, however many presets hold it.
    let checked: std::collections::HashMap<&str, skill_lint::Checked> = skills
        .iter()
        .map(|s| (s.id.as_str(), skill_lint::check_dir(Path::new(&s.central_path))))
        .collect();
    let mut out = Vec::new();
    for preset in store.get_all_scenarios().map_err(AppError::db)? {
        let ids = store.get_skill_ids_for_scenario(&preset.id).map_err(AppError::db)?;
        let members: Vec<_> = ids.iter().filter_map(|id| skills.iter().find(|s| &s.id == id)).collect();
        let entries: Vec<LibrarySkill> = members
            .iter()
            .map(|s| LibrarySkill { id: &s.id, name: &s.name, dir: Path::new(&s.central_path) })
            .collect();
        let checks: Vec<skill_lint::Checked> = members.iter().map(|s| checked[s.id.as_str()].clone()).collect();
        let together = skill_lint::cross_findings(&entries, &checks)
            .into_iter()
            .zip(&members)
            .filter(|(findings, _)| !findings.is_empty())
            .map(|(findings, s)| SkillQuality { skill_id: s.id.clone(), findings })
            .collect();
        out.push(PresetQuality { preset_id: preset.id, skills: together });
    }
    Ok(out)
}

#[derive(Debug, Serialize)]
pub struct PresetSummary {
    pub skills: usize,
    /// Tokens the preset's skills add to every session.
    pub always_on: u32,
    /// Skills that clash with another skill of the preset.
    pub clashes: usize,
    /// Skills with an error or warning of their own (library-wide clashes aside).
    pub problems: usize,
}

/// One preset's budget and fit, cheap enough for the preset's own page.
#[tauri::command]
pub async fn get_preset_summary(
    preset_id: String,
    store: State<'_, Arc<SkillStore>>,
) -> Result<PresetSummary, AppError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || preset_summary_internal(&store, &preset_id)).await?
}

pub fn preset_summary_internal(store: &SkillStore, preset_id: &str) -> Result<PresetSummary, AppError> {
    let members = store.get_skills_for_scenario(preset_id).map_err(AppError::db)?;
    let entries: Vec<LibrarySkill> = members
        .iter()
        .map(|s| LibrarySkill { id: &s.id, name: &s.name, dir: Path::new(&s.central_path) })
        .collect();
    let checks: Vec<skill_lint::Checked> = entries.iter().map(|e| skill_lint::check_dir(e.dir)).collect();
    let together = skill_lint::cross_findings(&entries, &checks);
    let problems = checks
        .iter()
        .filter(|c| c.findings.iter().any(|f| f.severity != skill_lint::Severity::Info))
        .count();
    Ok(PresetSummary {
        skills: members.len(),
        always_on: entries
            .iter()
            .map(|e| crate::core::context_cost::skill_dir_cost(e.dir).always_on)
            .sum(),
        clashes: together.iter().filter(|f| !f.is_empty()).count(),
        problems,
    })
}

/// Check a SKILL.md being written. With `skill_id`, links are checked against
/// that skill's folder.
#[tauri::command]
pub async fn check_skill_draft(
    content: String,
    skill_id: Option<String>,
    store: State<'_, Arc<SkillStore>>,
) -> Result<Vec<Finding>, AppError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let dir = match skill_id {
            Some(id) => Some(skill_dir(&store, &id)?),
            None => None,
        };
        Ok(skill_lint::check_content(&content, dir.as_deref()))
    })
    .await?
}

/// The SKILL.md a new skill starts as. The frontmatter goes through the YAML
/// writer, so a description holding `:` or quotes stays one valid string.
pub fn compose_skill_md(name: &str, description: &str, body: &str) -> Result<String, AppError> {
    #[derive(Serialize)]
    struct Frontmatter<'a> {
        name: &'a str,
        description: &'a str,
    }
    let yaml = serde_yaml::to_string(&Frontmatter { name, description }).map_err(AppError::internal)?;
    let yaml = yaml.strip_prefix("---\n").unwrap_or(&yaml);
    let body = body.trim_matches('\n');
    Ok(if body.trim().is_empty() {
        format!("---\n{yaml}---\n")
    } else {
        format!("---\n{yaml}---\n\n{body}\n")
    })
}

#[derive(Debug, Serialize)]
pub struct CreatedSkill {
    pub skill_id: String,
    pub name: String,
}

/// Create a skill in the library from a name, a description and its
/// instructions. It is a local skill with no source to update from.
#[tauri::command]
pub async fn create_skill(
    name: String,
    description: String,
    body: String,
    store: State<'_, Arc<SkillStore>>,
) -> Result<CreatedSkill, AppError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let outcome = create_skill_internal(&store, &name, &description, &body);
        let draft = AuditDraft::new("install").detail("created");
        store.log_audit(match &outcome {
            Ok(created) => draft.skill(created.skill_id.clone(), created.name.clone()).ok(),
            Err(e) => draft.fail(e.to_string()),
        });
        outcome
    })
    .await?
}

pub fn create_skill_internal(
    store: &SkillStore,
    name: &str,
    description: &str,
    body: &str,
) -> Result<CreatedSkill, AppError> {
    let name = name.trim();
    // The name becomes the folder name in the library and in every agent, so
    // hold it to the format every agent accepts.
    if !skill_lint::is_spec_name(name) {
        return Err(AppError::invalid_input(format!(
            "Invalid skill name '{name}': use up to {} lowercase letters, digits and single hyphens",
            skill_lint::NAME_MAX
        )));
    }
    let content = compose_skill_md(name, description.trim(), body)?;
    refuse_errors(&skill_lint::check_content(&content, None))?;

    let staging = tempfile::tempdir().map_err(AppError::io)?;
    std::fs::write(staging.path().join("SKILL.md"), &content).map_err(AppError::io)?;
    add_new_skill(store, staging.path(), name)
}

/// Create a library skill from a draft folder an agent wrote: its SKILL.md
/// and everything beside it (scripts, reference files). The draft must pass
/// the quality check without errors and carry a valid `name`; the findings
/// that are left (warnings, tips) come back for the agent to report.
pub fn create_skill_from_dir_internal(
    store: &SkillStore,
    dir: &Path,
) -> Result<(CreatedSkill, Vec<Finding>), AppError> {
    if !dir.is_dir() {
        return Err(AppError::not_found(format!("No folder at {}", dir.display())));
    }
    let checked = skill_lint::check_dir(dir);
    refuse_errors(&checked.findings)?;
    let name = checked.name.ok_or_else(|| {
        AppError::invalid_input("The draft's frontmatter needs a name: it becomes the skill's folder name")
    })?;
    if !skill_lint::is_spec_name(&name) {
        return Err(AppError::invalid_input(format!(
            "Invalid skill name '{name}': use up to {} lowercase letters, digits and single hyphens",
            skill_lint::NAME_MAX
        )));
    }
    let created = add_new_skill(store, dir, &name)?;
    Ok((created, checked.findings))
}

/// Copy `source` into the library as a new local skill with no source to
/// update from. Refuses a name the library already uses.
fn add_new_skill(store: &SkillStore, source: &Path, name: &str) -> Result<CreatedSkill, AppError> {
    let _lock = RepoLock::acquire_foreground("create skill").map_err(AppError::db)?;
    let taken = store
        .get_all_skills()
        .map_err(AppError::db)?
        .iter()
        .any(|s| s.name.eq_ignore_ascii_case(name));
    let destination = central_repo::skills_dir().join(name);
    if taken || destination.symlink_metadata().is_ok() {
        return Err(AppError::invalid_input(format!(
            "The library already has a skill named '{name}'"
        )));
    }
    let result = installer::install_skill_dir_to_destination(source, name, &destination)
        .map_err(AppError::io)?;
    let metadata = InstallSourceMetadata {
        source_type: "local".to_string(),
        source_ref: None,
        source_ref_resolved: None,
        source_subpath: None,
        source_branch: None,
        source_revision: None,
        remote_revision: None,
        update_status: "local_only".to_string(),
    };
    let skill_id = store_installed_skill_unlocked(store, &result, &metadata, None)?;
    Ok(CreatedSkill { skill_id, name: result.name })
}

/// Replace a library skill's SKILL.md. A draft with errors is refused, since
/// a broken frontmatter hides the skill from every agent it is deployed to.
/// Agents that hold a copy rather than a link get the new text too.
#[tauri::command]
pub async fn save_skill_document(
    skill_id: String,
    content: String,
    store: State<'_, Arc<SkillStore>>,
) -> Result<(), AppError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let outcome = save_skill_document_internal(&store, &skill_id, &content);
        let name = store.get_skill_by_id(&skill_id).ok().flatten().map(|s| s.name).unwrap_or_default();
        let draft = AuditDraft::new("edit").skill(skill_id.clone(), name);
        store.log_audit(match &outcome {
            Ok(()) => draft.ok(),
            Err(e) => draft.fail(e.to_string()),
        });
        outcome
    })
    .await?
}

pub fn save_skill_document_internal(
    store: &SkillStore,
    skill_id: &str,
    content: &str,
) -> Result<(), AppError> {
    let dir = skill_dir(store, skill_id)?;
    refuse_errors(&skill_lint::check_content(content, Some(&dir)))?;

    let _lock = RepoLock::acquire_foreground("edit skill").map_err(AppError::db)?;
    let path = skill_lint::skill_md_path(&dir).unwrap_or_else(|| dir.join("SKILL.md"));
    // Keep the file's line endings, so an edit to one line is a one-line
    // change in the backup history rather than the whole file.
    let crlf = std::fs::read_to_string(&path).map(|old| old.contains("\r\n")).unwrap_or(false);
    let normalized = content.replace("\r\n", "\n");
    let text = if crlf { normalized.replace('\n', "\r\n") } else { normalized };

    let temp = path.with_extension("md.saving");
    std::fs::write(&temp, text).map_err(AppError::io)?;
    if let Err(e) = std::fs::rename(&temp, &path) {
        let _ = std::fs::remove_file(&temp);
        return Err(AppError::io(e));
    }
    resync_copy_targets(store, skill_id)
}

fn skill_dir(store: &SkillStore, skill_id: &str) -> Result<std::path::PathBuf, AppError> {
    let skill = store
        .get_skill_by_id(skill_id)
        .map_err(AppError::db)?
        .ok_or_else(|| AppError::not_found("Skill not found"))?;
    Ok(std::path::PathBuf::from(skill.central_path))
}

fn refuse_errors(findings: &[Finding]) -> Result<(), AppError> {
    match findings.iter().find(|f| f.severity == skill_lint::Severity::Error) {
        Some(error) => Err(AppError::invalid_input(error.message.clone())),
        None => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    struct TestRepo {
        _lock: std::sync::MutexGuard<'static, ()>,
        _tmp: TempDir,
        store: SkillStore,
    }

    impl Drop for TestRepo {
        fn drop(&mut self) {
            central_repo::set_test_base_dir_override(None);
        }
    }

    fn test_repo() -> TestRepo {
        let lock = central_repo::test_base_dir_lock();
        let tmp = tempfile::tempdir().unwrap();
        let base = tmp.path().join("repo");
        central_repo::set_test_base_dir_override(Some(base.clone()));
        fs::create_dir_all(central_repo::skills_dir()).unwrap();
        let store = SkillStore::new(&base.join("test.db")).unwrap();
        TestRepo { _lock: lock, _tmp: tmp, store }
    }

    const DESC: &str = "Format SQL queries. Use when the user asks to tidy SQL.";

    #[test]
    fn preset_checks_only_report_clashes_between_its_own_skills() {
        let repo = test_repo();
        let overlap = "Review pull requests for bugs, style problems and missing tests before merging code changes";
        let a = create_skill_internal(&repo.store, "review-a", overlap, "Do it.").unwrap();
        let b = create_skill_internal(&repo.store, "review-b", overlap, "Do it.").unwrap();
        let c = create_skill_internal(&repo.store, "sql-format", DESC, "Do it.").unwrap();
        let preset = |id: &str| crate::core::skill_store::ScenarioRecord {
            id: id.into(),
            name: id.into(),
            description: None,
            icon: None,
            sort_order: 0,
            created_at: 0,
            updated_at: 0,
        };
        repo.store.insert_scenario(&preset("both")).unwrap();
        repo.store.insert_scenario(&preset("one")).unwrap();
        for id in [&a.skill_id, &b.skill_id, &c.skill_id] {
            repo.store.add_skill_to_scenario("both", id).unwrap();
        }
        repo.store.add_skill_to_scenario("one", &a.skill_id).unwrap();
        repo.store.add_skill_to_scenario("one", &c.skill_id).unwrap();

        let result = check_preset_quality_internal(&repo.store).unwrap();
        let both = result.iter().find(|p| p.preset_id == "both").unwrap();
        let flagged: Vec<&str> = both.skills.iter().map(|s| s.skill_id.as_str()).collect();
        assert_eq!(flagged.len(), 2);
        assert!(flagged.contains(&a.skill_id.as_str()) && flagged.contains(&b.skill_id.as_str()));
        assert!(both.skills.iter().all(|s| s.findings.iter().all(|f| f.code == "description_overlap")));
        let one = result.iter().find(|p| p.preset_id == "one").unwrap();
        assert!(one.skills.is_empty(), "the overlapping skill is not in this preset");

        let summary = preset_summary_internal(&repo.store, "both").unwrap();
        assert_eq!((summary.skills, summary.clashes), (3, 2));
        assert!(summary.always_on > 0);
        let summary = preset_summary_internal(&repo.store, "one").unwrap();
        assert_eq!((summary.skills, summary.clashes), (2, 0));
    }

    #[test]
    fn create_writes_a_local_skill_with_no_source() {
        let repo = test_repo();
        let created = create_skill_internal(&repo.store, " sql-format ", DESC, "# SQL\n\nRun it.").unwrap();
        assert_eq!(created.name, "sql-format");

        let skill = repo.store.get_skill_by_id(&created.skill_id).unwrap().unwrap();
        assert_eq!(skill.source_type, "local");
        assert_eq!(skill.source_ref, None);
        assert_eq!(skill.update_status, "local_only");
        assert_eq!(skill.description.as_deref(), Some(DESC));
        let content = fs::read_to_string(Path::new(&skill.central_path).join("SKILL.md")).unwrap();
        assert!(content.contains("name: sql-format\n"));
        assert!(content.ends_with("# SQL\n\nRun it.\n"));
    }

    #[test]
    fn create_refuses_bad_names_duplicates_and_drafts_with_errors() {
        let repo = test_repo();
        for bad in ["SQL", "a b", "../x", ""] {
            assert!(create_skill_internal(&repo.store, bad, DESC, "Body").is_err(), "{bad}");
        }
        assert!(create_skill_internal(&repo.store, "a", "", "Body").is_err(), "no description");

        create_skill_internal(&repo.store, "sql", DESC, "Body").unwrap();
        let again = create_skill_internal(&repo.store, "sql", DESC, "Body").unwrap_err();
        assert!(again.message.contains("already has"), "{}", again.message);

        // A folder already in the way, not in the library, is left alone.
        let stray = central_repo::skills_dir().join("stray");
        fs::create_dir_all(&stray).unwrap();
        fs::write(stray.join("notes.txt"), "mine").unwrap();
        assert!(create_skill_internal(&repo.store, "stray", DESC, "Body").is_err());
        assert_eq!(fs::read_to_string(stray.join("notes.txt")).unwrap(), "mine");
    }

    #[test]
    fn create_from_a_draft_folder_copies_its_files_and_reports_warnings() {
        let repo = test_repo();
        let draft = tempfile::tempdir().unwrap();
        fs::create_dir(draft.path().join("scripts")).unwrap();
        fs::write(draft.path().join("scripts/run.sh"), "echo hi").unwrap();
        fs::write(
            draft.path().join("SKILL.md"),
            "---\nname: deploy-site\ndescription: Deploys the site.\n---\nRun [it](scripts/run.sh).\n",
        )
        .unwrap();

        let (created, findings) = create_skill_from_dir_internal(&repo.store, draft.path()).unwrap();
        assert_eq!(created.name, "deploy-site");
        assert_eq!(findings.iter().map(|f| f.code).collect::<Vec<_>>(), ["description_short"]);
        let skill = repo.store.get_skill_by_id(&created.skill_id).unwrap().unwrap();
        assert_eq!(skill.source_ref, None);
        assert!(Path::new(&skill.central_path).join("scripts/run.sh").is_file());
        assert!(draft.path().join("SKILL.md").is_file(), "the draft is left in place");

        // Errors refuse; so does a name outside the format.
        fs::write(draft.path().join("SKILL.md"), "no frontmatter").unwrap();
        assert!(create_skill_from_dir_internal(&repo.store, draft.path()).is_err());
        fs::write(draft.path().join("SKILL.md"), "---\nname: Deploy Site\ndescription: d\n---\nx\n").unwrap();
        assert!(create_skill_from_dir_internal(&repo.store, draft.path()).is_err());
    }

    #[test]
    fn save_replaces_the_document_keeping_crlf_and_refuses_errors() {
        let repo = test_repo();
        let created = create_skill_internal(&repo.store, "sql", DESC, "Old").unwrap();
        let skill = repo.store.get_skill_by_id(&created.skill_id).unwrap().unwrap();
        let path = Path::new(&skill.central_path).join("SKILL.md");
        let crlf = fs::read_to_string(&path).unwrap().replace('\n', "\r\n");
        fs::write(&path, crlf).unwrap();

        let next = format!("---\nname: sql\ndescription: {DESC}\n---\nNew\n");
        save_skill_document_internal(&repo.store, &created.skill_id, &next).unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), next.replace('\n', "\r\n"));

        let broken = "# no frontmatter\n";
        assert!(save_skill_document_internal(&repo.store, &created.skill_id, broken).is_err());
        assert!(fs::read_to_string(&path).unwrap().contains("New"));
        assert!(!path.with_extension("md.saving").exists());
    }

    #[test]
    fn composed_frontmatter_survives_yaml_special_characters() {
        let content = compose_skill_md("a", "Does: \"things\" # really", "# A\n\nDo it.").unwrap();
        assert!(content.starts_with("---\nname: a\n"));
        assert!(content.ends_with("\n\n# A\n\nDo it.\n"));
        let findings = skill_lint::check_content(&content, None);
        assert!(!skill_lint::has_errors(&findings), "{findings:?}");
        let (yaml, _) = content[4..].split_once("---\n").unwrap();
        let value: serde_yaml::Value = serde_yaml::from_str(yaml).unwrap();
        assert_eq!(value["description"].as_str(), Some("Does: \"things\" # really"));
    }

    #[test]
    fn composed_skill_without_body_is_frontmatter_only() {
        assert_eq!(compose_skill_md("a", "b", "  \n").unwrap(), "---\nname: a\ndescription: b\n---\n");
    }
}
