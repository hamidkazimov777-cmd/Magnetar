//! Language-server bridge. Each server is an ordinary child process speaking
//! JSON-RPC over stdio with LSP's `Content-Length` framing. We spawn it, stream
//! every message it emits to the frontend over a Tauri channel, and take
//! messages back in through a command keyed by a server id — the same shape as
//! `pty.rs`, minus the terminal.
//!
//! We deliberately do NOT bundle any server binary: licences, tens of megabytes
//! and an update treadmill. Instead `which` finds a server already on the
//! user's `PATH`, and the frontend says so plainly when one is missing.

use once_cell::sync::Lazy;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::Mutex;
use tauri::ipc::Channel;

struct LspHandle {
    child: Child,
    stdin: ChildStdin,
}

static SERVERS: Lazy<Mutex<HashMap<String, LspHandle>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

/// A synthetic notification pushed through the same channel when the server
/// process ends, so the frontend can surface it and restart rather than hang
/// forever on requests that will never be answered.
fn exited_notice() -> String {
    r#"{"jsonrpc":"2.0","method":"magnetar/serverExited","params":{}}"#.to_string()
}

/// Frame one JSON-RPC payload the way LSP expects: a `Content-Length` header,
/// a blank line, then the raw body. Pure so it can be tested directly.
fn encode(body: &str) -> Vec<u8> {
    let mut out = format!("Content-Length: {}\r\n\r\n", body.len()).into_bytes();
    out.extend_from_slice(body.as_bytes());
    out
}

/// Read exactly one framed message off a reader, or `None` at end of stream.
/// Only `Content-Length` matters to us; any other header (there is rarely one)
/// is read and ignored. Split out from the reader thread so a `Cursor` can
/// exercise the parser in tests without a real process.
fn read_message<R: BufRead>(reader: &mut R) -> Option<String> {
    let mut len: Option<usize> = None;
    loop {
        let mut line = String::new();
        // EOF before a full header block means the server is gone.
        if reader.read_line(&mut line).ok()? == 0 {
            return None;
        }
        let trimmed = line.trim_end_matches(['\r', '\n']);
        if trimmed.is_empty() {
            break; // blank line: headers end, body begins
        }
        if let Some(v) = trimmed.strip_prefix("Content-Length:") {
            len = v.trim().parse().ok();
        }
    }
    // A header block with no Content-Length is malformed; skip it rather than
    // read the rest of the stream as one giant body.
    let len = len?;
    let mut body = vec![0u8; len];
    reader.read_exact(&mut body).ok()?;
    // Bodies are whole messages read to their exact byte length, so a multibyte
    // character can never be split across two reads the way it can in the PTY.
    Some(String::from_utf8_lossy(&body).into_owned())
}

/// Where to look for server binaries: everything on `PATH`, then the standard
/// toolchain locations.
///
/// A macOS app launched from Finder or `open` inherits launchd's minimal PATH
/// (`/usr/bin:/bin:/usr/sbin:/sbin`), not the login shell's — so a server put
/// there by rustup, Homebrew, pipx or go is invisible unless we look where it
/// actually lives. We use this list both to find a server and to build the
/// child's own PATH, so the server can in turn find its toolchain (rust-analyzer
/// shells out to cargo).
fn search_dirs() -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = Vec::new();
    if let Some(path) = std::env::var_os("PATH") {
        dirs.extend(std::env::split_paths(&path));
    }
    for e in ["/opt/homebrew/bin", "/opt/homebrew/sbin", "/usr/local/bin"] {
        dirs.push(PathBuf::from(e));
    }
    if let Some(home) = std::env::var_os("HOME") {
        let home = PathBuf::from(home);
        for sub in [".cargo/bin", ".local/bin", "go/bin"] {
            dirs.push(home.join(sub));
        }
    }
    // Dedup, keeping first occurrence so real PATH order still wins.
    let mut seen = std::collections::HashSet::new();
    dirs.retain(|d| seen.insert(d.clone()));
    dirs
}

/// Find an executable by name, searching PATH plus the toolchain locations.
/// Returns the first match so the frontend can tell "installed" from "not
/// installed" before trying to spawn.
pub fn which(bin: &str) -> Option<String> {
    // A path with a separator is not a lookup — take it as given.
    if bin.contains('/') {
        let p = std::path::Path::new(bin);
        return p.is_file().then(|| bin.to_string());
    }
    for dir in search_dirs() {
        let cand = dir.join(bin);
        if cand.is_file() {
            return Some(cand.to_string_lossy().into_owned());
        }
    }
    None
}

