//! Text files for the built-in editor and the preview, remote (SFTP) or local.
//!
//! A file is read whole (it is shown in an editor), so sizes are capped. Saving checks
//! that the file is still the version that was read: someone else's change is never
//! overwritten silently.

use std::{
    fs, io,
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};

use russh_sftp::protocol::OpenFlags;
use tokio::io::AsyncWriteExt;

use crate::{RemoteEntry, SftpClient, SftpError, Stamp};

/// Largest file the editor opens.
pub const TEXT_MAX_BYTES: u64 = 5 * 1024 * 1024;
/// Largest file the preview shows (images).
pub const PREVIEW_MAX_BYTES: u64 = 20 * 1024 * 1024;
/// How much of a file is searched for NUL bytes (a sign of a binary file).
const BINARY_SNIFF: usize = 8 * 1024;

const MIB: u64 = 1024 * 1024;

#[derive(Debug, thiserror::Error)]
pub enum TextError {
    #[error("fichier trop volumineux ({} Mio au plus)", .max / MIB)]
    TooLarge { size: u64, max: u64 },
    #[error("fichier binaire ou non UTF-8 : ouvrez-le avec l'éditeur externe")]
    Binary,
    #[error("le fichier a changé depuis son ouverture")]
    Conflict { current: Stamp },
    #[error(transparent)]
    Sftp(#[from] SftpError),
    #[error("{0}")]
    Io(String),
}

/// UTF-8 text from `bytes`: refused when larger than `max` or binary. A UTF-8 BOM is
/// dropped (the editor would show it as a stray character).
///
/// # Errors
///
/// [`TextError::TooLarge`] or [`TextError::Binary`].
pub fn decode_text(bytes: Vec<u8>, max: u64) -> Result<String, TextError> {
    let size = bytes.len() as u64;
    if size > max {
        return Err(TextError::TooLarge { size, max });
    }
    if bytes[..bytes.len().min(BINARY_SNIFF)].contains(&0) {
        return Err(TextError::Binary);
    }
    let text = String::from_utf8(bytes).map_err(|_| TextError::Binary)?;
    Ok(match text.strip_prefix('\u{feff}') {
        Some(rest) => rest.to_owned(),
        None => text,
    })
}

fn io_err(path: &Path, e: &io::Error) -> TextError {
    TextError::Io(format!("{} : {e}", path.display()))
}

fn local_stamp(meta: &fs::Metadata) -> Stamp {
    let mtime =
        meta.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_secs());
    Stamp { size: meta.len(), mtime }
}

/// What a deleted file looks like: never equal to a version that was read.
const GONE: Stamp = Stamp { size: 0, mtime: None };

/// Reads a local text file and the version read.
///
/// # Errors
///
/// Too large, binary, or I/O.
pub fn read_local_text(path: &Path) -> Result<(String, Stamp), TextError> {
    let meta = fs::metadata(path).map_err(|e| io_err(path, &e))?;
    if meta.len() > TEXT_MAX_BYTES {
        return Err(TextError::TooLarge { size: meta.len(), max: TEXT_MAX_BYTES });
    }
    let bytes = fs::read(path).map_err(|e| io_err(path, &e))?;
    let text = decode_text(bytes, TEXT_MAX_BYTES)?;
    let stamp = fs::metadata(path).map_or(GONE, |m| local_stamp(&m));
    Ok((text, stamp))
}

/// Reads at most `max` bytes of a local file (preview).
///
/// # Errors
///
/// Too large, or I/O.
pub fn read_local_bytes(path: &Path, max: u64) -> Result<Vec<u8>, TextError> {
    let meta = fs::metadata(path).map_err(|e| io_err(path, &e))?;
    if meta.len() > max {
        return Err(TextError::TooLarge { size: meta.len(), max });
    }
    fs::read(path).map_err(|e| io_err(path, &e))
}

fn temp_path(path: &Path) -> PathBuf {
    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    path.with_file_name(format!(".{name}.tilde-tmp"))
}

/// Saves a local text file, unless it changed since version `expected` was read
/// (`None`: overwrite). Written to a temporary file then renamed, keeping permissions.
///
/// # Errors
///
/// [`TextError::Conflict`] with the current version, or I/O.
pub fn write_local_text(
    path: &Path,
    text: &str,
    expected: Option<Stamp>,
) -> Result<Stamp, TextError> {
    let existing = fs::metadata(path).ok();
    if let Some(expected) = expected {
        let current = existing.as_ref().map_or(GONE, local_stamp);
        if current != expected {
            return Err(TextError::Conflict { current });
        }
    }
    let tmp = temp_path(path);
    let written = fs::write(&tmp, text)
        .and_then(|()| match &existing {
            Some(meta) => fs::set_permissions(&tmp, meta.permissions()),
            None => Ok(()),
        })
        .and_then(|()| fs::rename(&tmp, path));
    if let Err(e) = written {
        let _ = fs::remove_file(&tmp);
        return Err(io_err(path, &e));
    }
    let meta = fs::metadata(path).map_err(|e| io_err(path, &e))?;
    Ok(local_stamp(&meta))
}

fn remote_stamp(e: &RemoteEntry) -> Stamp {
    Stamp { size: e.size, mtime: e.modified }
}

