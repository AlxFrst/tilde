//! SSH sessions against the test bench: prompts, state recording, output matching.

use std::{
    collections::VecDeque,
    process::Command,
    sync::Arc,
    time::{Duration, Instant},
};

use async_trait::async_trait;
use parking_lot::Mutex;
use tilde_session::OutputFeed;
use tilde_ssh::{
    ConnState, Connector, HostKeyDecision, HostKeyPrompt, KbdPrompt, KnownHosts, MemoryStore,
    Prompter, SecretAnswer, SecretPrompt, SshDefaults, SshSessionSpec, SshShell, SshTarget,
    StateCallback, open_ssh_session,
};
use tilde_ssh_config::{ResolveContext, parse_str};
use tokio::sync::RwLock;

pub const TARGET_CONTAINER: &str = "tilde-ssh-tests-target-1";
pub const KEEPALIVE: Duration = Duration::from_secs(1);
pub const KEEPALIVE_MAX: u32 = 3;

/// Shared by ordinary tests, exclusive for tests that disrupt the `target` container.
pub static BENCH: RwLock<()> = RwLock::const_new(());

/// Accepts host keys; answers password prompts from a queue (then cancels).
#[derive(Default)]
pub struct Answers {
    pub passwords: Mutex<VecDeque<String>>,
}

#[async_trait]
impl Prompter for Answers {
    async fn host_key(&self, _req: HostKeyPrompt) -> HostKeyDecision {
        HostKeyDecision::AcceptAndSave
    }
    async fn secret(&self, _req: SecretPrompt) -> Option<SecretAnswer> {
        let value = self.passwords.lock().pop_front()?;
        Some(SecretAnswer { value, remember: false })
    }
    async fn keyboard_interactive(&self, _req: KbdPrompt) -> Option<Vec<String>> {
        None
    }
}

#[derive(Default)]
pub struct States(pub Mutex<Vec<ConnState>>);

impl States {
    pub fn callback(self: &Arc<Self>) -> StateCallback {
        let me = Arc::clone(self);
        Arc::new(move |s| me.0.lock().push(s))
    }

    pub fn snapshot(&self) -> Vec<ConnState> {
        self.0.lock().clone()
    }

    /// Waits until a state matching `pred` is recorded at or after index `from`;
    /// returns its index.
    pub async fn wait(
        &self,
        from: usize,
        within: Duration,
        pred: impl Fn(&ConnState) -> bool,
    ) -> usize {
        let deadline = Instant::now() + within;
        loop {
            if let Some(i) = self.0.lock().iter().skip(from).position(&pred) {
                return from + i;
            }
            assert!(Instant::now() < deadline, "state not reached; got {:?}", self.snapshot());
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    }
}

/// Accumulates a feed's output and finds text in it.
pub struct Output {
    pub feed: OutputFeed,
    text: String,
    pos: usize,
}

impl Output {
    pub fn new(feed: OutputFeed) -> Self {
        Self { feed, text: String::new(), pos: 0 }
    }

    pub async fn expect(&mut self, needle: &str) {
        let deadline = Instant::now() + Duration::from_secs(15);
        loop {
            for chunk in self.feed.chunks.try_iter() {
                self.text.push_str(&String::from_utf8_lossy(&chunk));
            }
            if let Some(i) = self.text[self.pos..].find(needle) {
                self.pos += i + needle.len();
                return;
            }
            assert!(
                Instant::now() < deadline,
                "{needle:?} not received; got {:?}",
                &self.text[self.pos..]
            );
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    }

    pub async fn exit_code(&self) -> Option<i32> {
        let deadline = Instant::now() + Duration::from_secs(15);
        loop {
            if let Ok(code) = self.feed.exit.try_recv() {
                return code;
            }
            assert!(Instant::now() < deadline, "no exit code");
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    }
}

pub struct Bench {
    home: tempfile::TempDir,
    pub password: String,
    key: std::path::PathBuf,
}

impl Bench {
    pub fn new() -> Option<Self> {
        let env = super::env()?;
        Some(Self {
            home: tempfile::TempDir::new().unwrap(),
            password: env.password(),
            key: env.key("id_ed25519"),
        })
    }

    /// The target, published directly on 2203; with the bench key unless `password_only`.
    pub fn spec(&self, password_only: bool, auto_reconnect: bool) -> SshSessionSpec {
        self.spec_with(password_only, auto_reconnect, "")
    }

    /// [`Self::spec`] with `extra` lines appended to the target's `Host` block.
    pub fn spec_with(
        &self,
        password_only: bool,
        auto_reconnect: bool,
        extra: &str,
    ) -> SshSessionSpec {
        let auth = if password_only {
            String::new()
        } else {
            format!(" IdentityFile \"{}\"\n", self.key.display())
        };
        let text = format!(
            "Host target\n HostName 127.0.0.1\n Port 2203\n User {}\n IdentitiesOnly yes\n{auth}{extra}",
            super::USER
        );
        let ctx = ResolveContext { local_user: "me".into(), home: self.home.path().to_path_buf() };
        SshSessionSpec {
            config: Arc::new(parse_str(&text, &self.home.path().join("config"))),
            ctx,
            target: SshTarget::Alias("target".into()),
            cols: 80,
            rows: 24,
            auto_reconnect,
        }
    }

    pub fn connector(&self, prompter: Arc<Answers>) -> Arc<Connector> {
        Arc::new(Connector {
            known_hosts: Some(KnownHosts::new(vec![self.home.path().join("known_hosts")])),
            prompter,
            secrets: Arc::new(MemoryStore::default()),
            defaults: SshDefaults {
                connect_timeout: Duration::from_secs(3),
                keepalive_interval: KEEPALIVE,
                keepalive_max: KEEPALIVE_MAX as usize,
            },
            home: self.home.path().to_path_buf(),
            agent_sources: Some(Vec::new()),
        })
    }

    /// A session with the bench key on another server of the bench, published on `port`.
    pub async fn open_at(&self, port: u16) -> (Arc<SshShell>, Output) {
        let mut spec = self.spec(false, false);
        let text = format!(
            "Host target\n HostName 127.0.0.1\n Port {port}\n User {}\n IdentitiesOnly yes\n IdentityFile \"{}\"\n",
            super::USER,
            self.key.display()
        );
        spec.config = Arc::new(parse_str(&text, &self.home.path().join("config")));
        let (shell, feed) = open_ssh_session(
            self.connector(Arc::new(Answers::default())),
            spec,
            Arc::new(States::default()).callback(),
        )
        .await
        .unwrap();
        (shell, Output::new(feed))
    }

    pub async fn open(&self, auto_reconnect: bool) -> (Arc<SshShell>, Output, Arc<States>) {
        self.open_with(auto_reconnect, "").await
    }

    pub async fn open_with(
        &self,
        auto_reconnect: bool,
        extra: &str,
    ) -> (Arc<SshShell>, Output, Arc<States>) {
        let states = Arc::new(States::default());
        let (shell, feed) = open_ssh_session(
            self.connector(Arc::new(Answers::default())),
            self.spec_with(false, auto_reconnect, extra),
            states.callback(),
        )
        .await
        .unwrap();
        (shell, Output::new(feed), states)
    }
}

pub fn docker(args: &[&str]) {
    let status = Command::new("docker").args(args).status().expect("docker CLI");
    assert!(status.success(), "docker {args:?} failed");
}

/// Unpauses the target even if the test fails.
pub struct Unpause;

impl Drop for Unpause {
    fn drop(&mut self) {
        let _ = Command::new("docker").args(["unpause", TARGET_CONTAINER]).status();
    }
}
