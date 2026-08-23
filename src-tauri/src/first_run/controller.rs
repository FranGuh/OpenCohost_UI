use crate::first_run::status::{
    safe_error, status, FirstRunError, FirstRunPhase, FirstRunStatus, ProgressSnapshot,
};
use crate::provisioning::CancellationToken;
use std::sync::{Arc, Mutex};

#[derive(Clone)]
pub struct ProvisioningController {
    inner: Arc<Mutex<ControllerInner>>,
}

struct ControllerInner {
    status: FirstRunStatus,
    cancel: Option<CancellationToken>,
}

impl ProvisioningController {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(ControllerInner {
                status: status(
                    FirstRunPhase::Unconfigured,
                    None,
                    None,
                    "Choose a local data folder",
                    true,
                    None,
                    Some("unconfigured"),
                ),
                cancel: None,
            })),
        }
    }

    pub fn status(&self) -> FirstRunStatus {
        self.inner.lock().unwrap().status.clone()
    }

    pub fn cancel(&self) -> Result<(), FirstRunError> {
        let guard = self.inner.lock().unwrap();
        let cancel = guard.cancel.as_ref().ok_or_else(|| {
            FirstRunError::new(
                "not_provisioning",
                "No provisioning operation is active",
                false,
            )
        })?;
        if cancel.cancel() {
            Ok(())
        } else {
            Err(FirstRunError::new(
                "cancellation_too_late",
                "Activation is already finishing; cancellation was not accepted",
                false,
            ))
        }
    }

    pub fn start_with_task<F>(&self, task: F) -> Result<(), FirstRunError>
    where
        F: FnOnce(
                CancellationToken,
                Arc<dyn Fn(ProgressSnapshot) + Send + Sync>,
            ) -> Result<(), FirstRunError>
            + Send
            + 'static,
    {
        let cancel = CancellationToken::new();
        let callback_controller = self.clone();
        let progress: Arc<dyn Fn(ProgressSnapshot) + Send + Sync> =
            Arc::new(move |snapshot| callback_controller.update_progress(snapshot));
        {
            let mut guard = self.inner.lock().unwrap();
            if guard.cancel.is_some() {
                return Err(FirstRunError::new(
                    "operation_busy",
                    "Provisioning is already running",
                    true,
                ));
            }
            guard.cancel = Some(cancel.clone());
            guard.status.phase = FirstRunPhase::Provisioning;
            guard.status.launchable = false;
            guard.status.error_code = None;
            guard.status.progress = None;
            guard.status.message = "Core runtime provisioning in progress".into();
            guard.status.can_retry = false;
        }
        let controller = self.clone();
        std::thread::spawn(move || {
            let result = task(cancel, progress);
            let mut guard = controller.inner.lock().unwrap();
            guard.cancel = None;
            match result {
                Ok(()) => {
                    guard.status.phase = FirstRunPhase::Ready;
                    guard.status.launchable = true;
                    guard.status.can_retry = false;
                    guard.status.message = "Core runtime ready".into();
                }
                Err(error) => {
                    let error = safe_error(&error);
                    guard.status.phase = FirstRunPhase::Failed;
                    guard.status.launchable = false;
                    guard.status.can_retry = error.retryable;
                    guard.status.error_code = Some(error.code);
                    guard.status.message = error.message;
                }
            }
        });
        Ok(())
    }

    fn update_progress(&self, snapshot: ProgressSnapshot) {
        let mut guard = self.inner.lock().unwrap();
        let replace = guard
            .status
            .progress
            .as_ref()
            .map(|current| {
                current.phase != snapshot.phase || snapshot.completed >= current.completed
            })
            .unwrap_or(true);
        if replace {
            guard.status.progress = Some(snapshot);
        }
    }
}

impl Default for ProvisioningController {
    fn default() -> Self {
        Self::new()
    }
}
