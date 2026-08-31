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
/// Default cap for a single command. Real work (`npm install`, `cargo build`)
/// routinely runs longer than two minutes, so the caller can raise this.
const BASH_TIMEOUT_SECS: u64 = 600;

/// A git subcommand that hangs (a credential prompt with no TTY, a stalled
/// network) must not block the agent loop forever. Generous enough for slow
/// pulls, short enough to actually matter.
const GIT_TIMEOUT_SECS: u64 = 120;

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

/// Serialised as camelCase: the whole frontend reads `isDir`, and without this
/// rename the field arrived as `is_dir`, came back `undefined`, and every
/// directory in the tree rendered — and behaved — as a file. Clicking one tried
/// to open it in the editor and failed with "Is a directory (os error 21)".
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
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
    // When a slice is asked for, read line by line and stop at the end of the
    // window rather than pulling the whole file into memory first. An agent
    // asking for lines 10-30 of a 500 MB log should cost thirty lines, not
    // half a gigabyte — the old code read it all and then discarded the rest.
    if offset.is_some() || limit.is_some() {
        return read_slice(path, offset.unwrap_or(1), limit.unwrap_or(200));
    }

    // No window: the whole file is wanted, but still bounded — clip caps what
    // is returned so a giant file cannot flood the model's context.
    let meta = std::fs::metadata(path).map_err(|e| format!("{path}: {e}"))?;
    let total = meta.len() as usize;
    let text = std::fs::read_to_string(path)
        .unwrap_or_else(|_| String::from_utf8_lossy(&std::fs::read(path).unwrap_or_default()).into_owned());
    let (content, truncated) = clip(&text, MAX_READ_BYTES);
    Ok(ReadResult { content, truncated, bytes: total })
}

/// Read a window of lines without loading the whole file.
fn read_slice(path: &str, offset: usize, limit: usize) -> Result<ReadResult, String> {
    use std::io::BufRead;
    let file = std::fs::File::open(path).map_err(|e| format!("{path}: {e}"))?;
    let total = file.metadata().map(|m| m.len() as usize).unwrap_or(0);
    let reader = std::io::BufReader::new(file);
    let start = offset.saturating_sub(1);

    let mut out = String::new();
    for (i, line) in reader.lines().enumerate() {
        if i < start {
            continue;
        }
        if i >= start + limit {
            break;
        }
        let line = line.unwrap_or_default();
        out.push_str(&format!("{}: {}\n", i + 1, line));
        // Even within the window, one pathological line must not blow the cap.
        if out.len() > MAX_READ_BYTES {
            break;
        }
    }
    // Trim the trailing newline to match the previous join semantics.
    if out.ends_with('\n') {
        out.pop();
    }

    let (content, truncated) = clip(&out, MAX_READ_BYTES);
    Ok(ReadResult { content, truncated, bytes: total })
}

/// Full file read (no truncation) — for the in-app code editor.
pub fn read_text(path: &str) -> Result<String, String> {
    std::fs::read_to_string(path).map_err(|e| format!("{path}: {e}"))
}

/// Create a project folder under the user's Documents and return its path.
///
/// The location is fixed by the app, not chosen by the model: letting a model
/// pick a path is how a generated page ended up inside Magnetar's own
/// repository (Entry 54). A name that already exists gets a numeric suffix
/// rather than being written into — an existing folder belongs to somebody.
pub fn create_project_dir(home: &str, name: &str) -> Result<String, String> {
    let safe: String = name
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' || c == ' ' { c } else { '-' })
        .collect::<String>()
        .trim()
        .trim_matches('-')
        .to_string();
    let safe = if safe.is_empty() { "project".to_string() } else { safe };

    let base = Path::new(home).join("Documents").join("Magnetar");
    std::fs::create_dir_all(&base).map_err(|e| e.to_string())?;

    let mut target = base.join(&safe);
    let mut n = 2;
    while target.exists() {
        target = base.join(format!("{safe} {n}"));
        n += 1;
        if n > 99 {
            return Err("too many folders with this name".into());
        }
    }
    std::fs::create_dir(&target).map_err(|e| e.to_string())?;
    Ok(target.to_string_lossy().into_owned())
}

