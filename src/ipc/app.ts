import { invoke } from './invoke';

export type Platform = 'windows' | 'macos' | 'linux';

export interface AppInfo {
  version: string;
  platform: Platform;
}

export const getAppInfo = () => invoke<AppInfo>('app_info');
