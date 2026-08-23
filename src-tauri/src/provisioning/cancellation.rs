use crate::provisioning::error::{ProvisionDeadline, ProvisionError, ProvisionErrorCode};
use std::sync::{Arc, Mutex};

#[derive(Clone)]
pub struct CancellationToken(pub(crate) Arc<Mutex<CancellationState>>);

#[derive(Default)]
pub(crate) struct CancellationState {
    pub(crate) cancelled: bool,
    pub(crate) commit_started: bool,
    pub(crate) committed: bool,
}

pub struct CommitGuard {
    pub(crate) token: CancellationToken,
    pub(crate) completed: bool,
}

#[cfg(test)]
pub(crate) type ActivationWaitHook =
    Box<dyn Fn(&CancellationToken, &ProvisionDeadline) + Send + Sync>;
#[cfg(test)]
pub(crate) type ActivationCommitHook = Box<dyn Fn(&CommitGuard, &ProvisionDeadline) + Send + Sync>;
#[cfg(test)]
static ACTIVATION_WAIT_HOOK: Mutex<Option<ActivationWaitHook>> = Mutex::new(None);
#[cfg(test)]
static ACTIVATION_COMMIT_HOOK: Mutex<Option<ActivationCommitHook>> = Mutex::new(None);
#[cfg(test)]
pub(crate) static ACTIVATION_HOOK_TEST_LOCK: Mutex<()> = Mutex::new(());

#[cfg(test)]
pub(crate) fn set_activation_wait_hook(hook: Option<ActivationWaitHook>) {
    *ACTIVATION_WAIT_HOOK
        .lock()
        .expect("activation wait hook lock") = hook;
}

#[cfg(test)]
pub(crate) fn set_activation_commit_hook(hook: Option<ActivationCommitHook>) {
    *ACTIVATION_COMMIT_HOOK
        .lock()
        .expect("activation commit hook lock") = hook;
}

#[cfg(test)]
pub(crate) fn invoke_activation_wait_hook(
    cancel: &CancellationToken,
    deadline: &ProvisionDeadline,
) {
    if let Some(hook) = ACTIVATION_WAIT_HOOK
        .lock()
        .expect("activation wait hook lock")
        .as_ref()
    {
        hook(cancel, deadline);
    }
}

#[cfg(test)]
pub(crate) fn invoke_activation_commit_hook(commit: &CommitGuard, deadline: &ProvisionDeadline) {
    if let Some(hook) = ACTIVATION_COMMIT_HOOK
        .lock()
        .expect("activation commit hook lock")
        .as_ref()
    {
        hook(commit, deadline);
    }
}

impl Drop for CommitGuard {
    fn drop(&mut self) {
        if !self.completed {
            self.token.finish_commit(false);
        }
    }
}

impl CommitGuard {
    pub(crate) fn check_deadline(
        &self,
        deadline: &ProvisionDeadline,
    ) -> Result<(), ProvisionError> {
        if deadline.is_expired() {
            return Err(ProvisionError::new(
                ProvisionErrorCode::DeadlineExceeded,
                "provisioning deadline exceeded",
                true,
            ));
        }
        Ok(())
    }

    pub fn complete(mut self) {
        self.token.finish_commit(true);
        self.completed = true;
    }
}

impl Default for CancellationToken {
    fn default() -> Self {
        Self::new()
    }
}

impl CancellationToken {
    pub fn new() -> Self {
        Self(Arc::new(Mutex::new(CancellationState::default())))
    }
    pub fn cancel(&self) -> bool {
        let Ok(mut state) = self.0.lock() else {
            return false;
        };
        if state.commit_started || state.committed {
            return false;
        }
        state.cancelled = true;
        true
    }
    pub fn is_cancelled(&self) -> bool {
        self.0.lock().map(|state| state.cancelled).unwrap_or(true)
    }
    pub fn try_begin_commit(&self) -> Option<CommitGuard> {
        let Ok(mut state) = self.0.lock() else {
            return None;
        };
        if state.cancelled || state.commit_started || state.committed {
            return None;
        }
        state.commit_started = true;
        Some(CommitGuard {
            token: self.clone(),
            completed: false,
        })
    }
    fn finish_commit(&self, success: bool) {
        if let Ok(mut state) = self.0.lock() {
            state.commit_started = false;
            state.committed = success;
        }
    }
}

pub(crate) fn ensure_not_cancelled(cancel: &CancellationToken) -> Result<(), ProvisionError> {
    if cancel.is_cancelled() {
        Err(ProvisionError::new(
            ProvisionErrorCode::Cancelled,
            "operation cancelled",
            true,
        ))
    } else {
        Ok(())
    }
}
