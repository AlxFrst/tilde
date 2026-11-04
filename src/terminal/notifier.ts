// Turns a terminal's signals (./shellSignals) into what the user gets when the session is
// out of sight: a badge in the Rail, a system notification, the taskbar flashing.

import { currentLabelNames, railTitle } from '@/app/paneLabel';
import { t } from '@/i18n';
import type { Notifications } from '@/ipc/generated/settings';
import { notifyDesktop, requestAttention } from '@/ipc/notify';
import { useAttention } from '@/stores/attention';
import { tabsOnScreen, useWorkspace } from '@/stores/workspace';
import {
  cleanText,
  createCommandTimer,
  createRateLimit,
  parseOsc777,
  parseOsc9,
  parseShellMark,
  react,
} from './shellSignals';

/** At most one system notification per session in this time, whatever it sends. */
export const NOTIFY_INTERVAL_MS = 5000;

/** A session name can be a title the remote shell set (OSC 0/2): kept short. */
const MAX_TITLE = 80;

export interface SessionNotifier {
  /** An OSC 133 or OSC 633 payload (shell integration). */
  shellMark: (data: string) => void;
  osc9: (data: string) => void;
  osc777: (data: string) => void;
  bell: () => void;
  /** A new shell starts: a command the old one was running ended with it. */
  reset: () => void;
}

function sessionName(tabId: string): string {
  const tab = useWorkspace.getState().tabs.find((x) => x.id === tabId);
  return (tab && cleanText(railTitle(tab, currentLabelNames()), MAX_TITLE)) || 'Tilde';
}

/**
 * The notifier of one terminal. Its session (`tabId`) and settings are read when a signal
 * arrives: the pane can move to another session, and settings change live.
 */
export function createSessionNotifier(
  tabId: () => string,
  settings: () => Notifications | undefined,
  now: () => number = Date.now,
): SessionNotifier {
  const timer = createCommandTimer();
  const allow = createRateLimit(NOTIFY_INTERVAL_MS);

  const signal = (kind: 'bell' | 'message', message: string) => {
    const prefs = settings();
    if (!prefs) return;
    const id = tabId();
    const { windowFocused } = useAttention.getState();
    const onScreen = tabsOnScreen(useWorkspace.getState()).includes(id);
    const reaction = react(kind, { windowFocused, onScreen }, prefs);
    if (reaction.badge) useAttention.getState().mark(id);
    if (!reaction.notify || !allow(now())) return;
    void notifyDesktop(sessionName(id), message);
    if (reaction.attention) requestAttention();
  };

  return {
    shellMark: (data) => {
      const mark = parseShellMark(data);
      const prefs = settings();
      if (!mark || !prefs) return;
      const message = timer.mark(mark, now(), prefs.minDurationSecs);
      if (message) signal('message', message);
    },
    osc9: (data) => {
      const message = parseOsc9(data);
      if (message) signal('message', message);
    },
    osc777: (data) => {
      const message = parseOsc777(data);
      if (message) signal('message', message);
    },
    bell: () => {
      signal('bell', t('Signal sonore'));
    },
    reset: timer.reset,
  };
}
