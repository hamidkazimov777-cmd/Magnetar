//! Local codebase index for retrieval (BM25). No embeddings/network — a plain
//! in-memory inverted index over the workspace, so the agent can pull the most
//! relevant files/snippets for a query and "understand the project" fast.

use once_cell::sync::Lazy;
use serde::Serialize;
use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;

const SKIP_DIRS: [&str; 8] = [
    "node_modules",
    ".git",
    "target",
    "dist",
    ".next",
    "build",
    ".venv",
    "__pycache__",
];
const MAX_FILE_BYTES: u64 = 1_000_000;
const MAX_FILES: usize = 5000;

struct Index {
    root: String,
    /// term -> list of (doc_id, term frequency)
    postings: HashMap<String, Vec<(usize, u32)>>,
    docs: Vec<String>, // doc_id -> file path
    doc_len: Vec<u32>,
    avg_len: f32,
}

static INDEX: Lazy<Mutex<Option<Index>>> = Lazy::new(|| Mutex::new(None));

#[derive(Serialize)]
pub struct IndexStats {
    pub files: usize,
    pub terms: usize,
}

#[derive(Serialize)]
pub struct SearchHit {
    pub file: String,
    pub score: f32,
    pub snippet: String,
    pub line: usize,
}

fn tokenize(s: &str) -> Vec<String> {
    s.split(|c: char| !c.is_alphanumeric() && c != '_')
        .filter(|t| t.len() >= 2 && t.len() <= 40)
        .map(|t| t.to_lowercase())
        .collect()
}

fn is_texty(name: &str) -> bool {
    // Skip obvious binaries/assets by extension.
    const BIN: [&str; 20] = [
        "png", "jpg", "jpeg", "gif", "webp", "ico", "pdf", "zip", "gz", "tar", "mp4",
        "mov", "mp3", "wav", "woff", "woff2", "ttf", "otf", "lock", "min",
    ];
    let ext = name.rsplit('.').next().unwrap_or("").to_lowercase();
    !BIN.contains(&ext.as_str())
}

