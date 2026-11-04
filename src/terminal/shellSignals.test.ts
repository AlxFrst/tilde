import { setLocale } from '@/i18n';
import { defaultSettings } from '@/test/fixtures';
import {
  MAX_TEXT,
  cleanText,
  createCommandTimer,
  createRateLimit,
  formatDuration,
  parseOsc777,
  parseOsc9,
  parseShellMark,
  react,
} from './shellSignals';

const prefs = defaultSettings.terminal.notifications;

afterEach(() => {
  setLocale('fr');
});

describe('shell integration marks (OSC 133 / 633)', () => {
  test('C starts a command and D ends it, with or without its exit code', () => {
    expect(parseShellMark('C')).toEqual({ kind: 'start' });
    expect(parseShellMark('D;0')).toEqual({ kind: 'end', exitCode: 0 });
    expect(parseShellMark('D;127')).toEqual({ kind: 'end', exitCode: 127 });
    expect(parseShellMark('D')).toEqual({ kind: 'end', exitCode: null });
  });

  test('extra parameters are ignored, and the prompt marks say nothing', () => {
    expect(parseShellMark('C;cmdline_url=make%20all')).toEqual({ kind: 'start' });
    expect(parseShellMark('D;2;aid=4242')).toEqual({ kind: 'end', exitCode: 2 });
    expect(parseShellMark('D;garbage')).toEqual({ kind: 'end', exitCode: null });
    for (const other of ['A', 'B', 'E;make all;nonce', 'P;Cwd=/home', '']) {
      expect(parseShellMark(other)).toBeNull();
    }
  });
});

describe('the command timer', () => {
  test('a command that ran long enough says how long, and how it ended', () => {
    const timer = createCommandTimer();
    timer.mark({ kind: 'start' }, 1_000, 10);
    expect(timer.mark({ kind: 'end', exitCode: 0 }, 134_000, 10)).toBe(
      'Commande terminée en 2 min 13 s',
    );
    timer.mark({ kind: 'start' }, 200_000, 10);
    expect(timer.mark({ kind: 'end', exitCode: 2 }, 215_000, 10)).toBe(
      'Commande échouée (code 2) en 15 s',
    );
    timer.mark({ kind: 'start' }, 300_000, 10);
    expect(timer.mark({ kind: 'end', exitCode: null }, 312_000, 10)).toBe(
      'Commande terminée en 12 s',
    );
  });

  test('a short command says nothing', () => {
    const timer = createCommandTimer();
    timer.mark({ kind: 'start' }, 0, 10);
    expect(timer.mark({ kind: 'end', exitCode: 1 }, 9_999, 10)).toBeNull();
  });

  test('with no minimum, every command is reported', () => {
    const timer = createCommandTimer();
    timer.mark({ kind: 'start' }, 0, 0);
    expect(timer.mark({ kind: 'end', exitCode: 0 }, 300, 0)).toBe('Commande terminée en 0 s');
  });

  test('a D without a C (an empty line, the first prompt) ends nothing', () => {
    const timer = createCommandTimer();
    expect(timer.mark({ kind: 'end', exitCode: 0 }, 60_000, 0)).toBeNull();
    timer.mark({ kind: 'start' }, 0, 10);
    timer.mark({ kind: 'end', exitCode: 0 }, 20_000, 10);
    // The next prompt sends D again: that command was already reported.
    expect(timer.mark({ kind: 'end', exitCode: 0 }, 90_000, 10)).toBeNull();
  });

  test('a command left running by a shell that is gone is forgotten', () => {
    const timer = createCommandTimer();
    timer.mark({ kind: 'start' }, 0, 10);
    timer.reset();
    expect(timer.mark({ kind: 'end', exitCode: 0 }, 60_000, 10)).toBeNull();
  });

  test('speaks English too', () => {
    setLocale('en');
    const timer = createCommandTimer();
    timer.mark({ kind: 'start' }, 0, 10);
    expect(timer.mark({ kind: 'end', exitCode: 130 }, 3_725_000, 10)).toBe(
      'Command failed (code 130) after 1 h 2 min',
    );
  });
});

