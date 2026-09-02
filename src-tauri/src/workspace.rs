use crate::db::with_conn;
use rusqlite::params;
use serde::{Deserialize, Serialize};

// --- Connections (durable provider connections) ---

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionRow {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub base_url: String,
    pub scope: Option<String>,
    pub ca_path: Option<String>,
    pub created_at: i64,
}

pub fn list_connections() -> Result<Vec<ConnectionRow>, String> {
    with_conn(|c| {
        let mut stmt = c
            .prepare(
                "SELECT id, name, kind, base_url, scope, ca_path, created_at \
                 FROM connections ORDER BY created_at ASC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| {
                Ok(ConnectionRow {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    kind: r.get(2)?,
                    base_url: r.get(3)?,
                    scope: r.get(4)?,
                    ca_path: r.get(5)?,
                    created_at: r.get(6)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    })
}

pub fn save_connection(c0: ConnectionRow) -> Result<(), String> {
    with_conn(|c| {
        c.execute(
            "INSERT INTO connections (id, name, kind, base_url, scope, ca_path, created_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) \
             ON CONFLICT(id) DO UPDATE SET \
               name=excluded.name, kind=excluded.kind, base_url=excluded.base_url, \
               scope=excluded.scope, ca_path=excluded.ca_path",
            params![c0.id, c0.name, c0.kind, c0.base_url, c0.scope, c0.ca_path, c0.created_at],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })?;
    // Saving a connection is what authorizes reaching its host over the network.
    crate::policy::allow_network(&c0.base_url);
    Ok(())
}

pub fn delete_connection(id: &str) -> Result<(), String> {
    with_conn(|c| {
        c.execute("DELETE FROM connections WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    })
}

// --- Agent runs (durable) ---
//
// A run is the canon of one agent turn: what it is, what it spent, and how it
// ended. The live loop stays in the frontend, but it now writes here so a run
// survives a restart and can be resumed, budgeted and reviewed. `agent_events`
// is the append-only trace that reconstructs the run.

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRunRow {
    pub id: String,
    pub session_id: Option<String>,
    pub project_id: Option<String>,
    pub connection_id: Option<String>,
    pub model: Option<String>,
    pub status: String,
    pub started_at: i64,
    pub updated_at: i64,
    pub ended_at: Option<i64>,
    pub steps: i64,
    pub tokens_in: i64,
    pub tokens_out: i64,
    pub cost_usd: f64,
    pub budget_steps: Option<i64>,
    pub budget_usd: Option<f64>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentEventRow {
    pub id: String,
    pub run_id: String,
    pub seq: i64,
    pub kind: String,
    pub payload: Option<String>,
    pub created_at: i64,
}

fn read_run(r: &rusqlite::Row) -> rusqlite::Result<AgentRunRow> {
    Ok(AgentRunRow {
        id: r.get(0)?,
        session_id: r.get(1)?,
        project_id: r.get(2)?,
        connection_id: r.get(3)?,
        model: r.get(4)?,
        status: r.get(5)?,
        started_at: r.get(6)?,
        updated_at: r.get(7)?,
        ended_at: r.get(8)?,
        steps: r.get(9)?,
        tokens_in: r.get(10)?,
        tokens_out: r.get(11)?,
        cost_usd: r.get(12)?,
        budget_steps: r.get(13)?,
        budget_usd: r.get(14)?,
        error: r.get(15)?,
    })
}

const RUN_COLS: &str = "id, session_id, project_id, connection_id, model, status, \
    started_at, updated_at, ended_at, steps, tokens_in, tokens_out, cost_usd, \
    budget_steps, budget_usd, error";

/// Create a run or update it in place — the frontend holds the run object and
/// writes the whole thing on each change, which keeps the durable copy in step
/// without a patch protocol.
pub fn save_agent_run(run: AgentRunRow) -> Result<(), String> {
    with_conn(|c| {
        c.execute(
            "INSERT INTO agent_runs (id, session_id, project_id, connection_id, model, \
               status, started_at, updated_at, ended_at, steps, tokens_in, tokens_out, \
               cost_usd, budget_steps, budget_usd, error) \
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16) \
             ON CONFLICT(id) DO UPDATE SET \
               session_id=excluded.session_id, project_id=excluded.project_id, \
               connection_id=excluded.connection_id, model=excluded.model, \
               status=excluded.status, updated_at=excluded.updated_at, \
               ended_at=excluded.ended_at, steps=excluded.steps, \
               tokens_in=excluded.tokens_in, tokens_out=excluded.tokens_out, \
               cost_usd=excluded.cost_usd, budget_steps=excluded.budget_steps, \
               budget_usd=excluded.budget_usd, error=excluded.error",
            params![
                run.id, run.session_id, run.project_id, run.connection_id, run.model,
                run.status, run.started_at, run.updated_at, run.ended_at, run.steps,
                run.tokens_in, run.tokens_out, run.cost_usd, run.budget_steps,
                run.budget_usd, run.error,
            ],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })
}

/// Append one event to a run's trace. `seq` is assigned as the next index for
/// the run, so callers never have to track it.
pub fn append_agent_event(
    run_id: &str,
    id: &str,
    kind: &str,
    payload: Option<String>,
    created_at: i64,
) -> Result<i64, String> {
    with_conn(|c| {
        let seq: i64 = c
            .query_row(
                "SELECT COALESCE(MAX(seq) + 1, 0) FROM agent_events WHERE run_id = ?1",
                params![run_id],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        c.execute(
            "INSERT INTO agent_events (id, run_id, seq, kind, payload, created_at) \
             VALUES (?1,?2,?3,?4,?5,?6)",
            params![id, run_id, seq, kind, payload, created_at],
        )
        .map_err(|e| e.to_string())?;
        Ok(seq)
    })
}

/// Recent runs, newest first, optionally scoped to one session.
pub fn list_agent_runs(session_id: Option<String>, limit: i64) -> Result<Vec<AgentRunRow>, String> {
    with_conn(|c| {
        let sql = format!(
            "SELECT {RUN_COLS} FROM agent_runs {} ORDER BY started_at DESC LIMIT ?",
            if session_id.is_some() { "WHERE session_id = ?" } else { "" },
        );
        let mut stmt = c.prepare(&sql).map_err(|e| e.to_string())?;
        let rows = match session_id {
            Some(s) => stmt.query_map(params![s, limit], read_run),
            None => stmt.query_map(params![limit], read_run),
        }
        .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    })
}

/// Runs that were still in flight — used at startup to offer resume or close.
pub fn active_agent_runs() -> Result<Vec<AgentRunRow>, String> {
    with_conn(|c| {
        let mut stmt = c
            .prepare(&format!(
                "SELECT {RUN_COLS} FROM agent_runs \
                 WHERE status IN ('running','paused') ORDER BY started_at DESC",
            ))
            .map_err(|e| e.to_string())?;
        let rows = stmt.query_map([], read_run).map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    })
}

pub fn get_agent_run(id: &str) -> Result<Option<AgentRunRow>, String> {
    with_conn(|c| {
        let mut stmt = c
            .prepare(&format!("SELECT {RUN_COLS} FROM agent_runs WHERE id = ?1"))
            .map_err(|e| e.to_string())?;
        let mut rows = stmt.query_map(params![id], read_run).map_err(|e| e.to_string())?;
        match rows.next() {
            Some(r) => Ok(Some(r.map_err(|e| e.to_string())?)),
            None => Ok(None),
        }
    })
}

pub fn list_agent_events(run_id: &str) -> Result<Vec<AgentEventRow>, String> {
    with_conn(|c| {
        let mut stmt = c
            .prepare(
                "SELECT id, run_id, seq, kind, payload, created_at \
                 FROM agent_events WHERE run_id = ?1 ORDER BY seq ASC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![run_id], |r| {
                Ok(AgentEventRow {
                    id: r.get(0)?,
                    run_id: r.get(1)?,
                    seq: r.get(2)?,
                    kind: r.get(3)?,
                    payload: r.get(4)?,
                    created_at: r.get(5)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    })
}

/// At startup, mark any run left in flight as interrupted (see db::reconcile).
pub fn reconcile_agent_runs() -> Result<usize, String> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    with_conn(|c| crate::db::reconcile_agent_runs(c, now))
}

/// Remove a run and its trace.
pub fn delete_agent_run(id: &str) -> Result<(), String> {
    with_conn(|c| {
        c.execute("DELETE FROM agent_events WHERE run_id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        c.execute("DELETE FROM agent_runs WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    })
}

// --- Generations (Studio gallery, durable) ---
//
// The Studio's results were kept only in a module cache, so a restart lost the
// gallery. They live in the `generations` table now: one row per produced asset,
// with the prompt and model that made it. `src` is a URL or a data-URI.

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerationRow {
    pub id: String,
    pub kind: String,
    pub src: String,
    pub name: String,
    pub prompt: Option<String>,
    pub model: Option<String>,
    pub run_id: Option<String>,
    pub created_at: i64,
}

pub fn save_generation(g: GenerationRow) -> Result<(), String> {
    with_conn(|c| {
        c.execute(
            "INSERT INTO generations (id, kind, src, name, prompt, model, run_id, created_at) \
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8) \
             ON CONFLICT(id) DO UPDATE SET \
               kind=excluded.kind, src=excluded.src, name=excluded.name, \
               prompt=excluded.prompt, model=excluded.model, run_id=excluded.run_id",
            params![g.id, g.kind, g.src, g.name, g.prompt, g.model, g.run_id, g.created_at],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })
}

pub fn list_generations(limit: i64) -> Result<Vec<GenerationRow>, String> {
    with_conn(|c| {
        let mut stmt = c
            .prepare(
                "SELECT id, kind, src, name, prompt, model, run_id, created_at \
                 FROM generations ORDER BY created_at DESC LIMIT ?1",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![limit], |r| {
                Ok(GenerationRow {
                    id: r.get(0)?,
                    kind: r.get(1)?,
                    src: r.get(2)?,
                    name: r.get(3)?,
                    prompt: r.get(4)?,
                    model: r.get(5)?,
                    run_id: r.get(6)?,
                    created_at: r.get(7)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    })
}

pub fn delete_generation(id: &str) -> Result<(), String> {
    with_conn(|c| {
        c.execute("DELETE FROM generations WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    })
}

// --- Projects ---

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub tech_stack: Option<String>,
    pub architecture_notes: Option<String>,
    pub coding_standards: Option<String>,
    pub decisions: Option<String>,
    pub active_goals: Option<String>,
    pub roadmap: Option<String>,
    pub risks: Option<String>,
    pub path: Option<String>,
    pub last_state: Option<String>,
    /// When this project's legacy prose fields were split into `memory_facts`.
    /// `None` means the one-time migration has not run yet.
    pub facts_migrated_at: Option<i64>,
    /// Same, for the old `decisions` text field becoming a decision log.
    pub decisions_migrated_at: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
}

pub fn list_projects() -> Result<Vec<Project>, String> {
    with_conn(|c| {
        let mut stmt = c
            .prepare(
                "SELECT id, name, description, tech_stack, architecture_notes, coding_standards, \
                 decisions, active_goals, roadmap, risks, path, last_state, facts_migrated_at, \
                 decisions_migrated_at, created_at, updated_at \
                 FROM projects \
                 WHERE deleted_at IS NULL \
                 ORDER BY updated_at DESC",
            )
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map([], |r| {
                Ok(Project {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    description: r.get(2)?,
                    tech_stack: r.get(3)?,
                    architecture_notes: r.get(4)?,
                    coding_standards: r.get(5)?,
                    decisions: r.get(6)?,
                    active_goals: r.get(7)?,
                    roadmap: r.get(8)?,
                    risks: r.get(9)?,
                    path: r.get(10)?,
                    last_state: r.get(11)?,
                    facts_migrated_at: r.get(12)?,
                    decisions_migrated_at: r.get(13)?,
                    created_at: r.get(14)?,
                    updated_at: r.get(15)?,
                })
            })
            .map_err(|e| e.to_string())?;
        
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    })
}

pub fn save_project(p: Project) -> Result<(), String> {
    with_conn(|c| {
        c.execute(
            "INSERT INTO projects \
               (id, name, description, tech_stack, architecture_notes, coding_standards, decisions, active_goals, roadmap, risks, path, last_state, facts_migrated_at, decisions_migrated_at, created_at, updated_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16) \
             ON CONFLICT(id) DO UPDATE SET \
               name=excluded.name, description=excluded.description, tech_stack=excluded.tech_stack, \
               architecture_notes=excluded.architecture_notes, coding_standards=excluded.coding_standards, \
               decisions=excluded.decisions, active_goals=excluded.active_goals, roadmap=excluded.roadmap, \
               risks=excluded.risks, path=excluded.path, last_state=excluded.last_state, \
               facts_migrated_at=excluded.facts_migrated_at, \
               decisions_migrated_at=excluded.decisions_migrated_at, updated_at=excluded.updated_at",
            params![
                p.id, p.name, p.description, p.tech_stack, p.architecture_notes, p.coding_standards,
                p.decisions, p.active_goals, p.roadmap, p.risks, p.path, p.last_state,
                p.facts_migrated_at, p.decisions_migrated_at, p.created_at, p.updated_at
            ],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })
}

/// Delete a project and everything that belonged to it.
///
/// This used to set `deleted_at` and stop there. The project vanished from the
/// list, and its facts, decisions, queued contradictions, proposals, tasks and
/// timeline stayed in the database for good — with no interface that could
/// show them and none that could remove them. The user had been asked "delete
/// this project?" and had said yes.
///
/// Telling someone their data is gone while keeping it is the kind of thing a
/// local-first, privacy-first tool has no excuse for, so the deletion is real.
/// The dependent rows go with it through the schema's own cascade rather than a
/// list of tables maintained here, which would fall behind the first time
/// somebody added one.
pub fn delete_project(id: &str) -> Result<(), String> {
    // The project's folder is the index key, so read it before the row is gone,
    // then drop the on-disk index so it does not linger as an orphan file.
    let path: Option<String> = with_conn(|c| {
        Ok(c
            .query_row("SELECT path FROM projects WHERE id = ?1", params![id], |r| {
                r.get::<_, Option<String>>(0)
            })
            .ok()
            .flatten())
    })
    .unwrap_or(None);
    let removed = with_conn(|c| crate::db::purge_project(c, id))?;
    if removed > 0 {
        eprintln!("magnetar: deleted project {id} and {removed} rows that belonged to it");
    }
    if let Some(root) = path {
        let _ = crate::index::drop_index(&root);
    }
    Ok(())
}

// --- Memory facts ---
//
// The unit of project memory. Prose in a text column could not answer the two
// questions that decide whether a coder should trust it: where did this come
// from, and is it still true? A fact answers both.

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryFact {
    pub id: String,
    pub project_id: String,
    /// stack | architecture | constraint | state — the sections already agreed.
    pub kind: String,
    pub text: String,
    /// extracted (read out of the project) | user (said so) | inferred (a model
    /// concluded it) | legacy (came from the old prose fields).
    pub origin: String,
    /// Which file, which conversation, which model — shown next to the fact.
    pub origin_detail: Option<String>,
    /// JSON spec a machine can run to confirm the fact, when one exists.
    pub verify: Option<String>,
    /// unverified | verified | stale | refuted
    pub status: String,
    pub checked_at: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
}

pub fn list_facts(project_id: &str) -> Result<Vec<MemoryFact>, String> {
    with_conn(|c| {
        let mut stmt = c
            .prepare(
                "SELECT id, project_id, kind, text, origin, origin_detail, verify, status, \
                 checked_at, created_at, updated_at \
                 FROM memory_facts \
                 WHERE project_id = ?1 AND deleted_at IS NULL \
                 ORDER BY kind ASC, created_at ASC",
            )
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map(params![project_id], |r| {
                Ok(MemoryFact {
                    id: r.get(0)?,
                    project_id: r.get(1)?,
                    kind: r.get(2)?,
                    text: r.get(3)?,
                    origin: r.get(4)?,
                    origin_detail: r.get(5)?,
                    verify: r.get(6)?,
                    status: r.get(7)?,
                    checked_at: r.get(8)?,
                    created_at: r.get(9)?,
                    updated_at: r.get(10)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    })
}

pub fn save_facts(facts: Vec<MemoryFact>) -> Result<(), String> {
    with_conn(|c| {
        // One transaction: a half-written batch would leave memory in a state
        // nobody wrote and nobody can explain.
        c.execute_batch("BEGIN").map_err(|e| e.to_string())?;
        let res = (|| -> Result<(), String> {
            for f in &facts {
                c.execute(
                    "INSERT INTO memory_facts \
                       (id, project_id, kind, text, origin, origin_detail, verify, status, \
                        checked_at, created_at, updated_at) \
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11) \
                     ON CONFLICT(id) DO UPDATE SET \
                       kind=excluded.kind, text=excluded.text, origin=excluded.origin, \
                       origin_detail=excluded.origin_detail, verify=excluded.verify, \
                       status=excluded.status, checked_at=excluded.checked_at, \
                       updated_at=excluded.updated_at, deleted_at=NULL",
                    params![
                        f.id, f.project_id, f.kind, f.text, f.origin, f.origin_detail, f.verify,
                        f.status, f.checked_at, f.created_at, f.updated_at
                    ],
                )
                .map_err(|e| e.to_string())?;
            }
            Ok(())
        })();
        match res {
            Ok(()) => {
                c.execute_batch("COMMIT").map_err(|e| e.to_string())?;
                Ok(())
            }
            Err(e) => {
                let _ = c.execute_batch("ROLLBACK");
                Err(e)
            }
        }
    })
}

pub fn delete_fact(id: &str) -> Result<(), String> {
    with_conn(|c| {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as i64;
        c.execute(
            "UPDATE memory_facts SET deleted_at = ?2 WHERE id = ?1",
            params![id, now],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })
}

// --- Decisions ---
//
// The differentiator. Half a year later the architecture is readable in the
// code; the reason it was chosen, and what was rejected on the way, exists
// nowhere unless it was written down at the moment of choosing.

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Decision {
    pub id: String,
    pub project_id: String,
    pub title: String,
    pub rationale: Option<String>,
    /// What was considered and rejected, and why.
    pub alternatives: Option<String>,
    /// JSON array of paths the decision touches.
    pub files: Option<String>,
    /// The commit the project stood at when this was decided.
    pub commit_sha: Option<String>,
    /// user | agent | legacy
    pub origin: String,
    pub created_at: i64,
}

pub fn list_decisions(project_id: &str) -> Result<Vec<Decision>, String> {
    with_conn(|c| {
        let mut stmt = c
            .prepare(
                "SELECT id, project_id, title, rationale, alternatives, files, commit_sha, \
                 origin, created_at \
                 FROM decisions \
                 WHERE project_id = ?1 AND deleted_at IS NULL \
                 ORDER BY created_at DESC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![project_id], |r| {
                Ok(Decision {
                    id: r.get(0)?,
                    project_id: r.get(1)?,
                    title: r.get(2)?,
                    rationale: r.get(3)?,
                    alternatives: r.get(4)?,
                    files: r.get(5)?,
                    commit_sha: r.get(6)?,
                    origin: r.get(7)?,
                    created_at: r.get(8)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    })
}

pub fn save_decision(d: Decision) -> Result<(), String> {
    with_conn(|c| {
        c.execute(
            "INSERT INTO decisions \
               (id, project_id, title, rationale, alternatives, files, commit_sha, origin, created_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9) \
             ON CONFLICT(id) DO UPDATE SET \
               title=excluded.title, rationale=excluded.rationale, \
               alternatives=excluded.alternatives, files=excluded.files, \
               commit_sha=excluded.commit_sha, deleted_at=NULL",
            params![
                d.id, d.project_id, d.title, d.rationale, d.alternatives, d.files, d.commit_sha,
                d.origin, d.created_at
            ],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })
}

pub fn delete_decision(id: &str) -> Result<(), String> {
    with_conn(|c| {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as i64;
        c.execute(
            "UPDATE decisions SET deleted_at = ?2 WHERE id = ?1",
            params![id, now],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })
}

// --- Divergences ---
//
// A queue, not an interruption. Everything here is a claim that memory and the
// project disagree; the human decides, in a batch, when they choose to.

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Divergence {
    pub id: String,
    pub project_id: String,
    /// The fact this contradicts, when it is about a specific one.
    pub fact_id: Option<String>,
    pub summary: String,
    /// What the fact should say instead — empty means "drop it".
    pub proposal: Option<String>,
    /// Where it was seen: a path, a line, a quote.
    pub evidence: Option<String>,
    /// agent | check — who noticed.
    pub source: String,
    /// open | applied | dismissed
    pub status: String,
    pub created_at: i64,
    pub resolved_at: Option<i64>,
}

pub fn list_divergences(project_id: &str) -> Result<Vec<Divergence>, String> {
    with_conn(|c| {
        let mut stmt = c
            .prepare(
                "SELECT id, project_id, fact_id, summary, proposal, evidence, source, status, \
                 created_at, resolved_at \
                 FROM divergences \
                 WHERE project_id = ?1 \
                 ORDER BY created_at DESC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![project_id], |r| {
                Ok(Divergence {
                    id: r.get(0)?,
                    project_id: r.get(1)?,
                    fact_id: r.get(2)?,
                    summary: r.get(3)?,
                    proposal: r.get(4)?,
                    evidence: r.get(5)?,
                    source: r.get(6)?,
                    status: r.get(7)?,
                    created_at: r.get(8)?,
                    resolved_at: r.get(9)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    })
}

pub fn save_divergence(d: Divergence) -> Result<(), String> {
    with_conn(|c| {
        c.execute(
            "INSERT INTO divergences \
               (id, project_id, fact_id, summary, proposal, evidence, source, status, \
                created_at, resolved_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10) \
             ON CONFLICT(id) DO UPDATE SET \
               summary=excluded.summary, proposal=excluded.proposal, \
               evidence=excluded.evidence, status=excluded.status, \
               resolved_at=excluded.resolved_at",
            params![
                d.id, d.project_id, d.fact_id, d.summary, d.proposal, d.evidence, d.source,
                d.status, d.created_at, d.resolved_at
            ],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })
}

// --- Proposals ---
//
// A model suggestion the user chose to fold into memory (or reject). Accepted
// ones are reviewed by an agent, which writes a verdict — fits, or conflicts
// and why.

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Proposal {
    pub id: String,
    pub project_id: String,
    pub message_id: String,
    pub text: String,
    /// accepted | rejected — the user's decision.
    pub status: String,
    /// The agent's verdict after review.
    pub review: Option<String>,
    pub created_at: i64,
    pub reviewed_at: Option<i64>,
}

pub fn list_proposals(project_id: &str) -> Result<Vec<Proposal>, String> {
    with_conn(|c| {
        let mut stmt = c
            .prepare(
                "SELECT id, project_id, message_id, text, status, review, created_at, reviewed_at \
                 FROM proposals \
                 WHERE project_id = ?1 \
                 ORDER BY created_at DESC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![project_id], |r| {
                Ok(Proposal {
                    id: r.get(0)?,
                    project_id: r.get(1)?,
                    message_id: r.get(2)?,
                    text: r.get(3)?,
                    status: r.get(4)?,
                    review: r.get(5)?,
                    created_at: r.get(6)?,
                    reviewed_at: r.get(7)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    })
}

pub fn save_proposal(p: Proposal) -> Result<(), String> {
    with_conn(|c| {
        c.execute(
            "INSERT INTO proposals \
               (id, project_id, message_id, text, status, review, created_at, reviewed_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8) \
             ON CONFLICT(id) DO UPDATE SET \
               status=excluded.status, review=excluded.review, \
               reviewed_at=excluded.reviewed_at",
            params![
                p.id, p.project_id, p.message_id, p.text, p.status, p.review, p.created_at,
                p.reviewed_at
            ],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })
}

// --- Tasks ---

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: String,
    pub project_id: String,
    pub title: String,
    pub description: Option<String>,
    pub status: String,
    pub priority: String,
    pub owner: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

pub fn list_tasks(project_id: &str) -> Result<Vec<Task>, String> {
    with_conn(|c| {
        let mut stmt = c.prepare(
            "SELECT id, project_id, title, description, status, priority, owner, created_at, updated_at \
             FROM tasks \
             WHERE project_id = ?1 AND deleted_at IS NULL \
             ORDER BY created_at DESC"
        ).map_err(|e| e.to_string())?;
        
        let rows = stmt.query_map(params![project_id], |r| {
            Ok(Task {
                id: r.get(0)?,
                project_id: r.get(1)?,
                title: r.get(2)?,
                description: r.get(3)?,
                status: r.get(4)?,
                priority: r.get(5)?,
                owner: r.get(6)?,
                created_at: r.get(7)?,
                updated_at: r.get(8)?,
            })
        }).map_err(|e| e.to_string())?;
        
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    })
}

pub fn save_task(t: Task) -> Result<(), String> {
    with_conn(|c| {
        c.execute(
            "INSERT INTO tasks \
               (id, project_id, title, description, status, priority, owner, created_at, updated_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9) \
             ON CONFLICT(id) DO UPDATE SET \
               title=excluded.title, description=excluded.description, status=excluded.status, \
               priority=excluded.priority, owner=excluded.owner, updated_at=excluded.updated_at",
            params![
                t.id, t.project_id, t.title, t.description, t.status, t.priority, t.owner, t.created_at, t.updated_at
            ],
        ).map_err(|e| e.to_string())?;
        Ok(())
    })
}

pub fn delete_task(id: &str) -> Result<(), String> {
    with_conn(|c| {
        let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() as i64;
        c.execute("UPDATE tasks SET deleted_at = ?2 WHERE id = ?1", params![id, now])
            .map_err(|e| e.to_string())?;
        Ok(())
    })
}

// --- Knowledge Nodes ---

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeNode {
    pub id: String,
    pub project_id: String,
    pub title: String,
    pub node_type: String,
    pub summary: Option<String>,
    pub metadata: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

pub fn list_knowledge_nodes(project_id: &str) -> Result<Vec<KnowledgeNode>, String> {
    with_conn(|c| {
        let mut stmt = c.prepare(
            "SELECT id, project_id, title, node_type, summary, metadata, created_at, updated_at \
             FROM knowledge_nodes \
             WHERE project_id = ?1 AND deleted_at IS NULL"
        ).map_err(|e| e.to_string())?;
        
        let rows = stmt.query_map(params![project_id], |r| {
            Ok(KnowledgeNode {
                id: r.get(0)?,
                project_id: r.get(1)?,
                title: r.get(2)?,
                node_type: r.get(3)?,
                summary: r.get(4)?,
                metadata: r.get(5)?,
                created_at: r.get(6)?,
                updated_at: r.get(7)?,
            })
        }).map_err(|e| e.to_string())?;
        
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    })
}

pub fn save_knowledge_node(n: KnowledgeNode) -> Result<(), String> {
    with_conn(|c| {
        c.execute(
            "INSERT INTO knowledge_nodes \
               (id, project_id, title, node_type, summary, metadata, created_at, updated_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8) \
             ON CONFLICT(id) DO UPDATE SET \
               title=excluded.title, node_type=excluded.node_type, summary=excluded.summary, \
               metadata=excluded.metadata, updated_at=excluded.updated_at",
            params![
                n.id, n.project_id, n.title, n.node_type, n.summary, n.metadata, n.created_at, n.updated_at
            ],
        ).map_err(|e| e.to_string())?;
        Ok(())
    })
}

// --- Knowledge Edges ---

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeEdge {
    pub source: String,
    pub target: String,
    pub relation: String,
}

pub fn list_knowledge_edges(project_id: &str) -> Result<Vec<KnowledgeEdge>, String> {
    with_conn(|c| {
        // Find edges where source is part of the project
        let mut stmt = c.prepare(
            "SELECT e.source, e.target, e.relation \
             FROM knowledge_edges e \
             JOIN knowledge_nodes n ON e.source = n.id \
             WHERE n.project_id = ?1 AND n.deleted_at IS NULL"
        ).map_err(|e| e.to_string())?;
        
        let rows = stmt.query_map(params![project_id], |r| {
            Ok(KnowledgeEdge {
                source: r.get(0)?,
                target: r.get(1)?,
                relation: r.get(2)?,
            })
        }).map_err(|e| e.to_string())?;
        
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    })
}

pub fn save_knowledge_edge(e: KnowledgeEdge) -> Result<(), String> {
    with_conn(|c| {
        c.execute(
            "INSERT OR IGNORE INTO knowledge_edges (source, target, relation) \
             VALUES (?1, ?2, ?3)",
            params![e.source, e.target, e.relation],
        ).map_err(|e| e.to_string())?;
        Ok(())
    })
}

// --- Timeline Events ---

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimelineEvent {
    pub id: String,
    pub project_id: String,
    pub event_type: String,
    pub content: String,
    pub created_at: i64,
}

pub fn list_timeline_events(project_id: &str) -> Result<Vec<TimelineEvent>, String> {
    with_conn(|c| {
        let mut stmt = c.prepare(
            "SELECT id, project_id, event_type, content, created_at \
             FROM timeline_events \
             WHERE project_id = ?1 \
             ORDER BY created_at DESC"
        ).map_err(|e| e.to_string())?;
        
        let rows = stmt.query_map(params![project_id], |r| {
            Ok(TimelineEvent {
                id: r.get(0)?,
                project_id: r.get(1)?,
                event_type: r.get(2)?,
                content: r.get(3)?,
                created_at: r.get(4)?,
            })
        }).map_err(|e| e.to_string())?;
        
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    })
}

pub fn save_timeline_event(t: TimelineEvent) -> Result<(), String> {
    with_conn(|c| {
        c.execute(
            "INSERT INTO timeline_events (id, project_id, event_type, content, created_at) \
             VALUES (?1, ?2, ?3, ?4, ?5) \
             ON CONFLICT(id) DO NOTHING",
            params![t.id, t.project_id, t.event_type, t.content, t.created_at],
        ).map_err(|e| e.to_string())?;
        Ok(())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// One test, not five: `db::init` installs a process-wide connection, so
    /// every test in this binary would share whatever the first one opened.
    ///
    /// What is being guarded here is the class of bug the compiler cannot see —
    /// a column added to `projects` without shifting every positional index in
    /// the SELECT and every `?N` in the INSERT. That silently reads the wrong
    /// field rather than failing to build, which is exactly how `DirEntry`
    /// started reporting folders as files.
    #[test]
    fn memory_tables_round_trip() {
        let dir = std::env::temp_dir().join(format!("magnetar-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        crate::db::init(&dir).expect("init");

        let now = 1_700_000_000_000i64;
        let project = Project {
            id: "p1".into(),
            name: "Test".into(),
            description: Some("desc".into()),
            tech_stack: Some("legacy stack".into()),
            architecture_notes: None,
            coding_standards: None,
            decisions: Some("legacy decision".into()),
            active_goals: None,
            roadmap: None,
            risks: None,
            path: Some("/tmp/test".into()),
            last_state: Some("stopped here".into()),
            facts_migrated_at: Some(now),
            decisions_migrated_at: None,
            created_at: now,
            updated_at: now,
        };
        save_project(project.clone()).expect("save project");

        let back = list_projects().expect("list").into_iter().next().expect("one project");
        // Every field must survive the round trip in its own column.
        assert_eq!(back.name, "Test");
        assert_eq!(back.path.as_deref(), Some("/tmp/test"));
        assert_eq!(back.last_state.as_deref(), Some("stopped here"));
        assert_eq!(back.facts_migrated_at, Some(now));
        assert_eq!(back.decisions_migrated_at, None);
        assert_eq!(back.created_at, now);
        assert_eq!(back.updated_at, now);

        // Facts: insert a batch, then update one of them by id.
        let fact = MemoryFact {
            id: "f1".into(),
            project_id: "p1".into(),
            kind: "stack".into(),
            text: "SQLite via rusqlite".into(),
            origin: "extracted".into(),
            origin_detail: Some("Cargo.toml".into()),
            verify: Some(r#"{"kind":"grep","pattern":"rusqlite","file":"Cargo.toml"}"#.into()),
            status: "unverified".into(),
            checked_at: None,
            created_at: now,
            updated_at: now,
        };
        save_facts(vec![
            fact.clone(),
            MemoryFact { id: "f2".into(), text: "second".into(), ..fact.clone() },
        ])
        .expect("save facts");
        assert_eq!(list_facts("p1").expect("list facts").len(), 2);

        save_facts(vec![MemoryFact {
            status: "verified".into(),
            checked_at: Some(now + 1),
            ..fact.clone()
        }])
        .expect("update fact");
        let facts = list_facts("p1").expect("list facts");
        assert_eq!(facts.len(), 2, "updating by id must not insert a duplicate");
        let f1 = facts.iter().find(|f| f.id == "f1").expect("f1");
        assert_eq!(f1.status, "verified");
        assert_eq!(f1.checked_at, Some(now + 1));
        assert_eq!(f1.origin_detail.as_deref(), Some("Cargo.toml"));

        delete_fact("f1").expect("delete");
        let left = list_facts("p1").expect("list facts");
        assert_eq!(left.len(), 1, "a deleted fact must stay deleted");
        assert_eq!(left[0].id, "f2");

        // Decisions and divergences: the same shape, and both must filter by
        // project so one project's memory never leaks into another's prompt.
        save_decision(Decision {
            id: "d1".into(),
            project_id: "p1".into(),
            title: "Use SQLite".into(),
            rationale: Some("local, no server".into()),
            alternatives: Some("Postgres".into()),
            files: Some(r#"["src-tauri/src/db.rs"]"#.into()),
            commit_sha: Some("abc1234".into()),
            origin: "user".into(),
            created_at: now,
        })
        .expect("save decision");
        // A second, real project. It used to be a bare string: the isolation
        // assertions below wrote rows for a project that did not exist, which
        // the schema now refuses — correctly, because a decision belonging to
        // no project is not a decision about anything.
        save_project(Project {
            id: "other".into(),
            name: "Other".into(),
            ..project.clone()
        })
        .expect("save other project");

        save_decision(Decision {
            id: "d2".into(),
            project_id: "other".into(),
            title: "Someone else's".into(),
            rationale: None,
            alternatives: None,
            files: None,
            commit_sha: None,
            origin: "agent".into(),
            created_at: now,
        })
        .expect("save decision 2");

        let decisions = list_decisions("p1").expect("list decisions");
        assert_eq!(decisions.len(), 1, "decisions must not cross projects");
        assert_eq!(decisions[0].commit_sha.as_deref(), Some("abc1234"));
        assert_eq!(decisions[0].alternatives.as_deref(), Some("Postgres"));

        save_divergence(Divergence {
            id: "v1".into(),
            project_id: "p1".into(),
            fact_id: Some("f2".into()),
            summary: "memory says X, code shows Y".into(),
            proposal: Some("Y".into()),
            evidence: Some("src/main.rs:12".into()),
            source: "agent".into(),
            status: "open".into(),
            created_at: now,
            resolved_at: None,
        })
        .expect("save divergence");
        save_divergence(Divergence {
            id: "v1".into(),
            project_id: "p1".into(),
            fact_id: Some("f2".into()),
            summary: "memory says X, code shows Y".into(),
            proposal: Some("Y".into()),
            evidence: Some("src/main.rs:12".into()),
            source: "agent".into(),
            status: "applied".into(),
            created_at: now,
            resolved_at: Some(now + 2),
        })
        .expect("resolve divergence");

        let queue = list_divergences("p1").expect("list divergences");
        assert_eq!(queue.len(), 1, "resolving must update, not duplicate");
        assert_eq!(queue[0].status, "applied");
        assert_eq!(queue[0].resolved_at, Some(now + 2));
        assert_eq!(queue[0].fact_id.as_deref(), Some("f2"));

        let _ = std::fs::remove_dir_all(&dir);
    }
}
