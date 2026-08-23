#[cfg(windows)]
pub use windows_impl::JobObject;

#[cfg(not(windows))]
pub use non_windows_impl::JobObject;

#[cfg(windows)]
mod windows_impl {
    use std::os::windows::io::AsRawHandle;
    use std::process::Child;

    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };

    use windows_sys::Win32::Foundation::HANDLE;

    pub struct JobObject(HANDLE);

    // SAFETY: a Win32 HANDLE is an opaque kernel object reference — it's
    // fine to move across threads, and every Win32 call made on it here is
    // safe to invoke from any thread.
    unsafe impl Send for JobObject {}

    impl JobObject {
        /// Creates an anonymous kill-on-close job object and assigns
        /// `child` to it. Returns `None` on any Win32 failure — a failure
        /// here must never abort the already-successful spawn, it just
        /// means this particular child loses the crash-orphan guarantee.
        pub fn assign(child: &Child) -> Option<Self> {
            unsafe {
                let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
                if job.is_null() {
                    eprintln!(
                        "JobObject: CreateJobObjectW failed, backend won't be killed on host crash"
                    );
                    return None;
                }

                let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
                info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;

                let set_ok = SetInformationJobObject(
                    job,
                    JobObjectExtendedLimitInformation,
                    &info as *const _ as *const core::ffi::c_void,
                    std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
                );
                if set_ok == 0 {
                    eprintln!("JobObject: SetInformationJobObject failed, backend won't be killed on host crash");
                    CloseHandle(job);
                    return None;
                }

                let process_handle = child.as_raw_handle() as HANDLE;
                let assign_ok = AssignProcessToJobObject(job, process_handle);
                if assign_ok == 0 {
                    eprintln!("JobObject: AssignProcessToJobObject failed, backend won't be killed on host crash");
                    CloseHandle(job);
                    return None;
                }

                Some(JobObject(job))
            }
        }

        /// Assigns an additional, already-spawned `child` to this same job so
        /// it shares the kill-on-close guarantee. Returns `true` on success; a
        /// failure just means this extra child loses the crash-orphan
        /// guarantee — never fatal, never aborts an already-successful spawn.
        pub fn assign_existing(&self, child: &Child) -> bool {
            unsafe {
                let process_handle = child.as_raw_handle() as HANDLE;
                if AssignProcessToJobObject(self.0, process_handle) == 0 {
                    eprintln!("JobObject: AssignProcessToJobObject (PTT bridge) failed, bridge won't be killed on host crash");
                    return false;
                }
                true
            }
        }
    }

    impl Drop for JobObject {
        fn drop(&mut self) {
            unsafe {
                CloseHandle(self.0);
            }
        }
    }
}

#[cfg(not(windows))]
mod non_windows_impl {
    use std::process::Child;

    pub struct JobObject;

    impl JobObject {
        pub fn assign(_child: &Child) -> Option<Self> {
            None
        }

        pub fn assign_existing(&self, _child: &Child) -> bool {
            false
        }
    }
}
