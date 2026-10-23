//! Direct connection, host key check and authentication against the SSH test bench
//! (and, opt-in, against a real host of the developer: `TILDE_SSH_REAL_HOST=<alias>`).
#![cfg(feature = "integration")]

use std::{fs, path::Path, sync::Arc, time::Instant};

use async_trait::async_trait;
use parking_lot::Mutex;
use tilde_ssh::{
    ConnectError, Connector, HopLabel, HostKeyDecision, HostKeyPrompt, HostKeyStatus, KbdPrompt,
    KnownHosts, MemoryStore, Prompter, SecretAnswer, SecretKind, SecretPrompt, SecretStore,
    SshDefaults, passphrase_account,
};
use tilde_ssh_config::{ResolveContext, ResolvedHost, parse_file, parse_str};

mod support;

/// Answers prompts from a script and records what was asked.
#[derive(Default)]
struct Scripted {
    host_key: Option<HostKeyDecision>,
    secret: Option<(String, bool)>,
    host_key_asked: Mutex<Vec<HostKeyPrompt>>,
    secrets_asked: Mutex<Vec<SecretPrompt>>,
}

#[async_trait]
impl Prompter for Scripted {
    async fn host_key(&self, req: HostKeyPrompt) -> HostKeyDecision {
        self.host_key_asked.lock().push(req);
        self.host_key.unwrap_or(HostKeyDecision::Reject)
    }
    async fn secret(&self, req: SecretPrompt) -> Option<SecretAnswer> {
        self.secrets_asked.lock().push(req);
        self.secret.clone().map(|(value, remember)| SecretAnswer { value, remember })
    }
    async fn keyboard_interactive(&self, _req: KbdPrompt) -> Option<Vec<String>> {
        None
    }
}

struct Fixture {
    _dir: tempfile::TempDir,
    home: std::path::PathBuf,
    known_hosts: std::path::PathBuf,
}

impl Fixture {
    fn new() -> Self {
        let dir = tempfile::TempDir::new().unwrap();
        let home = dir.path().to_path_buf();
        let known_hosts = home.join(".ssh").join("known_hosts");
        Self { _dir: dir, home, known_hosts }
    }

    fn host(&self, config: &str) -> ResolvedHost {
        let ctx = ResolveContext { local_user: "me".into(), home: self.home.clone() };
        parse_str(config, &self.home.join(".ssh/config")).resolve("bench", &ctx)
    }

    fn connector(&self, prompter: Arc<Scripted>, secrets: Arc<dyn SecretStore>) -> Connector {
        Connector {
            known_hosts: Some(KnownHosts::new(vec![self.known_hosts.clone()])),
            prompter,
            secrets,
            defaults: SshDefaults::default(),
            home: self.home.clone(),
        }
    }
}

fn bench_config(env: &support::TestEnv, extra: &str) -> String {
    format!(
        "Host bench\n HostName {}\n Port {}\n User {}\n IdentitiesOnly yes\n{extra}",
        env.host,
        env.target_port,
        support::USER
    )
}

fn accept_all() -> Arc<Scripted> {
    Arc::new(Scripted { host_key: Some(HostKeyDecision::AcceptAndSave), ..Scripted::default() })
}

#[tokio::test]
async fn password_auth() {
    let Some(env) = support::env() else { return };
    let fx = Fixture::new();
    let prompter = Arc::new(Scripted {
        host_key: Some(HostKeyDecision::AcceptAndSave),
        secret: Some((env.password(), false)),
        ..Scripted::default()
    });
    let c = fx.connector(prompter.clone(), Arc::new(MemoryStore::default()));
    let handle = c
        .connect_direct(&fx.host(&bench_config(&env, "")), None, HopLabel::target("bench"))
        .await
        .unwrap();
    assert_eq!(support::exec(&handle, "echo ok").await.0.trim(), "ok");
    assert!(matches!(prompter.secrets_asked.lock()[0].kind, SecretKind::Password));
}

