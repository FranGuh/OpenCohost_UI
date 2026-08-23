use crate::provisioning::cancellation::CancellationToken;
use crate::provisioning::error::{ProvisionDeadline, ProvisionError};
use std::collections::BTreeMap;
use std::path::Path;

pub trait HealthChecker {
    fn check(
        &self,
        project_dir: &Path,
        python_executable: &Path,
        env: &BTreeMap<String, String>,
        cancel: &CancellationToken,
        deadline: &ProvisionDeadline,
    ) -> Result<(), ProvisionError>;
}
