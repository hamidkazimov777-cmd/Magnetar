//! Secret storage for provider API keys.
//!
//! ## Keychain first, and in a release build Keychain only
//!
//! This module once moved keys *out* of the Keychain. The reason was real: macOS
//! ties a Keychain item's ACL to the exact code signature that created it, so
//! every rebuild — and every ad-hoc signed build before that — produced a fresh
//! "Magnetar wants to access…" prompt, and "Always Allow" never stuck. Working
//! that way is intolerable, so keys went to a 0600 file instead.
//!
//! The fix for the prompts was never the file, though. It was a stable code
//! signature, which `scripts/setup-signing.sh` provides and this machine
//! already has: sign every build with the same identity and the ACL sticks.
//!
//! So the order is inverted. The Keychain is where keys live. The file remains
//! only as a **debug-build fallback**, for the case where a developer is
//! running an unsigned build and the Keychain refuses. A release binary will
//! not write a key to disk in the clear under any circumstance: if the Keychain
//! cannot be written, the operation fails and says so, because silently
//! downgrading the protection on someone's credentials is worse than refusing.
//!
//! Reading the old file is still allowed everywhere, since that is how existing
//! keys get migrated into the Keychain and the file deleted.

use once_cell::sync::Lazy;
use security_framework::passwords::{
    delete_generic_password, get_generic_password, set_generic_password,
};
use std::collections::HashMap;
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;

/// Keychain service name. Stable: changing it orphans every stored key.
const SERVICE: &str = "com.hamidkazimov.magnetar";

/// The debug-only fallback file. Named for what it is.
const FILE_NAME: &str = "secrets.json";

/// Whether this build may write a key to disk in the clear.
///
/// Split out so the policy is one readable expression rather than a `cfg`
/// scattered through the write paths — and so it can be asserted in a test.
pub const fn plaintext_fallback_allowed() -> bool {
    cfg!(debug_assertions)
}

/// Where a key ended up, so the UI can say so rather than implying protection
/// the build did not provide.
#[derive(Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Storage {
    Keychain,
    /// Debug builds only.
    PlaintextFile,
    None,
}

/// What to do with a key given how the Keychain responded.
fn decide(keychain_error: Option<String>) -> Result<Storage, String> {
    match keychain_error {
        None => Ok(Storage::Keychain),
        Some(why) if plaintext_fallback_allowed() => {
            eprintln!("magnetar: keychain unavailable ({why}); using the debug plaintext fallback");
            Ok(Storage::PlaintextFile)
        }
        Some(why) => Err(format!(
            "could not store the key in the macOS Keychain: {why}. \
             Refusing to write it to disk in the clear."
        )),
    }
}

/// In-memory cache plus the resolved on-disk location. The directory is handed
/// to us at startup by Tauri, which is the only component that knows it.
static STORE: Lazy<Mutex<Store>> = Lazy::new(|| Mutex::new(Store::default()));

#[derive(Default)]
struct Store {
    dir: Option<PathBuf>,
    keys: HashMap<String, String>,
    loaded: bool,
}

/// Called once from `setup` with the app data directory.
pub fn init(app_dir: &std::path::Path) {
    if let Ok(mut store) = STORE.lock() {
        store.dir = Some(app_dir.to_path_buf());
    }
}

fn path_of(store: &Store) -> Option<PathBuf> {
    store.dir.as_ref().map(|d| d.join(FILE_NAME))
}

fn load(store: &mut Store) {
    if store.loaded {
        return;
    }
    store.loaded = true;
    let Some(path) = path_of(store) else { return };
    let Ok(text) = std::fs::read_to_string(&path) else {
        return;
    };
    if let Ok(map) = serde_json::from_str::<HashMap<String, String>>(&text) {
        store.keys = map;
    }
}

fn persist(store: &Store) -> Result<(), String> {
    let Some(path) = path_of(store) else {
        return Err("secret store not initialised".into());
    };
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(&store.keys).map_err(|e| e.to_string())?;

    // Create with 0600 from the start — writing first and chmod'ing after would
    // leave a window where the file is world-readable.
    let mut opts = std::fs::OpenOptions::new();
    opts.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o600);
    }
    let mut f = opts.open(&path).map_err(|e| e.to_string())?;
    f.write_all(json.as_bytes()).map_err(|e| e.to_string())?;
    Ok(())
}

