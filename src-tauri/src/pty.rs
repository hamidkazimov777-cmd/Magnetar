//! Embedded terminal via a real PTY (portable-pty). Each session streams its
//! output to the frontend over a Tauri channel; input/resize/kill go back
//! through commands keyed by a session id.

use once_cell::sync::Lazy;
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Mutex;
use tauri::ipc::Channel;

struct PtyHandle {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn portable_pty::Child + Send + Sync>,
}

static SESSIONS: Lazy<Mutex<HashMap<String, PtyHandle>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

pub fn spawn(
    id: String,
    cwd: Option<String>,
    cols: u16,
    rows: u16,
    on_data: Channel<String>,
) -> Result<(), String> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;

    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    let mut cmd = CommandBuilder::new(shell);
    if let Some(dir) = cwd.filter(|d| !d.is_empty()) {
        cmd.cwd(dir);
    }
    cmd.env("TERM", "xterm-256color");

    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    // Slave no longer needed by us.
    drop(pair.slave);

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    // Register before streaming, so the reader thread can find and reap the
    // session once it ends — a closed terminal must not leak a process or an
    // entry in the map.
    SESSIONS.lock().map_err(|e| e.to_string())?.insert(
        id.clone(),
        PtyHandle {
            master: pair.master,
            writer,
            child,
        },
    );

    // Stream output → frontend.
    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        // The terminal is the most likely place to split a character: reads are
        // small and output is whatever the program prints, Cyrillic included.
        let mut decoder = crate::utf8::Utf8Stream::new();
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let s = decoder.push(&buf[..n]);
                    if s.is_empty() {
                        continue; // held back half a character; wait for the rest
                    }
                    if on_data.send(s).is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }

        // The shell exited (EOF), the channel went away, or the read failed —
        // reap the child and drop the session. `kill` may already have removed
        // it, in which case this is a no-op.
        if let Ok(mut sessions) = SESSIONS.lock() {
            if let Some(mut h) = sessions.remove(&id) {
                let _ = h.child.kill();
                let _ = h.child.wait();
            }
        }
    });

    Ok(())
}

pub fn write(id: &str, data: &str) -> Result<(), String> {
    let mut m = SESSIONS.lock().map_err(|e| e.to_string())?;
    if let Some(h) = m.get_mut(id) {
        h.writer
            .write_all(data.as_bytes())
            .map_err(|e| e.to_string())?;
        h.writer.flush().ok();
    }
    Ok(())
}

pub fn resize(id: &str, cols: u16, rows: u16) -> Result<(), String> {
    let m = SESSIONS.lock().map_err(|e| e.to_string())?;
    if let Some(h) = m.get(id) {
        h.master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn kill(id: &str) -> Result<(), String> {
    let mut m = SESSIONS.lock().map_err(|e| e.to_string())?;
    if let Some(mut h) = m.remove(id) {
        let _ = h.child.kill();
        // Reap the zombie: without `wait`, a killed shell lingers until the app
        // exits. The reader thread reaps sessions that end on their own; this
        // reaps the ones we terminate explicitly.
        let _ = h.child.wait();
    }
    Ok(())
}
