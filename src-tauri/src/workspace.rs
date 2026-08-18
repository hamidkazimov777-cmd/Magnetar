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
    })
}

pub fn delete_connection(id: &str) -> Result<(), String> {
    with_conn(|c| {
        c.execute("DELETE FROM connections WHERE id = ?1", params![id])
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
    pub created_at: i64,
    pub updated_at: i64,
}

pub fn list_projects() -> Result<Vec<Project>, String> {
    with_conn(|c| {
        let mut stmt = c
            .prepare(
                "SELECT id, name, description, tech_stack, architecture_notes, coding_standards, \
                 decisions, active_goals, roadmap, risks, path, last_state, created_at, updated_at \
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
                    created_at: r.get(12)?,
                    updated_at: r.get(13)?,
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
               (id, name, description, tech_stack, architecture_notes, coding_standards, decisions, active_goals, roadmap, risks, path, last_state, created_at, updated_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14) \
             ON CONFLICT(id) DO UPDATE SET \
               name=excluded.name, description=excluded.description, tech_stack=excluded.tech_stack, \
               architecture_notes=excluded.architecture_notes, coding_standards=excluded.coding_standards, \
               decisions=excluded.decisions, active_goals=excluded.active_goals, roadmap=excluded.roadmap, \
               risks=excluded.risks, path=excluded.path, last_state=excluded.last_state, updated_at=excluded.updated_at",
            params![
                p.id, p.name, p.description, p.tech_stack, p.architecture_notes, p.coding_standards,
                p.decisions, p.active_goals, p.roadmap, p.risks, p.path, p.last_state, p.created_at, p.updated_at
            ],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })
}

pub fn delete_project(id: &str) -> Result<(), String> {
    with_conn(|c| {
        let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() as i64;
        c.execute("UPDATE projects SET deleted_at = ?2 WHERE id = ?1", params![id, now])
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
