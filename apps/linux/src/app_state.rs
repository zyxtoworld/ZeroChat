use crate::{
    auto_sync::AutoSyncCoordinator,
    defaults::{default_snapshot, normalize_official_provider_contracts},
    local_data_transition::recover_local_data_transition,
    media::{LinuxSpeechPlayback, play_speech_audio_bytes},
    models::AppSnapshot,
    secret_store::LinuxSecretStore,
    storage::SnapshotStore,
};
use std::{
    cell::RefCell,
    collections::BTreeSet,
    rc::Rc,
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};

mod chat_message_state;
mod chat_state;
mod conversation_state;
mod preference_state;
mod provider_state;
mod reset_state;
mod skill_state;
mod sync_state;

#[derive(Clone)]
pub(crate) struct LinuxAppState {
    snapshot: Rc<RefCell<AppSnapshot>>,
    committed_snapshot: Rc<RefCell<AppSnapshot>>,
    store: Option<Arc<SnapshotStore>>,
    local_storage_issue: Rc<RefCell<Option<LinuxLocalStorageIssue>>>,
    secrets: Arc<LinuxSecretStore>,
    auto_sync: Option<Arc<AutoSyncCoordinator<LinuxSecretStore>>>,
    sync_runtime: Option<Arc<tokio::runtime::Runtime>>,
    speech: Rc<RefCell<LinuxSpeechPlayback>>,
}

pub(crate) struct LinuxAppResources {
    snapshot: AppSnapshot,
    store: Option<Arc<SnapshotStore>>,
    local_storage_issue: Option<LinuxLocalStorageIssue>,
    secrets: Arc<LinuxSecretStore>,
    normalized: bool,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum ImageTaskMode {
    Generate,
    Edit,
    Inpaint,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum LinuxLocalStorageIssue {
    SnapshotLoadFailed,
    SnapshotSaveFailed,
    StorageUnavailable,
}

impl LinuxLocalStorageIssue {
    fn notice_key(self) -> &'static str {
        match self {
            Self::SnapshotLoadFailed => "message.localSnapshotLoadFailed",
            Self::SnapshotSaveFailed => "message.localSnapshotSaveFailed",
            Self::StorageUnavailable => "message.localStorageUnavailable",
        }
    }

    fn error_message(self) -> &'static str {
        match self {
            Self::SnapshotLoadFailed => "Local snapshot recovery is required.",
            Self::SnapshotSaveFailed => "Local snapshot persistence failed.",
            Self::StorageUnavailable => "Local storage is unavailable.",
        }
    }
}

fn resolve_initial_snapshot(
    loaded: Result<Option<AppSnapshot>, LinuxLocalStorageIssue>,
) -> (AppSnapshot, bool, Option<LinuxLocalStorageIssue>) {
    match loaded {
        Ok(Some(snapshot)) if !snapshot.providers.is_empty() => {
            let (snapshot, normalized) = normalize_official_provider_contracts(snapshot);
            (snapshot, normalized, None)
        }
        Ok(_) => (default_snapshot(), false, None),
        Err(issue) => (default_snapshot(), false, Some(issue)),
    }
}

impl LinuxAppState {
    pub(crate) fn load_resources() -> LinuxAppResources {
        let store = match SnapshotStore::new() {
            Ok(store) => Arc::new(store),
            Err(_) => {
                let snapshot = default_snapshot();
                let provider_ids = snapshot
                    .providers
                    .iter()
                    .map(|provider| provider.id.clone())
                    .collect();
                return LinuxAppResources {
                    snapshot,
                    store: None,
                    local_storage_issue: Some(LinuxLocalStorageIssue::StorageUnavailable),
                    secrets: Arc::new(LinuxSecretStore::load(provider_ids)),
                    normalized: false,
                };
            }
        };

        let loaded_before_recovery = store.load();
        let pending_transition = store.load_local_data_transition();
        let mut provider_ids = default_snapshot()
            .providers
            .into_iter()
            .map(|provider| provider.id)
            .collect::<BTreeSet<_>>();
        if let Ok(Some(snapshot)) = &loaded_before_recovery {
            provider_ids.extend(
                snapshot
                    .providers
                    .iter()
                    .map(|provider| provider.id.clone()),
            );
        }
        if let Ok(Some(transition)) = &pending_transition {
            provider_ids.extend(transition.provider_ids.iter().cloned());
        }
        let secrets = Arc::new(LinuxSecretStore::load(provider_ids.into_iter().collect()));
        let loaded = match pending_transition {
            Ok(Some(transition)) => {
                recover_local_data_transition(&store, secrets.as_ref(), transition)
                    .and_then(|_| store.load())
                    .map_err(|_| LinuxLocalStorageIssue::SnapshotLoadFailed)
            }
            Ok(None) => {
                loaded_before_recovery.map_err(|_| LinuxLocalStorageIssue::SnapshotLoadFailed)
            }
            Err(_) => Err(LinuxLocalStorageIssue::SnapshotLoadFailed),
        };
        let (snapshot, normalized, local_storage_issue) = resolve_initial_snapshot(loaded);

        LinuxAppResources {
            snapshot,
            store: Some(store),
            local_storage_issue,
            secrets,
            normalized,
        }
    }