#[tokio::test]
async fn key_auth() {
    let Some(env) = support::env() else { return };
    let fx = Fixture::new();
    let key = env.key("id_ed25519");
    let prompter = accept_all();
    let c = fx.connector(prompter.clone(), Arc::new(MemoryStore::default()));
    let cfg = bench_config(&env, &format!(" IdentityFile \"{}\"\n", key.display()));
    let handle = c.connect_direct(&fx.host(&cfg), None, HopLabel::target("bench")).await.unwrap();
    assert_eq!(support::exec(&handle, "whoami").await.0.trim(), support::USER);
    assert!(prompter.secrets_asked.lock().is_empty(), "no question for a key without passphrase");
}

#[tokio::test]
async fn rsa_key_auth() {
    let Some(env) = support::env() else { return };
    let fx = Fixture::new();
    let c = fx.connector(accept_all(), Arc::new(MemoryStore::default()));
    let cfg = bench_config(&env, &format!(" IdentityFile \"{}\"\n", env.key("id_rsa").display()));
    let handle = c.connect_direct(&fx.host(&cfg), None, HopLabel::target("bench")).await.unwrap();
    assert_eq!(support::exec(&handle, "echo rsa").await.0.trim(), "rsa");
}

#[tokio::test]
async fn key_with_passphrase_asks_once_and_remembers() {
    let Some(env) = support::env() else { return };
    let fx = Fixture::new();
    let key = env.key("id_ed25519_pass");
    let store: Arc<dyn SecretStore> = Arc::new(MemoryStore::default());
    let cfg = bench_config(&env, &format!(" IdentityFile \"{}\"\n", key.display()));

    let first = Arc::new(Scripted {
        host_key: Some(HostKeyDecision::AcceptAndSave),
        secret: Some((env.passphrase(), true)),
        ..Scripted::default()
    });
    fx.connector(first.clone(), store.clone())
        .connect_direct(&fx.host(&cfg), None, HopLabel::target("bench"))
        .await
        .unwrap();
    assert_eq!(first.secrets_asked.lock().len(), 1);
    assert!(store.get(&passphrase_account(&key)).is_some());

    let second = accept_all();
    fx.connector(second.clone(), store)
        .connect_direct(&fx.host(&cfg), None, HopLabel::target("bench"))
        .await
        .unwrap();
    assert!(second.secrets_asked.lock().is_empty(), "remembered passphrase reused");
}

#[tokio::test]
async fn wrong_password_lists_methods_tried() {
    let Some(env) = support::env() else { return };
    let fx = Fixture::new();
    let prompter = Arc::new(Scripted {
        host_key: Some(HostKeyDecision::AcceptAndSave),
        secret: Some(("wrong".into(), false)),
        ..Scripted::default()
    });
    let c = fx.connector(prompter.clone(), Arc::new(MemoryStore::default()));
    let err = c
        .connect_direct(&fx.host(&bench_config(&env, "")), None, HopLabel::target("bench"))
        .await
        .err()
        .expect("connection should fail");
    assert!(matches!(err, ConnectError::AuthFailed { .. }), "{err}");
    assert!(err.to_string().contains("mot de passe"), "{err}");
    assert_eq!(prompter.secrets_asked.lock().len(), 3, "three attempts");
}

#[tokio::test]
async fn unknown_host_key_prompts_then_saves() {
    let Some(env) = support::env() else { return };
    let fx = Fixture::new();
    let prompter = accept_all();
    let cfg =
        bench_config(&env, &format!(" IdentityFile \"{}\"\n", env.key("id_ed25519").display()));
    fx.connector(prompter.clone(), Arc::new(MemoryStore::default()))
        .connect_direct(&fx.host(&cfg), None, HopLabel::target("bench"))
        .await
        .unwrap();
    let asked = prompter.host_key_asked.lock();
    assert_eq!(asked.len(), 1);
    assert_eq!(asked[0].status, HostKeyStatus::Unknown);
    assert!(asked[0].fingerprint.starts_with("SHA256:"));
    let saved = fs::read_to_string(&fx.known_hosts).unwrap();
    assert!(saved.starts_with(&format!("[{}]:{} ", env.host, env.target_port)), "{saved}");
}

