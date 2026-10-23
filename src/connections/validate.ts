// Mirrors the checks of crates/tilde-config/src/connections.rs, to answer while typing.
// The backend stays the authority: its `invalid` errors are shown under the same field.

export interface ConnectionForm {
  name: string;
  host: string;
  port: string;
  user: string;
  identityFile: string;
  proxyJump: string;
}

export type FormErrors = Partial<Record<keyof ConnectionForm, string>>;

const HOP = /^(?:[^\s@,]+@)?(?:\[[^\]\s]+\]|[^\s@,:[\]]+)(?::\d{1,5})?$/;

export function validateConnection(f: ConnectionForm): FormErrors {
  const errors: FormErrors = {};
  const name = f.name.trim();
  if (!name) errors.name = 'Le nom est obligatoire';
  else if (Array.from(name).length > 100) errors.name = '100 caractères au plus';
  const host = f.host.trim();
  if (!host || /\s/.test(host)) errors.host = 'Indiquez un hôte ou un alias de ~/.ssh/config';
  const port = f.port.trim();
  if (port && !(/^\d+$/.test(port) && Number(port) >= 1 && Number(port) <= 65535)) {
    errors.port = 'Entre 1 et 65535';
  }
  if (/[\s@]/.test(f.user.trim())) errors.user = 'Sans espace ni @';
  const jump = f.proxyJump.trim();
  if (jump && !jump.split(',').every((hop) => HOP.test(hop.trim()))) {
    errors.proxyJump = 'Format : [user@]hôte[:port], séparés par des virgules';
  }
  return errors;
}

/** « web, eu ,web » → ['web', 'eu'] (trimmed, no empty or duplicate tag). */
export function parseTags(text: string): string[] {
  const seen = new Set<string>();
  return text
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t && !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase()));
}
