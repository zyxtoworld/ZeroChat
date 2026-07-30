use crate::i18n::{replace_placeholders, tr};
use std::{fs::File, io::Read, path::Path};

pub(crate) const MAX_ENCRYPTED_BACKUP_FILE_BYTES: usize = 50_000_000;
pub(crate) const MAX_SKILL_FILE_BYTES: usize = 2_000_000;
pub(crate) const MAX_IMAGE_FILE_BYTES: usize = 20_000_000;
pub(crate) const MAX_LOCAL_SNAPSHOT_FILE_BYTES: usize = 64_000_000;

pub(crate) fn local_file_too_large_message(locale: &str, max_bytes: usize) -> String {
    let max_mb = (max_bytes / 1_000_000).to_string();
    replace_placeholders(tr(locale, "message.fileTooLarge"), &[("{maxMb}", &max_mb)])
}

pub(crate) fn ensure_local_file_size(
    byte_length: usize,
    max_bytes: usize,
    too_large_message: &str,
) -> Result<(), String> {
    if byte_length > max_bytes {
        return Err(too_large_message.to_owned());
    }
    Ok(())
}

pub(crate) fn read_bounded_local_file_bytes(
    path: &Path,
    max_bytes: usize,
    too_large_message: &str,
) -> Result<Vec<u8>, String> {
    let file = File::open(path).map_err(|error| error.to_string())?;
    let declared_length = file.metadata().map_err(|error| error.to_string())?.len();
    if declared_length > usize::MAX as u64 {
        return Err(too_large_message.to_owned());
    }
    ensure_local_file_size(declared_length as usize, max_bytes, too_large_message)?;

    read_bounded_local_reader(file, max_bytes, too_large_message)
}

pub(crate) fn read_bounded_local_file_text(
    path: &Path,
    max_bytes: usize,
    too_large_message: &str,
) -> Result<String, String> {
    String::from_utf8(read_bounded_local_file_bytes(
        path,
        max_bytes,
        too_large_message,
    )?)
    .map_err(|error| error.to_string())
}

fn read_bounded_local_reader(
    mut reader: impl Read,
    max_bytes: usize,
    too_large_message: &str,
) -> Result<Vec<u8>, String> {
    let mut output = Vec::with_capacity(max_bytes.min(16_384));
    let mut buffer = [0_u8; 16_384];

    loop {
        let remaining = max_bytes - output.len();
        let read_limit = if remaining == 0 {
            1
        } else {
            remaining.min(buffer.len())
        };
        let read = reader
            .read(&mut buffer[..read_limit])
            .map_err(|error| error.to_string())?;
        if read == 0 {
            break;
        }
        if read > remaining {
            return Err(too_large_message.to_owned());
        }

        output.extend_from_slice(&buffer[..read]);
    }

    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::{
        MAX_ENCRYPTED_BACKUP_FILE_BYTES, MAX_IMAGE_FILE_BYTES, MAX_LOCAL_SNAPSHOT_FILE_BYTES,
        MAX_SKILL_FILE_BYTES, ensure_local_file_size, read_bounded_local_reader,
    };
    use std::io::Cursor;

    #[test]
    fn local_file_budgets_match_the_cross_platform_contract() {
        assert_eq!(MAX_ENCRYPTED_BACKUP_FILE_BYTES, 50_000_000);
        assert_eq!(MAX_SKILL_FILE_BYTES, 2_000_000);
        assert_eq!(MAX_IMAGE_FILE_BYTES, 20_000_000);
        assert_eq!(MAX_LOCAL_SNAPSHOT_FILE_BYTES, 64_000_000);
    }

    #[test]
    fn bounded_reader_accepts_boundary_and_rejects_overflow() {
        let payload = b"12345";

        assert_eq!(
            read_bounded_local_reader(Cursor::new(payload), payload.len(), "too large").unwrap(),
            payload
        );
        assert_eq!(
            read_bounded_local_reader(Cursor::new(payload), payload.len() - 1, "too large")
                .unwrap_err(),
            "too large"
        );
    }

    #[test]
    fn byte_size_check_keeps_exports_inside_the_import_budget() {
        ensure_local_file_size(4, 4, "too large").unwrap();
        assert_eq!(
            ensure_local_file_size(5, 4, "too large").unwrap_err(),
            "too large"
        );
    }
}
