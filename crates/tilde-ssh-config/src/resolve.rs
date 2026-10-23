//! Resolving an alias the way `ssh` does: blocks in order, first value obtained wins.

use std::path::PathBuf;

use crate::{
    forward::{Forward, parse_forward},
    jump::{JumpHost, parse_port, parse_proxy_jump},
    model::{Block, Directive, SshConfig},
    pattern::{host_matches, match_pattern_list},
    tokens::{Tokens, expand_path, percent_expand, percent_expand_host},
    validate::{CriterionKind, parse_bool, parse_criteria, parse_seconds},
};

/// Local facts used by resolution (`%u`, `%d`, `~`, default user, `Match localuser`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolveContext {
    pub local_user: String,
    pub home: PathBuf,
}

impl ResolveContext {
    /// The current user (`USER`, `LOGNAME` or `USERNAME`) and home directory.
    #[must_use]
    pub fn from_env() -> Self {
        let local_user = ["USER", "LOGNAME", "USERNAME"]
            .iter()
            .find_map(|name| std::env::var(name).ok().filter(|v| !v.is_empty()))
            .unwrap_or_default();
        Self { local_user, home: dirs::home_dir().unwrap_or_default() }
    }
}

/// Values obtained so far (`None` / empty = not set yet).
#[derive(Debug, Default)]
struct State {
    hostname: Option<String>,
    port: Option<u16>,
    user: Option<String>,
    identity_files: Vec<String>,
    identities_only: Option<bool>,
    /// `Some(vec![])` for `ProxyJump none`.
    proxy_jump: Option<Vec<JumpHost>>,
    /// Raw, `none` included.
    proxy_command: Option<String>,
    forward_agent: Option<bool>,
    local_forwards: Vec<Forward>,
    remote_forwards: Vec<Forward>,
    user_known_hosts_files: Option<Vec<String>>,
    server_alive_interval: Option<u32>,
    server_alive_count_max: Option<u32>,
    connect_timeout: Option<u32>,
    strict_host_key_checking: Option<String>,
    canonicalize_hostname: Option<bool>,
}

fn set_once<T>(slot: &mut Option<T>, value: Option<T>) {
    if slot.is_none() {
        *slot = value;
    }
}

fn push_unique<T: PartialEq>(list: &mut Vec<T>, value: Option<T>) {
    if let Some(value) = value
        && !list.contains(&value)
    {
        list.push(value);
    }
}

impl State {
    fn apply(&mut self, d: &Directive) {
        let first = d.args.first().map(String::as_str).unwrap_or_default();
        match d.keyword.as_str() {
            "hostname" => set_once(&mut self.hostname, Some(first.to_owned())),
            "port" => set_once(&mut self.port, parse_port(first)),
            "user" => set_once(&mut self.user, Some(first.to_owned())),
            "identityfile" => push_unique(&mut self.identity_files, Some(first.to_owned())),
            "identitiesonly" => set_once(&mut self.identities_only, parse_bool(first)),
            // ProxyJump and ProxyCommand exclude each other: the first one seen wins
            // (OpenSSH `parse_jump` / `oProxyCommand`).
            "proxyjump" if self.proxy_jump.is_none() && self.proxy_command.is_none() => {
                self.proxy_jump = parse_proxy_jump(first).ok();
            }
            "proxycommand" if self.proxy_jump.is_none() => {
                set_once(&mut self.proxy_command, Some(first.to_owned()));
            }
            "forwardagent" => set_once(
                &mut self.forward_agent,
                // A socket path or `$VAR` also enables forwarding.
                Some(parse_bool(first).unwrap_or(true)),
            ),
            "localforward" => push_unique(&mut self.local_forwards, parse_forward(&d.args).ok()),
            "remoteforward" => push_unique(&mut self.remote_forwards, parse_forward(&d.args).ok()),
            "userknownhostsfile" => {
                set_once(&mut self.user_known_hosts_files, Some(d.args.clone()));
            }
            "serveraliveinterval" => {
                set_once(&mut self.server_alive_interval, parse_seconds(first));
            }
            "serveralivecountmax" => set_once(&mut self.server_alive_count_max, first.parse().ok()),
            "connecttimeout" => set_once(&mut self.connect_timeout, parse_seconds(first)),
            "stricthostkeychecking" => {
                set_once(&mut self.strict_host_key_checking, Some(first.to_ascii_lowercase()));
            }
            "canonicalizehostname" => set_once(
                &mut self.canonicalize_hostname,
                Some(matches!(first.to_ascii_lowercase().as_str(), "yes" | "always")),
            ),
            _ => {}
        }
    }
}