#[tokio::test]
async fn changed_host_key_is_refused_by_default() {
    let Some(env) = support::env() else { return };
    let fx = Fixture::new();
    fs::create_dir_all(fx.known_hosts.parent().unwrap()).unwrap();
    // A different ed25519 key recorded for the bench.
    fs::write(
        &fx.known_hosts,
        format!(
            "[{}]:{} ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAICqku/9Fq6P2YIkfapLwWqPNs5oTPYzRTjhBvYZd+tV/\n",
            env.host, env.target_port
        ),
    )
    .unwrap();
    let prompter =
        Arc::new(Scripted { host_key: Some(HostKeyDecision::Reject), ..Scripted::default() });
    let cfg =
        bench_config(&env, &format!(" IdentityFile \"{}\"\n", env.key("id_ed25519").display()));
    let err = fx
        .connector(prompter.clone(), Arc::new(MemoryStore::default()))
        .connect_direct(&fx.host(&cfg), None, HopLabel::target("bench"))
        .await
        .err()
        .expect("connection should fail");
    assert!(matches!(err, ConnectError::HostKeyRejected { .. }), "{err}");
    assert!(matches!(prompter.host_key_asked.lock()[0].status, HostKeyStatus::Changed { .. }));
}

#[tokio::test]
async fn unreachable_port_fails_fast() {
    let fx = Fixture::new();
    let host = fx.host("Host bench\n HostName 127.0.0.1\n Port 1\n User x\n IdentitiesOnly yes\n");
    let start = Instant::now();
    let err = fx
        .connector(accept_all(), Arc::new(MemoryStore::default()))
        .connect_direct(&host, None, HopLabel::target("bench"))
        .await
        .err()
        .expect("connection should fail");
    assert!(
        matches!(err, ConnectError::Unreachable { .. } | ConnectError::Timeout { .. }),
        "{err}"
    );
    assert!(start.elapsed().as_secs() < 3, "took {:?}", start.elapsed());
    assert!(err.to_string().contains("bench"), "{err}");
}

/// Opt-in check against one of the developer's own hosts, read-only:
/// `TILDE_SSH_REAL_HOST=<alias> cargo test -p tilde-ssh --features integration`.
/// Uses the real `~/.ssh/config` and a temporary *copy* of `~/.ssh/known_hosts`; any host-key
/// question fails the test (nothing is ever written to the user's files).
#[tokio::test]
async fn real_host_key_auth_and_exec() {
    let Ok(alias) = std::env::var("TILDE_SSH_REAL_HOST") else { return };
    let ctx = ResolveContext::from_env();
    let host = parse_file(&ctx.home.join(".ssh").join("config")).resolve(&alias, &ctx);
    let tmp = tempfile::TempDir::new().unwrap();
    let mut files = Vec::new();
    for (i, f) in host.user_known_hosts_files.iter().enumerate() {
        if Path::new(f).exists() {
            let copy = tmp.path().join(format!("kh{i}"));
            fs::copy(f, &copy).unwrap();
            files.push(copy);
        }
    }
    let prompter = Arc::new(Scripted::default()); // rejects every host-key question
    let c = Connector {
        known_hosts: Some(KnownHosts::new(files)),
        prompter: prompter.clone(),
        secrets: Arc::new(MemoryStore::default()),
        defaults: SshDefaults::default(),
        home: ctx.home.clone(),
    };
    let handle = c.connect_direct(&host, None, HopLabel::target(&alias)).await.unwrap();
    let (out, code) = support::exec(&handle, "echo tilde-ok").await;
    assert_eq!(out.trim(), "tilde-ok");
    assert_eq!(code, Some(0));
    assert!(prompter.host_key_asked.lock().is_empty());
}
