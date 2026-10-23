//! OpenSSH host patterns (`*`, `?`, `!`), from `match.c`.

/// Whether a `Host` line's patterns select `host`.
///
/// `*` matches any run of characters and `?` exactly one. A negated pattern (`!db.prod`)
/// that matches excludes the host even if another pattern matches; negated patterns
/// alone never select anything.
///
/// The comparison is **case-sensitive**, like OpenSSH's `match_pattern` (`ssh -G WEB`
/// does not use a `Host web` block): this keeps Tilde and `ssh` in agreement.
#[must_use]
pub fn host_matches(patterns: &[String], host: &str) -> bool {
    match_any(patterns.iter().map(String::as_str), host)
}

/// OpenSSH `match_pattern_list`: comma-separated patterns with `!` negation, as used by
/// `Match host|originalhost|user|localuser`. With `lower_pattern`, the patterns (not the
/// subject) are lower-cased first, as OpenSSH does for host names.
pub(crate) fn match_pattern_list(subject: &str, list: &str, lower_pattern: bool) -> bool {
    if lower_pattern {
        match_any(list.to_lowercase().split(','), subject)
    } else {
        match_any(list.split(','), subject)
    }
}

/// Any positive pattern matches and no negated one does.
fn match_any<'a>(patterns: impl Iterator<Item = &'a str>, subject: &str) -> bool {
    let mut positive = false;
    for pattern in patterns {
        if let Some(negated) = pattern.strip_prefix('!') {
            if wildcard_match(negated, subject) {
                return false;
            }
        } else if wildcard_match(pattern, subject) {
            positive = true;
        }
    }
    positive
}

/// `*` / `?` wildcard match of the whole `subject`.
pub(crate) fn wildcard_match(pattern: &str, subject: &str) -> bool {
    let p: Vec<char> = pattern.chars().collect();
    let s: Vec<char> = subject.chars().collect();
    let (mut pi, mut si) = (0, 0);
    // Position after the last `*` in the pattern, and the subject position it was tried at.
    let mut star: Option<(usize, usize)> = None;
    while si < s.len() {
        if pi < p.len() && (p[pi] == '?' || p[pi] == s[si]) {
            pi += 1;
            si += 1;
        } else if pi < p.len() && p[pi] == '*' {
            star = Some((pi + 1, si));
            pi += 1;
        } else if let Some((after_star, tried)) = star {
            pi = after_star;
            si = tried + 1;
            star = Some((after_star, si));
        } else {
            return false;
        }
    }
    p[pi..].iter().all(|&c| c == '*')
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pats(list: &[&str]) -> Vec<String> {
        list.iter().map(|p| (*p).to_owned()).collect()
    }

    #[test]
    fn negation_excludes_even_when_another_pattern_matches() {
        let patterns = pats(&["*.prod", "!db.prod"]);
        assert!(host_matches(&patterns, "web.prod"));
        assert!(!host_matches(&patterns, "db.prod"));
        assert!(!host_matches(&patterns, "web.dev"));
    }

    #[test]
    fn question_mark_is_exactly_one_character() {
        assert!(host_matches(&pats(&["?eb"]), "web"));
        assert!(!host_matches(&pats(&["?eb"]), "eb"));
        assert!(!host_matches(&pats(&["?eb"]), "wweb"));
    }

    #[test]
    fn host_patterns_are_case_sensitive_like_openssh() {
        assert!(host_matches(&pats(&["web"]), "web"));
        assert!(!host_matches(&pats(&["web"]), "WEB"));
        assert!(!host_matches(&pats(&["Web"]), "web"));
    }

    #[test]
    fn negations_alone_or_no_pattern_select_nothing() {
        assert!(!host_matches(&pats(&["!db"]), "web"));
        assert!(!host_matches(&[], "web"));
    }

    #[test]
    fn star_backtracks() {
        assert!(wildcard_match("a*b*c", "aXbYbZc"));
        assert!(wildcard_match("*", ""));
        assert!(wildcard_match("10.0.*", "10.0.1.2"));
        assert!(!wildcard_match("a*b", "aXbY"));
        assert!(wildcard_match("é?", "éa"));
    }

    #[test]
    fn pattern_lists_split_on_commas_with_negation() {
        assert!(match_pattern_list("web.prod", "*.dev,*.prod", false));
        assert!(!match_pattern_list("db.prod", "*.prod,!db.*", false));
        assert!(!match_pattern_list("x", "!y", false));
    }

    #[test]
    fn pattern_lists_can_lower_case_the_patterns_only() {
        assert!(match_pattern_list("web.example", "WEB.Example", true));
        assert!(!match_pattern_list("WEB.example", "web.example", true));
        assert!(!match_pattern_list("alice", "Alice", false));
    }
}
