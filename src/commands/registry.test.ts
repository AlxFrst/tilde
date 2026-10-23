import { DEFAULT_KEYBINDINGS } from '@/terminal/keys';
import { registerBuiltins } from './builtin';
import { listCommands, registerCommands, runCommand } from './registry';

vi.mock('@/ipc/connections', () => ({
  importConnections: vi.fn(),
  exportConnections: vi.fn(),
}));
vi.mock('@/ipc/settings', () => ({ openSettingsFile: vi.fn(), openLogsDir: vi.fn() }));

test('registry runs, lists and unregisters commands', () => {
  const run = vi.fn();
  const off = registerCommands([{ id: 'test.hello', title: 'Bonjour', group: 'Application', run }]);
  expect(listCommands().some((c) => c.id === 'test.hello')).toBe(true);
  expect(runCommand('test.hello')).toBe(true);
  expect(run).toHaveBeenCalledTimes(1);
  off();
  expect(runCommand('test.hello')).toBe(false);
  expect(listCommands().some((c) => c.id === 'test.hello')).toBe(false);
});

test('every default shortcut has a registered command', () => {
  const off = registerBuiltins();
  const ids = new Set(listCommands().map((c) => c.id));
  const missing = Object.keys(DEFAULT_KEYBINDINGS).filter((id) => !ids.has(id));
  expect(missing).toEqual([]);
  for (const extra of [
    'connections.new',
    'connections.import',
    'connections.export',
    'app.settings',
  ]) {
    expect(ids.has(extra)).toBe(true);
  }
  off();
});
