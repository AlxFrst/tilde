//! Prints how Tilde resolves hosts from your ssh config, in `ssh -G`-like `key value` lines,
//! to compare with OpenSSH. Dev tool, nothing is sent anywhere.
//!
//! `cargo run -p tilde-ssh-config --example resolve -- [alias...]` (default: every concrete
//! host of `~/.ssh/config`). Diagnostics go to stderr.

use tilde_ssh_config::{ResolveContext, parse_file};

fn main() {
    let ctx = ResolveContext::from_env();
    let path = ctx.home.join(".ssh").join("config");
    let config = parse_file(&path);
    for d in &config.diagnostics {
        eprintln!("diagnostic {}:{}: {}", d.file.display(), d.line, d.message);
    }
    let mut aliases: Vec<String> = std::env::args().skip(1).collect();
    if aliases.is_empty() {
        aliases = config.concrete_hosts();
    }
    for alias in aliases {
        let h = config.resolve(&alias, &ctx);
        println!("== {alias}");
        println!("user {}", h.user);
        println!("hostname {}", h.hostname);
        println!("port {}", h.port);
        for f in &h.identity_files {
            println!("identityfile {}", f.display());
        }
        if !h.proxy_jump.is_empty() {
            let hops: Vec<String> = h
                .proxy_jump
                .iter()
                .map(|j| {
                    let user = j.user.as_deref().map(|u| format!("{u}@")).unwrap_or_default();
                    let port = j.port.map(|p| format!(":{p}")).unwrap_or_default();
                    format!("{user}{}{port}", j.host)
                })
                .collect();
            println!("proxyjump {}", hops.join(","));
        }
        if let Some(cmd) = &h.proxy_command {
            println!("proxycommand {cmd}");
        }
    }
}
