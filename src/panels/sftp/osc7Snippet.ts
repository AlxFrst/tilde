// Lines to add to the remote shell's startup file so it reports its directory (OSC 7):
// that is how the files pane follows `cd` in the terminal.

// `${…}` is bash syntax here, not a template placeholder: kept out of the template.
const BASH_CHAIN = '"${PROMPT_COMMAND:+;$PROMPT_COMMAND}"';

export const OSC7_SNIPPETS = [
  {
    shell: 'bash',
    file: '~/.bashrc',
    code:
      String.raw`PROMPT_COMMAND='printf "\033]7;file://%s%s\033\\" "$HOSTNAME" "$PWD"'` +
      BASH_CHAIN,
  },
  {
    shell: 'zsh',
    file: '~/.zshrc',
    code: String.raw`_tilde_osc7() { printf '\e]7;file://%s%s\e\\' "$HOST" "$PWD" }
autoload -Uz add-zsh-hook && add-zsh-hook chpwd _tilde_osc7 && _tilde_osc7`,
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
