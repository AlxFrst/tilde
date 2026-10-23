//! `ProxyJump` values.

/// One hop of a `ProxyJump` list. `user` and `port` are those written in the hop, if any;
/// the rest comes from resolving `host` as an alias.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct JumpHost {
    pub user: Option<String>,
    pub host: String,
    pub port: Option<u16>,
}

/// Parses `[user@]host[:port]` hops separated by commas (`ssh://` URIs and bracketed
/// IPv6 `[::1]:22` accepted). `none` gives an empty list.
///
/// # Errors
///
/// A French message naming the faulty hop (empty host or user, invalid port, …).
pub fn parse_proxy_jump(value: &str) -> Result<Vec<JumpHost>, String> {
    let value = value.trim();
    if value.eq_ignore_ascii_case("none") {
        return Ok(Vec::new());
    }
    value.split(',').map(parse_hop).collect()
}

fn parse_hop(hop: &str) -> Result<JumpHost, String> {
    let fail = |why: &str| format!("ProxyJump « {hop} » : {why}");
    let spec = hop.trim();
    if spec.is_empty() {
        return Err(fail("saut vide"));
    }
    if spec.contains(char::is_whitespace) {
        return Err(fail("espace inattendu"));
    }
    let spec = spec.strip_prefix("ssh://").unwrap_or(spec);
    let (user, host_port) = match spec.rsplit_once('@') {
        Some(("", _)) => return Err(fail("utilisateur vide")),
        Some((user, rest)) => (Some(user.to_owned()), rest),
        None => (None, spec),
    };
    let (host, port) = split_host_port(host_port).map_err(|why| fail(&why))?;
    Ok(JumpHost { user, host, port })
}

/// `host`, `host:port`, `[v6]` or `[v6]:port`.
pub(crate) fn split_host_port(s: &str) -> Result<(String, Option<u16>), String> {
    let (host, port) = if let Some(inner) = s.strip_prefix('[') {
        let Some((host, after)) = inner.split_once(']') else {
            return Err("crochet fermant manquant".into());
        };
        match after {
            "" => (host, None),
            _ => match after.strip_prefix(':') {
                Some(port) => (host, Some(port)),
                None => return Err(format!("texte inattendu après « ] » : {after}")),
            },
        }
    } else {
        match s.split_once(':') {
            Some((_, port)) if port.contains(':') => {
                return Err("adresse IPv6 sans crochets ([…])".into());
            }
            Some((host, port)) => (host, Some(port)),
            None => (s, None),
        }
    };
    if host.is_empty() {
        return Err("hôte vide".into());
    }
    let port = match port {
        None => None,
        Some(port) => Some(parse_port(port).ok_or_else(|| format!("port invalide « {port} »"))?),
    };
    Ok((host.to_owned(), port))
}

/// A TCP port in `1..=65535`.
pub(crate) fn parse_port(s: &str) -> Option<u16> {
    s.parse::<u16>().ok().filter(|&p| p != 0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hop(user: Option<&str>, host: &str, port: Option<u16>) -> JumpHost {
        JumpHost { user: user.map(str::to_owned), host: host.to_owned(), port }
    }

    #[test]
    fn proxy_jump_parsing() {
        assert_eq!(
            parse_proxy_jump("a,bob@c:2222,[::1]:2200").unwrap(),
            vec![
                hop(None, "a", None),
                hop(Some("bob"), "c", Some(2222)),
                hop(None, "::1", Some(2200))
            ]
        );
        assert_eq!(parse_proxy_jump("none").unwrap(), vec![]);
        assert_eq!(parse_proxy_jump("NONE").unwrap(), vec![]);
        assert!(parse_proxy_jump("bob@:22").is_err());
    }

    #[test]
    fn uris_and_bare_brackets() {
        assert_eq!(
            parse_proxy_jump("ssh://ops@b1.example:2201,[fe80::1]").unwrap(),
            vec![hop(Some("ops"), "b1.example", Some(2201)), hop(None, "fe80::1", None)]
        );
    }

    #[test]
    fn user_is_split_at_the_last_at_sign() {
        assert_eq!(parse_proxy_jump("me@corp@b1").unwrap(), vec![hop(Some("me@corp"), "b1", None)]);
    }

    #[test]
    fn invalid_values_are_errors() {
        for bad in ["", "a,,b", "@b1", "b1:", "b1:0", "b1:99999", "b1:x", "::1", "[::1", "a b"] {
            assert!(parse_proxy_jump(bad).is_err(), "{bad:?} should be rejected");
        }
    }
}
