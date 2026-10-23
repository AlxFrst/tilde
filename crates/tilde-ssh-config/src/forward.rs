//! `LocalForward` / `RemoteForward` values.

use crate::jump::split_host_port;

/// A TCP forward: listen on `[bind:]listen_port`, connect to `host:port` on the other side.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct Forward {
    /// Listen address as written (`None` when absent; an empty address becomes `*`).
    pub bind: Option<String>,
    /// `0` lets the system choose (remote forwards).
    pub listen_port: u16,
    pub host: String,
    pub port: u16,
}

/// Parses the two arguments of `LocalForward` / `RemoteForward`:
/// `port host:port`, `bind:port host:port`, with `[v6]` addresses on either side.
///
/// # Errors
///
/// A French message for other forms (one argument, Unix sockets, invalid ports, …).
pub fn parse_forward(args: &[String]) -> Result<Forward, String> {
    if let [single] = args {
        return Err(format!(
            "redirection « {single} » : cible manquante, ou redirection dynamique non prise en charge (attendu : [adresse:]port hôte:port)"
        ));
    }
    let [listen, target] = args else {
        return Err(format!(
            "redirection « {} » : deux arguments attendus ([adresse:]port hôte:port)",
            args.join(" ")
        ));
    };
    let fail = |why: String| format!("redirection « {listen} {target} » : {why}");
    if listen.contains('/') || target.contains('/') {
        return Err(fail("les sockets Unix ne sont pas pris en charge".into()));
    }
    let (bind, listen_port) = split_listen(listen).map_err(fail)?;
    let (host, port) = split_host_port(target).map_err(fail)?;
    let Some(port) = port else {
        return Err(fail(format!("port de destination manquant dans « {target} »")));
    };
    Ok(Forward { bind, listen_port, host, port })
}

/// `port`, `bind:port` or `[v6]:port`; the port may be `0`.
fn split_listen(s: &str) -> Result<(Option<String>, u16), String> {
    let parse =
        |port: &str| port.parse::<u16>().map_err(|_| format!("port d'écoute invalide « {port} »"));
    if let Some(inner) = s.strip_prefix('[') {
        let Some((bind, port)) = inner.split_once("]:") else {
            return Err(format!("adresse d'écoute invalide « {s} »"));
        };
        return Ok((Some(bind.to_owned()), parse(port)?));
    }
    match s.rsplit_once(':') {
        None => Ok((None, parse(s)?)),
        Some((bind, _)) if bind.contains(':') => Err(format!("adresse IPv6 sans crochets « {s} »")),
        Some(("", port)) => Ok((Some("*".to_owned()), parse(port)?)),
        Some((bind, port)) => Ok((Some(bind.to_owned()), parse(port)?)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(list: &[&str]) -> Vec<String> {
        list.iter().map(|a| (*a).to_owned()).collect()
    }

    fn fwd(bind: Option<&str>, listen_port: u16, host: &str, port: u16) -> Forward {
        Forward { bind: bind.map(str::to_owned), listen_port, host: host.to_owned(), port }
    }

    #[test]
    fn forward_parsing() {
        assert_eq!(
            parse_forward(&args(&["8080", "localhost:80"])).unwrap(),
            fwd(None, 8080, "localhost", 80)
        );
        assert_eq!(
            parse_forward(&args(&["127.0.0.1:8080", "db:5432"])).unwrap(),
            fwd(Some("127.0.0.1"), 8080, "db", 5432)
        );
        assert_eq!(
            parse_forward(&args(&["[::1]:9000", "[::1]:22"])).unwrap(),
            fwd(Some("::1"), 9000, "::1", 22)
        );
    }

    #[test]
    fn wildcard_and_empty_bind() {
        assert_eq!(
            parse_forward(&args(&["*:8080", "web:80"])).unwrap(),
            fwd(Some("*"), 8080, "web", 80)
        );
        assert_eq!(
            parse_forward(&args(&[":8080", "web:80"])).unwrap(),
            fwd(Some("*"), 8080, "web", 80)
        );
    }

    #[test]
    fn listen_port_zero_is_allowed() {
        assert_eq!(parse_forward(&args(&["0", "web:80"])).unwrap(), fwd(None, 0, "web", 80));
    }

    #[test]
    fn unsupported_or_invalid_forms_are_errors() {
        for bad in [
            &["1080"][..],
            &["8080", "web"],
            &["8080", "web:0"],
            &["x", "web:80"],
            &["8080", "/run/app.sock"],
            &["/tmp/s", "web:80"],
            &["8080", "web:80", "extra"],
            &["70000", "web:80"],
        ] {
            assert!(parse_forward(&args(bad)).is_err(), "{bad:?} should be rejected");
        }
    }
}
