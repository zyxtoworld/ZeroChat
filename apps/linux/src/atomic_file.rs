use std::{
    fs::{self, File, OpenOptions},
    io::{self, Write},
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

#[cfg(unix)]
use std::os::unix::fs::OpenOptionsExt;

const MAX_TEMP_FILE_ATTEMPTS: usize = 128;
static TEMP_FILE_SEQUENCE: AtomicU64 = AtomicU64::new(0);

struct PrivateTemporaryFile {
    path: PathBuf,
    output: Option<File>,
    published: bool,
}

impl PrivateTemporaryFile {
    fn output(&mut self) -> io::Result<&mut File> {
        self.output
            .as_mut()
            .ok_or_else(|| io::Error::other("Atomic export temporary file is closed."))
    }

    fn publish(mut self, destination: &Path) -> io::Result<()> {
        let output = self
            .output
            .take()
            .ok_or_else(|| io::Error::other("Atomic export temporary file is closed."))?;
        output.sync_all()?;
        drop(output);

        fs::rename(&self.path, destination)?;
        self.published = true;
        sync_parent_directory(destination)
    }
}

impl Drop for PrivateTemporaryFile {
    fn drop(&mut self) {
        if !self.published {
            self.output.take();
            let _ = fs::remove_file(&self.path);
        }
    }
}

fn destination_parent(destination: &Path) -> &Path {
    destination
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."))
}

fn create_private_temporary_file(destination: &Path) -> io::Result<PrivateTemporaryFile> {
    let parent = destination_parent(destination);
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();

    for _ in 0..MAX_TEMP_FILE_ATTEMPTS {
        let sequence = TEMP_FILE_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let path = parent.join(format!(
            ".zerochat-backup-{}-{timestamp}-{sequence}.tmp",
            std::process::id()
        ));
        let mut options = OpenOptions::new();
        options.create_new(true).write(true);
        #[cfg(unix)]
        options.mode(0o600);

        match options.open(&path) {
            Ok(output) => {
                return Ok(PrivateTemporaryFile {
                    path,
                    output: Some(output),
                    published: false,
                });
            }
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error),
        }
    }

    Err(io::Error::new(
        io::ErrorKind::AlreadyExists,
        "Unable to allocate a unique atomic export temporary file.",
    ))
}

fn sync_parent_directory(destination: &Path) -> io::Result<()> {
    #[cfg(unix)]
    File::open(destination_parent(destination))?.sync_all()?;
    #[cfg(not(unix))]
    let _ = destination;
    Ok(())
}

fn write_private_file_atomically_with(
    destination: &Path,
    write: impl FnOnce(&mut File) -> io::Result<()>,
) -> io::Result<()> {
    let mut temporary = create_private_temporary_file(destination)?;
    write(temporary.output()?)?;
    temporary.publish(destination)
}

pub(crate) fn write_private_file_atomically(destination: &Path, bytes: &[u8]) -> io::Result<()> {
    write_private_file_atomically_with(destination, |output| output.write_all(bytes))
}

#[cfg(test)]
mod tests {
    use super::{write_private_file_atomically, write_private_file_atomically_with};
    use std::{
        fs,
        io::{self, Write},
        path::{Path, PathBuf},
        sync::atomic::{AtomicU64, Ordering},
        time::{SystemTime, UNIX_EPOCH},
    };

    static TEST_DIRECTORY_SEQUENCE: AtomicU64 = AtomicU64::new(0);

    struct TestDirectory(PathBuf);

    impl TestDirectory {
        fn new(label: &str) -> Self {
            let nonce = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos();
            let sequence = TEST_DIRECTORY_SEQUENCE.fetch_add(1, Ordering::Relaxed);
            let path = std::env::temp_dir().join(format!(
                "zerochat-{label}-{}-{nonce}-{sequence}",
                std::process::id()
            ));
            fs::create_dir(&path).expect("test directory should be unique");
            Self(path)
        }

        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TestDirectory {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn failed_partial_write_preserves_existing_backup_and_cleans_temp() {
        let directory = TestDirectory::new("atomic-backup-failure");
        let destination = directory.path().join("backup.json");
        fs::write(&destination, b"complete-old-backup").unwrap();

        let error = write_private_file_atomically_with(&destination, |output| {
            output.write_all(b"partial-new")?;
            Err(io::Error::other("injected write failure"))
        })
        .unwrap_err();

        assert_eq!(error.kind(), io::ErrorKind::Other);
        assert_eq!(fs::read(&destination).unwrap(), b"complete-old-backup");
        let entries = fs::read_dir(directory.path())
            .unwrap()
            .map(|entry| entry.unwrap().file_name())
            .collect::<Vec<_>>();
        assert_eq!(entries, [destination.file_name().unwrap()]);
    }

    #[test]
    fn publishes_a_complete_new_backup() {
        let directory = TestDirectory::new("atomic-backup-new");
        let destination = directory.path().join("backup.json");

        write_private_file_atomically(&destination, b"complete-new-backup").unwrap();

        assert_eq!(fs::read(destination).unwrap(), b"complete-new-backup");
    }

    #[cfg(unix)]
    #[test]
    fn atomically_replaces_existing_backup_with_private_permissions() {
        use std::os::unix::fs::PermissionsExt;

        let directory = TestDirectory::new("atomic-backup-replace");
        let destination = directory.path().join("backup.json");
        fs::write(&destination, b"complete-old-backup").unwrap();

        write_private_file_atomically(&destination, b"complete-new-backup").unwrap();

        assert_eq!(fs::read(&destination).unwrap(), b"complete-new-backup");
        assert_eq!(
            fs::metadata(destination).unwrap().permissions().mode() & 0o777,
            0o600
        );
    }
}
