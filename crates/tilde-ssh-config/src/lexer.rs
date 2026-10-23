//! Splitting one `ssh_config` line into a keyword and its arguments, like OpenSSH's
//! `strdelim` + `argv_split`.

/// Keywords whose value is the rest of the line, verbatim (OpenSSH `parse_command`).
const COMMAND_KEYWORDS: &[&str] =
    &["proxycommand", "localcommand", "remotecommand", "knownhostscommand"];

/// Why a non-empty line could not be split.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum LexError {
    MissingArgument { keyword: String },
    UnbalancedQuotes { keyword: String },
}

impl LexError {
    pub(crate) fn message(&self) -> String {
        match self {
            Self::MissingArgument { keyword } => {
                format!("« {keyword} » sans argument : ligne ignorée")
            }
            Self::UnbalancedQuotes { keyword } => {
                format!("guillemets non fermés après « {keyword} » : ligne ignorée")
            }
        }
    }
}

/// Splits a line into `(keyword in lower case, arguments)`.
///
/// The keyword ends at a space, a tab or a `=`; a single `=` may surround the first
/// argument. Arguments are separated by spaces or tabs and may be quoted with `"` or
/// `'`; `\"`, `\'`, `\\` and (outside quotes) `\ ` are escapes, any other backslash is
/// kept (so `C:\Users` survives). A `#` that starts an argument outside quotes begins a
/// comment. Comment lines, blank lines and malformed lines return `None`.
#[must_use]
pub fn lex_line(line: &str) -> Option<(String, Vec<String>)> {
    lex(line).ok().flatten()
}

/// Like [`lex_line`], but tells malformed lines apart from comments.
pub(crate) fn lex(line: &str) -> Result<Option<(String, Vec<String>)>, LexError> {
    let line = line.trim_end_matches([' ', '\t', '\r', '\n', '\x0c']);
    let mut rest = line.trim_start_matches(is_blank);
    let mut keyword = take_keyword(&mut rest);
    if keyword.is_empty() && !rest.is_empty() {
        // `=value` with no keyword before: OpenSSH reads the next token as the keyword.
        keyword = take_keyword(&mut rest);
    }
    if keyword.is_empty() || keyword.starts_with('#') {
        return Ok(None);
    }
    let keyword = keyword.to_ascii_lowercase();
    if rest.is_empty() {
        return Err(LexError::MissingArgument { keyword });
    }
    let Some(args) = split_args(rest) else {
        return Err(LexError::UnbalancedQuotes { keyword });
    };
    if COMMAND_KEYWORDS.contains(&keyword.as_str()) {
        let command = rest.trim_start_matches(|c| is_blank(c) || c == '=');
        if command.is_empty() {
            return Err(LexError::MissingArgument { keyword });
        }
        return Ok(Some((keyword, vec![command.to_owned()])));
    }
    if args.is_empty() {
        // Only a comment after the keyword.
        return Err(LexError::MissingArgument { keyword });
    }
    Ok(Some((keyword, args)))
}

fn is_blank(c: char) -> bool {
    c == ' ' || c == '\t'
}

/// OpenSSH `strdelim`: the token ends at a blank or `=`, then blanks, at most one `=`
/// and blanks again are skipped.
fn take_keyword<'a>(rest: &mut &'a str) -> &'a str {
    let s = *rest;
    let end = s.find(|c: char| is_blank(c) || c == '=').unwrap_or(s.len());
    let (token, mut tail) = s.split_at(end);
    let mut seen_equals = false;
    if let Some(after) = tail.strip_prefix('=') {
        seen_equals = true;
        tail = after;
    } else if !tail.is_empty() {
        tail = &tail[1..];
    }
    tail = tail.trim_start_matches(is_blank);
    if !seen_equals && let Some(after) = tail.strip_prefix('=') {
        tail = after.trim_start_matches(is_blank);
    }
    *rest = tail;
    token
}

