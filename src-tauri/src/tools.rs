//! Agent tools: filesystem + shell primitives the model can call. Output is
//! filtered/truncated before it ever reaches the context (token economy). The
//! destructive tools (write_file, edit_file, run_bash) are gated by an explicit
//! user confirmation in the UI before the frontend invokes them.

use serde::Serialize;
use std::io::Read;
use std::os::unix::process::CommandExt;
use std::path::Path;
use std::process::Stdio;
use std::time::Duration;
use wait_timeout::ChildExt;

/// Hard ceiling so a runaway command can't hang the agent forever.
const BASH_TIMEOUT_SECS: u64 = 120;

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

/// Read a file. With `offset`/`limit` (1-based line offset, line count) it returns
/// just that slice — retrieval of chunks instead of whole files (token economy).
pub fn read_file(
    path: &str,
    offset: Option<usize>,
    limit: Option<usize>,
) -> Result<ReadResult, String> {
    let bytes = std::fs::read(path).map_err(|e| format!("{path}: {e}"))?;
    let total = bytes.len();
    let text = String::from_utf8_lossy(&bytes);

    let slice: String = if offset.is_some() || limit.is_some() {
        let start = offset.unwrap_or(1).saturating_sub(1);
        let count = limit.unwrap_or(200);
        text.lines()
            .enumerate()
            .skip(start)
            .take(count)
            .map(|(i, l)| format!("{}: {}", i + 1, l))
            .collect::<Vec<_>>()
            .join("\n")
    } else {
        text.to_string()
    };

    let (content, truncated) = clip(&slice, MAX_READ_BYTES);
    Ok(ReadResult {
        content,
        truncated,
        bytes: total,
    })
}

/// Full file read (no truncation) — for the in-app code editor.
pub fn read_text(path: &str) -> Result<String, String> {
    std::fs::read_to_string(path).map_err(|e| format!("{path}: {e}"))
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

use std::sync::Mutex;
use std::collections::HashMap;
use once_cell::sync::Lazy;

/// Map of PID to child process id for killing. (Platform specific, simplified here for macOS/Unix)
pub static BASH_PROCESSES: Lazy<Mutex<HashMap<u32, u32>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

pub fn run_bash(command: &str, cwd: Option<&str>) -> Result<BashResult, String> {
    let mut cmd = std::process::Command::new("bash");
    cmd.arg("-lc").arg(command).stdout(Stdio::piped()).stderr(Stdio::piped());
    if let Some(dir) = cwd.filter(|d| !d.is_empty()) {
        cmd.current_dir(dir);
    }
    // Put the command in its own process group (pgid == child pid) so we can
    // kill the WHOLE tree (e.g. `npm run dev` → node) on Stop/timeout, not just
    // the bash wrapper.
    cmd.process_group(0);
    let mut child = cmd.spawn().map_err(|e| e.to_string())?;

    let pid = child.id();
    if let Ok(mut m) = BASH_PROCESSES.lock() {
        m.insert(pid, pid);
    }

    // Drain pipes on threads so a chatty command can't deadlock on a full buffer
    // while we wait.
    let mut so = child.stdout.take();
    let mut se = child.stderr.take();
    let th_o = std::thread::spawn(move || {
        let mut s = String::new();
        if let Some(p) = so.as_mut() {
            let _ = p.read_to_string(&mut s);
        }
        s
    });
    let th_e = std::thread::spawn(move || {
        let mut s = String::new();
        if let Some(p) = se.as_mut() {
            let _ = p.read_to_string(&mut s);
        }
        s
    });

    let (code, timed_out) = match child
        .wait_timeout(Duration::from_secs(BASH_TIMEOUT_SECS))
        .map_err(|e| e.to_string())?
    {
        Some(status) => (status.code().unwrap_or(-1), false),
        None => {
            // Kill the whole process group on timeout.
            unsafe { libc::kill(-(pid as i32), libc::SIGKILL) };
            let _ = child.kill();
            let _ = child.wait();
            (-1, true)
        }
    };
    
    if let Ok(mut m) = BASH_PROCESSES.lock() {
        m.remove(&pid);
    }

    let stdout_raw = th_o.join().unwrap_or_default();
    let mut stderr_raw = th_e.join().unwrap_or_default();
    if timed_out {
        stderr_raw.push_str(&format!("\n[killed: exceeded {BASH_TIMEOUT_SECS}s timeout]"));
    } else if code == -1 && stdout_raw.is_empty() && stderr_raw.is_empty() {
        stderr_raw.push_str("\n[killed by user]");
    }

    let (stdout, t1) = clip(&stdout_raw, MAX_BASH_BYTES);
    let (stderr, t2) = clip(&stderr_raw, MAX_BASH_BYTES);
    Ok(BashResult {
        stdout,
        stderr,
        code,
        truncated: t1 || t2,
    })
}

pub fn kill_bash(pid: Option<u32>) -> Result<(), String> {
    // Negative pid = kill the whole process group (pgid == the bash pid we set
    // via process_group(0)), so children like node/npm die too.
    if let Some(p) = pid {
        unsafe {
            libc::kill(-(p as i32), libc::SIGKILL);
        }
        if let Ok(mut m) = BASH_PROCESSES.lock() {
            m.remove(&p);
        }
    } else {
        if let Ok(mut m) = BASH_PROCESSES.lock() {
            for (&p, _) in m.iter() {
                unsafe {
                    libc::kill(-(p as i32), libc::SIGKILL);
                }
            }
            m.clear();
        }
    }
    Ok(())
}
