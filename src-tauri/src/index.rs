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