fn walk(dir: &Path, docs: &mut Vec<String>) {
    if docs.len() >= MAX_FILES {
        return;
    }
    let Ok(rd) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in rd.flatten() {
        if docs.len() >= MAX_FILES {
            return;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
        if is_dir {
            if SKIP_DIRS.contains(&name.as_str()) || name.starts_with('.') {
                continue;
            }
            walk(&entry.path(), docs);
        } else {
            if !is_texty(&name) {
                continue;
            }
            if entry.metadata().map(|m| m.len()).unwrap_or(0) > MAX_FILE_BYTES {
                continue;
            }
            docs.push(entry.path().to_string_lossy().into_owned());
        }
    }
}

/// Flat list of project files, repo-relative, for the composer's `@` picker.
/// Reuses the same skip rules as the index so `node_modules` never shows up.
pub fn list_files(root: &str) -> Result<Vec<String>, String> {
    let base = Path::new(root);
    if !base.is_dir() {
        return Err(format!("{root}: not a directory"));
    }
    let mut docs: Vec<String> = Vec::new();
    walk(base, &mut docs);
    let prefix = format!("{}/", root.trim_end_matches('/'));
    Ok(docs
        .into_iter()
        .map(|p| p.strip_prefix(&prefix).unwrap_or(&p).to_string())
        .collect())
}

pub fn build(root: &str) -> Result<IndexStats, String> {
    let mut docs: Vec<String> = Vec::new();
    walk(Path::new(root), &mut docs);

    let mut postings: HashMap<String, Vec<(usize, u32)>> = HashMap::new();
    let mut doc_len: Vec<u32> = Vec::with_capacity(docs.len());
    let mut total_len: u64 = 0;

    for (id, path) in docs.iter().enumerate() {
        let Ok(content) = std::fs::read_to_string(path) else {
            doc_len.push(0);
            continue;
        };
        let mut tf: HashMap<String, u32> = HashMap::new();
        for tok in tokenize(&content) {
            *tf.entry(tok).or_insert(0) += 1;
        }
        let len: u32 = tf.values().sum();
        doc_len.push(len);
        total_len += len as u64;
        for (term, count) in tf {
            postings.entry(term).or_default().push((id, count));
        }
    }

    let avg_len = if docs.is_empty() {
        0.0
    } else {
        total_len as f32 / docs.len() as f32
    };

    let stats = IndexStats {
        files: docs.len(),
        terms: postings.len(),
    };
    *INDEX.lock().map_err(|e| e.to_string())? = Some(Index {
        root: root.to_string(),
        postings,
        docs,
        doc_len,
        avg_len,
    });
    Ok(stats)
}

pub fn search(root: &str, query: &str, top_k: usize) -> Result<Vec<SearchHit>, String> {
    {
        let guard = INDEX.lock().map_err(|e| e.to_string())?;
        let needs_build = match guard.as_ref() {
            Some(idx) => idx.root != root,
            None => true,
        };
        if needs_build {
            drop(guard);
            build(root)?;
        }
    }

    let guard = INDEX.lock().map_err(|e| e.to_string())?;
    let idx = guard.as_ref().ok_or("index not built")?;
    let n = idx.docs.len().max(1) as f32;
    let k1 = 1.2_f32;
    let b = 0.75_f32;

    let terms = tokenize(query);
    let mut scores: HashMap<usize, f32> = HashMap::new();

    for term in &terms {
        if let Some(postings) = idx.postings.get(term) {
            let df = postings.len() as f32;
            let idf = ((n - df + 0.5) / (df + 0.5) + 1.0).ln();
            for &(doc, tf) in postings {
                let dl = idx.doc_len[doc] as f32;
                let denom = tf as f32 + k1 * (1.0 - b + b * dl / idx.avg_len.max(1.0));
                let s = idf * (tf as f32 * (k1 + 1.0)) / denom.max(0.0001);
                *scores.entry(doc).or_insert(0.0) += s;
            }
        }
    }

    let mut ranked: Vec<(usize, f32)> = scores.into_iter().collect();
    ranked.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    ranked.truncate(top_k);

    let mut hits = Vec::new();
    for (doc, score) in ranked {
        let path = &idx.docs[doc];
        let (snippet, line) = best_snippet(path, &terms);
        hits.push(SearchHit {
            file: path.clone(),
            score,
            snippet,
            line,
        });
    }
    Ok(hits)
}

/// First line containing any query term, with a little context in the string.
fn best_snippet(path: &str, terms: &[String]) -> (String, usize) {
    let Ok(content) = std::fs::read_to_string(path) else {
        return (String::new(), 0);
    };
    for (i, line) in content.lines().enumerate() {
        let low = line.to_lowercase();
        if terms.iter().any(|t| low.contains(t.as_str())) {
            let trimmed = line.trim();
            let s = if trimmed.len() > 200 {
                trimmed.chars().take(200).collect::<String>()
            } else {
                trimmed.to_string()
            };
            return (s, i + 1);
        }
    }
    (String::new(), 0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::MutexGuard;

    /// `INDEX` is process-wide, so the tests that build or search it have to run
    /// one at a time. Without this they interleave and one test's root replaces
    /// another's mid-assertion.
    static SERIAL: Mutex<()> = Mutex::new(());
    static COUNTER: AtomicUsize = AtomicUsize::new(0);

    fn serial() -> MutexGuard<'static, ()> {
        SERIAL.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// A throwaway workspace. Named per process and per call so a parallel run
    /// never reuses another test's tree.
    struct Fixture(std::path::PathBuf);

    impl Fixture {
        fn new() -> Self {
            let n = COUNTER.fetch_add(1, Ordering::Relaxed);
            let dir = std::env::temp_dir()
                .join(format!("magnetar-index-{}-{}", std::process::id(), n));
            let _ = std::fs::remove_dir_all(&dir);
            std::fs::create_dir_all(&dir).expect("create fixture");
            Self(dir)
        }

        fn write(&self, rel: &str, body: &str) {
            let path = self.0.join(rel);
            if let Some(parent) = path.parent() {
                std::fs::create_dir_all(parent).expect("create parent");
            }
            std::fs::write(path, body).expect("write file");
        }

        fn root(&self) -> String {
            self.0.to_string_lossy().into_owned()
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn tokenize_keeps_identifiers_and_drops_noise() {
        assert_eq!(tokenize("let user_id = 3;"), vec!["let", "user_id"]);
        // Single characters carry no signal and the long token is a base64 blob,
        // not a word anyone searches for.
        assert!(tokenize("a b c").is_empty());
        assert!(tokenize(&"x".repeat(41)).is_empty());
        assert_eq!(tokenize(&"x".repeat(40)).len(), 1);
        assert_eq!(tokenize("SQLite"), vec!["sqlite"]);
    }

    #[test]
    fn binaries_and_lockfiles_are_not_texty() {
        assert!(is_texty("main.rs"));
        assert!(is_texty("README"));
        assert!(is_texty("Cargo.toml"));
        assert!(!is_texty("logo.PNG"));
        assert!(!is_texty("package-lock.json.lock"));
        assert!(!is_texty("vendor.min"));
    }

    #[test]
    fn list_files_applies_the_index_skip_rules() {
        let fx = Fixture::new();
        fx.write("src/main.rs", "fn main() {}");
        fx.write("README.md", "docs");
        fx.write("logo.png", "not really an image");
        fx.write("node_modules/dep/index.js", "noise");
        fx.write(".git/config", "noise");
        fx.write(".hidden/secret.txt", "noise");

        let mut files = list_files(&fx.root()).expect("list");
        files.sort();
        assert_eq!(files, vec!["README.md".to_string(), "src/main.rs".to_string()]);
    }

    #[test]
    fn list_files_rejects_a_path_that_is_not_a_directory() {
        let fx = Fixture::new();
        fx.write("a.txt", "hi");
        let err = list_files(&fx.0.join("a.txt").to_string_lossy()).expect_err("not a dir");
        assert!(err.contains("not a directory"));
    }

    #[test]
    fn list_files_is_empty_for_an_empty_workspace() {
        let fx = Fixture::new();
        assert!(list_files(&fx.root()).expect("list").is_empty());
    }

    #[test]
    fn oversized_files_are_skipped() {
        let fx = Fixture::new();
        fx.write("big.txt", &"a ".repeat((MAX_FILE_BYTES as usize / 2) + 10));
        fx.write("small.txt", "small");
        assert_eq!(list_files(&fx.root()).expect("list"), vec!["small.txt".to_string()]);
    }

    #[test]
    fn build_counts_indexed_files_and_distinct_terms() {
        let _guard = serial();
        let fx = Fixture::new();
        fx.write("a.txt", "alpha beta");
        fx.write("b.txt", "beta gamma");
        let stats = build(&fx.root()).expect("build");
        assert_eq!(stats.files, 2);
        assert_eq!(stats.terms, 3);
    }

    #[test]
    fn search_ranks_the_matching_file_and_points_at_the_line() {
        let _guard = serial();
        let fx = Fixture::new();
        fx.write("hit.rs", "// header\nlet rusqlite_conn = open();\n");
        fx.write("miss.rs", "let unrelated = 1;\n");

        let hits = search(&fx.root(), "rusqlite_conn", 5).expect("search");
        assert_eq!(hits.len(), 1);
        assert!(hits[0].file.ends_with("hit.rs"));
        assert_eq!(hits[0].line, 2);
        assert_eq!(hits[0].snippet, "let rusqlite_conn = open();");
        assert!(hits[0].score > 0.0);
    }

    #[test]
    fn search_returns_nothing_for_an_unknown_or_empty_query() {
        let _guard = serial();
        let fx = Fixture::new();
        fx.write("a.txt", "alpha beta");
        assert!(search(&fx.root(), "nowhere_at_all", 5).expect("search").is_empty());
        assert!(search(&fx.root(), "", 5).expect("search").is_empty());
        // A single character is below the token floor, so it can never match.
        assert!(search(&fx.root(), "a", 5).expect("search").is_empty());
    }

    #[test]
    fn search_honours_the_result_budget() {
        let _guard = serial();
        let fx = Fixture::new();
        for i in 0..5 {
            fx.write(&format!("f{i}.txt"), "shared_term here");
        }
        assert_eq!(search(&fx.root(), "shared_term", 2).expect("search").len(), 2);
    }

    #[test]
    fn search_rebuilds_when_the_workspace_changes() {
        let _guard = serial();
        let first = Fixture::new();
        first.write("a.txt", "alpha_marker");
        assert_eq!(search(&first.root(), "alpha_marker", 5).expect("search").len(), 1);

        let second = Fixture::new();
        second.write("b.txt", "beta_marker");
        // The stale index must not answer for a root it was not built from.
        assert!(search(&second.root(), "alpha_marker", 5).expect("search").is_empty());
        assert_eq!(search(&second.root(), "beta_marker", 5).expect("search").len(), 1);
    }
}