impl SftpClient {
    /// Reads a remote text file and the version read. The size is checked before
    /// anything is downloaded.
    ///
    /// # Errors
    ///
    /// Too large, binary, or SFTP.
    pub async fn read_text(&self, path: &str) -> Result<(String, Stamp), TextError> {
        let before = self.stat(path).await?;
        if before.size > TEXT_MAX_BYTES {
            return Err(TextError::TooLarge { size: before.size, max: TEXT_MAX_BYTES });
        }
        let bytes = self.read_raw(path).await?;
        let text = decode_text(bytes, TEXT_MAX_BYTES)?;
        let after = self.stat(path).await?;
        Ok((text, remote_stamp(&after)))
    }

    /// Reads at most `max` bytes of a remote file (preview).
    ///
    /// # Errors
    ///
    /// Too large, or SFTP.
    pub async fn read_bytes(&self, path: &str, max: u64) -> Result<Vec<u8>, TextError> {
        let st = self.stat(path).await?;
        if st.size > max {
            return Err(TextError::TooLarge { size: st.size, max });
        }
        Ok(self.read_raw(path).await?)
    }

    /// Saves a remote text file, unless it changed since version `expected` was read
    /// (`None`: overwrite). Written in place, which keeps its permissions and owner.
    ///
    /// # Errors
    ///
    /// [`TextError::Conflict`] with the current version, or SFTP.
    pub async fn write_text(
        &self,
        path: &str,
        text: &str,
        expected: Option<Stamp>,
    ) -> Result<Stamp, TextError> {
        if let Some(expected) = expected {
            let current = self.stat(path).await.map_or(GONE, |e| remote_stamp(&e));
            if current != expected {
                return Err(TextError::Conflict { current });
            }
        }
        let io = |e: &dyn std::fmt::Display| SftpError::Io {
            path: path.to_owned(),
            message: e.to_string(),
        };
        let flags = OpenFlags::WRITE | OpenFlags::CREATE | OpenFlags::TRUNCATE;
        let mut file = self.inner().open_with_flags(path, flags).await.map_err(|e| io(&e))?;
        file.write_all(text.as_bytes()).await.map_err(|e| io(&e))?;
        file.shutdown().await.map_err(|e| io(&e))?;
        drop(file);
        Ok(remote_stamp(&self.stat(path).await?))
    }

    async fn read_raw(&self, path: &str) -> Result<Vec<u8>, SftpError> {
        self.inner()
            .read(path)
            .await
            .map_err(|e| SftpError::Io { path: path.to_owned(), message: e.to_string() })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decode_text_refuses_binary_and_large() {
        assert_eq!(decode_text(b"hello\n".to_vec(), 100).unwrap(), "hello\n");
        assert_eq!(decode_text(b"\xEF\xBB\xBFbom".to_vec(), 100).unwrap(), "bom");
        assert!(matches!(decode_text(b"a\0b".to_vec(), 100), Err(TextError::Binary)));
        assert!(matches!(decode_text(vec![0xFF, 0xFE, 0x41], 100), Err(TextError::Binary)));
        assert!(matches!(
            decode_text(vec![b'a'; 101], 100),
            Err(TextError::TooLarge { size: 101, max: 100 })
        ));
        // A NUL after the first 8 KiB is not looked for, but UTF-8 still is checked.
        let mut late = vec![b'a'; 9000];
        late.push(0xC3);
        assert!(matches!(decode_text(late, 20_000), Err(TextError::Binary)));
        assert!(TextError::Binary.to_string().contains("éditeur externe"));
    }

    #[test]
    fn local_write_detects_a_changed_file() {
        let dir = tempfile::TempDir::new().unwrap();
        let path = dir.path().join("a.txt");
        std::fs::write(&path, "one\n").unwrap();
        let (text, stamp) = read_local_text(&path).unwrap();
        assert_eq!(text, "one\n");

        // Someone else changes it.
        std::fs::write(&path, "one\ntwo, from elsewhere\n").unwrap();
        let err = write_local_text(&path, "mine\n", Some(stamp)).unwrap_err();
        let TextError::Conflict { current } = err else { panic!("expected a conflict: {err}") };
        assert_eq!(current.size, 24);
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "one\ntwo, from elsewhere\n");

        // Forcing (no expected version) writes, and returns the new version.
        let new = write_local_text(&path, "mine\n", None).unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "mine\n");
        assert_eq!(new.size, 5);
        // That version is what the next save expects.
        write_local_text(&path, "mine again\n", Some(new)).unwrap();
    }

    #[test]
    fn local_write_keeps_the_file_whole_on_conflict() {
        let dir = tempfile::TempDir::new().unwrap();
        let path = dir.path().join("gone.txt");
        std::fs::write(&path, "x").unwrap();
        let (_, stamp) = read_local_text(&path).unwrap();
        std::fs::remove_file(&path).unwrap();
        // Deleted meanwhile: a conflict too, nothing is recreated behind the user's back.
        assert!(matches!(
            write_local_text(&path, "y", Some(stamp)),
            Err(TextError::Conflict { .. })
        ));
        assert!(!path.exists());
        // No temporary file is left behind.
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 0);
    }

    #[test]
    fn local_reads_are_capped() {
        let dir = tempfile::TempDir::new().unwrap();
        let path = dir.path().join("big.bin");
        std::fs::write(&path, vec![b'a'; 64]).unwrap();
        assert!(matches!(read_local_bytes(&path, 63), Err(TextError::TooLarge { .. })));
        assert_eq!(read_local_bytes(&path, 64).unwrap().len(), 64);
    }
}
