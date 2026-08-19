//! Secret storage for provider API keys.
//!
//! ## Why this is not the Keychain any more
//!
//! It used to be. The Keychain is the right default, but on this machine it
//! made the app unusable: macOS ties an item's ACL to the exact code signature
//! that created it, so every rebuild — and every unsigned or ad-hoc signed
//! build before that — produced a fresh "Magnetar wants to access…" password
//! prompt, and "Always allow" never stuck. The owner asked for the prompts to
//! stop on his own personal machine.
//!
//! So keys now live in a file inside the app's data directory, created with
//! mode 0600 (owner read/write only). Be clear-eyed about the trade: this is
//! **not** encrypted at rest. Anything running as this user can read it, and it
//! is no longer protected by the login password the way a Keychain item is. It
//! is the same posture as `~/.aws/credentials`, `~/.npmrc` or a `.env` file —
//! standard for developer tooling, weaker than the Keychain.
//!
//! Keys still never leave the machine except to the provider endpoint the user
//! configured, and the file is never in the repository.

use once_cell::sync::Lazy;
use security_framework::passwords::{delete_generic_password, get_generic_password};
use std::collections::HashMap;
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;

/// Legacy Keychain service, kept only so existing keys can be migrated out.
const SERVICE: &str = "com.hamidkazimov.magnetar";

const FILE_NAME: &str = "secrets.json";

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

/// One-time rescue of a key that still lives in the Keychain. This is the only
/// remaining Keychain read, and it happens at most once per connection —
/// afterwards the key is in the file and macOS is never asked again.
fn migrate_from_keychain(connection_id: &str) -> Option<String> {
    match get_generic_password(SERVICE, connection_id) {
        Ok(bytes) => Some(String::from_utf8_lossy(&bytes).into_owned()),
        Err(_) => None,
    }
}

pub fn set_key(connection_id: &str, key: &str) -> Result<(), String> {
    let mut store = STORE.lock().map_err(|_| "secret store lock failed")?;
    load(&mut store);
    store.keys.insert(connection_id.to_string(), key.to_string());
    persist(&store)
}

pub fn get_key(connection_id: &str) -> Result<Option<String>, String> {
    let mut store = STORE.lock().map_err(|_| "secret store lock failed")?;
    load(&mut store);

    if let Some(key) = store.keys.get(connection_id) {
        return Ok(Some(key.clone()));
    }

    if let Some(key) = migrate_from_keychain(connection_id) {
        store.keys.insert(connection_id.to_string(), key.clone());
        // Best-effort: a failed write just means we migrate again next launch.
        let _ = persist(&store);
        // Drop the Keychain copy so the prompt cannot come back for it.
        let _ = delete_generic_password(SERVICE, connection_id);
        return Ok(Some(key));
    }

    Ok(None)
}

pub fn delete_key(connection_id: &str) -> Result<(), String> {
    let mut store = STORE.lock().map_err(|_| "secret store lock failed")?;
    load(&mut store);
    store.keys.remove(connection_id);
    let _ = delete_generic_password(SERVICE, connection_id);
    persist(&store)
}

pub fn has_key(connection_id: &str) -> bool {
    matches!(get_key(connection_id), Ok(Some(_)))
}
