//! Checks done while reading, so that problems carry a file and a line. The resolver
//! uses the same parsers and ignores the values rejected here.

use crate::{
    forward::parse_forward,
    jump::{parse_port, parse_proxy_jump},
};

/// Keywords that take exactly one argument (among those Tilde reads).
const SINGLE_VALUE: &[&str] = &[
    "hostname",
    "user",
    "port",
    "identityfile",
    "identitiesonly",
    "proxyjump",
    "forwardagent",
    "serveraliveinterval",
    "serveralivecountmax",
    "connecttimeout",
    "stricthostkeychecking",
    "canonicalizehostname",
];

/// Problem with a directive's value that would make `ssh` refuse the file.
pub(crate) fn check_directive(keyword: &str, args: &[String]) -> Option<String> {
    if SINGLE_VALUE.contains(&keyword) && args.len() > 1 {
        return Some(format!("« {keyword} » n'accepte qu'un argument : seul le premier est lu"));
    }
    let value = args.first().map_or("", String::as_str);
    let invalid =
        |expected: &str| Some(format!("« {keyword} » : valeur « {value} » invalide ({expected})"));
    match keyword {
        "port" if parse_port(value).is_none() => invalid("port de 1 à 65535"),
        "proxyjump" => parse_proxy_jump(value).err(),
        "localforward" | "remoteforward" => parse_forward(args).err(),
        "serveraliveinterval" | "connecttimeout" if parse_seconds(value).is_none() => {
            invalid("durée : 30, 30s, 1m30s…")
        }
        "serveralivecountmax" if value.parse::<u32>().is_err() => invalid("nombre entier"),
        "identitiesonly" if parse_bool(value).is_none() => invalid("yes ou no"),
        "stricthostkeychecking"
            if !["yes", "no", "ask", "accept-new", "off", "true", "false"]
                .contains(&value.to_ascii_lowercase().as_str()) =>
        {
            invalid("yes, no, ask, accept-new ou off")
        }
        _ => None,
    }
}

/// Problem with a `Match` line: malformed, or using a criterion Tilde cannot evaluate
/// (the block then never applies).
pub(crate) fn check_match(criteria: &[String]) -> Option<String> {
    match parse_criteria(criteria) {
        Err(problem) => Some(format!("Match invalide, bloc ignoré : {problem}")),
        Ok(parsed) => parsed.iter().find_map(|c| match &c.kind {
            CriterionKind::Unsupported(name) => Some(format!(
                "Match {name} n'est pas pris en charge par Tilde : ce bloc ne s'appliquera jamais"
            )),
            _ => None,
        }),
    }
}

/// `yes`/`true` or `no`/`false`.
pub(crate) fn parse_bool(s: &str) -> Option<bool> {
    match s.to_ascii_lowercase().as_str() {
        "yes" | "true" => Some(true),
        "no" | "false" => Some(false),
        _ => None,
    }
}

/// OpenSSH `convtime`: `90`, `90s`, `1m30s`, `2h`, `1d`, `1w` → seconds.
pub(crate) fn parse_seconds(s: &str) -> Option<u32> {
    if s.is_empty() {
        return None;
    }
    let mut total: u32 = 0;
    let mut digits = String::new();
    for c in s.chars() {
        if c.is_ascii_digit() {
            digits.push(c);
            continue;
        }
        let unit: u32 = match c.to_ascii_lowercase() {
            's' => 1,
            'm' => 60,
            'h' => 3600,
            'd' => 86_400,
            'w' => 604_800,
            _ => return None,
        };
        let n: u32 = digits.parse().ok()?;
        total = total.checked_add(n.checked_mul(unit)?)?;
        digits.clear();
    }
    if !digits.is_empty() {
        total = total.checked_add(digits.parse().ok()?)?;
    }
    Some(total)
}

/// One `Match` criterion.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Criterion {
    pub negate: bool,
    pub kind: CriterionKind,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum CriterionKind {
    All,
    Canonical,
    Final,
    Host(String),
    OriginalHost(String),
    User(String),
    LocalUser(String),
    /// `@host`: the patterns of an enclosing `Host` block (see [`crate::Block::Match`]).
    HostBlock(Vec<String>),
    /// Known to OpenSSH, not evaluated by Tilde (`exec`, `localnetwork`, …).
    Unsupported(String),
}

/// Parses `Match` arguments.
pub(crate) fn parse_criteria(args: &[String]) -> Result<Vec<Criterion>, String> {
    if args.is_empty() {
        return Err("aucun critère".into());
    }
    let mut out = Vec::new();
    let mut iter = args.iter();
    while let Some(raw) = iter.next() {
        let (negate, name) = match raw.strip_prefix('!') {
            Some(name) => (true, name),
            None => (false, raw.as_str()),
        };
        let lower = name.to_ascii_lowercase();
        let mut value =
            || iter.next().cloned().ok_or_else(|| format!("argument manquant après « {name} »"));
        let kind = match lower.as_str() {
            "all" => CriterionKind::All,
            "canonical" => CriterionKind::Canonical,
            "final" => CriterionKind::Final,
            "host" => CriterionKind::Host(value()?),
            "originalhost" => CriterionKind::OriginalHost(value()?),
            "user" => CriterionKind::User(value()?),
            "localuser" => CriterionKind::LocalUser(value()?),
            "@host" => CriterionKind::HostBlock(value()?.split(',').map(str::to_owned).collect()),
            "exec" | "localnetwork" | "tagged" | "version" | "sessiontype" | "command" => {
                value()?;
                CriterionKind::Unsupported(lower)
            }
            _ => return Err(format!("critère inconnu « {name} »")),
        };
        out.push(Criterion { negate, kind });
    }
    let has_all = out.iter().any(|c| c.kind == CriterionKind::All);
    let only_all_compatible = out.iter().all(|c| {
        matches!(c.kind, CriterionKind::All | CriterionKind::Canonical | CriterionKind::Final)
    });
    if has_all && !only_all_compatible {
        return Err("« all » ne se combine qu'avec canonical ou final".into());
    }
    Ok(out)
}
