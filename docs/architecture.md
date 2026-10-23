# Architecture de Tilde

Vue d'ensemble pour les contributeurs. La référence complète est le
[document de conception](superpowers/specs/2026-10-23-tilde-design.md).

## Couches

```
WebView (React + TS)                       Rust
──────────────────────                     ─────────────────────────────
src/app/        coquille UI                src-tauri/   câblage Tauri : état,
src/themes/     moteur de thèmes                        commandes, events, plugins
src/stores/     état (Zustand)             crates/tilde-config/
src/ipc/        wrappers typés  ◄──IPC──►               réglages, migrations, hot reload
src/components/ui/  shadcn/ui
```

- **Les crates de `crates/` ne dépendent pas de Tauri.** Elles contiennent la logique métier et
  se testent avec `cargo test` seul. `src-tauri` ne fait que les relier à l'application.
- **Le front n'appelle `invoke` que depuis `src/ipc/`.** Les composants passent par les stores.

## Réglages : une seule source de vérité

```
crates/tilde-config/src/settings.rs   (structs Rust + bornes)
        │  cargo run -p tilde-config --bin gen-schema
        ▼
schemas/settings.schema.json          (JSON Schema, aussi copié à côté de settings.json
        │                              pour l'autocomplétion dans les éditeurs)
        │  node scripts/gen-types.mjs
        ▼
src/ipc/generated/settings.ts         (types TS utilisés par le front)
```

`pnpm gen:types` enchaîne les deux étapes ; la CI échoue si les fichiers générés ne sont pas à
jour.

### Cycle de vie de `settings.json`

1. **Chargement** (`SettingsStore::load`) : création avec les valeurs par défaut au premier
   lancement ; migration des anciennes versions (sauvegarde `.vN.bak` au préalable).
2. **Fichier invalide** (syntaxe, type, valeur hors bornes, version future) : Tilde démarre
   avec la dernière config valide (ou les défauts), passe en **lecture seule** et n'écrit
   jamais dans le fichier de l'utilisateur.
3. **Modification depuis l'UI** (`settings_update`) : *JSON Merge Patch* appliqué au document
   brut, ce qui conserve les clés inconnues et `$schema`. Validation, puis écriture atomique
   (fichier temporaire + renommage).
4. **Modification externe** : le watcher (`notify`, debounce de 150 ms, dossier surveillé en
   non récursif pour supporter les renommages atomiques des éditeurs) appelle
   `reload_from_disk`. Les écritures de l'app sont reconnues par leur hash et ignorées. Le
   front reçoit `settings://changed` ou `settings://error`.

## Thèmes

Un thème est un ensemble de tokens UI (`bg`, `surface1`, `accent`…) et une palette terminal
(16 couleurs ANSI, curseur, sélection). `applyTheme()` écrit les tokens UI dans des variables
CSS `--tilde-*`, que Tailwind et shadcn consomment via `src/styles/globals.css`. Le thème actif
est résolu à partir de `appearance.colorScheme`, `themeDark`, `themeLight` et de la préférence
de l'OS. Les tests vérifient le contraste WCAG de chaque thème intégré.

## Fenêtre

La fenêtre démarre **cachée** et le front l'affiche une fois la coquille rendue, ce qui évite
un flash blanc. On utilise `setTimeout` et pas `requestAnimationFrame` : une WebView2 cachée
n'exécute jamais les callbacks d'animation. La position et la taille sont restaurées par
`tauri-plugin-window-state`, qui ne gère pas la visibilité.

## Sécurité

- CSP stricte (voir `src-tauri/tauri.conf.json`), sans `unsafe-eval`. `'unsafe-inline'` est
  autorisé uniquement pour les styles (requis par xterm et Radix), avec
  `dangerousDisableAssetCspModification: ["style-src"]` pour que Tauri n'y injecte pas de
  nonce, qui désactiverait `'unsafe-inline'`.
- Permissions minimales (`src-tauri/capabilities/default.json`) : aucun plugin `fs` ni `shell`
  côté WebView ; `opener` n'est appelé que depuis Rust.
