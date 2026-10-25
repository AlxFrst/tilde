import { t } from '@/i18n';
import { tRust } from '@/i18n/rust';

/** Mirrors `ConfigErrorDto` in crates/tilde-config/src/error.rs. */
export interface ConfigErrorDto {
  kind: 'io' | 'parse' | 'type' | 'invalid' | 'futureVersion' | 'readOnly';
  message: string;
  line?: number;
  column?: number;
  path?: string;
}

export function isConfigError(value: unknown): value is ConfigErrorDto {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { kind?: unknown }).kind === 'string' &&
    typeof (value as { message?: unknown }).message === 'string'
  );
}

/**
 * Human-readable message for an error in a configuration file, in the interface's
 * language. The message may come straight from Rust (a snapshot or an event, kept in a
 * store): it is translated here, while rendering; one already translated is unchanged.
 */
export function formatConfigError(e: ConfigErrorDto, file = 'settings.json'): string {
  const message = tRust(e.message);
  if (e.kind === 'parse' && e.line !== undefined && e.column !== undefined) {
    return t('{file} ligne {line}, colonne {column} : {message}', {
      file,
      line: e.line,
      column: e.column,
      message,
    });
  }
  return message;
}
