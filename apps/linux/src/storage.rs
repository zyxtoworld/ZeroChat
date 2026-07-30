use crate::{
    local_file::{
        MAX_ENCRYPTED_BACKUP_FILE_BYTES, MAX_LOCAL_SNAPSHOT_FILE_BYTES, ensure_local_file_size,
        read_bounded_local_file_text,
    },
    models::{AppSnapshot, EncryptedSnapshotEnvelope},
};
use anyhow::Result;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    ffi::OsString,
    fs::{self, File, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::Mutex,
};
use uuid::Uuid;

const LOCAL_DATA_TRANSITION_VERSION: i32 = 1;
const MAX_LOCAL_DATA_TRANSITION_FILE_BYTES: usize = MAX_ENCRYPTED_BACKUP_FILE_BYTES + 1_000_000;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum LocalDataTransitionKind {
    Reset,
    EncryptedBackupImport,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalDataTransition {
    pub(crate) version: i32,
    pub(crate) id: String,
    pub(crate) kind: LocalDataTransitionKind,
    pub(crate) source_snapshot_fingerprint: Option<String>,
    pub(crate) target_snapshot: Option<AppSnapshot>,
    pub(crate) target_updated_at: Option<i64>,
    pub(crate) encrypted_backup: Option<EncryptedSnapshotEnvelope>,
    pub(crate) provider_ids: Vec<String>,
}

impl LocalDataTransition {
    pub(crate) fn reset(
        source_snapshot_fingerprint: Option<String>,
        target_snapshot: AppSnapshot,
        provider_ids: Vec<String>,
    ) -> Self {
        Self {
            version: LOCAL_DATA_TRANSITION_VERSION,
            id: Uuid::new_v4().to_string(),
            kind: LocalDataTransitionKind::Reset,
            source_snapshot_fingerprint,
            target_snapshot: Some(target_snapshot),
            target_updated_at: None,
            encrypted_backup: None,
            provider_ids,
        }
    }

    pub(crate) fn encrypted_backup_import(
        source_snapshot_fingerprint: Option<String>,
        target_updated_at: i64,
        encrypted_backup: EncryptedSnapshotEnvelope,
        provider_ids: Vec<String>,
    ) -> Self {
        Self {
            version: LOCAL_DATA_TRANSITION_VERSION,
            id: Uuid::new_v4().to_string(),
            kind: LocalDataTransitionKind::EncryptedBackupImport,
            source_snapshot_fingerprint,
            target_snapshot: None,
            target_updated_at: Some(target_updated_at),
            encrypted_backup: Some(encrypted_backup),
            provider_ids,
        }
    }
}

fn resolve_data_home(xdg_data_home: Option<OsString>, home: Option<OsString>) -> Result<PathBuf> {
    if let Some(path) = xdg_data_home
        .map(PathBuf::from)
        .filter(|path| path.is_absolute())
    {
        return Ok(path);
    }

    let home = home
        .map(PathBuf::from)
        .filter(|path| path.is_absolute())
        .ok_or_else(|| anyhow::anyhow!("Local storage directory is unavailable."))?;
    Ok(home.join(".local/share"))
}

fn snapshot_too_large_message(max_bytes: usize) -> String {
    format!("Local snapshot exceeded the {max_bytes}-byte safety limit.")
}

fn snapshot_temp_path(file: &Path) -> PathBuf {
    let file_name = file
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("snapshot.v1.json");
    file.with_file_name(format!("{file_name}.tmp"))
}

fn local_data_transition_path(snapshot_file: &Path) -> PathBuf {
    snapshot_file.with_file_name("snapshot.v1.local-data-transition.json")
}

pub(crate) fn snapshot_fingerprint(snapshot: Option<&AppSnapshot>) -> Result<String> {
    let data = serde_json::to_vec(&snapshot)?;
    Ok(format!("{:x}", Sha256::digest(data)))
}

fn read_snapshot_text(file: &Path, max_bytes: usize) -> Result<String> {
    let too_large_message = snapshot_too_large_message(max_bytes);
    read_bounded_local_file_text(file, max_bytes, &too_large_message).map_err(anyhow::Error::msg)
}

fn sync_parent_directory(file: &Path) -> Result<()> {
    #[cfg(unix)]
    if let Some(parent) = file.parent() {
        File::open(parent)?.sync_all()?;
    }
    #[cfg(not(unix))]
    let _ = file;
    Ok(())
}

fn publish_snapshot_temp(temp_file: &Path, snapshot_file: &Path) -> Result<()> {
    #[cfg(unix)]
    fs::rename(temp_file, snapshot_file)?;
    #[cfg(not(unix))]
    {
        if snapshot_file.exists() {
            fs::remove_file(snapshot_file)?;
        }
        fs::rename(temp_file, snapshot_file)?;
    }
    sync_parent_directory(snapshot_file)
}

fn write_snapshot_text_atomically(file: &Path, text: &str, max_bytes: usize) -> Result<()> {
    let too_large_message = snapshot_too_large_message(max_bytes);
    ensure_local_file_size(text.len(), max_bytes, &too_large_message)
        .map_err(anyhow::Error::msg)?;

    let temp_file = snapshot_temp_path(file);
    let result = (|| -> Result<()> {
        let mut options = OpenOptions::new();
        options.create(true).truncate(true).write(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut output = options.open(&temp_file)?;
        output.write_all(text.as_bytes())?;
        output.sync_all()?;
        drop(output);
        publish_snapshot_temp(&temp_file, file)
    })();

    if result.is_err() {
        let _ = fs::remove_file(&temp_file);
    }
    result
}

fn snapshots_match(current: Option<&AppSnapshot>, expected: Option<&AppSnapshot>) -> Result<bool> {
    match (current, expected) {
        (None, None) => Ok(true),
        (Some(current), Some(expected)) => {
            Ok(serde_json::to_vec(current)? == serde_json::to_vec(expected)?)
        }
        _ => Ok(false),
    }
}

pub struct SnapshotStore {
    file: PathBuf,
    file_lock: Mutex<()>,
}

pub enum SnapshotCompareAndSave {
    Saved,
    Changed(Option<AppSnapshot>),
}

impl SnapshotStore {
    pub fn new() -> Result<Self> {
        let base = resolve_data_home(std::env::var_os("XDG_DATA_HOME"), std::env::var_os("HOME"))?;
        let dir = base.join("zerochat");
        fs::create_dir_all(&dir)?;
        Ok(Self {
            file: dir.join("snapshot.v1.json"),
            file_lock: Mutex::new(()),
        })
    }

    #[cfg(test)]
    pub(crate) fn for_test_file(file: PathBuf) -> Self {
        Self {
            file,
            file_lock: Mutex::new(()),
        }
    }

    pub fn load(&self) -> Result<Option<AppSnapshot>> {
        let _guard = self
            .file_lock
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        self.load_unlocked()
    }

    fn load_unlocked(&self) -> Result<Option<AppSnapshot>> {
        let temp_file = snapshot_temp_path(&self.file);
        let (source, recovering_temp_snapshot) = if self.file.exists() {
            (&self.file, false)
        } else if temp_file.exists() {
            (&temp_file, true)
        } else {
            return Ok(None);
        };

        let text = read_snapshot_text(source, MAX_LOCAL_SNAPSHOT_FILE_BYTES)?;
        let snapshot = serde_json::from_str(&text)?;
        if recovering_temp_snapshot {
            publish_snapshot_temp(&temp_file, &self.file)?;
        }
        Ok(Some(snapshot))
    }

    pub fn save(&self, snapshot: &AppSnapshot) -> Result<()> {
        let _guard = self
            .file_lock
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let text = serde_json::to_string_pretty(snapshot)?;
        write_snapshot_text_atomically(&self.file, &text, MAX_LOCAL_SNAPSHOT_FILE_BYTES)
    }

    pub fn save_if_unchanged(
        &self,
        expected: Option<&AppSnapshot>,
        snapshot: &AppSnapshot,
    ) -> Result<SnapshotCompareAndSave> {
        let _guard = self
            .file_lock
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let current = self.load_unlocked()?;
        if !snapshots_match(current.as_ref(), expected)? {
            return Ok(SnapshotCompareAndSave::Changed(current));
        }
        let text = serde_json::to_string_pretty(snapshot)?;
        write_snapshot_text_atomically(&self.file, &text, MAX_LOCAL_SNAPSHOT_FILE_BYTES)?;
        Ok(SnapshotCompareAndSave::Saved)
    }

    pub(crate) fn stage_local_data_transition(
        &self,
        transition: &LocalDataTransition,
    ) -> Result<()> {
        let _guard = self
            .file_lock
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if self.load_local_data_transition_unlocked()?.is_some() {
            anyhow::bail!("A local data recovery operation is already pending.");
        }
        validate_local_data_transition(transition)?;
        let text = serde_json::to_string_pretty(transition)?;
        write_snapshot_text_atomically(
            &local_data_transition_path(&self.file),
            &text,
            MAX_LOCAL_DATA_TRANSITION_FILE_BYTES,
        )
    }

    pub(crate) fn load_local_data_transition(&self) -> Result<Option<LocalDataTransition>> {
        let _guard = self
            .file_lock
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        self.load_local_data_transition_unlocked()
    }

    fn load_local_data_transition_unlocked(&self) -> Result<Option<LocalDataTransition>> {
        let file = local_data_transition_path(&self.file);
        let temp_file = snapshot_temp_path(&file);
        let (source, recovering_temp) = if file.exists() {
            (&file, false)
        } else if temp_file.exists() {
            (&temp_file, true)
        } else {
            return Ok(None);
        };
        let text = read_snapshot_text(source, MAX_LOCAL_DATA_TRANSITION_FILE_BYTES)?;
        let transition = serde_json::from_str(&text)?;
        validate_local_data_transition(&transition)?;
        if recovering_temp {
            publish_snapshot_temp(&temp_file, &file)?;
        }
        Ok(Some(transition))
    }

    pub(crate) fn save_local_data_transition_target(
        &self,
        source_fingerprint: Option<&str>,
        target: &AppSnapshot,
    ) -> Result<SnapshotCompareAndSave> {
        let _guard = self
            .file_lock
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some(source_fingerprint) = source_fingerprint {
            let current = self.load_unlocked()?;
            let current_fingerprint = snapshot_fingerprint(current.as_ref())?;
            let target_fingerprint = snapshot_fingerprint(Some(target))?;
            if current_fingerprint != source_fingerprint
                && current_fingerprint != target_fingerprint
            {
                return Ok(SnapshotCompareAndSave::Changed(current));
            }
        }
        let text = serde_json::to_string_pretty(target)?;
        write_snapshot_text_atomically(&self.file, &text, MAX_LOCAL_SNAPSHOT_FILE_BYTES)?;
        Ok(SnapshotCompareAndSave::Saved)
    }

    pub(crate) fn complete_local_data_transition(
        &self,
        expected_target_fingerprint: &str,
    ) -> Result<()> {
        let _guard = self
            .file_lock
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let current = self.load_unlocked()?;
        if snapshot_fingerprint(current.as_ref())? != expected_target_fingerprint {
            anyhow::bail!("The recovered local snapshot changed before recovery completed.");
        }
        let file = local_data_transition_path(&self.file);
        if file.exists() {
            fs::remove_file(&file)?;
            sync_parent_directory(&file)?;
        }
        let temp_file = snapshot_temp_path(&file);
        if temp_file.exists() {
            fs::remove_file(temp_file)?;
            sync_parent_directory(&file)?;
        }
        Ok(())
    }

    pub(crate) fn discard_local_data_transition(&self) -> Result<()> {
        let _guard = self
            .file_lock
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let file = local_data_transition_path(&self.file);
        for candidate in [&file, &snapshot_temp_path(&file)] {
            if candidate.exists() {
                fs::remove_file(candidate)?;
            }
        }
        sync_parent_directory(&file)
    }

    pub fn clear(&self) -> Result<()> {
        let _guard = self
            .file_lock
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if self.file.exists() {
            fs::remove_file(&self.file)?;
        }
        let temp_file = snapshot_temp_path(&self.file);
        if temp_file.exists() {
            fs::remove_file(temp_file)?;
        }
        Ok(())
    }
}

fn validate_local_data_transition(transition: &LocalDataTransition) -> Result<()> {
    let provider_ids = transition
        .provider_ids
        .iter()
        .cloned()
        .collect::<std::collections::BTreeSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    if transition.version != LOCAL_DATA_TRANSITION_VERSION
        || Uuid::parse_str(&transition.id).is_err()
        || transition.provider_ids != provider_ids
        || transition
            .provider_ids
            .iter()
            .any(|id| id.trim().is_empty())
        || transition
            .source_snapshot_fingerprint
            .as_deref()
            .is_some_and(|fingerprint| {
                fingerprint.len() != 64
                    || !fingerprint
                        .bytes()
                        .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
            })
    {
        anyhow::bail!("The pending local data recovery record is invalid.");
    }

    match transition.kind {
        LocalDataTransitionKind::Reset => {
            if transition.target_snapshot.is_none()
                || transition.target_updated_at.is_some()
                || transition.encrypted_backup.is_some()
            {
                anyhow::bail!("The pending local data recovery record is invalid.");
            }
        }
        LocalDataTransitionKind::EncryptedBackupImport => {
            if transition.target_snapshot.is_some()
                || transition
                    .target_updated_at
                    .is_none_or(|timestamp| timestamp <= 0)
                || transition.encrypted_backup.is_none()
            {
                anyhow::bail!("The pending local data recovery record is invalid.");
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        SnapshotCompareAndSave, SnapshotStore, read_snapshot_text, resolve_data_home,
        snapshot_temp_path, write_snapshot_text_atomically,
    };
    use crate::defaults::default_snapshot;
    use std::{ffi::OsString, fs, path::PathBuf, sync::Mutex};
    use uuid::Uuid;

    fn test_snapshot_path() -> std::path::PathBuf {
        std::env::temp_dir().join(format!("zerochat-snapshot-{}.json", Uuid::new_v4()))
    }

    #[test]
    fn atomic_writer_rejects_overflow_without_replacing_current_snapshot() {
        let file = test_snapshot_path();
        write_snapshot_text_atomically(&file, "old", 3).unwrap();

        let error = write_snapshot_text_atomically(&file, "newer", 3).unwrap_err();

        assert!(error.to_string().contains("3-byte safety limit"));
        assert_eq!(read_snapshot_text(&file, 3).unwrap(), "old");
        assert!(!snapshot_temp_path(&file).exists());
        let _ = fs::remove_file(file);
    }

    #[test]
    fn store_recovers_a_valid_temp_snapshot_when_main_file_is_missing() {
        let file = test_snapshot_path();
        let temp_file = snapshot_temp_path(&file);
        fs::write(
            &temp_file,
            serde_json::to_string_pretty(&default_snapshot()).unwrap(),
        )
        .unwrap();
        let store = SnapshotStore {
            file: file.clone(),
            file_lock: Mutex::new(()),
        };

        assert!(store.load().unwrap().is_some());
        assert!(file.exists());
        assert!(!temp_file.exists());
        let _ = fs::remove_file(file);
    }

    #[test]
    fn compare_and_save_rejects_a_snapshot_changed_after_observation() {
        let file = test_snapshot_path();
        let store = SnapshotStore {
            file: file.clone(),
            file_lock: Mutex::new(()),
        };
        let mut observed = default_snapshot();
        observed.updated_at = 10;
        store.save(&observed).unwrap();
        let mut concurrent = observed.clone();
        concurrent.updated_at = 11;
        store.save(&concurrent).unwrap();
        let mut candidate = observed.clone();
        candidate.updated_at = 12;

        let result = store
            .save_if_unchanged(Some(&observed), &candidate)
            .unwrap();

        let SnapshotCompareAndSave::Changed(Some(current)) = result else {
            panic!("a changed snapshot must reject compare-and-save");
        };
        assert_eq!(current.updated_at, concurrent.updated_at);
        assert_eq!(
            store.load().unwrap().unwrap().updated_at,
            concurrent.updated_at
        );
        let _ = fs::remove_file(file);
    }

    #[test]
    fn corrupted_snapshot_load_fails_without_replacing_the_file() {
        let file = test_snapshot_path();
        fs::write(&file, "{broken").unwrap();
        let store = SnapshotStore {
            file: file.clone(),
            file_lock: Mutex::new(()),
        };

        assert!(store.load().is_err());
        assert_eq!(fs::read_to_string(&file).unwrap(), "{broken");
        let _ = fs::remove_file(file);
    }

    #[test]
    fn data_home_prefers_an_absolute_xdg_path() {
        let resolved = resolve_data_home(
            Some(OsString::from("/tmp/zerochat-xdg")),
            Some(OsString::from("/home/tester")),
        )
        .unwrap();

        assert_eq!(resolved, PathBuf::from("/tmp/zerochat-xdg"));
    }

    #[test]
    fn relative_xdg_path_falls_back_to_absolute_home() {
        let resolved = resolve_data_home(
            Some(OsString::from("relative-data")),
            Some(OsString::from("/home/tester")),
        )
        .unwrap();

        assert_eq!(resolved, PathBuf::from("/home/tester/.local/share"));
    }

    #[test]
    fn missing_absolute_data_home_fails_closed() {
        assert!(resolve_data_home(None, None).is_err());
        assert!(
            resolve_data_home(
                Some(OsString::from("relative-data")),
                Some(OsString::from("relative-home")),
            )
            .is_err()
        );
    }
}
