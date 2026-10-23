/* Généré par scripts/gen-types.mjs depuis schemas/keybindings.schema.json — ne pas éditer. */

export interface KeybindingsFile {
  version: number;
  /**
   * Command id → shortcut (`Ctrl+Alt+T`), or `null` to leave the command unbound.
   */
  bindings: {
    [k: string]: string | null | undefined;
  };
}
