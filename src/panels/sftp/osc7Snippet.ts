// Lines to add to the remote shell's startup file so it reports its directory (OSC 7):
// that is how the files pane follows `cd` in the terminal. In bash and zsh they also mark
// where each command starts and ends (OSC 133 `C` and `D;<status>`), which is how Tilde
// tells that a long command finished (src/terminal/shellSignals.ts); fish 4 marks
// commands by itself.

// `${…}` is bash syntax here, not a template placeholder: kept out of the template.
const BASH_CHAIN = '"${PROMPT_COMMAND:+;$PROMPT_COMMAND}"';
const BASH_PS0 = '"${PS0-}"';

export const OSC7_SNIPPETS = [
  {
    shell: 'bash',
    file: '~/.bashrc',
    // $? is read first, before anything changes it, and given back so a PROMPT_COMMAND
    // chained after this one still sees the command's status. PS0 is printed just before
    // a command runs (never for an empty line).
    code:
      String.raw`_tilde_prompt() { local s=$?; printf "\033]133;D;%s\007\033]7;file://%s%s\033\\" "$s" "$HOSTNAME" "$PWD"; return $s; }
PROMPT_COMMAND='_tilde_prompt'` +
      BASH_CHAIN +
      String.raw`
PS0=` +
      BASH_PS0 +
      String.raw`'\033]133;C\007'`,
  },
  {
    shell: 'zsh',
    file: '~/.zshrc',
    // Each precmd hook sees the status of the command line, whatever hooks ran before.
    code: String.raw`_tilde_osc7() { printf '\e]7;file://%s%s\e\\' "$HOST" "$PWD" }
_tilde_preexec() { printf '\e]133;C\a' }
_tilde_precmd() { printf '\e]133;D;%s\a' "$?" }
autoload -Uz add-zsh-hook && add-zsh-hook chpwd _tilde_osc7 && add-zsh-hook preexec _tilde_preexec && add-zsh-hook precmd _tilde_precmd && _tilde_osc7`,
  },
  {
    shell: 'fish',
    file: '~/.config/fish/config.fish',
    code: String.raw`function __tilde_osc7 --on-variable PWD
    printf '\e]7;file://%s%s\e\\' (hostname) "$PWD"
end
__tilde_osc7`,
  },
] as const;
