//! `%` tokens, `~` and `${VAR}` expansion.

/// Values of the `%` tokens for one resolved host.
#[derive(Debug, Clone, Copy)]
pub(crate) struct Tokens<'a> {
    /// `%h`: the remote host name.
    pub host: &'a str,
    /// `%p`: the remote port.
    pub port: u16,
    /// `%r`: the remote user.
    pub remote_user: &'a str,
    /// `%u`: the local user.
    pub local_user: &'a str,
    /// `%d`: the local home directory.
    pub home: &'a str,
    /// `%n`: the alias as typed.
    pub alias: &'a str,
}

/// Replaces `%h %p %r %u %d %n %%`. Unknown tokens (`%C`, `%l`, …) are left as they are.
pub(crate) fn percent_expand(s: &str, t: &Tokens<'_>) -> String {
    let port = t.port.to_string();
    expand_with(s, |c| match c {
        'h' => Some(t.host),
        'p' => Some(port.as_str()),
        'r' => Some(t.remote_user),
        'u' => Some(t.local_user),
        'd' => Some(t.home),
        'n' => Some(t.alias),
        _ => None,
    })
}

/// Replaces only `%h` and `%%`, as OpenSSH does for `HostName`.
pub(crate) fn percent_expand_host(s: &str, host: &str) -> String {
    expand_with(s, |c| (c == 'h').then_some(host))
}

fn expand_with<'a>(s: &str, value: impl Fn(char) -> Option<&'a str>) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars();
    while let Some(c) = chars.next() {
        if c != '%' {
            out.push(c);
            continue;
        }
        match chars.next() {
            Some('%') | None => out.push('%'),
            Some(token) => {
                if let Some(v) = value(token) {
                    out.push_str(v);
                } else {
                    out.push('%');
                    out.push(token);
                }
            }
        }
    }
    out
}

/// `~` or `~/…` at the start → home directory. `~user/…` is left as is.
#[must_use]
pub fn tilde_expand(s: &str, home: &str) -> String {
    match s.strip_prefix('~') {
        Some("") => home.to_owned(),
        Some(rest) if rest.starts_with('/') || rest.starts_with('\\') => format!("{home}{rest}"),
        _ => s.to_owned(),
    }
}

/// `${VAR}` → environment variable. Undefined variables are left as they are.
pub(crate) fn env_expand(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(start) = rest.find("${") {
        out.push_str(&rest[..start]);
        let after = &rest[start + 2..];
        let Some(end) = after.find('}') else {
            out.push_str(&rest[start..]);
            return out;
        };
        let name = &after[..end];
        match std::env::var(name) {
            Ok(value) if !name.is_empty() => out.push_str(&value),
            _ => out.push_str(&rest[start..=start + 2 + end]),
        }
        rest = &after[end + 1..];
    }
    out.push_str(rest);
    out
}

/// Paths (`IdentityFile`, `UserKnownHostsFile`): `~`, then `${VAR}`, then `%` tokens.
pub(crate) fn expand_path(s: &str, t: &Tokens<'_>) -> String {
    percent_expand(&env_expand(&tilde_expand(s, t.home)), t)
}

#[cfg(test)]
mod tests {
    use super::*;

    const T: Tokens<'static> = Tokens {
        host: "h.example",
        port: 2222,
        remote_user: "bob",
        local_user: "alice",
        home: "/home/alice",
        alias: "web",
    };

    #[test]
    fn all_supported_tokens() {
        assert_eq!(
            percent_expand("%h %p %r %u %d %n %%", &T),
            "h.example 2222 bob alice /home/alice web %"
        );
    }

    #[test]
    fn unknown_and_trailing_percent_are_kept() {
        assert_eq!(percent_expand("%C-%l-%", &T), "%C-%l-%");
        assert_eq!(percent_expand("100%%", &T), "100%");
    }

    #[test]
    fn host_name_only_knows_h() {
        assert_eq!(percent_expand_host("%h.internal %p %%", "web"), "web.internal %p %");
    }

    #[test]
    fn tilde_only_at_the_start() {
        assert_eq!(tilde_expand("~/.ssh/id", "/home/alice"), "/home/alice/.ssh/id");
        assert_eq!(tilde_expand("~", "/home/alice"), "/home/alice");
        assert_eq!(tilde_expand("a/~/b", "/home/alice"), "a/~/b");
        assert_eq!(tilde_expand("~bob/x", "/home/alice"), "~bob/x");
        assert_eq!(tilde_expand("~\\.ssh\\id", "C:\\Users\\alice"), "C:\\Users\\alice\\.ssh\\id");
    }

    #[test]
    fn env_variables() {
        let path = std::env::var("PATH").unwrap();
        assert_eq!(env_expand("x${PATH}y"), format!("x{path}y"));
        assert_eq!(
            env_expand("${TILDE_SSH_CONFIG_SURELY_UNSET}"),
            "${TILDE_SSH_CONFIG_SURELY_UNSET}"
        );
        assert_eq!(env_expand("$PATH ${unclosed"), "$PATH ${unclosed");
    }

    #[test]
    fn paths_combine_everything() {
        assert_eq!(expand_path("~/.ssh/%r@%h", &T), "/home/alice/.ssh/bob@h.example");
    }
}