test('durations read like a person would say them', () => {
  expect(formatDuration(42_000)).toBe('42 s');
  expect(formatDuration(120_000)).toBe('2 min');
  expect(formatDuration(133_000)).toBe('2 min 13 s');
  expect(formatDuration(3_600_000)).toBe('1 h');
  expect(formatDuration(3_900_000)).toBe('1 h 5 min');
});

describe('notifications sent by programs', () => {
  test('OSC 9 shows its text', () => {
    expect(parseOsc9('Build finished')).toBe('Build finished');
    expect(parseOsc9('3 tests failed')).toBe('3 tests failed');
  });

  test("OSC 9's numbered ConEmu sub-commands are not messages", () => {
    expect(parseOsc9('4;1;50')).toBeNull(); // progress
    expect(parseOsc9('9;C:\\Users')).toBeNull(); // working directory
    expect(parseOsc9('4')).toBeNull();
    expect(parseOsc9('')).toBeNull();
  });

  test('OSC 777 notify shows its title and body', () => {
    expect(parseOsc777('notify;Backup;done; 2 files')).toBe('Backup — done; 2 files');
    expect(parseOsc777('notify;Backup;')).toBe('Backup');
    expect(parseOsc777('notify;;done')).toBe('done');
    expect(parseOsc777('notify;;')).toBeNull();
    expect(parseOsc777('preexec')).toBeNull();
  });
});

describe('remote text', () => {
  test('loses its control characters and bidi overrides, and fits on one line', () => {
    expect(cleanText('a\u0007b\u001b[31mc\r\nd\u009be')).toBe('a b [31mc d e');
    expect(cleanText('\u202Etxt.exe')).toBe('txt.exe');
    expect(parseOsc9('  hello \t world  ')).toBe('hello world');
  });

  test('cannot carry markup', () => {
    expect(cleanText('<a href="https://example.com">click</a>')).toBe(
      '‹a href="https://example.com"›click‹/a›',
    );
  });

  test('is cut short', () => {
    const long = parseOsc9('x'.repeat(5000)) ?? '';
    expect(Array.from(long)).toHaveLength(MAX_TEXT);
    expect(long.endsWith('…')).toBe(true);
    // Characters, not UTF-16 units: an emoji is never cut in half.
    expect(cleanText('🎉'.repeat(10), 4)).toBe('🎉🎉🎉…');
  });
});

test('the rate limit lets one signal through every interval', () => {
  const allow = createRateLimit(5000);
  expect(allow(0)).toBe(true);
  expect(allow(1000)).toBe(false);
  expect(allow(4999)).toBe(false);
  expect(allow(5000)).toBe(true);
  expect(allow(5001)).toBe(false);
});

describe('what a signal does', () => {
  const seen = { windowFocused: true, onScreen: true };
  const otherTab = { windowFocused: true, onScreen: false };
  const background = { windowFocused: false, onScreen: true };

  test('in a session the user is looking at: nothing', () => {
    expect(react('message', seen, prefs)).toEqual({
      badge: false,
      notify: false,
      attention: false,
    });
    expect(react('bell', seen, prefs)).toEqual({ badge: false, notify: false, attention: false });
  });

  test('in another session: a badge and a notification, the window already has the focus', () => {
    expect(react('message', otherTab, prefs)).toEqual({
      badge: true,
      notify: true,
      attention: false,
    });
  });

  test('with Tilde in the background: the taskbar flashes too', () => {
    expect(react('message', background, prefs)).toEqual({
      badge: true,
      notify: true,
      attention: true,
    });
  });

  test('the bell notifies only if asked to; the badge shows anyway', () => {
    const quiet = { ...prefs, onBell: false };
    expect(react('bell', background, quiet)).toEqual({
      badge: true,
      notify: false,
      attention: false,
    });
    expect(react('message', background, quiet).notify).toBe(true);
  });

  test('notifications turned off leave only the badge', () => {
    const off = { ...prefs, enabled: false };
    expect(react('message', background, off)).toEqual({
      badge: true,
      notify: false,
      attention: false,
    });
  });
});
