//! Running a command on the server of an SSH session, on a channel of its existing
//! connection (no new authentication). Used by the remote monitor.

use std::time::Duration;

use crate::SshShell;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExecOutput {
    /// Standard output (and error when the command redirects it), lossy UTF-8.
    pub stdout: String,
    pub exit: Option<u32>,
}

#[derive(Debug, thiserror::Error)]
pub enum ExecError {
    #[error("la session SSH n'est pas connectée")]
    Disconnected,
    #[error("le serveur ne répond pas")]
    Timeout,
    #[error("sortie trop volumineuse ({0} octets au plus)")]
    TooLarge(usize),
    #[error("commande impossible : {0}")]
    Failed(String),
}

impl SshShell {
    /// Runs `command` and returns its output, at most `max_output` bytes, within
    /// `timeout`.
    ///
    /// # Errors
    ///
    /// Not connected, timeout, output too large, or the channel failed.
    pub async fn exec(
        &self,
        command: &str,
        max_output: usize,
        timeout: Duration,
    ) -> Result<ExecOutput, ExecError> {
        let connection = self.connection().ok_or(ExecError::Disconnected)?;
        let run = async {
            let mut channel = connection
                .target()
                .channel_open_session()
                .await
                .map_err(|e| ExecError::Failed(e.to_string()))?;
            channel.exec(true, command).await.map_err(|e| ExecError::Failed(e.to_string()))?;
            let mut out = Vec::new();
            let mut exit = None;
            while let Some(msg) = channel.wait().await {
                match msg {
                    russh::ChannelMsg::Data { data } => {
                        if out.len() + data.len() > max_output {
                            let _ = channel.close().await;
                            return Err(ExecError::TooLarge(max_output));
                        }
                        out.extend_from_slice(&data);
                    }
                    russh::ChannelMsg::ExitStatus { exit_status } => exit = Some(exit_status),
                    russh::ChannelMsg::Close => break,
                    _ => {}
                }
            }
            Ok(ExecOutput { stdout: String::from_utf8_lossy(&out).into_owned(), exit })
        };
        tokio::time::timeout(timeout, run).await.map_err(|_| ExecError::Timeout)?
    }
}
