/* Généré par scripts/gen-types.mjs depuis schemas/connections.schema.json — ne pas éditer. */

export interface ConnectionsFile {
  version: number;
  folders: Folder[];
  connections: Connection[];
  recents: Recent[];
}
/**
 * A folder of connections (one level).
 */
export interface Folder {
  id: string;
  name: string;
  /**
   * `#RRGGBB`.
   */
  color: string | null;
}
/**
 * A saved connection. `host` is an alias of `~/.ssh/config` or a host name; the
 * fields set here override what `ssh_config` says for it.
 */
export interface Connection {
  id: string;
  name: string;
  host: string;
  port: number | null;
  user: string | null;
  /**
   * Private key path (`~` allowed).
   */
  identityFile: string | null;
  /**
   * `ProxyJump` syntax: `[user@]host[:port]`, comma-separated.
   */
  proxyJump: string | null;
  /**
   * `None`: as `ssh_config` says.
   */
  forwardAgent: boolean | null;
  folderId: string | null;
  /**
   * `#RRGGBB`.
   */
  color: string | null;
  /**
   * One of [`ICONS`].
   */
  icon: string | null;
  tags: string[];
  favorite: boolean;
}
/**
 * A recently opened target: `conn:<id>` or `ssh:<typed target>`.
 */
export interface Recent {
  key: string;
  label: string;
  /**
   * Seconds since the Unix epoch.
   */
  at: number;
}
