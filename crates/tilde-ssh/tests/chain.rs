//! `ProxyJump` chains and `ProxyCommand` against the test bench:
//! host → bastion1 (2201) → bastion2 → target.
#![cfg(feature = "integration")]

use std::{path::PathBuf, sync::Arc};

use async_trait::async_trait;
use parking_lot::Mutex;
use tilde_ssh::{
    ConnectError, Connector, HopLabel, HostKeyDecision, HostKeyPrompt, KbdPrompt, KnownHosts,
    MemoryStore, Prompter, SecretAnswer, SecretPrompt, SshDefaults,
};
use tilde_ssh_config::{ResolveContext, SshConfig, parse_str};

mod support;

#[derive(Default)]
struct AcceptAll {
    hosts: Mutex<Vec<String>>,
}

#[async_trait]
impl Prompter for AcceptAll {
    async fn host_key(&self, req: HostKeyPrompt) -> HostKeyDecision {
        self.hosts.lock().push(req.host);
        HostKeyDecision::AcceptAndSave
    }
    async fn secret(&self, _req: SecretPrompt) -> Option<SecretAnswer> {
        None
    }
    async fn keyboard_interactive(&self, _req: KbdPrompt) -> Option<Vec<String>> {
        None
    }
}

/// `target/<profile>/examples/tcp-pipe[.exe]`, built by `cargo test` with the examples.
fn tcp_pipe() -> PathBuf {
    let mut p = std::env::current_exe().unwrap();
    p.pop(); // deps
    p.pop();
    p.push("examples");
    p.push(if cfg!(windows) { "tcp-pipe.exe" } else { "tcp-pipe" });
    p
}

struct Bench {
    home: tempfile::TempDir,
    config: SshConfig,
    ctx: ResolveContext,
}

impl Bench {
    fn new(extra: &str) -> Option<Self> {
        let env = support::env()?;
        let key = env.key("id_ed25519");
        let common = format!(
            " User {}\n IdentityFile \"{}\"\n IdentitiesOnly yes\n",
            support::USER,
            key.display()
        );
        let text = format!(
            "Host b1\n HostName {host}\n Port {b1}\n{common}\
             Host b2\n HostName bastion2\n{common}\
             Host target\n HostName target\n ProxyJump b1,b2\n{common}\
             Host via-one\n HostName bastion2\n ProxyJump b1\n{common}\
             Host ghost\n HostName no-such-host.invalid\n{common}\
             Host broken\n HostName target\n ProxyJump b1,ghost\n{common}\
             {extra}",
            host = env.host,
            b1 = env.bastion1_port,
        );
        let home = tempfile::TempDir::new().unwrap();
        let ctx = ResolveContext { local_user: "me".into(), home: home.path().to_path_buf() };
        let config = parse_str(&text, &home.path().join("config"));
        Some(Self { home, config, ctx })
    }

    fn connector(&self, prompter: Arc<AcceptAll>) -> Connector {
        Connector {
            known_hosts: Some(KnownHosts::new(vec![self.home.path().join("known_hosts")])),
            prompter,
            secrets: Arc::new(MemoryStore::default()),
            defaults: SshDefaults::default(),
            home: self.home.path().to_path_buf(),
            agent_sources: Some(Vec::new()),
        }
    }

    async fn connect(&self, alias: &str) -> Result<tilde_ssh::Connection, ConnectError> {
        let target = self.config.resolve(alias, &self.ctx);
        self.connector(Arc::new(AcceptAll::default()))
            .connect_chain(&self.config, &self.ctx, &target, |_hop: &HopLabel| {})
            .await
    }
}

#[tokio::test]
async fn one_bastion() {
    let Some(b) = Bench::new("") else { return };
    let conn = b.connect("via-one").await.unwrap();
    assert_eq!(support::exec(conn.target(), "hostname").await.0.trim(), "bastion2");
}