/// What one pass over the blocks matches against.
struct Pass<'a> {
    alias: &'a str,
    ctx: &'a ResolveContext,
    /// `None` on the first pass; the final host name on OpenSSH's second pass.
    final_host: Option<&'a str>,
}

impl Pass<'_> {
    /// Subject of `Host` patterns.
    fn host_line_subject(&self) -> &str {
        self.final_host.unwrap_or(self.alias)
    }

    fn criteria_match(&self, criteria: &[String], st: &State) -> bool {
        let Ok(criteria) = parse_criteria(criteria) else { return false };
        criteria.iter().all(|c| {
            let result = match &c.kind {
                CriterionKind::All => true,
                CriterionKind::Canonical | CriterionKind::Final => self.final_host.is_some(),
                CriterionKind::Host(list) => {
                    let host = match (self.final_host, &st.hostname) {
                        (Some(host), _) => host.to_owned(),
                        (None, Some(hostname)) => percent_expand_host(hostname, self.alias),
                        (None, None) => self.alias.to_owned(),
                    };
                    match_pattern_list(&host, list, true)
                }
                CriterionKind::OriginalHost(list) => match_pattern_list(self.alias, list, true),
                CriterionKind::User(list) => {
                    let user = st.user.as_deref().unwrap_or(&self.ctx.local_user);
                    match_pattern_list(user, list, false)
                }
                CriterionKind::LocalUser(list) => {
                    match_pattern_list(&self.ctx.local_user, list, false)
                }
                CriterionKind::HostBlock(patterns) => {
                    host_matches(patterns, self.host_line_subject())
                }
                // Never evaluated, whatever the negation.
                CriterionKind::Unsupported(_) => return false,
            };
            result != c.negate
        })
    }

    fn run(&self, blocks: &[Block], st: &mut State) {
        for block in blocks {
            let active = match block {
                Block::Global(_) => true,
                Block::Host { patterns, .. } => host_matches(patterns, self.host_line_subject()),
                Block::Match { criteria, .. } => self.criteria_match(criteria, st),
            };
            if active {
                for directive in block.directives() {
                    st.apply(directive);
                }
            }
        }
    }
}

/// Whether some `Match` asks for OpenSSH's final pass.
fn wants_final_pass(blocks: &[Block]) -> bool {
    blocks.iter().any(|block| match block {
        Block::Match { criteria, .. } => parse_criteria(criteria)
            .is_ok_and(|parsed| parsed.iter().any(|c| c.kind == CriterionKind::Final)),
        _ => false,
    })
}

/// Everything Tilde needs to connect to one alias.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedHost {
    /// The name that was resolved, as given.
    pub alias: String,
    /// `HostName` (tokens expanded) or the alias, in lower case like `ssh`.
    pub hostname: String,
    pub port: u16,
    pub user: String,
    /// Explicit `IdentityFile`s in order, expanded, duplicates and `none` removed. The
    /// default keys (`~/.ssh/id_ed25519`, …) are not listed here.
    pub identity_files: Vec<PathBuf>,
    pub identities_only: bool,
    /// Empty without `ProxyJump` or with `ProxyJump none`.
    pub proxy_jump: Vec<JumpHost>,
    /// Tokens expanded; `None` without `ProxyCommand` or with `ProxyCommand none`.
    pub proxy_command: Option<String>,
    pub forward_agent: bool,
    pub local_forwards: Vec<Forward>,
    pub remote_forwards: Vec<Forward>,
    /// `UserKnownHostsFile` expanded, or OpenSSH's default (`~/.ssh/known_hosts`,
    /// `~/.ssh/known_hosts2`); empty with `UserKnownHostsFile none`.
    pub user_known_hosts_files: Vec<PathBuf>,
    /// Seconds.
    pub server_alive_interval: Option<u32>,
    pub server_alive_count_max: Option<u32>,
    /// Seconds.
    pub connect_timeout: Option<u32>,
    /// Lower case (`yes`, `no`, `ask`, `accept-new`, `off`).
    pub strict_host_key_checking: Option<String>,
}

