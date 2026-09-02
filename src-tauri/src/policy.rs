//! What the app is allowed to do to the machine right now.
//!
//! Path containment answers *where*; this answers *whether*. They are separate
//! questions: a write inside the workspace is still a write, and there are
//! situations — reviewing someone else's repository, letting an agent explore
//! before you trust it — where reading everything and changing nothing is the
//! whole point.
//!
//! The decision lives in Rust for the same reason the workspace root does. A
//! read-only switch the webview owns is a switch that stops existing the moment
//! the page is compromised, and "the UI hid the button" is not a control.

use once_cell::sync::Lazy;
use std::collections::HashSet;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

/// What a command is about to do.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Access {
    /// Reads the disk. Always permitted today, and declared at every read
    /// command anyway: a classification that only appears where it forbids
    /// something is not a policy, it is a scattering of special cases.
    Read,
    /// Creates, changes or removes something.
    Write,
    /// Runs a program, which may do either and cannot be inspected first.
    Execute,
}

static READ_ONLY: Lazy<AtomicBool> = Lazy::new(|| AtomicBool::new(false));

/* --------------------------------------------------------------------------
   REPOSITORY TRUST

   Opening a folder is not the same as vouching for what is in it. A repository
   can carry build scripts, task definitions and tooling configuration that run
   the moment something touches them, and cloning a stranger's project to read
   it is an ordinary thing to do. Until someone says otherwise, an unfamiliar
   folder gets to be read and nothing else.

   Trust is remembered per folder — being asked again every morning about the
   project you work in daily is how a prompt becomes something people click
   through without reading.
   -------------------------------------------------------------------------- */

const TRUSTED_FILE: &str = "trusted-roots.json";

static DIR: Lazy<Mutex<Option<PathBuf>>> = Lazy::new(|| Mutex::new(None));
static TRUSTED: Lazy<Mutex<HashSet<PathBuf>>> = Lazy::new(|| Mutex::new(HashSet::new()));
static CURRENT: Lazy<Mutex<Option<PathBuf>>> = Lazy::new(|| Mutex::new(None));

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// Called once from `setup` with the app data directory.
pub fn init(app_dir: &Path) {
    *lock(&DIR) = Some(app_dir.to_path_buf());

    // The network allowlist starts with the built-in provider hosts and adds any
    // it persisted before. Saved connections are seeded separately in `setup`,
    // where the database is available.
    {
        let mut hosts = lock(&NETWORK);
        for h in BUILTIN_HOSTS {
            hosts.insert((*h).to_string());
        }
        if let Ok(text) = std::fs::read_to_string(app_dir.join(NETWORK_FILE)) {
            if let Ok(list) = serde_json::from_str::<Vec<String>>(&text) {
                hosts.extend(list);
            }
        }
    }

    let path = app_dir.join(TRUSTED_FILE);
    let Ok(text) = std::fs::read_to_string(path) else { return };
    if let Ok(list) = serde_json::from_str::<Vec<String>>(&text) {
        *lock(&TRUSTED) = list.into_iter().map(PathBuf::from).collect();
    }
}

fn persist_trusted(trusted: &HashSet<PathBuf>) {
    let Some(dir) = lock(&DIR).clone() else { return };
    let list: Vec<String> = trusted.iter().map(|p| p.to_string_lossy().into_owned()).collect();
    let Ok(json) = serde_json::to_string_pretty(&list) else { return };
    let mut opts = std::fs::OpenOptions::new();
    opts.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o600);
    }
    if let Ok(mut f) = opts.open(dir.join(TRUSTED_FILE)) {
        let _ = f.write_all(json.as_bytes());
    }
}

/// Point trust at a folder, or clear it when the folder closes.
pub fn set_workspace(root: Option<PathBuf>) {
    *lock(&CURRENT) = root;
}

