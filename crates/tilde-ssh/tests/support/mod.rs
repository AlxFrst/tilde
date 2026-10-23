//! Shared helpers for the integration tests (SSH test bench, see tests/docker/README.md).
#![allow(dead_code)]

use std::{
    net::{SocketAddr, TcpStream},
    path::PathBuf,
    time::Duration,
};

pub const USER: &str = "tilde";
pub const PASSWORD: &str = "tilde-test";
pub const KEY_PASSPHRASE: &str = "tilde-pass";

/// Where the bench listens and where its keys are.
pub struct TestEnv {
    pub host: &'static str,
    pub bastion1_port: u16,
    pub target_port: u16,
    pub keys: PathBuf,
}

impl TestEnv {
    pub fn key(&self, name: &str) -> PathBuf {
        self.keys.join(name)
    }
}

fn reachable(port: u16) -> bool {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    TcpStream::connect_timeout(&addr, Duration::from_secs(1)).is_ok()
}

/// The bench, or `None` (and a note on stderr) when it isn't running — the test then
/// returns early. In CI the bench is always started, so nothing is silently skipped.
pub fn env() -> Option<TestEnv> {
    let keys = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../tests/docker/keys");
    let env = TestEnv { host: "127.0.0.1", bastion1_port: 2201, target_port: 2203, keys };
    if env.key("id_ed25519").exists() && reachable(env.bastion1_port) && reachable(env.target_port)
    {
        Some(env)
    } else {
        assert!(
            std::env::var_os("TILDE_REQUIRE_SSH_BENCH").is_none(),
            "SSH test bench required but not running (scripts/ssh-test-env up)"
        );
        eprintln!("SSH test bench not running: skipped (scripts/ssh-test-env up)");
        None
    }
}
