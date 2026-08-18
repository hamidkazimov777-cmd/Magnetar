//! Secret storage via the macOS Keychain (security-framework generic passwords).
//! API keys never touch disk in plaintext and never leave the machine except to
//! the provider endpoint the user configured.

use security_framework::passwords::{
    delete_generic_password, get_generic_password, set_generic_password,
};

/// One Keychain item per app; the account field is the connection id.
const SERVICE: &str = "com.hamidkazimov.magnetar";

pub fn set_key(connection_id: &str, key: &str) -> Result<(), String> {
    set_generic_password(SERVICE, connection_id, key.as_bytes())
        .map_err(|e| format!("keychain set failed: {e}"))
}

pub fn get_key(connection_id: &str) -> Result<Option<String>, String> {
    match get_generic_password(SERVICE, connection_id) {
        Ok(bytes) => Ok(Some(String::from_utf8_lossy(&bytes).into_owned())),
        // Not found is not an error for our purposes.
        Err(_) => Ok(None),
    }
}

pub fn delete_key(connection_id: &str) -> Result<(), String> {
    match delete_generic_password(SERVICE, connection_id) {
        Ok(_) => Ok(()),
        Err(_) => Ok(()), // idempotent
    }
}

pub fn has_key(connection_id: &str) -> bool {
    matches!(get_key(connection_id), Ok(Some(_)))
}
