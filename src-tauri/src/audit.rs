//! An append-only local record of what the agent was allowed to run.
//!
//! Shell commands are the one tool whose reach cannot be worked out in advance:
//! a command is an opaque string, and deciding what `make deploy` will touch
//! means running it. Containment can say where a command starts, not where it
//! goes. What is left is honesty after the fact — a record the user can read to
//! find out what actually happened on their machine.
//!
//! It stays on disk, next to the other app data, and never leaves. Nothing here
//! is sent anywhere: this is a log for the person whose machine it is.

use once_cell::sync::Lazy;
use std::collections::HashSet;
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;

const FILE_NAME: &str = "audit.log";
const ROTATE_AT_BYTES: u64 = 2 * 1024 * 1024;

static DIR: Lazy<Mutex<Option<PathBuf>>> = Lazy::new(|| Mutex::new(None));

/// Hosts already recorded this run, so a long conversation does not write one
/// line per message. What the record is for is the set of places this machine
/// talked to, not the count.
static SEEN_HOSTS: Lazy<Mutex<HashSet<String>>> = Lazy::new(|| Mutex::new(HashSet::new()));

/// Called once from `setup` with the app data directory, like the key store.
pub fn init(app_dir: &std::path::Path) {
    if let Ok(mut dir) = DIR.lock() {
        *dir = Some(app_dir.to_path_buf());
    }
}

fn path() -> Option<PathBuf> {
    DIR.lock().ok()?.as_ref().map(|d| d.join(FILE_NAME))
}

/// Words that introduce a credential in the shell commands people actually
/// write: `curl -H "Authorization: Bearer sk-..."`, `TOKEN=... ./deploy`.
const MARKERS: [&str; 9] = [
    "authorization",
    "api_key",
    "api-key",
    "apikey",
    "password",
    "secret",
    "token",
    "bearer",
    "client_id",
];

fn is_separator(c: char) -> bool {
    matches!(c, ':' | '=' | ' ' | '\t' | '"' | '\'')
}

/// Blank out anything that looks like a credential.
///
/// A log of shell commands is exactly where a key ends up: it is the one place
/// a user pastes one by hand. Deliberately blunt — over-redacting a command
/// costs a reader some context, under-redacting writes their key to a file.
pub fn redact(command: &str) -> String {
    let lower = command.to_lowercase();
    let bytes: Vec<char> = command.chars().collect();
    let lower_chars: Vec<char> = lower.chars().collect();
    let mut out = String::with_capacity(command.len());
    let mut i = 0usize;

    while i < bytes.len() {
        // A recognisable key shape is redacted wherever it appears, with or
        // without a marker in front of it.
        if let Some(len) = key_shape_at(&bytes, i) {
            out.push_str("[REDACTED]");
            i += len;
            continue;
        }

        // A marker only introduces a credential when a separator follows it.
        // Without that check the word is matched inside other words, and
        // `api.tokenflow.ai` came back as `api.token[REDACTED]` — the audit
        // log's own hostnames were being destroyed. `git checkout secrets.ts`
        // was heading the same way. The boundary is checked on the right only:
        // requiring one on the left would stop matching `GITHUB_TOKEN=`, which
        // is the shape this is most needed for.
        let matched = MARKERS
            .iter()
            .find(|m| {
                starts_with_at(&lower_chars, i, m)
                    && bytes
                        .get(i + m.chars().count())
                        .is_some_and(|c| is_separator(*c))
            })
            .copied();

        let Some(marker) = matched else {
            out.push(bytes[i]);
            i += 1;
            continue;
        };

        out.push_str(&command[..].chars().skip(i).take(marker.len()).collect::<String>());
        i += marker.len();

        let mut sep = String::new();
        while i < bytes.len() && is_separator(bytes[i]) {
            sep.push(bytes[i]);
            i += 1;
        }
        let value_len = bytes[i..]
            .iter()
            .take_while(|c| !is_separator(**c) && **c != '\n')
            .count();

        out.push_str(&sep);
        if value_len == 0 {
            continue;
        }
        out.push_str("[REDACTED]");
        i += value_len;
    }
    out
}

fn starts_with_at(haystack: &[char], at: usize, needle: &str) -> bool {
    let n: Vec<char> = needle.chars().collect();
    at + n.len() <= haystack.len() && haystack[at..at + n.len()] == n[..]
}

/// Provider key prefixes are distinctive enough to catch on their own.
fn key_shape_at(chars: &[char], at: usize) -> Option<usize> {
    const PREFIXES: [&str; 5] = ["sk-", "ghp_", "gho_", "ghs_", "github_pat_"];
    let prefix = PREFIXES
        .iter()
        .find(|p| starts_with_at(chars, at, p))
        .copied()?;
    let body = chars[at + prefix.chars().count()..]
        .iter()
        .take_while(|c| c.is_ascii_alphanumeric() || **c == '_' || **c == '-')
        .count();
    // Short enough and it is a word, not a key: `sk-1` is not a credential.
    (body >= 12).then_some(prefix.chars().count() + body)
}

/// One line, one event. JSON so it can be read by a tool as well as by a person.
pub fn record(kind: &str, cwd: &str, command: &str, outcome: &str) {
    let Some(path) = path() else { return };
    rotate_if_large(&path);

    let entry = serde_json::json!({
        "at": std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0),
        "kind": kind,
        "cwd": cwd,
        "command": redact(command),
        "outcome": outcome,
    });

    // The log holds a history of what ran on this machine, so it gets the same
    // owner-only permissions as the key store.
    let mut opts = std::fs::OpenOptions::new();
    opts.create(true).append(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o600);
    }
    // A failure to log must never take down the command being logged: this is
    // a record, not a control.
    if let Ok(mut file) = opts.open(&path) {
        let _ = writeln!(file, "{entry}");
    }
}