pub fn create_dir(path: &str) -> Result<(), String> {
    let p = std::path::Path::new(path);
    if p.exists() {
        return Err(format!("{path}: already exists"));
    }
    std::fs::create_dir_all(p).map_err(|e| format!("{path}: {e}"))
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

/// Delete a single file. Used to undo a file the agent created — never
/// recursive, so it cannot take a directory tree with it.
pub fn delete_file(path: &str) -> Result<(), String> {
    let p = Path::new(path);
    if p.is_dir() {
        return Err(format!("{path}: is a directory"));
    }
    std::fs::remove_file(p).map_err(|e| format!("{path}: {e}"))
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

use std::sync::{Arc, Mutex};
use std::sync::atomic::{AtomicBool, Ordering};
use std::collections::HashMap;
use once_cell::sync::Lazy;

/// Map of PID to child process id for killing. (Platform specific, simplified here for macOS/Unix)
pub static BASH_PROCESSES: Lazy<Mutex<HashMap<u32, u32>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

/// Drain a child's output pipe into a bounded buffer. The buffer never grows
/// past MAX_BASH_BYTES: once it is full the tail is dropped and `overflow` is
/// set, so a chatty command (`yes`, `npm install`) cannot balloon memory while
/// it runs. The incremental UTF-8 decoder keeps multi-byte characters intact
/// across 8 KiB reads.
fn pump<R: Read + Send + 'static>(
    mut src: R,
    sink: Arc<Mutex<String>>,
    overflow: Arc<AtomicBool>,
) {
    let mut chunk = [0u8; 8192];
    let mut decoder = crate::utf8::Utf8Stream::new();
    loop {
        match src.read(&mut chunk) {
            Ok(0) | Err(_) => {
                let rest = decoder.finish();
                if !rest.is_empty() {
                    append_capped(&sink, &rest, &overflow);
                }
                return;
            }
            Ok(n) => {
                let text = decoder.push(&chunk[..n]);
                if !text.is_empty() {
                    append_capped(&sink, &text, &overflow);
                }
            }
        }
    }
}

/// Append to a pump buffer, dropping the tail once MAX_BASH_BYTES is reached.
fn append_capped(sink: &Arc<Mutex<String>>, text: &str, overflow: &Arc<AtomicBool>) {
    let Ok(mut b) = sink.lock() else { return };
    let room = MAX_BASH_BYTES.saturating_sub(b.len());
    if room == 0 {
        overflow.store(true, Ordering::Relaxed);
        return;
    }
    if text.len() <= room {
        b.push_str(text);
    } else {
        let mut end = room;
        while !text.is_char_boundary(end) && end > 0 {
            end -= 1;
        }
        b.push_str(&text[..end]);
        overflow.store(true, Ordering::Relaxed);
    }
}

/// Reconstruct the user-visible "…[truncated]" marker from the overflow flag the
/// pump recorded. The buffer is already bounded, so this is just presentation.
fn finalize_buf(raw: String, overflowed: bool) -> (String, bool) {
    if overflowed {
        (format!("{raw}\n…[truncated]"), true)
    } else {
        (raw, false)
    }
}

pub fn run_bash(
    command: &str,
    cwd: Option<&str>,
    timeout_secs: Option<u64>,
) -> Result<BashResult, String> {
    let timeout = timeout_secs.filter(|t| *t > 0).unwrap_or(BASH_TIMEOUT_SECS);
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
    //
    // The buffers are shared rather than returned from the threads, because we
    // must be able to give up on them. A backgrounded child inherits these
    // pipes and keeps them open after bash itself exits — `nohup python bot.py &`
    // is the everyday case — so `read_to_string` never returns and joining
    // would hang the whole agent loop long after the command "finished". That
    // is exactly what the user saw: a command sitting at 220 seconds that Stop
    // could not touch, because there was nothing left to kill.
    let out_buf = Arc::new(Mutex::new(String::new()));
    let err_buf = Arc::new(Mutex::new(String::new()));
    let overflow_o = Arc::new(AtomicBool::new(false));
    let overflow_e = Arc::new(AtomicBool::new(false));
    let mut so = child.stdout.take();
    let mut se = child.stderr.take();

    let ob = out_buf.clone();
    let ov_o = overflow_o.clone();
    let th_o = std::thread::spawn(move || {
        if let Some(p) = so.take() {
            pump(p, ob, ov_o);
        }
    });
    let eb = err_buf.clone();
    let ov_e = overflow_e.clone();
    let th_e = std::thread::spawn(move || {
        if let Some(p) = se.take() {
            pump(p, eb, ov_e);
        }
    });

    let (code, timed_out) = match child
        .wait_timeout(Duration::from_secs(timeout))
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

    // Give the readers a moment to flush what the command actually printed,
    // then move on whether or not the pipes closed. Detached children may hold
    // them open forever; their output is not worth blocking the agent for.
    let deadline = std::time::Instant::now() + Duration::from_millis(1500);
    while (!th_o.is_finished() || !th_e.is_finished()) && std::time::Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(25));
    }
    let detached = !th_o.is_finished() || !th_e.is_finished();

    let stdout_raw = out_buf.lock().map(|b| b.clone()).unwrap_or_default();
    let stderr_raw = err_buf.lock().map(|b| b.clone()).unwrap_or_default();
    let killed_by_user = code == -1 && stdout_raw.is_empty() && stderr_raw.is_empty();

    let (stdout, stdout_trunc) = finalize_buf(stdout_raw, overflow_o.load(Ordering::Relaxed));
    let (mut stderr, stderr_trunc) = finalize_buf(stderr_raw, overflow_e.load(Ordering::Relaxed));

    // App-owned notes go after the command's own output so a chatty command
    // can't clip them away.
    if timed_out {
        stderr.push_str(&format!("\n[killed: exceeded {timeout}s timeout]"));
    } else if killed_by_user {
        stderr.push_str("\n[killed by user]");
    }
    if detached {
        stderr.push_str(
            "\n[note: a background process is still holding this command's output pipe, \
             so its output may be incomplete. Redirect it — e.g. `cmd > /tmp/x.log 2>&1 < /dev/null &` \
             — to detach cleanly.]",
        );
    }

    Ok(BashResult {
        stdout,
        stderr,
        code,
        truncated: stdout_trunc || stderr_trunc,
    })
}

