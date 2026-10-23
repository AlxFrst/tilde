//! Connection chains: `ProxyJump` hosts in front of the target.

use tilde_ssh_config::{ResolveContext, ResolvedHost, SshConfig};

use russh::client::Handle;

use crate::{ClientHandler, ConnectError, Connector, HopLabel, proxy_command::spawn_proxy_command};

/// Maximum number of hops (jump hosts + target).
pub const MAX_HOPS: usize = 8;

/// The ordered hops to `target`: jump hosts first, the target last.
///
/// Follows OpenSSH: with `ProxyJump a,b`, `a` is resolved with its own configuration
/// (its own `ProxyJump` is honoured, recursively) while `b` is reached through `a`, so
/// `b`'s own `ProxyJump` is ignored. A jump's explicit `user@`/`:port` wins over its
/// configuration.
///
/// # Errors
///
/// [`ConnectError::Proxy`] for a cycle or more than [`MAX_HOPS`] hops.
pub fn plan_chain(
    config: &SshConfig,
    ctx: &ResolveContext,
    target: &ResolvedHost,
) -> Result<Vec<ResolvedHost>, ConnectError> {
    let mut hops = Vec::new();
    let mut path = vec![target.alias.clone()];
    expand(config, ctx, &target.proxy_jump, &mut path, &mut hops)?;
    let mut target = target.clone();
    if !hops.is_empty() {
        // Reached through the chain: its own ProxyCommand no longer applies.
        target.proxy_command = None;
    }
    target.proxy_jump.clear();
    hops.push(target);
    if hops.len() > MAX_HOPS {
        return Err(too_many());
    }
    Ok(hops)
}

/// An established chain. Jump-host sessions are kept alive as long as the target's.
pub struct Connection {
    /// Every hop's session, jump hosts first; never empty.
    handles: Vec<Handle<ClientHandler>>,
}

impl Connection {
    /// The session with the final host.
    ///
    /// # Panics
    ///
    /// Never: a `Connection` always holds at least the target's session.
    #[must_use]
    pub fn target(&self) -> &Handle<ClientHandler> {
        self.handles.last().expect("a connection has at least one hop")
    }
}

impl Connector {
    /// Connects to `target` through its `ProxyJump` chain (or its `ProxyCommand`), checking
    /// each hop's host key and authenticating on each. `on_hop` is called before each hop.
    ///
    /// # Errors
    ///
    /// The first hop's failure, labelled with that hop.
    pub async fn connect_chain(
        &self,
        config: &SshConfig,
        ctx: &ResolveContext,
        target: &ResolvedHost,
        mut on_hop: impl FnMut(&HopLabel),
    ) -> Result<Connection, ConnectError> {
        let hops = plan_chain(config, ctx, target)?;
        let total = hops.len();
        let mut handles: Vec<Handle<ClientHandler>> = Vec::with_capacity(total);
        for (i, host) in hops.iter().enumerate() {
            let label = HopLabel { index: i + 1, total, host: host.hostname.clone() };
            on_hop(&label);
            let handle = match handles.last() {
                // Through the previous hop: a direct-tcpip channel becomes the stream.
                Some(prev) => {
                    let channel = prev
                        .channel_open_direct_tcpip(
                            host.hostname.as_str(),
                            u32::from(host.port),
                            "127.0.0.1",
                            0,
                        )
                        .await
                        .map_err(|e| ConnectError::Unreachable {
                            hop: label.clone(),
                            source: std::io::Error::other(e),
                        })?;
                    self.connect_direct(host, Some(Box::new(channel.into_stream())), label).await?
                }
                None => self.connect_first(host, label).await?,
            };
            handles.push(handle);
        }
        Ok(Connection { handles })
    }

    /// The first hop: TCP, or its `ProxyCommand`.
    async fn connect_first(
        &self,
        host: &ResolvedHost,
        label: HopLabel,
    ) -> Result<Handle<ClientHandler>, ConnectError> {
        let Some(cmd) = &host.proxy_command else {
            return self.connect_direct(host, None, label).await;
        };
        let proxy = spawn_proxy_command(cmd)?;
        let stderr = proxy.stderr_handle();
        match self.connect_direct(host, Some(Box::new(proxy)), label).await {
            Ok(h) => Ok(h),
            Err(e) => {
                tokio::time::sleep(std::time::Duration::from_millis(300)).await;
                let output = stderr.lock().trim().to_owned();
                if output.is_empty() {
                    Err(e)
                } else {
                    Err(ConnectError::Proxy { message: format!("ProxyCommand : {output} ({e})") })
                }
            }
        }
    }
}