    pub(crate) fn from_resources(resources: LinuxAppResources) -> Self {
        let LinuxAppResources {
            snapshot,
            store,
            local_storage_issue,
            secrets,
            normalized,
        } = resources;
        let auto_sync = store
            .as_ref()
            .map(|store| Arc::new(AutoSyncCoordinator::new(store.clone(), secrets.clone())));
        let sync_runtime = auto_sync.as_ref().and_then(|_| {
            tokio::runtime::Builder::new_multi_thread()
                .enable_all()
                .thread_name("zerochat-linux-sync")
                .build()
                .ok()
                .map(Arc::new)
        });

        let state = Self {
            snapshot: Rc::new(RefCell::new(snapshot.clone())),
            committed_snapshot: Rc::new(RefCell::new(snapshot)),
            store,
            local_storage_issue: Rc::new(RefCell::new(local_storage_issue)),
            secrets,
            auto_sync,
            sync_runtime,
            speech: Rc::new(RefCell::new(LinuxSpeechPlayback::default())),
        };

        if normalized {
            state.save();
        }

        state
    }

    pub(crate) fn take_secret_store_issue(&self) -> Option<String> {
        self.secrets.take_issue()
    }

    pub(crate) fn local_storage_notice_key(&self) -> Option<&'static str> {
        (*self.local_storage_issue.borrow()).map(LinuxLocalStorageIssue::notice_key)
    }

    fn local_storage_blocker_message(&self) -> Option<&'static str> {
        (*self.local_storage_issue.borrow()).map(LinuxLocalStorageIssue::error_message)
    }

    fn local_persistence_blocked(&self) -> bool {
        self.local_storage_issue.borrow().is_some()
    }

    fn clear_local_storage_issue(&self) {
        *self.local_storage_issue.borrow_mut() = None;
    }

    fn report_local_storage_issue(&self, issue: LinuxLocalStorageIssue) {
        *self.local_storage_issue.borrow_mut() = Some(issue);
    }

    fn restore_committed_snapshot(&self) {
        *self.snapshot.borrow_mut() = self.committed_snapshot.borrow().clone();
    }

    fn persist_recovered_snapshot(&self, snapshot: &AppSnapshot) -> anyhow::Result<()> {
        let store = self
            .store
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("Local storage is unavailable."))?;
        store
            .save(snapshot)
            .map_err(|_| anyhow::anyhow!("Local snapshot recovery failed."))?;
        *self.committed_snapshot.borrow_mut() = snapshot.clone();
        self.clear_local_storage_issue();
        Ok(())
    }

    pub(crate) fn begin_speaking_message(&self, message_id: &str) -> u64 {
        self.speech.borrow_mut().begin(message_id)
    }

    pub(crate) fn speaking_message_id(&self) -> Option<String> {
        self.speech.borrow().speaking_message_id()
    }

    pub(crate) fn is_current_speech_request(&self, message_id: &str, serial: u64) -> bool {
        self.speech.borrow().is_current(message_id, serial)
    }

    pub(crate) fn stop_speaking_message(&self) -> bool {
        self.speech.borrow_mut().stop()
    }

    pub(crate) fn play_speech_audio(
        &self,
        message_id: String,
        serial: u64,
        bytes: Vec<u8>,
    ) -> Result<(), String> {
        play_speech_audio_bytes(self.speech.clone(), message_id, serial, bytes)
    }
}

#[cfg(test)]
mod tests {
    use super::{LinuxLocalStorageIssue, persist_snapshot_candidate, resolve_initial_snapshot};
    use crate::defaults::default_snapshot;
    use std::{cell::RefCell, rc::Rc};

    #[test]
    fn missing_snapshot_is_a_clean_first_run() {
        let (_, normalized, issue) = resolve_initial_snapshot(Ok(None));

        assert!(!normalized);
        assert_eq!(issue, None);
    }

    #[test]
    fn snapshot_load_failure_is_not_treated_as_first_run() {
        let (_, normalized, issue) =
            resolve_initial_snapshot(Err(LinuxLocalStorageIssue::SnapshotLoadFailed));

        assert!(!normalized);
        assert_eq!(issue, Some(LinuxLocalStorageIssue::SnapshotLoadFailed));
    }

    #[test]
    fn failed_snapshot_save_restores_the_last_committed_state() {
        let committed = default_snapshot();
        let mut changed = committed.clone();
        changed.preferences.theme = "dark".to_owned();
        changed.updated_at += 1;
        let visible = Rc::new(RefCell::new(changed));
        let baseline = Rc::new(RefCell::new(committed.clone()));

        let result =
            persist_snapshot_candidate(&visible, &baseline, |_| anyhow::bail!("disk full"));

        assert_eq!(result, Err(LinuxLocalStorageIssue::SnapshotSaveFailed));
        assert_eq!(*visible.borrow(), committed);
        assert_eq!(*baseline.borrow(), committed);
    }

    #[test]
    fn successful_snapshot_save_advances_the_committed_state() {
        let committed = default_snapshot();
        let mut changed = committed.clone();
        changed.preferences.theme = "dark".to_owned();
        changed.updated_at += 1;
        let visible = Rc::new(RefCell::new(changed.clone()));
        let baseline = Rc::new(RefCell::new(committed));

        let result = persist_snapshot_candidate(&visible, &baseline, |_| Ok(()));

        assert_eq!(result, Ok(changed.clone()));
        assert_eq!(*visible.borrow(), changed);
        assert_eq!(*baseline.borrow(), changed);
    }
}

fn persist_snapshot_candidate(
    snapshot: &Rc<RefCell<AppSnapshot>>,
    committed_snapshot: &Rc<RefCell<AppSnapshot>>,
    persist: impl FnOnce(&AppSnapshot) -> anyhow::Result<()>,
) -> Result<AppSnapshot, LinuxLocalStorageIssue> {
    let candidate = snapshot.borrow().clone();
    if persist(&candidate).is_err() {
        *snapshot.borrow_mut() = committed_snapshot.borrow().clone();
        return Err(LinuxLocalStorageIssue::SnapshotSaveFailed);
    }

    *committed_snapshot.borrow_mut() = candidate.clone();
    Ok(candidate)
}

fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or_default()
}
