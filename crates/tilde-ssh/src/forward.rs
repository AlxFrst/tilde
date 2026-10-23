//! Port forwarding (tunnels). Forwards belong to the session, not to one connection:
//! local listeners stay bound while reconnecting, and remote forwards are requested
//! again on each new connection.

use std::{
    collections::HashMap,
    sync::{
        Arc, Weak,
        atomic::{AtomicU32, Ordering},
    },
};

use parking_lot::Mutex;
use russh::{Channel, client};
use serde::{Deserialize, Serialize};
use tilde_ssh_config::Forward;
use tokio::{
    net::{TcpListener, TcpStream},
    task::JoinHandle,
};

use crate::{chain::Connection, shell::SshShell};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ForwardKind {
    /// Listen here, connect from the server (`ssh -L`).
    Local,
    /// Listen on the server, connect from here (`ssh -R`).
    Remote,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ForwardSpec {
    pub kind: ForwardKind,
    /// Listen address (`127.0.0.1` by default).
    pub bind: String,
    /// `0`: chosen by the system (see [`ForwardInfo::bound_port`]).
    pub listen_port: u16,
    pub host: String,
    pub port: u16,
}

impl ForwardSpec {
    /// A `LocalForward` / `RemoteForward` of `ssh_config`.
    #[must_use]
    pub fn from_config(kind: ForwardKind, forward: &Forward) -> Self {
        let bind = match (forward.bind.as_deref(), kind) {
            (None, _) => "127.0.0.1",
            (Some("*"), ForwardKind::Local) => "0.0.0.0",
            // For the server, an empty address means every interface.
            (Some("*"), ForwardKind::Remote) => "",
            (Some(bind), _) => bind,
        };
        Self {
            kind,
            bind: bind.to_owned(),
            listen_port: forward.listen_port,
            host: forward.host.clone(),
            port: forward.port,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ForwardInfo {
    pub id: u32,
    pub spec: ForwardSpec,
    /// The port actually listened on (`0` while not established).
    pub bound_port: u16,
    pub active_connections: u32,
    /// Why this forward does not work (port taken, refused by the server…).
    pub error: Option<String>,
}

/// Remote forwards of one session: bound port on the server → local target.
#[derive(Default)]
pub(crate) struct Routes(Mutex<HashMap<u32, Route>>);

#[derive(Clone)]
struct Route {
    host: String,
    port: u16,
    active: Arc<AtomicU32>,
}

impl Routes {
    /// Connects a channel opened by the server for a remote forward to its local target.
    /// `false`: no such forward (the channel is refused).
    pub(crate) fn serve(&self, bound_port: u32, channel: Channel<client::Msg>) -> bool {
        let Some(route) = self.0.lock().get(&bound_port).cloned() else { return false };
        tokio::spawn(async move {
            match TcpStream::connect((route.host.as_str(), route.port)).await {
                Ok(mut local) => {
                    route.active.fetch_add(1, Ordering::Relaxed);
                    let mut remote = channel.into_stream();
                    let _ = tokio::io::copy_bidirectional(&mut local, &mut remote).await;
                    route.active.fetch_sub(1, Ordering::Relaxed);
                }
                Err(e) => tracing::info!(host = %route.host, port = route.port, error = %e,
                    "remote forward: local target unreachable"),
            }
        });
        true
    }
}

struct Entry {
    info: ForwardInfo,
    active: Arc<AtomicU32>,
    /// Local forwards: the accept loop (aborting it closes the listener).
    listener: Option<JoinHandle<()>>,
}

/// The forwards of one session.
#[derive(Default)]
pub(crate) struct Forwards {
    next_id: AtomicU32,
    entries: Mutex<Vec<Entry>>,
    pub(crate) routes: Arc<Routes>,
}

impl Forwards {
    pub(crate) fn list(&self) -> Vec<ForwardInfo> {
        self.entries
            .lock()
            .iter()
            .map(|e| ForwardInfo {
                active_connections: e.active.load(Ordering::Relaxed),
                ..e.info.clone()
            })
            .collect()
    }

    pub(crate) async fn add(&self, spec: ForwardSpec, shell: &Arc<SshShell>) -> ForwardInfo {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed) + 1;
        let active = Arc::new(AtomicU32::new(0));
        let mut info = ForwardInfo { id, spec, bound_port: 0, active_connections: 0, error: None };
        let mut listener = None;
        match info.spec.kind {
            ForwardKind::Local => {
                match TcpListener::bind((info.spec.bind.as_str(), info.spec.listen_port)).await {
                    Ok(l) => {
                        info.bound_port = l.local_addr().map_or(0, |a| a.port());
                        listener = Some(tokio::spawn(accept_loop(
                            l,
                            info.spec.clone(),
                            Arc::downgrade(shell),
                            Arc::clone(&active),
                        )));
                    }
                    Err(e) => {
                        info.error = Some(format!(
                            "écoute impossible sur {}:{} : {e}",
                            info.spec.bind, info.spec.listen_port
                        ));
                    }
                }
            }
            ForwardKind::Remote => {
                if let Some(connection) = shell.connection() {
                    self.request_remote(&mut info, &active, &connection).await;
                }
            }
        }
        if let Some(e) = &info.error {
            tracing::warn!(forward = id, error = %e, "forward unavailable");
        }
        self.entries.lock().push(Entry { info: info.clone(), active, listener });
        info
    }

    /// Asks the server to listen; records the bound port (or the refusal).
    async fn request_remote(
        &self,
        info: &mut ForwardInfo,
        active: &Arc<AtomicU32>,
        connection: &Connection,
    ) {
        let spec = &info.spec;
        let result = connection
            .target()
            .tcpip_forward(spec.bind.as_str(), u32::from(spec.listen_port))
            .await;
        match result {
            Ok(port) => {
                let bound = if port == 0 { u32::from(spec.listen_port) } else { port };
                info.bound_port = u16::try_from(bound).unwrap_or(0);
                info.error = None;
                self.routes.0.lock().insert(
                    bound,
                    Route { host: spec.host.clone(), port: spec.port, active: Arc::clone(active) },
                );
            }
            Err(e) => {
                info.bound_port = 0;
                info.error = Some(format!(
                    "le serveur refuse d'écouter sur {}:{} ({e})",
                    spec.bind, spec.listen_port
                ));
            }
        }
    }

    /// Requests every remote forward again on a new connection.
    pub(crate) async fn reattach(&self, connection: &Connection) {
        self.routes.0.lock().clear();
        let remote: Vec<(ForwardInfo, Arc<AtomicU32>)> = self
            .entries
            .lock()
            .iter()
            .filter(|e| e.info.spec.kind == ForwardKind::Remote)
            .map(|e| (e.info.clone(), Arc::clone(&e.active)))
            .collect();
        for (mut info, active) in remote {
            self.request_remote(&mut info, &active, connection).await;
            if let Some(e) = self.entries.lock().iter_mut().find(|e| e.info.id == info.id) {
                e.info = info;
            }
        }
    }

    /// Stops a forward. `false` for an unknown id.
    pub(crate) async fn remove(&self, id: u32, connection: Option<Arc<Connection>>) -> bool {
        let entry = {
            let mut entries = self.entries.lock();
            let Some(i) = entries.iter().position(|e| e.info.id == id) else { return false };
            entries.remove(i)
        };
        if let Some(task) = entry.listener {
            task.abort();
        }
        if entry.info.spec.kind == ForwardKind::Remote && entry.info.bound_port != 0 {
            self.routes.0.lock().remove(&u32::from(entry.info.bound_port));
            if let Some(connection) = connection {
                let _ = connection
                    .target()
                    .cancel_tcpip_forward(
                        entry.info.spec.bind.as_str(),
                        u32::from(entry.info.bound_port),
                    )
                    .await;
            }
        }
        true
    }

    pub(crate) fn stop_all(&self) {
        for entry in self.entries.lock().drain(..) {
            if let Some(task) = entry.listener {
                task.abort();
            }
        }
        self.routes.0.lock().clear();
    }
}

/// Local forward: each accepted socket gets a `direct-tcpip` channel on the current
/// connection (refused while reconnecting).
async fn accept_loop(
    listener: TcpListener,
    spec: ForwardSpec,
    shell: Weak<SshShell>,
    active: Arc<AtomicU32>,
) {
    while let Ok((mut socket, peer)) = listener.accept().await {
        let Some(connection) = shell.upgrade().and_then(|s| s.connection()) else { continue };
        let spec = spec.clone();
        let active = Arc::clone(&active);
        tokio::spawn(async move {
            let channel = connection
                .target()
                .channel_open_direct_tcpip(
                    spec.host.as_str(),
                    u32::from(spec.port),
                    peer.ip().to_string(),
                    u32::from(peer.port()),
                )
                .await;
            match channel {
                Ok(channel) => {
                    active.fetch_add(1, Ordering::Relaxed);
                    let mut remote = channel.into_stream();
                    let _ = tokio::io::copy_bidirectional(&mut socket, &mut remote).await;
                    active.fetch_sub(1, Ordering::Relaxed);
                }
                Err(e) => tracing::info!(host = %spec.host, port = spec.port, error = %e,
                    "local forward: the server could not connect"),
            }
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn forward(bind: Option<&str>, listen_port: u16) -> Forward {
        Forward { bind: bind.map(str::to_owned), listen_port, host: "db".into(), port: 5432 }
    }

    #[test]
    fn config_forwards_default_to_loopback() {
        let spec = ForwardSpec::from_config(ForwardKind::Local, &forward(None, 15432));
        assert_eq!(
            spec,
            ForwardSpec {
                kind: ForwardKind::Local,
                bind: "127.0.0.1".into(),
                listen_port: 15432,
                host: "db".into(),
                port: 5432
            }
        );
        let any = ForwardSpec::from_config(ForwardKind::Local, &forward(Some("*"), 1));
        assert_eq!(any.bind, "0.0.0.0");
        let remote_any = ForwardSpec::from_config(ForwardKind::Remote, &forward(Some("*"), 1));
        assert_eq!(remote_any.bind, "", "an empty address means every interface on the server");
        let explicit = ForwardSpec::from_config(ForwardKind::Remote, &forward(Some("10.0.0.1"), 1));
        assert_eq!(explicit.bind, "10.0.0.1");
    }

    #[tokio::test]
    async fn a_taken_port_is_reported_on_the_forward() {
        let taken = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = taken.local_addr().unwrap().port();
        let (input, _rx) = tokio::sync::mpsc::unbounded_channel();
        let shell = Arc::new(SshShell::new(input, 80, 24));
        let info = shell
            .add_forward(ForwardSpec {
                kind: ForwardKind::Local,
                bind: "127.0.0.1".into(),
                listen_port: port,
                host: "h".into(),
                port: 1,
            })
            .await;
        assert_eq!(info.bound_port, 0);
        assert!(info.error.as_deref().unwrap_or_default().contains(&port.to_string()), "{info:?}");
        assert_eq!(shell.forwards(), vec![info]);
    }

    #[tokio::test]
    async fn removing_a_local_forward_closes_its_listener() {
        let (input, _rx) = tokio::sync::mpsc::unbounded_channel();
        let shell = Arc::new(SshShell::new(input, 80, 24));
        let info = shell
            .add_forward(ForwardSpec {
                kind: ForwardKind::Local,
                bind: "127.0.0.1".into(),
                listen_port: 0,
                host: "h".into(),
                port: 1,
            })
            .await;
        assert_ne!(info.bound_port, 0);
        assert!(TcpStream::connect(("127.0.0.1", info.bound_port)).await.is_ok());
        assert!(shell.remove_forward(info.id).await);
        assert!(!shell.remove_forward(info.id).await);
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(2);
        while TcpStream::connect(("127.0.0.1", info.bound_port)).await.is_ok() {
            assert!(std::time::Instant::now() < deadline, "listener still open");
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }
        assert_eq!(shell.forwards(), vec![]);
    }
}