#[tokio::test]
async fn two_bastions() {
    let Some(b) = Bench::new("") else { return };
    let prompter = Arc::new(AcceptAll::default());
    let target = b.config.resolve("target", &b.ctx);
    let mut hops = Vec::new();
    let conn = b
        .connector(prompter.clone())
        .connect_chain(&b.config, &b.ctx, &target, |hop: &HopLabel| hops.push(hop.to_string()))
        .await
        .unwrap();
    assert_eq!(support::exec(conn.target(), "hostname").await.0.trim(), "target");
    assert_eq!(hops, ["bastion 1/2 (127.0.0.1)", "bastion 2/2 (bastion2)", "target"]);
    assert_eq!(prompter.hosts.lock().len(), 3, "each hop's key is checked");
}

#[tokio::test]
async fn unreachable_second_hop_names_the_hop() {
    let Some(b) = Bench::new("") else { return };
    let err = b.connect("broken").await.err().expect("must fail");
    assert!(err.to_string().contains("bastion 2/2"), "{err}");
    assert!(err.to_string().contains("no-such-host.invalid"), "{err}");
}

#[tokio::test]
async fn proxy_command_tcp_pipe() {
    let Some(env) = support::env() else { return };
    let extra = format!(
        "Host piped\n HostName {}\n Port {}\n ProxyCommand \"{}\" %h %p\n User {}\n IdentityFile \"{}\"\n IdentitiesOnly yes\n",
        env.host,
        env.target_port,
        tcp_pipe().display(),
        support::USER,
        env.key("id_ed25519").display()
    );
    let Some(b) = Bench::new(&extra) else { return };
    let conn = b.connect("piped").await.unwrap();
    assert_eq!(support::exec(conn.target(), "echo piped").await.0.trim(), "piped");
}

#[tokio::test]
async fn proxy_command_failure_shows_stderr() {
    let Some(env) = support::env() else { return };
    let extra = format!(
        "Host badpipe\n HostName {}\n Port 1\n ProxyCommand \"{}\" %h %p\n User x\n IdentitiesOnly yes\n",
        env.host,
        tcp_pipe().display()
    );
    let Some(b) = Bench::new(&extra) else { return };
    let err = b.connect("badpipe").await.err().expect("must fail");
    assert!(err.to_string().contains("tcp-pipe: connexion"), "{err}");
}

/// Opt-in, read-only: the developer's real host reached through a `ProxyCommand`
/// (`tcp-pipe`), exercising the platform shell quoting. Uses a temp copy of `known_hosts`.
#[tokio::test]
async fn real_host_through_proxy_command() {
    let Ok(alias) = std::env::var("TILDE_SSH_REAL_HOST") else { return };
    let ctx = ResolveContext::from_env();
    let config = tilde_ssh_config::parse_file(&ctx.home.join(".ssh").join("config"));
    let mut host = config.resolve(&alias, &ctx);
    host.proxy_jump.clear();
    host.proxy_command =
        Some(format!("\"{}\" {} {}", tcp_pipe().display(), host.hostname, host.port));
    let tmp = tempfile::TempDir::new().unwrap();
    let files: Vec<PathBuf> = host
        .user_known_hosts_files
        .iter()
        .enumerate()
        .filter(|(_, f)| f.exists())
        .map(|(i, f)| {
            let copy = tmp.path().join(format!("kh{i}"));
            std::fs::copy(f, &copy).unwrap();
            copy
        })
        .collect();
    let prompter = Arc::new(AcceptAll::default());
    let connector = Connector {
        known_hosts: Some(KnownHosts::new(files)),
        prompter: prompter.clone(),
        secrets: Arc::new(MemoryStore::default()),
        defaults: SshDefaults::default(),
        home: ctx.home.clone(),
        agent_sources: None,
    };
    let conn = connector.connect_chain(&config, &ctx, &host, |_: &HopLabel| {}).await.unwrap();
    assert_eq!(support::exec(conn.target(), "echo via-proxy").await.0.trim(), "via-proxy");
    assert!(prompter.hosts.lock().is_empty(), "host key must already be known");
}
