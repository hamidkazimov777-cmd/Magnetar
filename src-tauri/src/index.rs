//! Persistent, incremental code index over a workspace, backed by SQLite FTS5.
//!
//! ## What changed, and why
//!
//! The old index was in memory, rebuilt from scratch every time the workspace
//! root changed, and capped at 5,000 files. On anything larger than a toy that
//! is three separate failures: the work is redone on every open, the cap
//! silently hides half a real repository, and a rebuild blocks while it reads
//! every file.
//!
//! This keeps the index on disk, one small database per workspace, and updates
//! only what changed. A file is re-read when its size or mtime differs from
//! what was stored, and dropped when it disappears — so opening a project the
//! second time costs a directory walk, not a full re-read, and there is no cap.
//!
//! Ranking and matching are FTS5's, which is BM25 done by people who do this
//! for a living, rather than the hand-rolled scorer this replaces.
//!
//! ## Respecting the project's own rules
//!
//! Walking uses the `ignore` crate — ripgrep's — so `.gitignore`, `.ignore`
//! and nested ignore files are honoured for free. Indexing `node_modules` or a
//! `target/` directory is not just slow, it buries the ten files someone wants
//! under ten thousand they do not.

use ignore::WalkBuilder;
use once_cell::sync::Lazy;
use rusqlite::{params, Connection};
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

const MAX_FILE_BYTES: u64 = 1_000_000;

/// One open index database per workspace root, keyed by the canonical root.
static INDEXES: Lazy<Mutex<HashMap<String, Connection>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

/// Where index databases live: alongside the app's other data, named by a hash
/// of the root so two workspaces never collide and neither leaks into the
/// canon database.
static INDEX_DIR: Lazy<Mutex<Option<PathBuf>>> = Lazy::new(|| Mutex::new(None));

pub fn init(app_dir: &Path) {
    let dir = app_dir.join("index");
    let _ = std::fs::create_dir_all(&dir);
    if let Ok(mut d) = INDEX_DIR.lock() {
        *d = Some(dir);
    }
}

#[derive(Serialize)]
pub struct IndexStats {
    /// Files currently in the index.
    pub files: usize,
    /// Files added or updated in this sync.
    pub changed: usize,
    /// Files removed in this sync (deleted or newly ignored).
    pub removed: usize,
    /// Files skipped for being too large or binary, so coverage is honest.
    pub skipped: usize,
}

#[derive(Serialize)]
pub struct SearchHit {
    pub file: String,
    pub score: f32,
    pub snippet: String,
    pub line: usize,
}

fn db_path_for(root: &str) -> Result<PathBuf, String> {
    let dir = INDEX_DIR
        .lock()
        .ok()
        .and_then(|d| d.clone())
        .ok_or("index dir not initialised")?;
    // A stable, filesystem-safe name from the root. Not cryptographic — just a
    // collision-resistant handle so two roots get two files.
    let mut hash: u64 = 1469598103934665603;
    for b in root.bytes() {
        hash ^= b as u64;
        hash = hash.wrapping_mul(1099511628211);
    }
    Ok(dir.join(format!("idx-{hash:016x}.sqlite")))
}

fn open_index(root: &str) -> Result<Connection, String> {
    let path = db_path_for(root)?;
    let conn = Connection::open(path).map_err(|e| e.to_string())?;
    conn.execute_batch(
        r#"
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;
        -- The file catalogue: what we have indexed and its fingerprint, so a
        -- re-sync can tell what changed without reading the file.
        CREATE TABLE IF NOT EXISTS files (
            path  TEXT PRIMARY KEY,
            size  INTEGER NOT NULL,
            mtime INTEGER NOT NULL
        );
        -- The searchable content. This is an ordinary (not contentless) FTS5
        -- table: `body` is indexed and also stored in FTS5's shadow tables, so
        -- matching needs no second lookup. `path` is stored UNINDEXED so a hit
        -- carries its file without a join.
        CREATE VIRTUAL TABLE IF NOT EXISTS docs USING fts5(
            path UNINDEXED,
            body,
            tokenize = 'unicode61'
        );
        "#,
    )
    .map_err(|e| e.to_string())?;
    Ok(conn)
}