/// Store a key. Keychain first; a debug build may fall back to the file.
pub fn set_key(connection_id: &str, key: &str) -> Result<(), String> {
    let outcome = set_generic_password(SERVICE, connection_id, key.as_bytes())
        .err()
        .map(|e| e.to_string());

    match decide(outcome)? {
        Storage::Keychain => {
            // A copy left behind in the fallback file would outlive the key it
            // duplicates and quietly become the older, wrong one.
            let mut store = STORE.lock().map_err(|_| "secret store lock failed")?;
            load(&mut store);
            if store.keys.remove(connection_id).is_some() {
                let _ = persist(&store);
            }
            Ok(())
        }
        Storage::PlaintextFile => {
            let mut store = STORE.lock().map_err(|_| "secret store lock failed")?;
            load(&mut store);
            store.keys.insert(connection_id.to_string(), key.to_string());
            persist(&store)
        }
        Storage::None => Err("no storage available for the key".into()),
    }
}

/// Fetch a key, moving it into the Keychain if it is still in the old file.
pub fn get_key(connection_id: &str) -> Result<Option<String>, String> {
    if let Ok(bytes) = get_generic_password(SERVICE, connection_id) {
        return Ok(Some(String::from_utf8_lossy(&bytes).into_owned()));
    }

    // Not in the Keychain: it may predate this change. Reading the old file is
    // allowed in every build, because that is how a key gets rescued out of it.
    let mut store = STORE.lock().map_err(|_| "secret store lock failed")?;
    load(&mut store);
    let Some(key) = store.keys.get(connection_id).cloned() else {
        return Ok(None);
    };

    // Promote it, and only drop the plaintext copy once the Keychain has it.
    if set_generic_password(SERVICE, connection_id, key.as_bytes()).is_ok() {
        store.keys.remove(connection_id);
        let _ = persist(&store);
    }
    Ok(Some(key))
}

pub fn delete_key(connection_id: &str) -> Result<(), String> {
    let _ = delete_generic_password(SERVICE, connection_id);
    let mut store = STORE.lock().map_err(|_| "secret store lock failed")?;
    load(&mut store);
    if store.keys.remove(connection_id).is_some() {
        persist(&store)?;
    }
    Ok(())
}

pub fn has_key(connection_id: &str) -> bool {
    matches!(get_key(connection_id), Ok(Some(_)))
}

/// Where this connection's key is actually kept. Shown in Settings so the user
/// is told the truth rather than being left to assume the Keychain.
pub fn storage_of(connection_id: &str) -> Storage {
    if get_generic_password(SERVICE, connection_id).is_ok() {
        return Storage::Keychain;
    }
    let Ok(mut store) = STORE.lock() else {
        return Storage::None;
    };
    load(&mut store);
    if store.keys.contains_key(connection_id) {
        Storage::PlaintextFile
    } else {
        Storage::None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_release_build_never_writes_a_key_in_the_clear() {
        // The whole point of the inversion. If the Keychain refuses, a release
        // build must fail loudly rather than quietly downgrading protection on
        // someone's credentials.
        let refused = decide(Some("user denied access".into()));
        if plaintext_fallback_allowed() {
            assert_eq!(refused.expect("debug falls back"), Storage::PlaintextFile);
        } else {
            let err = refused.expect_err("release refuses");
            assert!(err.contains("Keychain"));
            assert!(err.contains("Refusing"));
        }
    }

    #[test]
    fn a_working_keychain_is_always_preferred() {
        assert_eq!(decide(None).expect("stored"), Storage::Keychain);
    }

    #[test]
    fn the_fallback_is_a_debug_only_policy() {
        // Guards against the `cfg` being edited into something unconditional.
        assert_eq!(plaintext_fallback_allowed(), cfg!(debug_assertions));
    }

    #[test]
    fn the_refusal_message_does_not_echo_the_key() {
        // Error strings reach logs and the UI; a message that quotes what it
        // failed to store is the exact leak this module exists to prevent.
        let message = decide(Some("errSecAuthFailed".into()))
            .err()
            .unwrap_or_default();
        assert!(!message.contains("sk-"));
    }
}
