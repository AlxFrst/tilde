//! Structured logging: JSON lines in a daily-rotated file, plus the console in debug builds.

use std::path::Path;

use tracing::Subscriber;
use tracing_appender::{
    non_blocking::WorkerGuard,
    rolling::{InitError, RollingFileAppender, Rotation},
};
use tracing_subscriber::{EnvFilter, Layer, layer::SubscriberExt};

const MAX_LOG_FILES: usize = 7;

fn env_filter() -> EnvFilter {
    let default =
        if cfg!(debug_assertions) { "info,tilde=debug,tilde_config=debug" } else { "info" };
    EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new(default))
}

/// Builds the subscriber without installing it, so tests can scope it locally.
///
/// Files are named `tilde.YYYY-MM-DD.log` and only the last 7 are kept.
///
/// # Errors
///
/// Fails if the log directory cannot be created or opened.
pub fn build_subscriber(
    log_dir: &Path,
) -> Result<(impl Subscriber + Send + Sync + 'static, WorkerGuard), InitError> {
    let appender = RollingFileAppender::builder()
        .rotation(Rotation::DAILY)
        .filename_prefix("tilde")
        .filename_suffix("log")
        .max_log_files(MAX_LOG_FILES)
        .build(log_dir)?;
    let (writer, guard) = tracing_appender::non_blocking(appender);
    let file_layer = tracing_subscriber::fmt::layer().json().with_writer(writer);
    let console_layer = cfg!(debug_assertions)
        .then(|| tracing_subscriber::fmt::layer().with_writer(std::io::stderr).boxed());
    let subscriber =
        tracing_subscriber::registry().with(env_filter()).with(file_layer).with(console_layer);
    Ok((subscriber, guard))
}

/// Installs the global subscriber. Falls back to stderr-only logging if the log
/// directory is unusable; never panics. Keep the returned guard alive until exit.
pub fn init(log_dir: Option<&Path>) -> Option<WorkerGuard> {
    match log_dir.map(build_subscriber) {
        Some(Ok((subscriber, guard))) => {
            let _ = tracing::subscriber::set_global_default(subscriber);
            Some(guard)
        }
        other => {
            let _ = tracing_subscriber::fmt().with_env_filter(env_filter()).try_init();
            if let Some(Err(e)) = other {
                tracing::error!(error = %e, "cannot open log directory; logging to stderr only");
            }
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::build_subscriber;

    #[test]
    fn log_files_are_created_in_dir() {
        let dir = tempfile::TempDir::new().unwrap();
        let (subscriber, guard) = build_subscriber(dir.path()).unwrap();
        tracing::subscriber::with_default(subscriber, || tracing::info!("hello"));
        drop(guard);
        let logs: Vec<_> = std::fs::read_dir(dir.path())
            .unwrap()
            .map(|e| e.unwrap().path())
            .filter(|p| p.file_name().unwrap().to_string_lossy().starts_with("tilde."))
            .collect();
        assert_eq!(logs.len(), 1, "{logs:?}");
        assert!(std::fs::read_to_string(&logs[0]).unwrap().contains("hello"));
    }
}