/// Get the open connection for a root, opening it once and caching it.
fn with_index<T>(root: &str, f: impl FnOnce(&Connection) -> Result<T, String>) -> Result<T, String> {
    let mut map = INDEXES.lock().map_err(|e| e.to_string())?;
    if !map.contains_key(root) {
        map.insert(root.to_string(), open_index(root)?);
    }
    f(map.get(root).expect("just inserted"))
}

fn is_texty(name: &str) -> bool {
    const BIN: [&str; 22] = [
        "png", "jpg", "jpeg", "gif", "webp", "ico", "pdf", "zip", "gz", "tar", "mp4", "mov",
        "mp3", "wav", "woff", "woff2", "ttf", "otf", "lock", "min", "map", "wasm",
    ];
    let ext = name.rsplit('.').next().unwrap_or("").to_lowercase();
    !BIN.contains(&ext.as_str())
}

/// Walk the workspace with the project's ignore rules and return every file
/// worth indexing, with its size and mtime.
fn walk(root: &str) -> Vec<(String, u64, i64)> {
    let mut out = Vec::new();
    // `WalkBuilder` reads .gitignore/.ignore, skips hidden files, and does not
    // descend into ignored directories — so node_modules never even opens.
    let walker = WalkBuilder::new(root)
        .hidden(true)
        .git_ignore(true)
        .git_global(true)
        .git_exclude(true)
        // Honour .gitignore even when the folder is not (yet) a git repo:
        // people clone, read, and edit before `git init`, and the ignore file
        // is right there saying what not to index.
        .require_git(false)
        .parents(true)
        .build();
    for entry in walker.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let name = entry.file_name().to_string_lossy();
        if !is_texty(&name) {
            continue;
        }
        let Ok(meta) = entry.metadata() else { continue };
        let size = meta.len();
        let mtime = meta
            .modified()
            .ok()
            .and_then(|m| m.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);
        out.push((path.to_string_lossy().into_owned(), size, mtime));
    }
    out
}

/// Bring the index for `root` up to date, reading only what changed.
pub fn sync(root: &str) -> Result<IndexStats, String> {
    let found = walk(root);
    with_index(root, |conn| {
        // What we already have, so we can tell changed from unchanged from gone.
        let mut stored: HashMap<String, (u64, i64)> = HashMap::new();
        {
            let mut stmt = conn
                .prepare("SELECT path, size, mtime FROM files")
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map([], |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        (r.get::<_, i64>(1)? as u64, r.get::<_, i64>(2)?),
                    ))
                })
                .map_err(|e| e.to_string())?;
            for row in rows.flatten() {
                stored.insert(row.0, row.1);
            }
        }

        let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
        let mut changed = 0;
        let mut skipped = 0;
        let seen: std::collections::HashSet<&str> =
            found.iter().map(|(p, _, _)| p.as_str()).collect();

        for (path, size, mtime) in &found {
            if *size > MAX_FILE_BYTES {
                skipped += 1;
                continue;
            }
            // Unchanged: same size and mtime as stored. The cheap fingerprint is
            // enough — a file edited without changing size keeps its mtime only
            // if nothing wrote it, which does not happen.
            let known = stored.get(path);
            if let Some((s, m)) = known {
                if *s == *size && *m == *mtime {
                    continue;
                }
            }
            let Ok(body) = std::fs::read_to_string(path) else {
                skipped += 1;
                continue;
            };
            // Replace any existing row for this path, then re-insert. `docs` is
            // an FTS5 table, and `DELETE ... WHERE path = ?` cannot use an index
            // there — it scans. On an initial sync every file is new, so doing
            // that delete for all of them was a scan of an ever-growing index
            // per file: quadratic, and the reason a 50k-file first build took
            // minutes. Only delete when the path was actually stored before.
            if known.is_some() {
                tx.execute("DELETE FROM docs WHERE path = ?1", params![path])
                    .map_err(|e| e.to_string())?;
            }
            tx.execute(
                "INSERT INTO docs (path, body) VALUES (?1, ?2)",
                params![path, body],
            )
            .map_err(|e| e.to_string())?;
            tx.execute(
                "INSERT INTO files (path, size, mtime) VALUES (?1, ?2, ?3)
                 ON CONFLICT(path) DO UPDATE SET size = excluded.size, mtime = excluded.mtime",
                params![path, *size as i64, mtime],
            )
            .map_err(|e| e.to_string())?;
            changed += 1;
        }

        // Anything stored but no longer walked was deleted or newly ignored.
        let mut removed = 0;
        for path in stored.keys() {
            if !seen.contains(path.as_str()) {
                tx.execute("DELETE FROM docs WHERE path = ?1", params![path])
                    .map_err(|e| e.to_string())?;
                tx.execute("DELETE FROM files WHERE path = ?1", params![path])
                    .map_err(|e| e.to_string())?;
                removed += 1;
            }
        }

        tx.commit().map_err(|e| e.to_string())?;

        let files: usize = conn
            .query_row("SELECT count(*) FROM files", [], |r| r.get::<_, i64>(0))
            .map_err(|e| e.to_string())? as usize;

        Ok(IndexStats { files, changed, removed, skipped })
    })
}