impl SshConfig {
    /// Resolves `alias` like `ssh -G` would (see the crate docs for what is supported).
    #[must_use]
    pub fn resolve(&self, alias: &str, ctx: &ResolveContext) -> ResolvedHost {
        let mut st = State::default();
        Pass { alias, ctx, final_host: None }.run(&self.blocks, &mut st);

        // ssh.c: expand `%h` in HostName, then lower-case the result.
        let hostname = st
            .hostname
            .as_deref()
            .map_or_else(|| alias.to_owned(), |h| percent_expand_host(h, alias))
            .to_lowercase();
        if wants_final_pass(&self.blocks) || st.canonicalize_hostname == Some(true) {
            // HostName is now fixed; `Host` lines and `Match host` see the final name.
            st.hostname.get_or_insert_with(|| hostname.clone());
            Pass { alias, ctx, final_host: Some(&hostname) }.run(&self.blocks, &mut st);
        }

        let port = st.port.unwrap_or(22);
        let user = st.user.clone().unwrap_or_else(|| ctx.local_user.clone());
        let home = ctx.home.to_string_lossy();
        let tokens = Tokens {
            host: &hostname,
            port,
            remote_user: &user,
            local_user: &ctx.local_user,
            home: &home,
            alias,
        };
        let path = |raw: &String| PathBuf::from(expand_path(raw, &tokens));

        let identity_files = st
            .identity_files
            .iter()
            .filter(|f| !f.eq_ignore_ascii_case("none"))
            .map(path)
            .collect();
        let proxy_command = st
            .proxy_command
            .as_deref()
            .filter(|c| !c.eq_ignore_ascii_case("none"))
            .map(|c| percent_expand(c, &tokens));
        let known_hosts = st.user_known_hosts_files.clone().unwrap_or_else(|| {
            vec!["~/.ssh/known_hosts".to_owned(), "~/.ssh/known_hosts2".to_owned()]
        });
        let user_known_hosts_files =
            if known_hosts.len() == 1 && known_hosts[0].eq_ignore_ascii_case("none") {
                Vec::new()
            } else {
                known_hosts.iter().map(path).collect()
            };

        ResolvedHost {
            alias: alias.to_owned(),
            hostname: hostname.clone(),
            port,
            user: user.clone(),
            identity_files,
            identities_only: st.identities_only.unwrap_or(false),
            proxy_jump: st.proxy_jump.unwrap_or_default(),
            proxy_command,
            forward_agent: st.forward_agent.unwrap_or(false),
            local_forwards: st.local_forwards,
            remote_forwards: st.remote_forwards,
            user_known_hosts_files,
            server_alive_interval: st.server_alive_interval,
            server_alive_count_max: st.server_alive_count_max,
            connect_timeout: st.connect_timeout,
            strict_host_key_checking: st.strict_host_key_checking,
        }
    }

    /// `Host` patterns without wildcard or negation, without duplicates, in file order:
    /// the hosts a user can pick from a list.
    #[must_use]
    pub fn concrete_hosts(&self) -> Vec<String> {
        let mut hosts: Vec<String> = Vec::new();
        for block in &self.blocks {
            if let Block::Host { patterns, .. } = block {
                for pattern in patterns {
                    let concrete = !pattern.is_empty()
                        && !pattern.starts_with('!')
                        && !pattern.contains(['*', '?']);
                    if concrete && !hosts.contains(pattern) {
                        hosts.push(pattern.clone());
                    }
                }
            }
        }
        hosts
    }
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::*;
    use crate::{
        forward::Forward,
        include::{ParseOptions, parse_str_with},
    };