pub fn spawn(
    id: String,
    cmd: String,
    args: Vec<String>,
    cwd: Option<String>,
    on_msg: Channel<String>,
) -> Result<(), String> {
    let mut command = Command::new(&cmd);
    command
        .args(&args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(dir) = cwd.filter(|d| !d.is_empty()) {
        command.current_dir(dir);
    }
    // Give the server the same augmented PATH we found it on, so it can locate
    // its own toolchain (rust-analyzer → cargo/rustc) even under launchd's
    // minimal PATH.
    if let Ok(path) = std::env::join_paths(search_dirs()) {
        command.env("PATH", path);
    }

    let mut child = command
        .spawn()
        .map_err(|e| format!("could not start {cmd}: {e}"))?;

    let stdout = child.stdout.take().ok_or("no stdout on language server")?;
    let stderr = child.stderr.take();
    let stdin = child.stdin.take().ok_or("no stdin on language server")?;

    // Register before the reader starts so an exit can find and reap the entry.
    SERVERS
        .lock()
        .map_err(|e| e.to_string())?
        .insert(id.clone(), LspHandle { child, stdin });

    // Drain stderr so a chatty server (rust-analyzer logs there) can never fill
    // its pipe buffer and block. Discard it — diagnostics come over stdout.
    if let Some(err) = stderr {
        std::thread::spawn(move || {
            let mut sink = [0u8; 4096];
            let mut err = err;
            while let Ok(n) = err.read(&mut sink) {
                if n == 0 {
                    break;
                }
            }
        });
    }

    // Stream messages → frontend.
    std::thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        while let Some(msg) = read_message(&mut reader) {
            if on_msg.send(msg).is_err() {
                break; // frontend dropped the channel
            }
        }
        // Stream ended: the server exited or the channel went away. Tell the
        // frontend (best-effort) and reap the child.
        let _ = on_msg.send(exited_notice());
        if let Ok(mut servers) = SERVERS.lock() {
            if let Some(mut h) = servers.remove(&id) {
                let _ = h.child.kill();
                let _ = h.child.wait();
            }
        }
    });

    Ok(())
}

pub fn send(id: &str, message: &str) -> Result<(), String> {
    let mut m = SERVERS.lock().map_err(|e| e.to_string())?;
    if let Some(h) = m.get_mut(id) {
        h.stdin
            .write_all(&encode(message))
            .map_err(|e| e.to_string())?;
        h.stdin.flush().ok();
    }
    Ok(())
}

pub fn kill(id: &str) -> Result<(), String> {
    let mut m = SERVERS.lock().map_err(|e| e.to_string())?;
    if let Some(mut h) = m.remove(id) {
        let _ = h.child.kill();
        // Reap the zombie; the reader thread reaps servers that exit on their
        // own, this reaps the ones we stop.
        let _ = h.child.wait();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn encodes_with_content_length_header() {
        let got = encode(r#"{"a":1}"#);
        assert_eq!(got, b"Content-Length: 7\r\n\r\n{\"a\":1}".to_vec());
    }

    #[test]
    fn reads_one_framed_message() {
        let mut c = Cursor::new(b"Content-Length: 7\r\n\r\n{\"a\":1}".to_vec());
        assert_eq!(read_message(&mut c).as_deref(), Some(r#"{"a":1}"#));
    }

    #[test]
    fn reads_back_to_back_messages() {
        let mut buf = encode(r#"{"n":1}"#);
        buf.extend(encode(r#"{"n":22}"#));
        let mut c = Cursor::new(buf);
        assert_eq!(read_message(&mut c).as_deref(), Some(r#"{"n":1}"#));
        assert_eq!(read_message(&mut c).as_deref(), Some(r#"{"n":22}"#));
        assert_eq!(read_message(&mut c), None); // stream drained
    }

    #[test]
    fn ignores_extra_headers_and_preserves_utf8() {
        let body = r#"{"msg":"привет"}"#;
        let framed = format!(
            "Content-Type: application/json\r\nContent-Length: {}\r\n\r\n{}",
            body.len(),
            body
        );
        let mut c = Cursor::new(framed.into_bytes());
        assert_eq!(read_message(&mut c).as_deref(), Some(body));
    }

    #[test]
    fn eof_returns_none() {
        let mut c = Cursor::new(Vec::new());
        assert_eq!(read_message(&mut c), None);
    }

    #[test]
    fn which_finds_a_known_binary() {
        // `sh` is on PATH on every unix host the app runs on.
        assert!(which("sh").is_some());
        assert!(which("magnetar-no-such-binary-xyz").is_none());
    }

    #[test]
    fn search_dirs_include_toolchain_locations() {
        // A GUI app gets launchd's minimal PATH, so we must also look where
        // rustup/Homebrew/pipx put things — otherwise an installed server is
        // invisible. ~/.cargo/bin is where rust-analyzer lives.
        let dirs = search_dirs();
        if let Some(home) = std::env::var_os("HOME") {
            let cargo = std::path::PathBuf::from(home).join(".cargo/bin");
            assert!(dirs.contains(&cargo), "search dirs must include ~/.cargo/bin");
        }
        assert!(dirs.contains(&std::path::PathBuf::from("/opt/homebrew/bin")));
    }
}