fn too_many() -> ConnectError {
    ConnectError::Proxy { message: format!("trop de sauts ProxyJump (maximum {MAX_HOPS})") }
}

fn expand(
    config: &SshConfig,
    ctx: &ResolveContext,
    jumps: &[tilde_ssh_config::JumpHost],
    path: &mut Vec<String>,
    hops: &mut Vec<ResolvedHost>,
) -> Result<(), ConnectError> {
    for (i, jump) in jumps.iter().enumerate() {
        if path.contains(&jump.host) {
            return Err(ConnectError::Proxy {
                message: format!("ProxyJump circulaire : {} → {}", path.join(" → "), jump.host),
            });
        }
        let mut hop = config.resolve(&jump.host, ctx);
        if let Some(user) = &jump.user {
            hop.user.clone_from(user);
        }
        if let Some(port) = jump.port {
            hop.port = port;
        }
        if i == 0 {
            // Only the first jump host is reached with its own configuration.
            path.push(jump.host.clone());
            expand(config, ctx, &hop.proxy_jump, path, hops)?;
            path.pop();
            if !hop.proxy_jump.is_empty() {
                hop.proxy_command = None;
            }
        } else {
            hop.proxy_command = None;
        }
        hop.proxy_jump.clear();
        hops.push(hop);
        if hops.len() >= MAX_HOPS {
            return Err(too_many());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use tilde_ssh_config::parse_str;

    use super::*;

    fn setup(text: &str) -> (SshConfig, ResolveContext) {
        let ctx = ResolveContext { local_user: "me".into(), home: "/home/me".into() };
        (parse_str(text, Path::new("/home/me/.ssh/config")), ctx)
    }

    fn aliases(hops: &[ResolvedHost]) -> Vec<&str> {
        hops.iter().map(|h| h.alias.as_str()).collect()
    }

    #[test]
    fn direct_host_is_a_single_hop() {
        let (c, ctx) = setup("Host t\n HostName t.example\n");
        let hops = plan_chain(&c, &ctx, &c.resolve("t", &ctx)).unwrap();
        assert_eq!(aliases(&hops), ["t"]);
    }

    #[test]
    fn plan_chain_orders_hops() {
        // b1's own ProxyJump (b0) is honoured; b2's (bx) is not: b2 is reached via b1.
        let (c, ctx) = setup(
            "Host t\n ProxyJump b1,b2\nHost b1\n ProxyJump b0\nHost b2\n ProxyJump bx\nHost b0 bx\n HostName %h.example\n",
        );
        let hops = plan_chain(&c, &ctx, &c.resolve("t", &ctx)).unwrap();
        assert_eq!(aliases(&hops), ["b0", "b1", "b2", "t"]);
        assert_eq!(hops[0].hostname, "b0.example");
    }

    #[test]
    fn plan_chain_detects_cycles() {
        let (c, ctx) = setup("Host a\n ProxyJump b\nHost b\n ProxyJump a\n");
        let err = plan_chain(&c, &ctx, &c.resolve("a", &ctx)).unwrap_err();
        assert!(err.to_string().contains("circulaire"), "{err}");
    }

    #[test]
    fn explicit_jump_user_and_port_win() {
        let (c, ctx) = setup("Host t\n ProxyJump root@b:2222\nHost b\n User alice\n Port 22\n");
        let hops = plan_chain(&c, &ctx, &c.resolve("t", &ctx)).unwrap();
        assert_eq!((hops[0].user.as_str(), hops[0].port), ("root", 2222));
    }

    #[test]
    fn too_many_hops_is_refused() {
        let jumps: Vec<String> = (0..MAX_HOPS).map(|i| format!("j{i}")).collect();
        let (c, ctx) = setup(&format!("Host t\n ProxyJump {}\n", jumps.join(",")));
        let err = plan_chain(&c, &ctx, &c.resolve("t", &ctx)).unwrap_err();
        assert!(err.to_string().contains(&MAX_HOPS.to_string()), "{err}");
    }
}