    fn ctx() -> ResolveContext {
        ResolveContext { local_user: "alice".into(), home: PathBuf::from("/home/alice") }
    }

    fn parse(text: &str) -> SshConfig {
        parse_str_with(text, Path::new("cfg"), &ParseOptions::with_home("/home/alice"))
    }

    fn resolve(text: &str, alias: &str) -> ResolvedHost {
        parse(text).resolve(alias, &ctx())
    }

    fn paths(list: &[&str]) -> Vec<PathBuf> {
        list.iter().map(PathBuf::from).collect()
    }

    #[test]
    fn defaults() {
        let host = resolve("", "Web");
        assert_eq!(host.alias, "Web");
        assert_eq!(host.hostname, "web");
        assert_eq!(host.port, 22);
        assert_eq!(host.user, "alice");
        assert_eq!(host.identity_files, Vec::<PathBuf>::new());
        assert!(!host.identities_only);
        assert_eq!(host.proxy_jump, vec![]);
        assert_eq!(host.proxy_command, None);
        assert!(!host.forward_agent);
        assert_eq!(
            host.user_known_hosts_files,
            paths(&["/home/alice/.ssh/known_hosts", "/home/alice/.ssh/known_hosts2"])
        );
        assert_eq!(host.server_alive_interval, None);
        assert_eq!(host.connect_timeout, None);
        assert_eq!(host.strict_host_key_checking, None);
    }

    #[test]
    fn first_value_wins() {
        let host = resolve("Host web\n User a\nHost *\n User b\n", "web");
        assert_eq!(host.user, "a");
    }

    /// OpenSSH keeps the *first* value obtained, so a `Host *` block placed first wins
    /// over a more specific block placed later (`ssh_config(5)`: "more host-specific
    /// declarations should be given near the beginning of the file"). The specific
    /// block still supplies what `Host *` left unset.
    #[test]
    fn host_star_first_does_not_override_specific_later_values() {
        let host = resolve("Host *\n User def\nHost web\n User a\n Port 2222\n", "web");
        assert_eq!(host.user, "def");
        assert_eq!(host.port, 2222);
    }

    #[test]
    fn keywords_are_case_insensitive() {
        let host = resolve("HOST web\n  hOsTnAmE 10.0.0.5\n  PORT=2200\n", "web");
        assert_eq!(host.hostname, "10.0.0.5");
        assert_eq!(host.port, 2200);
    }

    #[test]
    fn identity_files_accumulate_in_order() {
        let host = resolve(
            "Host web\n IdentityFile ~/.ssh/web\n IdentityFile ~/.ssh/shared\nHost *\n IdentityFile ~/.ssh/shared\n IdentityFile ~/.ssh/all\n IdentityFile none\n",
            "web",
        );
        assert_eq!(
            host.identity_files,
            paths(&["/home/alice/.ssh/web", "/home/alice/.ssh/shared", "/home/alice/.ssh/all"])
        );
    }

    #[test]
    fn tokens_are_expanded() {
        let host = resolve(
            "Host web\n User bob\n HostName h.example\n IdentityFile ~/.ssh/%r@%h\n IdentityFile %d/k-%u-%n-%p\n",
            "web",
        );
        assert_eq!(
            host.identity_files,
            paths(&["/home/alice/.ssh/bob@h.example", "/home/alice/k-alice-web-22"])
        );
    }

    #[test]
    fn hostname_knows_h_and_is_lower_cased() {
        let host = resolve("Host web\n HostName %h.Internal.Example\n", "web");
        assert_eq!(host.hostname, "web.internal.example");
    }

    #[test]
    fn proxy_command_tokens_are_expanded() {
        let host = resolve("Host web\n User bob\n ProxyCommand ssh -W %h:%p %r@gw\n", "web");
        assert_eq!(host.proxy_command.as_deref(), Some("ssh -W web:22 bob@gw"));
    }

