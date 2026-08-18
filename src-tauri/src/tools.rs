//! Agent tools: filesystem + shell primitives the model can call. Output is
//! filtered/truncated before it ever reaches the context (token economy). The
//! destructive tools (write_file, edit_file, run_bash) are gated by an explicit
//! user confirmation in the UI before the frontend invokes them.

use serde::{Deserialize, Serialize};
use std::path::Path;

/// Hard caps so a single tool call can't blow up the context window.
const MAX_READ_BYTES: usize = 60_000;
const MAX_BASH_BYTES: usize = 20_000;
const MAX_GREP_RESULTS: usize = 100;
const MAX_DIR_ENTRIES: usize = 500;

#[derive(Debug, Serialize)]
pub struct ReadResult {
    pub content: String,
    pub truncated: bool,
    pub bytes: usize,
}

#[derive(Debug, Serialize)]
pub struct DirEntry {
    pub name: String,
    pub is_dir: bool,
}

#[derive(Debug, Serialize)]
pub struct GrepHit {
    pub file: String,
    pub line: usize,
    pub text: String,
}

#[derive(Debug, Serialize)]
pub struct BashResult {
    pub stdout: String,
    pub stderr: String,
    pub code: i32,
    pub truncated: bool,
}

#[derive(Debug, Serialize)]
pub struct EditResult {
    pub replaced: usize,
    pub diff: String,
}

fn clip(s: &str, max: usize) -> (String, bool) {
    if s.len() <= max {
        (s.to_string(), false)
    } else {
        // Cut on a char boundary.
        let mut end = max;
        while !s.is_char_boundary(end) && end > 0 {
            end -= 1;
        }
        (format!("{}\n…[truncated]", &s[..end]), true)
    }
}

pub fn read_file(path: &str) -> Result<ReadResult, String> {
    let bytes = std::fs::read(path).map_err(|e| format!("{path}: {e}"))?;
    let total = bytes.len();
    let text = String::from_utf8_lossy(&bytes);
    let (content, truncated) = clip(&text, MAX_READ_BYTES);
    Ok(ReadResult {
        content,
        truncated,
        bytes: total,
    })
}

pub fn write_file(path: &str, content: &str) -> Result<usize, String> {
    if let Some(parent) = Path::new(path).parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
    }
    std::fs::write(path, content).map_err(|e| format!("{path}: {e}"))?;
    Ok(content.len())
}

pub fn edit_file(path: &str, old: &str, new: &str) -> Result<EditResult, String> {
    let src = std::fs::read_to_string(path).map_err(|e| format!("{path}: {e}"))?;
    let count = src.matches(old).count();
    if count == 0 {
        return Err("old_string not found in file".into());
    }
    if count > 1 {
        return Err(format!(
            "old_string is not unique ({count} matches) — include more context"
        ));
    }
    let updated = src.replacen(old, new, 1);
    std::fs::write(path, &updated).map_err(|e| e.to_string())?;
    let diff = format!("- {}\n+ {}", old.replace('\n', "\n- "), new.replace('\n', "\n+ "));
    Ok(EditResult {
        replaced: 1,
        diff: clip(&diff, 4_000).0,
    })
}

pub fn list_dir(path: &str) -> Result<Vec<DirEntry>, String> {
    let mut out = Vec::new();
    let rd = std::fs::read_dir(path).map_err(|e| format!("{path}: {e}"))?;
    for entry in rd.flatten() {
        if out.len() >= MAX_DIR_ENTRIES {
            break;
        }
        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
        out.push(DirEntry {
            name: entry.file_name().to_string_lossy().into_owned(),
            is_dir,
        });
    }
    out.sort_by(|a, b| (b.is_dir, &a.name).cmp(&(a.is_dir, &b.name)));
    Ok(out)
}

/// Case-insensitive substring search, recursive, skipping obvious noise dirs and
/// binary-looking files. Capped at MAX_GREP_RESULTS.
pub fn grep(pattern: &str, root: &str) -> Result<Vec<GrepHit>, String> {
    let mut hits = Vec::new();
    let needle = pattern.to_lowercase();
    walk_grep(Path::new(root), &needle, &mut hits);
    Ok(hits)
}

fn walk_grep(dir: &Path, needle: &str, hits: &mut Vec<GrepHit>) {
    const SKIP: [&str; 6] = ["node_modules", ".git", "target", "dist", ".next", "build"];
    if hits.len() >= MAX_GREP_RESULTS {
        return;
    }
    let Ok(rd) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in rd.flatten() {
        if hits.len() >= MAX_GREP_RESULTS {
            return;
        }
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
        if is_dir {
            if SKIP.contains(&name.as_str()) || name.starts_with('.') {
                continue;
            }
            walk_grep(&path, needle, hits);
        } else {
            // Read as text; skip if it isn't valid-ish UTF-8 or is large.
            let Ok(meta) = entry.metadata() else { continue };
            if meta.len() > 2_000_000 {
                continue;
            }
            let Ok(content) = std::fs::read_to_string(&path) else {
                continue;
            };
            for (i, line) in content.lines().enumerate() {
                if line.to_lowercase().contains(needle) {
                    hits.push(GrepHit {
                        file: path.to_string_lossy().into_owned(),
                        line: i + 1,
                        text: clip(line.trim(), 300).0,
                    });
                    if hits.len() >= MAX_GREP_RESULTS {
                        return;
                    }
                }
            }
        }
    }
}

pub fn run_bash(command: &str, cwd: Option<&str>) -> Result<BashResult, String> {
    let mut cmd = std::process::Command::new("bash");
    cmd.arg("-lc").arg(command);
    if let Some(dir) = cwd.filter(|d| !d.is_empty()) {
        cmd.current_dir(dir);
    }
    let out = cmd.output().map_err(|e| e.to_string())?;
    let (stdout, t1) = clip(&String::from_utf8_lossy(&out.stdout), MAX_BASH_BYTES);
    let (stderr, t2) = clip(&String::from_utf8_lossy(&out.stderr), MAX_BASH_BYTES);
    Ok(BashResult {
        stdout,
        stderr,
        code: out.status.code().unwrap_or(-1),
        truncated: t1 || t2,
    })
}

// ---- Tool argument shapes (deserialized from the model's JSON) --------------

#[derive(Debug, Deserialize)]
pub struct PathArg {
    pub path: String,
}

#[derive(Debug, Deserialize)]
pub struct WriteArg {
    pub path: String,
    pub content: String,
}

#[derive(Debug, Deserialize)]
pub struct EditArg {
    pub path: String,
    pub old_string: String,
    pub new_string: String,
}

#[derive(Debug, Deserialize)]
pub struct GrepArg {
    pub pattern: String,
    #[serde(default)]
    pub path: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct BashArg {
    pub command: String,
    #[serde(default)]
    pub cwd: Option<String>,
}
