//! Smoke test for the SSH test bench itself.
#![cfg(feature = "integration")]

use std::{io::Read, net::TcpStream, time::Duration};

mod support;

#[test]
fn bench_servers_speak_ssh() {
    let Some(env) = support::env() else { return };
    for port in [env.bastion1_port, env.target_port] {
        let mut s = TcpStream::connect((env.host, port)).unwrap();
        s.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
        let mut banner = [0u8; 8];
        s.read_exact(&mut banner).unwrap();
        assert_eq!(&banner, b"SSH-2.0-", "port {port}");
    }
}
