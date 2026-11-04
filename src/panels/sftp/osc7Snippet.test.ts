import { OSC7_SNIPPETS } from './osc7Snippet';

const snippet = (shell: string) => {
  const found = OSC7_SNIPPETS.find((s) => s.shell === shell);
  if (!found) throw new Error(`no ${shell} snippet`);
  return found.code;
};

describe('bash', () => {
  const code = snippet('bash');
  const prompt = code.split('\n')[0] ?? '';

  test('reports the directory and the end of the command at each prompt', () => {
    expect(prompt).toContain(String.raw`\033]133;D;%s\007`);
    expect(prompt).toContain(String.raw`\033]7;file://%s%s\033\\`);
    expect(prompt).toContain('"$s" "$HOSTNAME" "$PWD"');
  });

  test("reads the command's status before anything changes it, and gives it back", () => {
    expect(prompt).toMatch(/^_tilde_prompt\(\) \{ local s=\$\?; /);
    expect(prompt).toMatch(/return \$s; \}$/);
  });

  test("runs before the user's own PROMPT_COMMAND, which it keeps", () => {
    expect(code).toContain(`PROMPT_COMMAND='_tilde_prompt'"\${PROMPT_COMMAND:+;$PROMPT_COMMAND}"`);
  });

  test('marks the start of each command through PS0, keeping the one set', () => {
    // `${PS0-}` is bash, not a template placeholder.
    expect(code).toContain('PS0="${PS0-}"' + String.raw`'\033]133;C\007'`);
  });
});

describe('zsh', () => {
  const code = snippet('zsh');

  test('marks the start of a command before it runs, and its end with its status', () => {
    expect(code).toContain(String.raw`_tilde_preexec() { printf '\e]133;C\a' }`);
    expect(code).toContain(String.raw`_tilde_precmd() { printf '\e]133;D;%s\a' "$?" }`);
    expect(code).toContain('add-zsh-hook preexec _tilde_preexec');
    expect(code).toContain('add-zsh-hook precmd _tilde_precmd');
  });

  test('still reports the directory on each cd, and once at startup', () => {
    expect(code).toContain('add-zsh-hook chpwd _tilde_osc7');
    expect(code.trimEnd()).toMatch(/&& _tilde_osc7$/);
  });
});

test('fish only reports its directory: fish 4 marks commands by itself', () => {
  const code = snippet('fish');
  expect(code).toContain('--on-variable PWD');
  expect(code).not.toContain('133');
});