/// Run a git subcommand in `cwd`. Only invokes the `git` binary (not a shell),
/// so it's safer than run_bash. Output is capped like bash output, and a git
/// command that hangs (a credential prompt, a stalled network) is killed after
/// GIT_TIMEOUT_SECS instead of blocking the agent loop forever.
pub fn git_exec(cwd: &str, args: Vec<String>) -> Result<BashResult, String> {
    let mut cmd = std::process::Command::new("git");
    cmd.args(&args)
        .current_dir(cwd)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    // Own process group so the whole tree (ssh, credential helpers) dies on timeout.
    cmd.process_group(0);
    let mut child = cmd.spawn().map_err(|e| e.to_string())?;
    let pid = child.id();

    let out_buf = Arc::new(Mutex::new(String::new()));
    let err_buf = Arc::new(Mutex::new(String::new()));
    let overflow_o = Arc::new(AtomicBool::new(false));
    let overflow_e = Arc::new(AtomicBool::new(false));

    let so = child.stdout.take().expect("stdout piped");
    let se = child.stderr.take().expect("stderr piped");
    let ob = out_buf.clone();
    let ov_o = overflow_o.clone();
    let th_o = std::thread::spawn(move || pump(so, ob, ov_o));
    let eb = err_buf.clone();
    let ov_e = overflow_e.clone();
    let th_e = std::thread::spawn(move || pump(se, eb, ov_e));

    let status = match child
        .wait_timeout(Duration::from_secs(GIT_TIMEOUT_SECS))
        .map_err(|e| e.to_string())?
    {
        Some(status) => status,
        None => {
            unsafe { libc::kill(-(pid as i32), libc::SIGKILL) };
            let _ = child.kill();
            let _ = child.wait();
            return Err(format!("git command timed out after {GIT_TIMEOUT_SECS}s"));
        }
    };

    // git closes its pipes when it exits; a spawned helper (ssh, a credential
    // prompt) might still hold them, so give the readers a grace period instead
    // of joining forever.
    let deadline = std::time::Instant::now() + Duration::from_millis(1500);
    while (!th_o.is_finished() || !th_e.is_finished()) && std::time::Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(25));
    }

    let stdout_raw = out_buf.lock().map(|b| b.clone()).unwrap_or_default();
    let stderr_raw = err_buf.lock().map(|b| b.clone()).unwrap_or_default();

    let (stdout, t1) = finalize_buf(stdout_raw, overflow_o.load(Ordering::Relaxed));
    let (stderr, t2) = finalize_buf(stderr_raw, overflow_e.load(Ordering::Relaxed));

    Ok(BashResult {
        stdout,
        stderr,
        code: status.code().unwrap_or(-1),
        truncated: t1 || t2,
    })
}