/// OpenSSH `argv_split` with `terminate_on_comment`. `None` on an unclosed quote.
fn split_args(s: &str) -> Option<Vec<String>> {
    let chars: Vec<char> = s.chars().collect();
    let mut args = Vec::new();
    let mut i = 0;
    while i < chars.len() {
        if is_blank(chars[i]) {
            i += 1;
            continue;
        }
        if chars[i] == '#' {
            break;
        }
        let mut arg = String::new();
        let mut quote: Option<char> = None;
        while i < chars.len() {
            let c = chars[i];
            let next = chars.get(i + 1).copied();
            if c == '\\' {
                match next {
                    Some(n @ ('\'' | '"' | '\\')) => {
                        arg.push(n);
                        i += 1;
                    }
                    Some(' ') if quote.is_none() => {
                        arg.push(' ');
                        i += 1;
                    }
                    _ => arg.push('\\'),
                }
            } else if quote.is_none() && is_blank(c) {
                break;
            } else if quote.is_none() && (c == '"' || c == '\'') {
                quote = Some(c);
            } else if quote == Some(c) {
                quote = None;
            } else {
                arg.push(c);
            }
            i += 1;
        }
        if quote.is_some() {
            return None;
        }
        args.push(arg);
    }
    Some(args)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lexed(line: &str) -> Option<(String, Vec<String>)> {
        lex_line(line)
    }

    #[allow(clippy::unnecessary_wraps)] // compared with `lex_line`, which returns an Option
    fn some(keyword: &str, args: &[&str]) -> Option<(String, Vec<String>)> {
        Some((keyword.to_owned(), args.iter().map(|a| (*a).to_owned()).collect()))
    }

    #[test]
    fn keyword_and_several_arguments() {
        assert_eq!(lexed("Host foo bar"), some("host", &["foo", "bar"]));
    }

    #[test]
    fn equals_separator_without_spaces() {
        assert_eq!(lexed("  HostName=example.com"), some("hostname", &["example.com"]));
    }

    #[test]
    fn equals_separator_with_spaces() {
        assert_eq!(lexed("User = alice"), some("user", &["alice"]));
        assert_eq!(lexed("User =alice"), some("user", &["alice"]));
        assert_eq!(lexed("User\t=\talice"), some("user", &["alice"]));
    }

    #[test]
    fn only_one_equals_is_a_separator() {
        assert_eq!(lexed("SetEnv = A=b"), some("setenv", &["A=b"]));
    }

    #[test]
    fn quoted_windows_path_with_a_space_is_one_argument() {
        assert_eq!(
            lexed("IdentityFile \"C:\\Users\\Al Ex\\.ssh\\id\""),
            some("identityfile", &["C:\\Users\\Al Ex\\.ssh\\id"])
        );
    }

    #[test]
    fn unquoted_backslashes_are_kept() {
        assert_eq!(
            lexed("IdentityFile C:\\Users\\alex\\.ssh\\id_ed25519"),
            some("identityfile", &["C:\\Users\\alex\\.ssh\\id_ed25519"])
        );
    }

    #[test]
    fn escapes_follow_openssh() {
        assert_eq!(lexed(r#"IdentityFile \\esc\"x"#), some("identityfile", &[r#"\esc"x"#]));
        assert_eq!(lexed(r"IdentityFile a\ b"), some("identityfile", &["a b"]));
    }

    #[test]
    fn single_quotes_group_too() {
        assert_eq!(lexed("IdentityFile 'my key'"), some("identityfile", &["my key"]));
    }

    #[test]
    fn trailing_comment_is_dropped() {
        assert_eq!(lexed("Port 22 # admin"), some("port", &["22"]));
    }

    #[test]
    fn hash_inside_a_word_or_quotes_is_not_a_comment() {
        assert_eq!(lexed("User a#b"), some("user", &["a#b"]));
        assert_eq!(lexed("User \"# x\""), some("user", &["# x"]));
    }

    #[test]
    fn comments_and_blank_lines_are_none() {
        assert_eq!(lexed("# commentaire"), None);
        assert_eq!(lexed("   # indenté"), None);
        assert_eq!(lexed(""), None);
        assert_eq!(lexed(" \t "), None);
    }

    #[test]
    fn keyword_is_lower_cased_but_arguments_are_not() {
        assert_eq!(lexed("HOSTNAME Example.COM"), some("hostname", &["Example.COM"]));
    }

    #[test]
    fn commands_keep_the_rest_of_the_line_verbatim() {
        assert_eq!(
            lexed("ProxyCommand sh -c \"nc %h %p\" # trailing"),
            some("proxycommand", &["sh -c \"nc %h %p\" # trailing"])
        );
        assert_eq!(lexed("ProxyCommand=nc %h %p  "), some("proxycommand", &["nc %h %p"]));
    }

    #[test]
    fn missing_argument_is_an_error() {
        assert_eq!(lex("Port"), Err(LexError::MissingArgument { keyword: "port".into() }));
        assert_eq!(lex("Port =  "), Err(LexError::MissingArgument { keyword: "port".into() }));
        assert_eq!(lexed("Port"), None);
    }

    #[test]
    fn unbalanced_quotes_are_an_error() {
        assert_eq!(lex("User \"alice"), Err(LexError::UnbalancedQuotes { keyword: "user".into() }));
    }

    #[test]
    fn empty_quotes_give_an_empty_argument() {
        assert_eq!(lexed("RemoteCommand=x"), some("remotecommand", &["x"]));
        assert_eq!(lexed("User \"\""), some("user", &[""]));
    }
}