    #[test]
    fn proxy_jump_and_proxy_command_first_one_wins() {
        let text = "Host a\n ProxyJump none\nHost b\n ProxyCommand none\nHost c\n ProxyCommand nc %h %p\nHost *\n ProxyJump j1\n ProxyCommand other\n";
        let a = resolve(text, "a");
        assert_eq!((a.proxy_jump, a.proxy_command), (vec![], None));
        let b = resolve(text, "b");
        assert_eq!((b.proxy_jump, b.proxy_command), (vec![], None));
        let c = resolve(text, "c");
        assert_eq!((c.proxy_jump, c.proxy_command.as_deref()), (vec![], Some("nc c 22")));
        let d = resolve(text, "d");
        assert_eq!(
            (d.proxy_jump, d.proxy_command),
            (vec![JumpHost { user: None, host: "j1".into(), port: None }], None)
        );
    }

    #[test]
    fn forwards_accumulate() {
        let host = resolve(
            "Host web\n LocalForward 8080 localhost:80\n RemoteForward 9000 localhost:9000\nHost *\n LocalForward 5432 db:5432\n LocalForward 8080 localhost:80\n",
            "web",
        );
        assert_eq!(
            host.local_forwards,
            vec![
                Forward { bind: None, listen_port: 8080, host: "localhost".into(), port: 80 },
                Forward { bind: None, listen_port: 5432, host: "db".into(), port: 5432 },
            ]
        );
        assert_eq!(host.remote_forwards.len(), 1);
    }

    #[test]
    fn scalar_options() {
        let host = resolve(
            "Host web\n IdentitiesOnly yes\n ForwardAgent yes\n ServerAliveInterval 1m30s\n ServerAliveCountMax 5\n ConnectTimeout 10\n StrictHostKeyChecking Accept-New\n UserKnownHostsFile ~/.ssh/kh_%h /etc/kh\n",
            "web",
        );
        assert!(host.identities_only);
        assert!(host.forward_agent);
        assert_eq!(host.server_alive_interval, Some(90));
        assert_eq!(host.server_alive_count_max, Some(5));
        assert_eq!(host.connect_timeout, Some(10));
        assert_eq!(host.strict_host_key_checking.as_deref(), Some("accept-new"));
        assert_eq!(host.user_known_hosts_files, paths(&["/home/alice/.ssh/kh_web", "/etc/kh"]));
    }

    #[test]
    fn user_known_hosts_none_is_empty() {
        let host = resolve("UserKnownHostsFile none\n", "web");
        assert_eq!(host.user_known_hosts_files, Vec::<PathBuf>::new());
    }

    #[test]
    fn invalid_values_are_reported_and_skipped() {
        let text = "Host web\n Port 99999\n ProxyJump bob@:22\n ServerAliveInterval soon\n LocalForward 1080\nHost *\n Port 2200\n ProxyJump j1\n";
        let cfg = parse(text);
        let lines: Vec<usize> = cfg.diagnostics.iter().map(|d| d.line).collect();
        assert_eq!(lines, vec![2, 3, 4, 5]);
        let host = cfg.resolve("web", &ctx());
        assert_eq!(host.port, 2200);
        assert_eq!(host.proxy_jump.len(), 1);
        assert_eq!(host.server_alive_interval, None);
        assert_eq!(host.local_forwards, vec![]);
    }

    #[test]
    fn match_host_and_user() {
        let text = "Host web\n HostName web.prod.example\nMatch host *.prod.example user deploy\n Port 2201\nMatch host *.prod.example\n User deploy\nMatch originalhost web user deploy\n IdentityFile ~/.ssh/deploy\nMatch localuser alice !user root\n ConnectTimeout 7\n";
        let host = resolve(text, "web");
        // `user deploy` is not set yet when the first Match is evaluated.
        assert_eq!(host.port, 22);
        assert_eq!(host.user, "deploy");
        assert_eq!(host.identity_files, paths(&["/home/alice/.ssh/deploy"]));
        assert_eq!(host.connect_timeout, Some(7));
        let other = resolve(text, "other");
        assert_eq!(other.user, "alice");
    }