/// Search the index. Falls back to a fresh sync if the index is empty, so the
/// first search after opening a project still works without a separate build.
pub fn search(root: &str, query: &str, top_k: usize) -> Result<Vec<SearchHit>, String> {
    let empty = with_index(root, |conn| {
        conn.query_row("SELECT count(*) FROM files", [], |r| r.get::<_, i64>(0))
            .map(|n| n == 0)
            .map_err(|e| e.to_string())
    })?;
    if empty {
        sync(root)?;
    }

    let terms = sanitize_query(query);
    if terms.is_empty() {
        return Ok(Vec::new());
    }

    with_index(root, |conn| {
        let mut stmt = conn
            .prepare(
                "SELECT path, bm25(docs) AS score FROM docs
                 WHERE docs MATCH ?1 ORDER BY score LIMIT ?2",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![terms, top_k as i64], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, f64>(1)?))
            })
            .map_err(|e| e.to_string())?;

        let mut hits = Vec::new();
        for row in rows.flatten() {
            let (path, score) = row;
            let (snippet, line) = best_snippet(&path, query);
            hits.push(SearchHit {
                file: path,
                // bm25 returns lower-is-better; flip it so the frontend's
                // "higher is more relevant" holds as it did before.
                score: -score as f32,
                snippet,
                line,
            });
        }
        Ok(hits)
    })
}

/// Turn a user query into an FTS5 MATCH expression that cannot be a syntax
/// error. A raw query with an unbalanced quote or a bare `AND` throws; wrapping
/// each word as a quoted term and joining with OR matches "any of these words",
/// which is what a code search means.
fn sanitize_query(query: &str) -> String {
    query
        .split(|c: char| !c.is_alphanumeric() && c != '_')
        .filter(|w| w.len() >= 2)
        .map(|w| format!("\"{}\"", w.replace('"', "")))
        .collect::<Vec<_>>()
        .join(" OR ")
}

fn best_snippet(path: &str, query: &str) -> (String, usize) {
    let Ok(content) = std::fs::read_to_string(path) else {
        return (String::new(), 0);
    };
    let needles: Vec<String> = query
        .split(|c: char| !c.is_alphanumeric() && c != '_')
        .filter(|w| w.len() >= 2)
        .map(|w| w.to_lowercase())
        .collect();
    for (i, line) in content.lines().enumerate() {
        let low = line.to_lowercase();
        if needles.iter().any(|t| low.contains(t.as_str())) {
            let trimmed = line.trim();
            let s = trimmed.chars().take(200).collect::<String>();
            return (s, i + 1);
        }
    }
    (String::new(), 0)
}

