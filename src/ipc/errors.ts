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

/** Human-readable French message for a settings error. */
export function formatConfigError(e: ConfigErrorDto): string {
  if (e.kind === 'parse' && e.line !== undefined && e.column !== undefined) {
    return `settings.json ligne ${e.line}, colonne ${e.column} : ${e.message}`;
  }
  return e.message;
}
