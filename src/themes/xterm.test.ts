import { tildeDark } from './builtin/tilde';
import { toXtermTheme } from './xterm';

test('maps terminal colors to an xterm theme', () => {
  const theme = toXtermTheme(tildeDark.terminal);
  expect(theme.selectionBackground).toBe('#7AA2F740');
  expect(theme.brightCyan).toBe('#8AF5E4');
  expect(theme.background).toBe('#0B0E14');
});