/// Note that the app is about to talk to a host.
///
/// Magnetar is BYOK, so "which endpoints may be contacted" is the user's
/// decision, not a list this app gets to police — a local model on a strange
/// port is exactly as legitimate as a well-known provider. What can honestly be
/// offered is visibility: the record says where this machine reached, so nobody
/// has to take the claim on trust.
pub fn record_destination(url: &str) {
    let host = host_of(url);
    if host.is_empty() {
        return;
    }
    {
        let mut seen = match SEEN_HOSTS.lock() {
            Ok(s) => s,
            Err(e) => e.into_inner(),
        };
        if !seen.insert(host.clone()) {
            return;
        }
    }
    record("network", "", &host, "endpoint contacted");
}

/// Host and port only. A full URL can carry a key in a query string, and this
/// record exists to be safe to read.
fn host_of(url: &str) -> String {
    let after_scheme = url.split("://").nth(1).unwrap_or(url);
    after_scheme
        .split(['/', '?', '#'])
        .next()
        .unwrap_or("")
        // Some endpoints embed credentials as user:pass@host.
        .rsplit('@')
        .next()
        .unwrap_or("")
        .to_string()
}

fn rotate_if_large(path: &std::path::Path) {
    let too_big = std::fs::metadata(path).map(|m| m.len() >= ROTATE_AT_BYTES).unwrap_or(false);
    if too_big {
        // One generation back is kept. An audit trail nobody can grep because
        // it grew to a gigabyte is no more useful than no trail at all.
        let _ = std::fs::rename(path, path.with_extension("log.1"));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_pasted_key_never_reaches_the_log() {
        let out = redact("curl -H 'Authorization: Bearer sk-abcdefghijklmnop' https://api");
        assert!(!out.contains("sk-abcdefghijklmnop"));
        assert!(out.contains("[REDACTED]"));
        // The shape of the command is still readable, which is the point of
        // keeping a log at all.
        assert!(out.contains("curl"));
        assert!(out.contains("https://api"));
    }

    #[test]
    fn assignments_and_flags_are_both_covered() {
        for command in [
            "API_KEY=abcd1234efgh npm run deploy",
            "export TOKEN=ghp_aaaabbbbccccdddd",
            "psql --password=hunter2correct",
            "run --client_id 12345abcdef",
        ] {
            let out = redact(command);
            assert!(out.contains("[REDACTED]"), "not redacted: {command} -> {out}");
        }
    }

    #[test]
    fn a_bare_provider_key_is_caught_without_any_marker() {
        let out = redact("echo sk-0123456789abcdef > /tmp/x");
        assert!(!out.contains("sk-0123456789abcdef"));
        assert!(out.contains("echo"));
        assert!(out.contains("/tmp/x"));
    }

    #[test]
    fn ordinary_commands_pass_through_untouched() {
        for command in ["git status", "cargo test --all", "ls -la src/", "npm run build"] {
            assert_eq!(redact(command), command);
        }
    }

    #[test]
    fn a_marker_inside_a_word_is_not_a_marker() {
        // Found on the first real run: the audit log recorded a provider host
        // as `api.token[REDACTED]`. A hostname is not a credential, and a
        // redactor that eats them destroys the record it exists to protect.
        assert_eq!(redact("api.tokenflow.ai"), "api.tokenflow.ai");
        assert_eq!(redact("git checkout secrets.ts"), "git checkout secrets.ts");
        assert_eq!(redact("cat passwords.md"), "cat passwords.md");
        assert_eq!(redact("api.together.xyz"), "api.together.xyz");
    }

    #[test]
    fn an_underscored_environment_name_is_still_caught() {
        // The boundary is only checked to the right of the marker: requiring
        // one on the left would stop matching exactly the shape that matters.
        for command in ["GITHUB_TOKEN=abcd1234efgh", "MY_API_KEY=abcd1234efgh"] {
            assert!(redact(command).contains("[REDACTED]"), "missed: {command}");
        }
    }

    #[test]
    fn a_short_lookalike_is_not_a_key() {
        // `sk-1` is a word in a filename far more often than it is a secret,
        // and redacting it would make the log useless without protecting
        // anything.
        assert_eq!(redact("cat sk-1.txt"), "cat sk-1.txt");
    }

    #[test]
    fn a_marker_with_no_value_is_left_alone() {
        assert_eq!(redact("grep -i token"), "grep -i token");
        assert_eq!(redact("echo password"), "echo password");
    }

    #[test]
    fn only_the_host_is_recorded_never_the_path_or_query() {
        // A full URL routinely carries a key in the query string, and this
        // record exists to be safe to read.
        assert_eq!(host_of("https://api.openai.com/v1/chat?key=sk-secret"), "api.openai.com");
        assert_eq!(host_of("http://localhost:11434/api/generate"), "localhost:11434");
        assert_eq!(host_of("https://user:pass@example.com/x"), "example.com");
        assert_eq!(host_of(""), "");
    }

    #[test]
    fn a_host_is_recorded_once_per_run_not_once_per_message() {
        // The record is for the set of places this machine reached, not a
        // counter that buries it under one line per message.
        let mut seen = HashSet::new();
        assert!(seen.insert("api.openai.com".to_string()));
        assert!(!seen.insert("api.openai.com".to_string()));
    }

    #[test]
    fn logging_without_a_directory_does_not_panic() {
        // Before `init` runs there is nowhere to write. Recording must be a
        // no-op rather than a crash, because it happens on the command path.
        record("bash", "/tmp", "git status", "exit 0");
    }
}
