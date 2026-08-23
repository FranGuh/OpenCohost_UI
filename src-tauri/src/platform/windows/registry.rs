#[cfg(windows)]
pub const RUNTIME_REGISTRY_KEY: &str = r"Software\OpenCohost\Runtime";

#[cfg(windows)]
#[derive(Debug, Clone, Copy, Default)]
pub struct WindowsRegistryHandoff;

#[cfg(windows)]
impl crate::runtime::handoff::HandoffStore for WindowsRegistryHandoff {
    fn value(&self, name: &str) -> Option<String> {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::System::Registry::{
            RegCloseKey, RegOpenKeyExW, RegQueryValueExW, HKEY_CURRENT_USER, KEY_READ, REG_SZ,
        };
        let key_name: Vec<u16> = std::ffi::OsStr::new(RUNTIME_REGISTRY_KEY)
            .encode_wide()
            .chain(Some(0))
            .collect();
        let value_name: Vec<u16> = std::ffi::OsStr::new(name)
            .encode_wide()
            .chain(Some(0))
            .collect();
        let mut key = std::ptr::null_mut();
        if unsafe { RegOpenKeyExW(HKEY_CURRENT_USER, key_name.as_ptr(), 0, KEY_READ, &mut key) }
            != 0
        {
            return None;
        }
        let mut value_type = 0;
        let mut byte_len = 0;
        let result = unsafe {
            RegQueryValueExW(
                key,
                value_name.as_ptr(),
                std::ptr::null(),
                &mut value_type,
                std::ptr::null_mut(),
                &mut byte_len,
            )
        };
        if result != 0 || value_type != REG_SZ || byte_len < 2 {
            unsafe {
                RegCloseKey(key);
            }
            return None;
        }
        let mut bytes = vec![0u8; byte_len as usize];
        let result = unsafe {
            RegQueryValueExW(
                key,
                value_name.as_ptr(),
                std::ptr::null(),
                &mut value_type,
                bytes.as_mut_ptr(),
                &mut byte_len,
            )
        };
        unsafe {
            RegCloseKey(key);
        }
        if result != 0 {
            return None;
        }
        let words: &[u16] =
            unsafe { std::slice::from_raw_parts(bytes.as_ptr().cast(), byte_len as usize / 2) };
        Some(
            String::from_utf16_lossy(words)
                .trim_end_matches('\0')
                .to_string(),
        )
    }
}

#[cfg(windows)]
impl crate::runtime::handoff::HandoffWriter for WindowsRegistryHandoff {
    fn write_values(
        &self,
        values: &[(String, String)],
    ) -> Result<(), crate::runtime::manifest::RuntimeManifestError> {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::System::Registry::{
            RegCloseKey, RegCreateKeyExW, RegSetValueExW, HKEY_CURRENT_USER, KEY_WRITE,
            REG_OPTION_NON_VOLATILE, REG_SZ,
        };
        let key_name: Vec<u16> = std::ffi::OsStr::new(RUNTIME_REGISTRY_KEY)
            .encode_wide()
            .chain(Some(0))
            .collect();
        let mut key = std::ptr::null_mut();
        let result = unsafe {
            RegCreateKeyExW(
                HKEY_CURRENT_USER,
                key_name.as_ptr(),
                0,
                std::ptr::null_mut(),
                REG_OPTION_NON_VOLATILE,
                KEY_WRITE,
                std::ptr::null(),
                &mut key,
                std::ptr::null_mut(),
            )
        };
        if result != 0 {
            return Err(crate::runtime::manifest::RuntimeManifestError::new(
                format!("HKCU handoff key could not be opened: win32={result}"),
            ));
        }
        let result = (|| {
            for (name, value) in values {
                let name: Vec<u16> = std::ffi::OsStr::new(name)
                    .encode_wide()
                    .chain(Some(0))
                    .collect();
                let mut encoded: Vec<u16> = std::ffi::OsStr::new(value).encode_wide().collect();
                encoded.push(0);
                let bytes = unsafe {
                    std::slice::from_raw_parts(
                        encoded.as_ptr().cast::<u8>(),
                        encoded.len() * std::mem::size_of::<u16>(),
                    )
                };
                let result = unsafe {
                    RegSetValueExW(
                        key,
                        name.as_ptr(),
                        0,
                        REG_SZ,
                        bytes.as_ptr(),
                        bytes.len() as u32,
                    )
                };
                if result != 0 {
                    return Err(crate::runtime::manifest::RuntimeManifestError::new(
                        format!("HKCU handoff value {name:?} could not be written: win32={result}"),
                    ));
                }
            }
            Ok(())
        })();
        unsafe { RegCloseKey(key) };
        result
    }
}