/// Run `git apply` with a patch fed on stdin.
///
/// Staging and discarding a single hunk means constructing a one-hunk patch and
/// handing it to `git apply`, which reads from stdin. `git_exec` does not write
/// stdin, and it should not learn to: a general command runner that also pipes
/// caller-supplied bytes into the process is a larger thing to reason about
/// than one focused call that does exactly this.
///
/// The `args` are fixed by the caller to `apply` variants; the patch is data.
pub fn git_apply(cwd: &str, args: Vec<String>, patch: &str) -> Result<BashResult, String> {
    use std::io::Write;
    let mut child = std::process::Command::new("git")
        .arg("apply")
        .args(&args)
        .current_dir(cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;

    // Write the patch and close stdin so git stops waiting for more. A patch
    // that does not end in a newline makes `git apply` reject the last hunk
    // with "corrupt patch", so one is ensured.
    if let Some(mut stdin) = child.stdin.take() {
        let body = if patch.ends_with('\n') {
            patch.to_string()
        } else {
            format!("{patch}\n")
        };
        stdin.write_all(body.as_bytes()).map_err(|e| e.to_string())?;
    }

    let out = child.wait_with_output().map_err(|e| e.to_string())?;
    Ok(BashResult {
        stdout: String::from_utf8_lossy(&out.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&out.stderr).into_owned(),
        code: out.status.code().unwrap_or(-1),
        truncated: false,
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reading_a_slice_does_not_depend_on_reading_the_whole_file() {
        // The window is returned with 1-based line prefixes, and the byte count
        // reflects the whole file even though only the window was read.
        let dir = std::env::temp_dir().join(format!("magnetar-read-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let path = dir.join("big.txt");
        let body: String = (1..=1000).map(|i| format!("line {i}\n")).collect();
        std::fs::write(&path, &body).unwrap();

        let r = read_file(&path.to_string_lossy(), Some(10), Some(3)).unwrap();
        assert!(r.content.contains("10: line 10"));
        assert!(r.content.contains("12: line 12"));
        assert!(!r.content.contains("line 13"));
        assert!(!r.content.contains("line 9"));
        assert_eq!(r.bytes, body.len());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn reading_past_the_end_returns_what_exists() {
        let dir = std::env::temp_dir().join(format!("magnetar-read2-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let path = dir.join("short.txt");
        std::fs::write(&path, "one\ntwo\n").unwrap();
        let r = read_file(&path.to_string_lossy(), Some(5), Some(10)).unwrap();
        assert_eq!(r.content, "");
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// The regression that made Stop look broken: a command that detaches a
    /// child while leaving stdout attached. bash exits immediately, but the
    /// pipe stays open, so draining it used to block until the 600s timeout —
    /// with no process left to kill.
    #[test]
    fn background_child_holding_stdout_does_not_hang() {
        let started = std::time::Instant::now();
        let r = run_bash("sleep 30 & echo started", None, Some(600))
            .expect("run_bash should return");
        let elapsed = started.elapsed();

        assert!(
            elapsed < Duration::from_secs(5),
            "returned after {elapsed:?} — the detached child's pipe is blocking again"
        );
        assert!(
            r.stdout.contains("started"),
            "output collected before giving up: {:?}",
            r.stdout
        );

        // Clean up the child we deliberately leaked.
        let _ = run_bash("pkill -f 'sleep 30' || true", None, Some(10));
    }

    /// A normal command must still return its full output, not a truncated
    /// snapshot taken at the deadline.
    #[test]
    fn ordinary_command_returns_complete_output() {
        let r = run_bash("printf 'a\\nb\\nc\\n'", None, Some(30)).expect("run_bash");
        assert_eq!(r.stdout.trim(), "a\nb\nc");
        assert_eq!(r.code, 0);
    }

    /// A command that floods stdout must not balloon memory while it runs: the
    /// buffer is capped at MAX_BASH_BYTES during execution (not after), and the
    /// result is flagged truncated.
    #[test]
    fn oversized_output_is_capped_during_execution() {
        let r = run_bash("yes x | head -c 100000", None, Some(30)).expect("run_bash");
        assert!(r.truncated, "a 100 KB output must be flagged truncated");
        assert!(
            r.stdout.len() <= MAX_BASH_BYTES + 64,
            "stdout grew to {} bytes, exceeding the cap",
            r.stdout.len()
        );
    }

    /// The rewritten git_exec still runs a quick subcommand and returns its output.
    #[test]
    fn git_exec_runs_a_quick_command() {
        let r = git_exec(".", vec!["--version".to_string()]).expect("git_exec");
        assert_eq!(r.code, 0, "git --version should exit 0: {:?}", r.stderr);
        assert!(
            r.stdout.contains("git version"),
            "unexpected output: {:?}",
            r.stdout
        );
    }
}