/// Flat list of project files, repo-relative, for the composer's `@` picker.
/// Uses the same ignore-aware walk, so it matches what the index sees.
pub fn list_files(root: &str) -> Result<Vec<String>, String> {
    let base = Path::new(root);
    if !base.is_dir() {
        return Err(format!("{root}: not a directory"));
    }
    let prefix = format!("{}/", root.trim_end_matches('/'));
    Ok(walk(root)
        .into_iter()
        .map(|(p, _, _)| p.strip_prefix(&prefix).unwrap_or(&p).to_string())
        .collect())
}

/// Forget a workspace's index — used when a project is deleted so its index
/// file does not linger.
pub fn drop_index(root: &str) -> Result<(), String> {
    if let Ok(mut map) = INDEXES.lock() {
        map.remove(root);
    }
    if let Ok(path) = db_path_for(root) {
        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_file(path.with_extension("sqlite-wal"));
        let _ = std::fs::remove_file(path.with_extension("sqlite-shm"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    static SERIAL: Mutex<()> = Mutex::new(());
    fn serial() -> std::sync::MutexGuard<'static, ()> { SERIAL.lock().unwrap_or_else(|e| e.into_inner()) }
    static COUNTER: AtomicUsize = AtomicUsize::new(0);

    struct Fixture {
        work: PathBuf,
        index: PathBuf,
    }
    impl Fixture {
        fn new() -> Self {
            let n = COUNTER.fetch_add(1, Ordering::Relaxed);
            let base = std::env::temp_dir().join(format!("magnetar-idx-{}-{}", std::process::id(), n));
            // The workspace and the index live in sibling directories, never
            // nested — an index dir inside the workspace would index its own
            // database files, and a WAL write would then look like a change.
            let work = base.join("work");
            let index = base.join("index");
            let _ = std::fs::remove_dir_all(&base);
            std::fs::create_dir_all(&work).unwrap();
            std::fs::create_dir_all(&index).unwrap();
            *INDEX_DIR.lock().unwrap_or_else(|e| e.into_inner()) = Some(index.clone());
            Self { work, index }
        }
        fn write(&self, rel: &str, body: &str) {
            let p = self.work.join(rel);
            if let Some(parent) = p.parent() {
                std::fs::create_dir_all(parent).unwrap();
            }
            std::fs::write(p, body).unwrap();
        }
        fn remove(&self, rel: &str) {
            let _ = std::fs::remove_file(self.work.join(rel));
        }
        fn root(&self) -> String {
            self.work.to_string_lossy().into_owned()
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            if let Ok(mut m) = INDEXES.lock() { m.remove(&self.root()); }
            let _ = std::fs::remove_dir_all(self.work.parent().unwrap_or(&self.work));
            let _ = &self.index;
        }
    }

    #[test]
    fn indexes_and_finds_a_file() {
        let _g = serial();
        let fx = Fixture::new();
        fx.write("src/main.rs", "fn open_workspace() { let rusqlite_conn = 1; }");
        fx.write("src/other.rs", "fn unrelated() {}");

        let stats = sync(&fx.root()).unwrap();
        assert_eq!(stats.files, 2);
        assert_eq!(stats.changed, 2);

        let hits = search(&fx.root(), "rusqlite_conn", 5).unwrap();
        assert_eq!(hits.len(), 1);
        assert!(hits[0].file.ends_with("main.rs"));
        assert_eq!(hits[0].line, 1);
        drop_index(&fx.root()).unwrap();
    }

    #[test]
    fn a_second_sync_only_touches_what_changed() {
        let _g = serial();
        let fx = Fixture::new();
        fx.write("a.rs", "fn a() {}");
        fx.write("b.rs", "fn b() {}");
        sync(&fx.root()).unwrap();

        // Nothing changed: a re-sync reads nothing.
        let again = sync(&fx.root()).unwrap();
        assert_eq!(again.changed, 0);
        assert_eq!(again.files, 2);

        // Change one file; only it is re-indexed.
        std::thread::sleep(std::time::Duration::from_millis(1100));
        fx.write("a.rs", "fn a() { let changed_token = 2; }");
        let third = sync(&fx.root()).unwrap();
        assert_eq!(third.changed, 1);
        assert_eq!(search(&fx.root(), "changed_token", 5).unwrap().len(), 1);
        drop_index(&fx.root()).unwrap();
    }

    #[test]
    fn a_deleted_file_leaves_the_index() {
        let _g = serial();
        let fx = Fixture::new();
        fx.write("gone.rs", "fn gone_marker() {}");
        fx.write("kept.rs", "fn kept() {}");
        sync(&fx.root()).unwrap();
        assert_eq!(search(&fx.root(), "gone_marker", 5).unwrap().len(), 1);

        fx.remove("gone.rs");
        let stats = sync(&fx.root()).unwrap();
        assert_eq!(stats.removed, 1);
        assert_eq!(stats.files, 1);
        assert!(search(&fx.root(), "gone_marker", 5).unwrap().is_empty());
        drop_index(&fx.root()).unwrap();
    }

    #[test]
    fn gitignored_files_are_not_indexed() {
        let _g = serial();
        let fx = Fixture::new();
        fx.write(".gitignore", "secret.rs\nbuild/\n");
        fx.write("secret.rs", "fn secret_token() {}");
        fx.write("build/out.rs", "fn built_token() {}");
        fx.write("src/real.rs", "fn real_token() {}");

        sync(&fx.root()).unwrap();
        assert!(search(&fx.root(), "secret_token", 5).unwrap().is_empty());
        assert!(search(&fx.root(), "built_token", 5).unwrap().is_empty());
        assert_eq!(search(&fx.root(), "real_token", 5).unwrap().len(), 1);
        drop_index(&fx.root()).unwrap();
    }

    #[test]
    fn a_dangerous_query_does_not_throw() {
        let _g = serial();
        let fx = Fixture::new();
        fx.write("a.rs", "fn find_me() {}");
        sync(&fx.root()).unwrap();
        // Unbalanced quotes and FTS operators used to be a syntax error.
        assert!(search(&fx.root(), "\"unbalanced", 5).is_ok());
        assert!(search(&fx.root(), "AND OR NOT", 5).is_ok());
        assert_eq!(search(&fx.root(), "find_me", 5).unwrap().len(), 1);
        drop_index(&fx.root()).unwrap();
    }

    #[test]
    fn there_is_no_file_cap() {
        let _g = serial();
        let fx = Fixture::new();
        for i in 0..6000 {
            fx.write(&format!("f{i}.rs"), &format!("fn f{i}() {{}}"));
        }
        let stats = sync(&fx.root()).unwrap();
        // The old index stopped at 5,000; this must see them all.
        assert_eq!(stats.files, 6000);
        drop_index(&fx.root()).unwrap();
    }

    /// A real scale bench, not a unit test — `#[ignore]` so the normal suite
    /// stays fast. Run it to turn the scale *targets* in QUALITY_GATES into
    /// measurements:
    ///
    ///   cargo test --manifest-path src-tauri/Cargo.toml -- --ignored --nocapture bench_index_scale
    ///
    /// File count defaults to 50k; set MAGNETAR_BENCH_FILES=100000 for the
    /// larger target. Files are spread across 200 directories so the walk is
    /// realistic rather than one giant folder.
    #[test]
    #[ignore]
    fn bench_index_scale() {
        use std::time::Instant;
        let _g = serial();
        let n: usize = std::env::var("MAGNETAR_BENCH_FILES")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(50_000);
        let dirs = 200;
        let fx = Fixture::new();

        let t_write = Instant::now();
        for i in 0..n {
            fx.write(
                &format!("d{}/f{i}.rs", i % dirs),
                &format!("fn f{i}() {{ let needle_{i} = {i}; }}\n// token_common here\n"),
            );
        }
        let write_ms = t_write.elapsed().as_millis();

        let t_sync = Instant::now();
        let stats = sync(&fx.root()).unwrap();
        let sync_ms = t_sync.elapsed().as_millis();
        assert_eq!(stats.files, n);

        // A no-change re-sync: the incremental path (size+mtime), which is what a
        // branch switch or a save triggers, not a full rebuild.
        let t_resync = Instant::now();
        let restats = sync(&fx.root()).unwrap();
        let resync_ms = t_resync.elapsed().as_millis();
        assert_eq!(restats.files, n);

        // A handful of queries: a rare token (one hit) and a common one (capped).
        let t_q = Instant::now();
        let rare = search(&fx.root(), "needle_42", 10).unwrap();
        let common = search(&fx.root(), "token_common", 20).unwrap();
        let query_ms = t_q.elapsed().as_millis();
        assert_eq!(rare.len(), 1);
        assert!(!common.is_empty());

        eprintln!(
            "\n=== index scale bench: {n} files across {dirs} dirs ===\n\
             write fixture : {write_ms} ms\n\
             initial sync  : {sync_ms} ms\n\
             no-op re-sync : {resync_ms} ms\n\
             2 queries     : {query_ms} ms\n",
        );
        drop_index(&fx.root()).unwrap();
    }

    #[test]
    fn list_files_is_repo_relative_and_ignore_aware() {
        let _g = serial();
        let fx = Fixture::new();
        fx.write(".gitignore", "ignored.rs\n");
        fx.write("src/a.rs", "");
        fx.write("ignored.rs", "");
        let mut files = list_files(&fx.root()).unwrap();
        files.sort();
        // .gitignore is a dotfile and skipped like ripgrep skips hidden files;
        // ignored.rs is skipped because the .gitignore says so.
        assert_eq!(files, vec!["src/a.rs".to_string()]);
        drop_index(&fx.root()).unwrap();
    }
}

/* --------------------------------------------------------------------------
   WATCHING FOR CHANGES

   The index is incremental, but something has to notice a file changed. A
   watcher on the workspace root does — coalescing a burst of events (a git
   checkout touches thousands of files at once) into one debounced re-sync, so
   the index follows the tree without the user pressing a button and without a
   rebuild storm during a branch switch.
   -------------------------------------------------------------------------- */

use notify::{RecursiveMode, Watcher};

static WATCHERS: Lazy<Mutex<HashMap<String, notify::RecommendedWatcher>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

/// Start watching a workspace, re-syncing its index shortly after changes stop.
///
/// One watcher per root; starting again replaces the old one. The debounce is
/// what keeps a `git checkout` — which fires an event per file — from becoming
/// a thousand syncs.
pub fn watch(root: &str) -> Result<(), String> {
    let root_owned = root.to_string();
    let (tx, rx) = std::sync::mpsc::channel::<()>();

    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        if let Ok(event) = res {
            // Only content-changing events are worth a re-sync; access-time
            // touches and metadata reads are not.
            use notify::EventKind::*;
            if matches!(event.kind, Create(_) | Modify(_) | Remove(_)) {
                let _ = tx.send(());
            }
        }
    })
    .map_err(|e| e.to_string())?;

    watcher
        .watch(Path::new(root), RecursiveMode::Recursive)
        .map_err(|e| e.to_string())?;

    WATCHERS
        .lock()
        .map_err(|e| e.to_string())?
        .insert(root_owned.clone(), watcher);

    // The debounce loop: drain the channel, wait for quiet, then sync once.
    std::thread::spawn(move || {
        while rx.recv().is_ok() {
            // Collect everything that arrives within the settle window, then
            // sync a single time for the whole burst.
            loop {
                match rx.recv_timeout(std::time::Duration::from_millis(400)) {
                    Ok(()) => continue,
                    Err(_) => break,
                }
            }
            // If the watcher was dropped (workspace closed), stop.
            if WATCHERS
                .lock()
                .map(|m| !m.contains_key(&root_owned))
                .unwrap_or(true)
            {
                break;
            }
            let _ = sync(&root_owned);
        }
    });

    Ok(())
}

/// Stop watching a workspace (folder closed).
pub fn unwatch(root: &str) {
    if let Ok(mut m) = WATCHERS.lock() {
        m.remove(root);
    }
}
