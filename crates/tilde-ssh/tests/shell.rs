//! SSH shell sessions against the test bench: output, exit code, resize, flow control,
//! keepalive and reconnection. Tests that pause or restart the `target` container hold
//! the bench exclusively.
#![cfg(feature = "integration")]

use std::{
    collections::VecDeque,
    fs,
    path::Path,
    process::Command,
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
    time::{Duration, Instant},
};

use async_trait::async_trait;
use parking_lot::Mutex;
use tilde_session::{Backend, OutputFeed, OutputSink, SessionManager};
use tilde_ssh::{
    ConnState, Connector, HostKeyDecision, HostKeyPrompt, KbdPrompt, KnownHosts, MemoryStore,
    Prompter, SecretAnswer, SecretPrompt, SshDefaults, SshSessionSpec, SshShell, SshTarget,
    StateCallback, open_ssh_session,
};
use tilde_ssh_config::{ResolveContext, parse_file, parse_str};
use tokio::sync::RwLock;

mod support;

const TARGET_CONTAINER: &str = "tilde-ssh-tests-target-1";
const KEEPALIVE: Duration = Duration::from_secs(1);
const KEEPALIVE_MAX: u32 = 3;

/// Shared by ordinary tests, exclusive for tests that disrupt the `target` container.
static BENCH: RwLock<()> = RwLock::const_new(());

/// Accepts host keys; answers password prompts from a queue (then cancels).
#[derive(Default)]
struct Answers {
    passwords: Mutex<VecDeque<String>>,
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
struct States(Mutex<Vec<ConnState>>);

impl States {
    fn callback(self: &Arc<Self>) -> StateCallback {
        let me = Arc::clone(self);
        Arc::new(move |s| me.0.lock().push(s))
    }

    fn snapshot(&self) -> Vec<ConnState> {
        self.0.lock().clone()
    }