/// Whether the open folder may be changed and have commands run in it.
///
/// With no folder open there is nothing to distrust, and the app has to work
/// before a project is chosen — so the answer is yes.
pub fn trusted() -> bool {
    match lock(&CURRENT).clone() {
        None => true,
        Some(root) => lock(&TRUSTED).contains(&root),
    }
}

/// Record that the user vouched for the open folder.
pub fn trust_workspace() -> Result<(), String> {
    let Some(root) = lock(&CURRENT).clone() else {
        return Err("no folder is open".into());
    };
    let mut trusted = lock(&TRUSTED);
    trusted.insert(root);
    persist_trusted(&trusted);
    Ok(())
}

/// Withdraw trust from the open folder. Immediate: the next write is refused.
pub fn distrust_workspace() {
    let Some(root) = lock(&CURRENT).clone() else { return };
    let mut trusted = lock(&TRUSTED);
    trusted.remove(&root);
    persist_trusted(&trusted);
}

/* --------------------------------------------------------------------------
   NETWORK ALLOWLIST

   Every outbound request this app makes goes to a provider the user configured:
   an OpenAI-compatible base URL, Anthropic, or GigaChat's fixed endpoints. There
   is no "fetch an arbitrary URL" surface. So the network rule is not read-only
   or trust — a chat has to work before any folder is open — it is containment of
   a different kind: the app may reach the hosts of connections the user saved,
   and nothing else. A compromised webview cannot redirect a request to an
   exfiltration host it invents, because that host is not on the list.

   The list is seeded from saved connections (on startup and on save) plus the
   built-in GigaChat hosts, and persisted so it survives a restart.
   -------------------------------------------------------------------------- */

const NETWORK_FILE: &str = "network-hosts.json";

static NETWORK: Lazy<Mutex<HashSet<String>>> = Lazy::new(|| Mutex::new(HashSet::new()));

/// GigaChat reaches fixed hosts that are not expressed as a connection base URL,
/// so they are allowed by construction.
const BUILTIN_HOSTS: &[&str] = &[
    "gigachat.devices.sberbank.ru",
    "ngw.devices.sberbank.ru:9443",
];

/// The host (with port, if any) of a URL — the unit the allowlist is keyed on.
/// A deliberately small parse: scheme, then everything up to the next `/`, with
/// any `user@` and query stripped. Returns None for an empty or path-less value.
pub fn host_of(url: &str) -> Option<String> {
    let after_scheme = url.split("://").nth(1).unwrap_or(url);
    let authority = after_scheme.split(['/', '?', '#']).next().unwrap_or("");
    let host = authority.rsplit('@').next().unwrap_or(authority).trim();
    if host.is_empty() {
        None
    } else {
        Some(host.to_ascii_lowercase())
    }
}

fn persist_network(hosts: &HashSet<String>) {
    let Some(dir) = lock(&DIR).clone() else { return };
    let list: Vec<String> = hosts.iter().cloned().collect();
    let Ok(json) = serde_json::to_string_pretty(&list) else { return };
    let mut opts = std::fs::OpenOptions::new();
    opts.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o600);
    }
    if let Ok(mut f) = opts.open(dir.join(NETWORK_FILE)) {
        let _ = f.write_all(json.as_bytes());
    }
}

/// Add a URL's host to the allowlist and persist. Called when a connection is
/// saved, and for each saved connection at startup, so configuring a provider is
/// what authorizes reaching it. A URL with no host is ignored.
pub fn allow_network(url: &str) {
    let Some(host) = host_of(url) else { return };
    let mut hosts = lock(&NETWORK);
    if hosts.insert(host) {
        persist_network(&hosts);
    }
}

/// Whether a URL's host is on the allowlist. A URL with no host is treated as
/// nothing to gate (Ok), so an empty provider base URL — GigaChat expresses its
/// endpoints as built-ins, not a base URL — does not wrongly fail.
pub fn network_allowed(url: &str) -> bool {
    match host_of(url) {
        None => true,
        Some(host) => lock(&NETWORK).contains(&host),
    }
}

