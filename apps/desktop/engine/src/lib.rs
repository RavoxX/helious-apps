pub mod knowledge;
pub mod remote;
mod service;
pub mod sync;
pub mod updater;
pub mod vault;
pub use service::Engine;
pub const CLOUD_ORIGIN: &str = "https://helious.work";
#[cfg(test)]
mod remote_tests;
#[cfg(test)]
mod service_tests;
#[cfg(test)]
mod sync_tests;
#[cfg(test)]
mod updater_tests;
#[cfg(test)]
mod vault_tests;

use serde_json::{json, Value};
use std::{
    ffi::{CStr, CString},
    os::raw::c_char,
    sync::{Mutex, OnceLock},
};
static ENGINE: OnceLock<Mutex<Option<Engine>>> = OnceLock::new();
/// Synchronous C bridge. Call from a background queue; caller owns returned UTF-8 until helious_free.
/// # Safety
/// `request` must point to a live, NUL-terminated UTF-8 string for the duration of the call.
#[no_mangle]
pub unsafe extern "C" fn helious_call(request: *const c_char) -> *mut c_char {
    let response = std::panic::catch_unwind(|| {
        if request.is_null() {
            return Err("Missing native request.".to_string());
        }
        let source = unsafe { CStr::from_ptr(request) }
            .to_str()
            .map_err(|_| "Invalid request encoding.")?;
        if source.len() > 32 * 1024 * 1024 {
            return Err("Native request is too large.".into());
        }
        let value: Value = serde_json::from_str(source).map_err(|_| "Invalid native request.")?;
        let mut state = ENGINE
            .get_or_init(|| Mutex::new(None))
            .lock()
            .map_err(|_| "Native engine unavailable.")?;
        if value["operation"] == "initialize" {
            if state.is_none() {
                let folder = value["dataDir"]
                    .as_str()
                    .ok_or("Missing application data folder.")?;
                *state = Some(Engine::new(folder.into())?);
            }
            return Ok(json!({"ready":true}));
        }
        state
            .as_mut()
            .ok_or("Initialize the native engine first.")?
            .execute(value)
    });
    let value = match response {
        Ok(Ok(data)) => json!({"ok":true,"data":data}),
        Ok(Err(error)) => json!({"ok":false,"error":error}),
        Err(_) => {
            json!({"ok":false,"error":"Native operation failed. Your existing files have been preserved."})
        }
    };
    CString::new(value.to_string())
        .unwrap_or_default()
        .into_raw()
}
/// # Safety
/// `response` must be an unfreed pointer returned by helious_call, or null.
#[no_mangle]
pub unsafe extern "C" fn helious_free(response: *mut c_char) {
    if !response.is_null() {
        drop(unsafe { CString::from_raw(response) });
    }
}
