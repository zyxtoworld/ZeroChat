use crate::models::AppSnapshot;
use anyhow::Result;
use std::{fs, path::PathBuf};

pub struct SnapshotStore {
    file: PathBuf,
}

impl SnapshotStore {
    pub fn new() -> Result<Self> {
        let base = std::env::var_os("XDG_DATA_HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|| {
                let mut home = PathBuf::from(std::env::var_os("HOME").unwrap_or_default());
                home.push(".local/share");
                home
            });
        let dir = base.join("zerochat");
        fs::create_dir_all(&dir)?;
        Ok(Self {
            file: dir.join("snapshot.v1.json"),
        })
    }

    pub fn load(&self) -> Result<Option<AppSnapshot>> {
        if !self.file.exists() {
            return Ok(None);
        }

        let text = fs::read_to_string(&self.file)?;
        Ok(Some(serde_json::from_str(&text)?))
    }

    pub fn save(&self, snapshot: &AppSnapshot) -> Result<()> {
        let text = serde_json::to_string_pretty(snapshot)?;
        fs::write(&self.file, text)?;
        Ok(())
    }
}
