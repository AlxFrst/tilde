//! SSH agent authentication and agent forwarding against the test bench (Unix only:
//! needs `ssh-agent`/`ssh-add`; the Windows agent is covered by the source-selection
//! unit tests and a manual check).
#![cfg(all(feature = "integration", unix))]

use std::{
    process::{Child, Command},
    sync::Arc,
    time::{Duration, Instant},
};

use async_trait::async_trait;
use tilde_ssh::{
    AgentSource, Connector, HopLabel, HostKeyDecision, HostKeyPrompt, KbdPrompt, KnownHosts,
    MemoryStore, Prompter, SecretAnswer, SecretPrompt, SshDefaults,
};
use tilde_ssh_config::{ResolveContext, parse_str};

mod support;

struct AcceptHostKeys;

#[async_trait]
impl Prompter for AcceptHostKeys {
    async fn host_key(&self, _req: HostKeyPrompt) -> HostKeyDecision {
        HostKeyDecision::AcceptOnce
    }
    async fn secret(&self, _req: SecretPrompt) -> Option<SecretAnswer> {
        None
    }
    async fn keyboard_interactive(&self, _req: KbdPrompt) -> Option<Vec<String>> {
        None
    }
}

/// A throwaway `ssh-agent` holding the bench's ed25519 key; killed on drop.
struct TestAgent {
    child: Child,
    socket: std::path::PathBuf,
    _dir: tempfile::TempDir,
}

impl TestAgent {
    fn start(key: &std::path::Path) -> Self {
        let dir = tempfile::TempDir::new().unwrap();
        let socket = dir.path().join("agent.sock");
        let child = Command::new("ssh-agent").arg("-D").arg("-a").arg(&socket).spawn().unwrap();
        let start = Instant::now();
        while !socket.exists() {
            assert!(start.elapsed() < Duration::from_secs(5), "ssh-agent did not start");
            std::thread::sleep(Duration::from_millis(50));
        }
        let status =
            Command::new("ssh-add").arg(key).env("SSH_AUTH_SOCK", &socket).status().unwrap();
        assert!(status.success(), "ssh-add failed");
        Self { child, socket, _dir: dir }
    }
}

impl Drop for TestAgent {
    fn drop(&mut self) {
        let _ = self.child.kill();
    }
}

fn connector(home: &std::path::Path, agent: &TestAgent) -> Connector {
    Connector {
        known_hosts: Some(KnownHosts::new(vec![home.join("known_hosts")])),
        prompter: Arc::new(AcceptHostKeys),
        secrets: Arc::new(MemoryStore::default()),
        defaults: SshDefaults::default(),
        home: home.to_path_buf(),
        agent_sources: Some(vec![AgentSource::Unix(agent.socket.clone())]),
    }
}

fn bench_host(
    env: &support::TestEnv,
    home: &std::path::Path,
    extra: &str,
) -> tilde_ssh_config::ResolvedHost {
    let config = format!(
        "Host bench\n HostName {}\n Port {}\n User {}\n{extra}",
        env.host,
        env.target_port,
        support::USER
    );
    let ctx = ResolveContext { local_user: "me".into(), home: home.to_path_buf() };
    parse_str(&config, &home.join("config")).resolve("bench", &ctx)
}

#[tokio::test]
async fn agent_auth_without_key_files() {
    let Some(env) = support::env() else { return };
    let agent = TestAgent::start(&env.key("id_ed25519"));
    let home = tempfile::TempDir::new().unwrap();
    let handle = connector(home.path(), &agent)
        .connect_direct(&bench_host(&env, home.path(), ""), None, HopLabel::target("bench"))
        .await
        .unwrap();
    assert_eq!(support::exec(&handle, "whoami").await.0.trim(), support::USER);
}

#[tokio::test]
async fn agent_forwarding_reaches_the_agent() {
    let Some(env) = support::env() else { return };
    let agent = TestAgent::start(&env.key("id_ed25519"));
    let home = tempfile::TempDir::new().unwrap();
    let host = bench_host(&env, home.path(), " ForwardAgent yes\n");
    let handle = connector(home.path(), &agent)
        .connect_direct(&host, None, HopLabel::target("bench"))
        .await
        .unwrap();
    let mut channel = handle.channel_open_session().await.unwrap();
    channel.agent_forward(true).await.unwrap();
    channel.exec(true, "ssh-add -l").await.unwrap();
    let (mut out, mut err) = (Vec::new(), Vec::new());
    while let Some(msg) = channel.wait().await {
        match msg {
            russh::ChannelMsg::Data { data } => out.extend_from_slice(&data),
            russh::ChannelMsg::ExtendedData { data, .. } => err.extend_from_slice(&data),
            russh::ChannelMsg::Close => break,
            _ => {}
        }
    }
    let listed = String::from_utf8_lossy(&out);
    let stderr = String::from_utf8_lossy(&err);
    assert!(listed.contains("tilde-test"), "remote ssh-add -l: {listed} / stderr: {stderr}");
}
