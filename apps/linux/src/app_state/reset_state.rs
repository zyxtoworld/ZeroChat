use super::LinuxAppState;
use crate::{
    defaults::default_snapshot,
    local_data_transition::recover_pending_local_data_transition_during_local_data_commit,
    storage::{LocalDataTransition, snapshot_fingerprint},
};
use std::collections::BTreeSet;

impl LinuxAppState {
    pub(crate) fn reset_local_data(&self) -> anyhow::Result<()> {
        let replacement = default_snapshot();
        let previous = self.snapshot.borrow().clone();
        let store = self
            .store
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("Local storage is unavailable."))?;
        let guard = store.lock_local_data_commit();
        let recovering = self.local_persistence_blocked();
        if recovering {
            store.discard_local_data_transition(&guard)?;
        }
        let source_snapshot_fingerprint = if recovering {
            None
        } else {
            Some(snapshot_fingerprint(
                store.load_during_local_data_commit(&guard)?.as_ref(),
            )?)
        };
        let provider_ids = previous
            .providers
            .iter()
            .chain(replacement.providers.iter())
            .map(|provider| provider.id.clone())
            .collect::<BTreeSet<_>>();
        let transition = LocalDataTransition::reset(
            source_snapshot_fingerprint,
            replacement,
            provider_ids.into_iter().collect(),
        );
        store.stage_local_data_transition(&guard, &transition)?;
        let replacement = match recover_pending_local_data_transition_during_local_data_commit(
            store,
            self.secrets.as_ref(),
            &guard,
        ) {
            Ok(Some(replacement)) => replacement,
            Ok(None) => anyhow::bail!("The local reset recovery record disappeared."),
            Err(error) => {
                self.report_local_storage_issue(super::LinuxLocalStorageIssue::SnapshotLoadFailed);
                return Err(error);
            }
        };

        *self.snapshot.borrow_mut() = replacement.clone();
        *self.committed_snapshot.borrow_mut() = replacement;
        self.clear_local_storage_issue();
        Ok(())
    }
}