    #[test]
    fn match_all_and_negated_host() {
        let text = "Match !host *.internal\n User outside\nMatch all\n Port 2022\n";
        assert_eq!(resolve(text, "a.internal").user, "alice");
        assert_eq!(resolve(text, "example.com").user, "outside");
        assert_eq!(resolve(text, "a.internal").port, 2022);
    }

    #[test]
    fn match_host_lower_cases_the_pattern_and_user_is_case_sensitive() {
        let text = "Match host WEB\n Port 2000\nMatch user Alice\n User x\n";
        let host = resolve(text, "web");
        assert_eq!(host.port, 2000);
        assert_eq!(host.user, "alice");
    }

    #[test]
    fn match_exec_never_matches_and_reports() {
        let cfg = parse("Match exec \"true\"\n User x\nMatch host web exec \"true\"\n Port 1\n");
        assert_eq!(cfg.diagnostics.len(), 2, "{:?}", cfg.diagnostics);
        assert_eq!(cfg.diagnostics[0].line, 1);
        assert!(cfg.diagnostics[0].message.contains("exec"), "{}", cfg.diagnostics[0].message);
        let host = cfg.resolve("web", &ctx());
        assert_eq!(host.user, "alice");
        assert_eq!(host.port, 22);
    }

    #[test]
    fn unknown_or_malformed_match_criteria_never_match_and_report() {
        let cfg = parse(
            "Match frobnicate x\n User a\nMatch localnetwork 10.0.0.0/8\n User b\nMatch host\n User c\nMatch all host x\n User d\n",
        );
        assert_eq!(cfg.diagnostics.len(), 4, "{:?}", cfg.diagnostics);
        assert_eq!(cfg.resolve("x", &ctx()).user, "alice");
    }

    /// Like OpenSSH: `Match final` (or `CanonicalizeHostname yes`) triggers a second
    /// pass where `final` and `canonical` hold and `Host` patterns are compared with the
    /// resolved host name.
    #[test]
    fn match_final_runs_a_second_pass() {
        let text = "Host web\n HostName 10.0.0.5\nMatch final\n Port 2022\nHost 10.0.0.*\n User inner\nMatch canonical\n ServerAliveInterval 7\n";
        let host = resolve(text, "web");
        assert_eq!(host.port, 2022);
        assert_eq!(host.user, "inner");
        assert_eq!(host.server_alive_interval, Some(7));
        let plain = resolve("Match canonical\n Port 2022\n", "web");
        assert_eq!(plain.port, 22);
        let canon = resolve("CanonicalizeHostname yes\nMatch canonical\n Port 2022\n", "web");
        assert_eq!(canon.port, 2022);
    }

    #[test]
    fn nested_host_from_an_include_needs_both_patterns() {
        let home = tempfile::tempdir().unwrap();
        let opts = ParseOptions::with_home(home.path());
        std::fs::create_dir_all(&opts.ssh_dir).unwrap();
        std::fs::write(opts.ssh_dir.join("inner.conf"), "User shared\nHost *1\n Port 2201\n")
            .unwrap();
        let cfg = parse_str_with("Host web*\n Include inner.conf\n", Path::new("cfg"), &opts);
        let web1 = cfg.resolve("web1", &ctx());
        assert_eq!((web1.user.as_str(), web1.port), ("shared", 2201));
        let db1 = cfg.resolve("db1", &ctx());
        assert_eq!((db1.user.as_str(), db1.port), ("alice", 22));
    }

    #[test]
    fn concrete_hosts_skip_patterns() {
        let cfg = parse(
            "Host *\n User x\nHost web web-?? !db *.prod\nHost db\nMatch host api\nHost web\nHost bastion1 bastion2\n",
        );
        assert_eq!(cfg.concrete_hosts(), vec!["web", "db", "bastion1", "bastion2"]);
    }
}
