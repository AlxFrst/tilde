import { invoke } from './invoke';

export type Platform = 'windows' | 'macos' | 'linux';

export interface AppInfo {
  version: string;
  platform: Platform;
}

export const getAppInfo = () => invoke<AppInfo>('app_info');

/**
 * Tells Rust the interface's language, for the text it shows itself: native dialogs,
 * Explorer's context menu, the lines it writes into SSH terminals.
 */
export const setUiLocale = (locale: 'fr' | 'en') => invoke<undefined>('app_set_locale', { locale });
