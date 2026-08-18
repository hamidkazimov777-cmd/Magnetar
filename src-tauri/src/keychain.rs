//! Secret storage via the macOS Keychain (security-framework generic passwords).
//! API keys never touch disk in plaintext and never leave the machine except to
//! the provider endpoint the user configured.

use security_framework::passwords::{
    delete_generic_password, get_generic_password, set_generic_password,
};
use once_cell::sync::Lazy;
use std::collections::HashMap;
use std::sync::Mutex;

/// One Keychain item per app; the account field is the connection id.
const SERVICE: &str = "com.hamidkazimov.magnetar";

/// Keychain is deliberately still the durable secret store. This cache only
/// lives for the current process and prevents macOS from asking to unlock the
/// same item again for every model list, health check, or streamed request.
static SESSION_KEYS: Lazy<Mutex<HashMap<String, String>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

pub fn set_key(connection_id: &str, key: &str) -> Result<(), String> {
    set_generic_password(SERVICE, connection_id, key.as_bytes())
        .map_err(|e| format!("keychain set failed: {e}"))?;
    SESSION_KEYS
        .lock()
        .map_err(|_| "key cache lock failed".to_string())?
        .insert(connection_id.to_string(), key.to_string());
    Ok(())
}

pub fn get_key(connection_id: &str) -> Result<Option<String>, String> {
    if let Some(key) = SESSION_KEYS
        .lock()
        .map_err(|_| "key cache lock failed".to_string())?
        .get(connection_id)
        .cloned()
    {
        return Ok(Some(key));
    }

    match get_generic_password(SERVICE, connection_id) {
        Ok(bytes) => {
            let key = String::from_utf8_lossy(&bytes).into_owned();
            SESSION_KEYS
                .lock()
                .map_err(|_| "key cache lock failed".to_string())?
                .insert(connection_id.to_string(), key.clone());
            Ok(Some(key))
        }
        // Not found is not an error for our purposes.
        Err(_) => Ok(None),
    }
}

pub fn delete_key(connection_id: &str) -> Result<(), String> {
    if let Ok(mut cache) = SESSION_KEYS.lock() {
        cache.remove(connection_id);
    }
    match delete_generic_password(SERVICE, connection_id) {
        Ok(_) => Ok(()),
        Err(_) => Ok(()), // idempotent
    }
}

pub fn has_key(connection_id: &str) -> bool {
    matches!(get_key(connection_id), Ok(Some(_)))
}