    /// Waits until a state matching `pred` is recorded at or after index `from`;
    /// returns its index.
    async fn wait(
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
struct Output {
    feed: OutputFeed,
    text: String,
    pos: usize,
}

impl Output {
    fn new(feed: OutputFeed) -> Self {
        Self { feed, text: String::new(), pos: 0 }
    }

    async fn expect(&mut self, needle: &str) {
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

    async fn exit_code(&self) -> Option<i32> {
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

struct Bench {
    home: tempfile::TempDir,
    password: String,
    key: std::path::PathBuf,
}

impl Bench {
    fn new() -> Option<Self> {
        let env = support::env()?;
        Some(Self {
            home: tempfile::TempDir::new().unwrap(),
            password: env.password(),
            key: env.key("id_ed25519"),
        })
    }

    /// The target, published directly on 2203; with the bench key unless `password_only`.
    fn spec(&self, password_only: bool, auto_reconnect: bool) -> SshSessionSpec {
        let auth = if password_only {
            String::new()
        } else {
            format!(" IdentityFile \"{}\"\n", self.key.display())
        };
        let text = format!(
            "Host target\n HostName 127.0.0.1\n Port 2203\n User {}\n IdentitiesOnly yes\n{auth}",
            support::USER
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

    fn connector(&self, prompter: Arc<Answers>) -> Arc<Connector> {
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

    async fn open(&self, auto_reconnect: bool) -> (Arc<SshShell>, Output, Arc<States>) {
        let states = Arc::new(States::default());
        let (shell, feed) = open_ssh_session(
            self.connector(Arc::new(Answers::default())),
            self.spec(false, auto_reconnect),
            states.callback(),
        )
        .await
        .unwrap();
        (shell, Output::new(feed), states)
    }
}

fn docker(args: &[&str]) {
    let status = Command::new("docker").args(args).status().expect("docker CLI");
    assert!(status.success(), "docker {args:?} failed");
}

/// Unpauses the target even if the test fails.
struct Unpause;

impl Drop for Unpause {
    fn drop(&mut self) {
        let _ = Command::new("docker").args(["unpause", TARGET_CONTAINER]).status();
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn shell_echo_and_exit_code() {
    let _bench = BENCH.read().await;
    let Some(bench) = Bench::new() else { return };
    let (shell, mut out, states) = bench.open(false).await;
    assert_eq!(states.snapshot().last(), Some(&ConnState::Ready));

    shell.write(b"echo T=$TERM\n").unwrap();
    out.expect("T=xterm-256color").await;
    shell.write(b"exit 4\n").unwrap();
    assert_eq!(out.exit_code().await, Some(4));
}

#[tokio::test(flavor = "multi_thread")]
async fn resize_reaches_remote() {
    let _bench = BENCH.read().await;
    let Some(bench) = Bench::new() else { return };
    let (shell, mut out, _) = bench.open(false).await;
    shell.resize(100, 40).unwrap();
    shell.write(b"echo S=$(stty size)\n").unwrap();
    out.expect("S=40 100").await;
    shell.close();
}

/// Counts what reaches the UI, and never acknowledges it (a frozen tab).
#[derive(Default)]
struct Frozen(AtomicUsize);

impl OutputSink for Frozen {
    fn data(&self, bytes: Vec<u8>) {
        self.0.fetch_add(bytes.len(), Ordering::Relaxed);
    }
    fn exited(&self, _code: Option<i32>) {}
}

#[tokio::test(flavor = "multi_thread")]
async fn remote_flood_does_not_starve_other_channels() {
    let _bench = BENCH.read().await;
    let Some(bench) = Bench::new() else { return };
    let (shell, out, _) = bench.open(false).await;
    let manager = SessionManager::new();
    let sink = Arc::new(Frozen::default());
    let (id, flow) = manager.open_backend(shell.clone(), out.feed, sink.clone()).unwrap();
    shell.attach_flow(flow);

    shell.write(b"head -c 200000000 /dev/zero | base64\n").unwrap();
    let connection = shell.connection().unwrap();
    let mut max_held = 0;
    for _ in 0..20 {
        let start = Instant::now();
        let (pong, _) = support::exec(connection.target(), "echo pong").await;
        let took = start.elapsed();
        assert_eq!(pong.trim(), "pong");
        assert!(took < Duration::from_millis(500), "round trip took {took:?}");
        max_held = max_held.max(shell.held_bytes());
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    assert!(
        sink.0.load(Ordering::Relaxed) >= tilde_session::HIGH_WATERMARK,
        "the flood never reached the UI"
    );
    assert!(max_held < 8 * 1024 * 1024, "held {max_held} bytes");
    manager.close(id).unwrap();
}

#[tokio::test(flavor = "multi_thread")]
async fn keepalive_detects_dead_server() {
    let _bench = BENCH.write().await;
    let Some(bench) = Bench::new() else { return };
    let (shell, _out, states) = bench.open(false).await;
    let _unpause = Unpause;
    docker(&["pause", TARGET_CONTAINER]);
    let start = Instant::now();
    states.wait(0, Duration::from_secs(15), |s| matches!(s, ConnState::Lost { .. })).await;
    let bound = KEEPALIVE * (KEEPALIVE_MAX + 2);
    assert!(start.elapsed() < bound, "loss noticed after {:?}", start.elapsed());
    shell.close();
}

#[tokio::test(flavor = "multi_thread")]
async fn reconnects_after_server_restart() {
    let _bench = BENCH.write().await;
    let Some(bench) = Bench::new() else { return };
    let (shell, mut out, states) = bench.open(true).await;
    shell.write(b"echo before\n").unwrap();
    out.expect("before").await;

    tokio::task::spawn_blocking(|| docker(&["restart", "-t", "1", TARGET_CONTAINER]))
        .await
        .unwrap();
    let lost =
        states.wait(0, Duration::from_secs(15), |s| matches!(s, ConnState::Lost { .. })).await;
    let again = states
        .wait(lost, Duration::from_secs(15), |s| matches!(s, ConnState::Reconnecting { .. }))
        .await;
    states.wait(again, Duration::from_secs(40), |s| *s == ConnState::Ready).await;
    out.expect("reconnecté").await;

    shell.write(b"echo again-$((40+2))\n").unwrap();
    out.expect("again-42").await;
    shell.close();
}

#[tokio::test(flavor = "multi_thread")]
async fn auth_failure_does_not_reconnect_forever() {
    let _bench = BENCH.write().await;
    let Some(bench) = Bench::new() else { return };
    let answers = Arc::new(Answers::default());
    answers.passwords.lock().extend([
        bench.password.clone(),
        "wrong".into(),
        "wrong".into(),
        "wrong".into(),
    ]);
    let states = Arc::new(States::default());
    let (_shell, out) =
        open_ssh_session(bench.connector(answers), bench.spec(true, true), states.callback())
            .await
            .unwrap();
    let out = Output::new(out);

    tokio::task::spawn_blocking(|| docker(&["restart", "-t", "1", TARGET_CONTAINER]))
        .await
        .unwrap();
    let failed =
        states.wait(0, Duration::from_secs(60), |s| matches!(s, ConnState::Failed { .. })).await;
    let ConnState::Failed { message } = &states.snapshot()[failed] else { unreachable!() };
    assert!(message.contains("authentification refusée"), "{message}");
    assert_eq!(out.exit_code().await, None);
    tokio::time::sleep(Duration::from_secs(3)).await;
    assert_eq!(
        states.snapshot().len(),
        failed + 1,
        "no attempt after the failure: {:?}",
        states.snapshot()
    );
}

/// Opt-in, read-only, against one of the developer's own hosts (see tests/connect.rs):
/// `TILDE_SSH_REAL_HOST=<alias> cargo test -p tilde-ssh --features integration`.
#[tokio::test(flavor = "multi_thread")]
async fn real_host_shell_round_trip() {
    let Ok(alias) = std::env::var("TILDE_SSH_REAL_HOST") else { return };
    let ctx = ResolveContext::from_env();
    let config = parse_file(&ctx.home.join(".ssh").join("config"));
    let host = config.resolve(&alias, &ctx);
    let tmp = tempfile::TempDir::new().unwrap();
    let mut files = Vec::new();
    for (i, f) in host.user_known_hosts_files.iter().enumerate() {
        if Path::new(f).exists() {
            let copy = tmp.path().join(format!("kh{i}"));
            fs::copy(f, &copy).unwrap();
            files.push(copy);
        }
    }
    let connector = Arc::new(Connector {
        known_hosts: Some(KnownHosts::new(files)),
        // Host-key answers only reach the temporary copy of known_hosts.
        prompter: Arc::new(Answers::default()),
        secrets: Arc::new(MemoryStore::default()),
        defaults: SshDefaults::default(),
        home: ctx.home.clone(),
        agent_sources: None,
    });
    let spec = SshSessionSpec {
        config: Arc::new(config),
        ctx,
        target: SshTarget::Alias(alias),
        cols: 80,
        rows: 24,
        auto_reconnect: false,
    };
    let states = Arc::new(States::default());
    let (shell, feed) = open_ssh_session(connector, spec, states.callback()).await.unwrap();
    let mut out = Output::new(feed);
    // A proxy such as Warpgate drops a resize sent before the target shell is up.
    shell.write(b"echo r$((1+1))eady\n").unwrap();
    out.expect("r2eady").await;
    shell.resize(100, 40).unwrap();
    shell.write(b"echo T=$TERM S=$(stty size)\n").unwrap();
    out.expect("T=xterm-256color S=40 100").await;
    shell.write(b"exit 4\n").unwrap();
    assert_eq!(out.exit_code().await, Some(4));
}