/// The gate every outbound provider call goes through.
pub fn require_network(url: &str) -> Result<(), String> {
    if network_allowed(url) {
        Ok(())
    } else {
        Err(format!(
            "network host not allowed: {}. It is not one of the configured \
             connections. Add or save the connection to reach it.",
            host_of(url).unwrap_or_default()
        ))
    }
}

pub fn set_read_only(on: bool) {
    READ_ONLY.store(on, Ordering::SeqCst);
}

pub fn read_only() -> bool {
    READ_ONLY.load(Ordering::SeqCst)
}

/// Decide, given the modes, whether an access may proceed.
///
/// Kept as a pure function of its inputs so the rule can be tested without
/// standing up any global state, and so the rule reads as one expression
/// instead of being spread across every call site.
///
/// Read-only is reported before trust when both apply: it is the one the user
/// just chose, so it is the one that explains what they are seeing.
pub fn decide(access: Access, read_only: bool, trusted: bool) -> Result<(), String> {
    // Execution is grouped with writing, deliberately. A shell command is
    // opaque: `sh build.sh` cannot be shown to be read-only, so treating it as
    // a read would make both modes a promise the app cannot keep.
    let what = match access {
        Access::Read => return Ok(()),
        Access::Execute => "run a command",
        Access::Write => "change a file",
    };

    if read_only {
        return Err(format!(
            "read-only mode is on: this would {what}. Turn it off to continue."
        ));
    }
    if !trusted {
        return Err(format!(
            "this folder is not trusted: this would {what}. \
             Trust the folder to allow changes and commands in it."
        ));
    }
    Ok(())
}

/// The gate every mutating command goes through.
pub fn require(access: Access) -> Result<(), String> {
    decide(access, read_only(), trusted())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The mode and the current folder are process-wide, so the tests that set
    /// them run one at a time rather than racing each other.
    static SERIAL: Mutex<()> = Mutex::new(());

    fn serial() -> std::sync::MutexGuard<'static, ()> {
        SERIAL.lock().unwrap_or_else(|e| e.into_inner())
    }

    #[test]
    fn reading_is_never_blocked() {
        for read_only in [true, false] {
            for trusted in [true, false] {
                assert!(decide(Access::Read, read_only, trusted).is_ok());
            }
        }
    }

    #[test]
    fn read_only_stops_writing_and_running_alike() {
        // Running is refused with writing, not alongside reading: a command is
        // opaque, so allowing it would make the mode a promise that cannot be
        // kept.
        assert!(decide(Access::Write, true, true).is_err());
        assert!(decide(Access::Execute, true, true).is_err());
    }

    #[test]
    fn spawning_a_process_is_execute_and_stays_gated() {
        // pty_spawn, lsp_spawn and dap_spawn each spawn a real process — a
        // language server runs build scripts and proc-macros, a terminal runs
        // the shell — so they are gated on Access::Execute. This pins the
        // contract those commands now depend on: neither read-only nor an
        // untrusted folder may spawn, and only a trusted, writable folder may.
        // A regression that downgraded the requirement would surface here.
        assert!(decide(Access::Execute, true, true).is_err(), "read-only must refuse a spawn");
        assert!(decide(Access::Execute, false, false).is_err(), "untrusted must refuse a spawn");
        assert!(decide(Access::Execute, false, true).is_ok(), "trusted + writable may spawn");
    }

    #[test]
    fn host_of_extracts_host_with_port_and_ignores_userinfo() {
        assert_eq!(host_of("https://api.openai.com/v1"), Some("api.openai.com".into()));
        assert_eq!(
            host_of("https://ngw.devices.sberbank.ru:9443/api/v2/oauth"),
            Some("ngw.devices.sberbank.ru:9443".into())
        );
        assert_eq!(host_of("http://user@host.local:8080/x"), Some("host.local:8080".into()));
        assert_eq!(host_of(""), None);
        assert_eq!(host_of("   "), None);
    }

    #[test]
    fn the_network_gate_allows_a_configured_host_and_refuses_an_unknown_one() {
        // A unique host, since NETWORK is process-wide and tests share it.
        let url = "https://byok-test.example/v1/chat";
        assert!(!network_allowed(url), "an unconfigured host is not allowed");
        assert!(require_network(url).is_err());
        allow_network(url);
        assert!(network_allowed("https://byok-test.example/anything"));
        assert!(require_network(url).is_ok());
        // A URL with no host is nothing to gate.
        assert!(network_allowed(""));
        assert!(require_network("").is_ok());
    }

    #[test]
    fn everything_is_allowed_when_the_mode_is_off() {
        for access in [Access::Read, Access::Write, Access::Execute] {
            assert!(decide(access, false, true).is_ok());
        }
    }

    #[test]
    fn the_refusal_says_what_was_refused_and_how_to_proceed() {
        let write = decide(Access::Write, true, true).expect_err("refused");
        assert!(write.contains("change a file"));
        assert!(write.contains("Turn it off"));

        let run = decide(Access::Execute, true, true).expect_err("refused");
        assert!(run.contains("run a command"));

        let untrusted = decide(Access::Write, false, false).expect_err("refused");
        assert!(untrusted.contains("not trusted"));
        assert!(untrusted.contains("Trust the folder"));
    }

    #[test]
    fn an_untrusted_folder_may_be_read_but_not_changed() {
        assert!(decide(Access::Read, false, false).is_ok());
        assert!(decide(Access::Write, false, false).is_err());
        // Commands are refused too: a repository's own build script is exactly
        // the thing that makes an unfamiliar folder worth distrusting.
        assert!(decide(Access::Execute, false, false).is_err());
    }

    #[test]
    fn read_only_is_the_reason_reported_when_both_apply() {
        // The user just chose read-only, so that is the explanation that makes
        // sense of what they are seeing; being told about trust instead would
        // send them to fix the wrong thing.
        let both = decide(Access::Write, true, false).expect_err("refused");
        assert!(both.contains("read-only"));
        assert!(!both.contains("not trusted"));
    }

    #[test]
    fn with_no_folder_open_there_is_nothing_to_distrust() {
        let _guard = serial();
        set_workspace(None);
        assert!(trusted());
    }

    #[test]
    fn a_folder_is_untrusted_until_someone_says_otherwise() {
        let _guard = serial();
        set_workspace(Some(PathBuf::from("/tmp/magnetar-unknown-folder")));
        assert!(!trusted());
        trust_workspace().expect("trusted");
        assert!(trusted());
        distrust_workspace();
        assert!(!trusted());
        set_workspace(None);
    }

    #[test]
    fn trusting_one_folder_says_nothing_about_another() {
        let _guard = serial();
        set_workspace(Some(PathBuf::from("/tmp/magnetar-trusted-a")));
        trust_workspace().expect("trusted");
        set_workspace(Some(PathBuf::from("/tmp/magnetar-trusted-b")));
        assert!(!trusted());
        set_workspace(None);
    }

    #[test]
    fn trusting_nothing_is_an_error_rather_than_a_silent_success() {
        let _guard = serial();
        set_workspace(None);
        assert!(trust_workspace().is_err());
    }

    #[test]
    fn the_mode_is_off_until_it_is_turned_on() {
        let _guard = serial();
        // A security control that defaults on would be turned off once and
        // never thought about again; this one is a deliberate choice each time.
        assert!(!read_only());
        set_read_only(true);
        assert!(read_only());
        assert!(require(Access::Write).is_err());
        set_read_only(false);
        set_workspace(None); // no folder: trust is not the thing under test here
        assert!(require(Access::Write).is_ok());
    }
}
