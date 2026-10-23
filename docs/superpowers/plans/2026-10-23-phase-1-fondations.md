# Phase 1 — Fondations : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Une app Tauri 2 qui s'ouvre en < 1 s sur une coquille Tilde (titlebar custom, sidebar, barre d'onglets, écran d'accueil), thémée par tokens (Tilde dark/light, Catppuccin Mocha/Latte), pilotée par un `settings.json` versionné, validé, hot-reloadé et éditable depuis l'UI, avec logs `tracing` et CI lint/test.

**Architecture:** Workspace Cargo : la logique de config vit dans la crate `tilde-config` (sans dépendance Tauri, testée seule) ; `src-tauri` ne fait que le câblage (état, commandes, events, plugins, logs). Le front React lit les réglages via des wrappers IPC typés dont les types TS sont **générés** depuis le JSON Schema produit par Rust (source de vérité unique). Les thèmes sont des tokens TS appliqués en variables CSS consommées par Tailwind v4.

**Tech Stack:** Rust 1.99 · Tauri 2.11 (crate) / CLI 2.12 · React 19 · TypeScript 6.0 · Vite 8 · Tailwind 4.3 · shadcn/ui · Zustand 5 · Vitest 5 · serde / schemars 1 / serde_path_to_error · notify 8 + notify-debouncer-full 0.7 · tracing + tracing-appender 0.2 · thiserror.

**Spec:** `docs/superpowers/specs/2026-10-23-tilde-design.md` (§3, §4.8–4.10, §5, §6 phase 1).

## Global Constraints

- Tauri **2.x** uniquement (`tauri = "2"`, plugins `"2"`) — **pas** la 3.0 alpha publiée sur crates.io.
- TypeScript **~6.0** (typescript-eslint ne supporte pas TS 7) ; ESLint 10 flat config.
- `notify` **8.x** + `notify-debouncer-full` **0.7** (pas les RC 9 / 0.8).
- `rust-toolchain.toml` : `channel = "1.99"`, composants `rustfmt`, `clippy`.
- Identifiant d'app : `dev.tilde.app` ; nom produit : `Tilde`.
- Dossier config : `dirs::config_dir()/Tilde/` ; logs : `dirs::data_local_dir()/Tilde/logs/`, rotation quotidienne, 7 fichiers max.
- Licence : MIT OR Apache-2.0 (fichiers `LICENSE-MIT`, `LICENSE-APACHE`, champ `license` dans Cargo.toml et package.json).
- Gestionnaire JS : pnpm. Polices via `@fontsource-variable/geist` et `@fontsource-variable/jetbrains-mono` (aucun CDN).
- CSP (tauri.conf.json `app.security.csp`) : `default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src ipc: http://ipc.localhost` + `dangerousDisableAssetCspModification: ["style-src"]`. Pas d'`unsafe-eval`.
- Aucun plugin `fs` ni `shell` exposé au front. Plugins phase 1 : `opener` (appelé côté Rust uniquement), `single-instance`, `window-state`.
- Clés JSON des réglages en **camelCase** (`#[serde(rename_all = "camelCase")]`).
- Animations UI 150–200 ms, coins 6–10 px, icônes Lucide `strokeWidth={1.5}`.
- Zéro télémétrie, aucune requête réseau sortante.
- Commits conventionnels terminés par `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **`settings.json` édité à la main avec une erreur de syntaxe ou un mauvais type** → l'app garde la dernière config valide, affiche un toast avec le chemin de la clé (et ligne/colonne pour la syntaxe), et **n'écrase jamais** le fichier de l'utilisateur. Tests : Task 3 `load_with_syntax_error_keeps_defaults_and_is_read_only`, `invalid_type_reports_key_path` ; Task 4 `reload_with_bad_file_keeps_previous`.
2. **Clés inconnues et `$schema` dans `settings.json`** (réglages futurs, plugins, commentaires de l'utilisateur sous forme de clés) → conservées après une modification depuis l'UI. Test : Task 3 `update_preserves_unknown_keys_and_schema`.
3. **Sauvegarde par un éditeur qui écrit via renommage atomique ou en deux temps (VS Code)** → un seul rechargement, et pas de boucle quand c'est l'app elle-même qui écrit. Tests : Task 4 `atomic_rename_triggers_single_reload`, `self_write_is_ignored`.
4. **`settings.json` d'une version future** (retour à une ancienne version de Tilde) → aucune migration, aucune écriture, mode lecture seule signalé. Test : Task 3 `future_version_is_read_only_and_untouched`.
5. **Premier lancement / dossier de config absent / non inscriptible** → création avec les valeurs par défaut ; si l'écriture échoue, l'app démarre quand même avec les défauts en mémoire et journalise l'erreur. Tests : Task 3 `first_launch_creates_file_and_schema`, `unwritable_dir_falls_back_to_memory`.

---

### Task 1 : Squelette du dépôt (workspace, Tauri, React, outillage)

**Files:**
- Create: `rust-toolchain.toml`, `Cargo.toml` (workspace : `members = ["src-tauri", "crates/*"]`, `resolver = "2"`, `[workspace.package]` avec `edition = "2024"`, `license = "MIT OR Apache-2.0"`, `[workspace.lints.clippy] pedantic = { level = "warn", priority = -1 }`, `module_name_repetitions = "allow"`)
- Create: `src-tauri/` via `pnpm create tauri-app` (template `react-ts`, identifiant `dev.tilde.app`), puis déplacer le front à la racine si nécessaire pour obtenir l'arborescence §5 du spec
- Create: `package.json` (scripts `dev`, `build`, `tauri`, `lint`, `typecheck` = `tsc --noEmit`, `test` = `vitest run`, `format`), `vite.config.ts` (plugins react + `@tailwindcss/vite`, alias `@` → `src`, `test.environment = "jsdom"`, `clearScreen: false`, `server.strictPort: true`, port 1420)
- Create: `eslint.config.js` (typescript-eslint strict-type-checked + `eslint-plugin-react-hooks`), `.prettierrc` (`printWidth 100`, `singleQuote: true`), `.editorconfig`, `.gitattributes` (`* text=auto eol=lf`), `.gitignore` (node_modules, dist, target, `*.log`)
- Create: `components.json` + `src/lib/utils.ts` (`cn`) via `pnpm dlx shadcn@latest init` (style new-york, base color neutral, CSS variables)
- Create: `src/styles/globals.css`, `src/main.tsx`, `src/App.tsx` (affiche « ~ Tilde »)
- Create: `LICENSE-MIT`, `LICENSE-APACHE` (titulaire : « Tilde contributors »)
- Test: `src/App.test.tsx`

- [ ] **Step 1 :** Créer le squelette avec `pnpm create tauri-app` puis appliquer les fichiers ci-dessus. Désactiver le `tauri.conf.json` bundle par défaut des icônes inutilisées (garder l'icône générée pour l'instant).
- [ ] **Step 2 : Écrire le test** `src/App.test.tsx` : `render(<App />)` puis `expect(screen.getByText('Tilde')).toBeInTheDocument()`. Ajouter `src/test/setup.ts` qui importe `@testing-library/jest-dom/vitest`, et le déclarer dans `test.setupFiles`.
- [ ] **Step 3 : Vérifier** — `pnpm test` → 1 test PASS ; `pnpm lint && pnpm typecheck` → 0 erreur ; `cargo clippy --workspace -- -D warnings` → OK (rustup installe 1.99 automatiquement via `rust-toolchain.toml`).
- [ ] **Step 4 : Vérifier à la main** — `pnpm tauri dev` ouvre une fenêtre affichant « ~ Tilde ».
- [ ] **Step 5 : Commit** `chore: scaffold Tauri 2 + React workspace`

---

### Task 2 : `tilde-config` — modèle des réglages, défauts, validation, schéma

**Files:**
- Create: `crates/tilde-config/Cargo.toml` (deps : `serde`, `serde_json`, `schemars = "1"`, `thiserror`, `serde_path_to_error`, `dirs`, `tracing` ; dev : `tempfile`, `insta` avec feature `json`)
- Create: `crates/tilde-config/src/lib.rs`, `src/settings.rs`, `src/error.rs`, `src/bin/gen-schema.rs`
- Create: `schemas/settings.schema.json` (généré et commité)
- Test: `crates/tilde-config/src/settings.rs` (module `tests`)

**Interfaces:**
- Produces :
  - `pub const SETTINGS_VERSION: u32 = 1;`
  - `pub struct Settings` (dérive `Serialize, Deserialize, JsonSchema, Clone, Debug, PartialEq, Default` via `#[serde(default)]` sur chaque struct) — arborescence exacte :
    ```
    Settings { version: u32,
      appearance: Appearance { colorScheme: ColorScheme(system|dark|light)=system,
        themeDark: String="tilde-dark", themeLight: String="tilde-light",
        uiFontFamily: String="Geist Variable", uiFontSize: u8=13 [10..=20],
        density: Density(compact|comfortable|spacious)=comfortable,
        sidebarPosition: SidebarPosition(left|right)=left, sidebarWidth: u16=260 [180..=480],
        window: WindowAppearance { effect: WindowEffect(none|mica|acrylic|vibrancy)=none, opacity: f32=1.0 [0.3..=1.0] } },
      terminal: Terminal { fontFamily: String="JetBrains Mono Variable", fontSize: u8=14 [6..=72],
        lineHeight: f32=1.2 [0.8..=3.0], ligatures: bool=true,
        cursorStyle: CursorStyle(block|bar|underline)=block, cursorBlink: bool=true,
        scrollback: u32=10000 [0..=1_000_000], defaultProfile: Option<String>=None,
        copyOnSelect: bool=false, rightClick: RightClick(menu|paste|copyPaste)=menu, confirmClose: bool=true },
      ssh: Ssh { keepaliveIntervalSecs: u32=15 [0..=3600], keepaliveCountMax: u32=3 [1..=100],
        autoReconnect: bool=true, confirmCloseSsh: bool=true },
      sftp: Sftp { concurrency: u8=3 [1..=16], editorMode: EditorMode(external|builtin)=external,
        externalEditor: Option<String>=None },
      general: General { restoreSession: bool=true,
        quake: Quake { enabled: bool=false, shortcut: String="Ctrl+`" } } }
    ```
    Les bornes `[a..=b]` sont déclarées via `#[schemars(range(min = a, max = b))]` **et** vérifiées par `validate`.
  - `impl Settings { pub fn validate(&self) -> Result<(), ConfigError> }` — renvoie `ConfigError::Invalid(Vec<FieldError>)` listant **toutes** les violations.
  - `pub struct FieldError { pub path: String /* ex. "terminal.fontSize" */, pub message: String }`
  - `pub enum ConfigError { Io { path: PathBuf, source: io::Error }, Parse { message: String, line: usize, column: usize }, Type { path: String, message: String }, Invalid(Vec<FieldError>), FutureVersion { found: u32, supported: u32 } }` (thiserror, messages en français, `Serialize` via un DTO `{ kind, message, line?, column?, path? }`).
  - `pub fn settings_schema() -> serde_json::Value` (schemars, avec `"$id": "https://tilde.dev/schemas/settings.schema.json"` — identifiant seulement, pas de requête réseau).

- [ ] **Step 1 : Écrire les tests**
  - `defaults_are_valid` : `Settings::default().validate().is_ok()` et `Settings::default().version == SETTINGS_VERSION`.
  - `partial_json_fills_defaults` : `{"terminal":{"fontSize":16}}` → `font_size == 16`, `line_height == 1.2`, `appearance.theme_dark == "tilde-dark"`.
  - `validate_reports_all_out_of_range_fields` : `font_size = 2`, `opacity = 0.1` → `Invalid` avec 2 entrées dont les chemins sont `"terminal.fontSize"` et `"appearance.window.opacity"`.
  - `schema_snapshot` : `insta::assert_json_snapshot!(settings_schema())`.
- [ ] **Step 2 : Lancer** `cargo test -p tilde-config` → FAIL (types absents).
- [ ] **Step 3 : Implémenter** les types, défauts, `validate`, `settings_schema`, et `src/bin/gen-schema.rs` qui écrit `schemas/settings.schema.json` (chemin passé en argument, défaut `schemas/settings.schema.json`).
- [ ] **Step 4 : Lancer** `cargo test -p tilde-config` → PASS (accepter le snapshot avec `cargo insta accept` après relecture) ; `cargo run -p tilde-config --bin gen-schema` crée le fichier.
- [ ] **Step 5 : Commit** `feat(config): settings model, defaults, validation and JSON schema`

---

### Task 3 : `tilde-config` — chargement, migrations, mise à jour

**Files:**
- Create: `crates/tilde-config/src/paths.rs`, `src/migrate.rs`, `src/merge_patch.rs`, `src/store.rs`
- Test: modules `tests` de chaque fichier + `crates/tilde-config/tests/store.rs`

**Interfaces:**
- Consumes : `Settings`, `ConfigError`, `SETTINGS_VERSION`, `settings_schema()` (Task 2).
- Produces :
  - `pub struct ConfigPaths { pub root: PathBuf }` ; `ConfigPaths::from_os() -> Option<Self>` (`dirs::config_dir()/Tilde`), `ConfigPaths::new(root)`, `fn settings_file(&self) -> PathBuf` (`settings.json`), `fn schema_file(&self) -> PathBuf` (`settings.schema.json`).
  - `pub fn migrate(raw: Value) -> Result<(Value, Option<u32 /* ancienne version */>), ConfigError>` — table `MIGRATIONS: &[fn(Value) -> Value]` indexée par version source ; v0 = absence de `version` → ajoute `"version": 1`. Version > `SETTINGS_VERSION` → `FutureVersion`.
  - `pub fn merge_patch(target: &mut Value, patch: &Value)` — RFC 7386 (null supprime, objets fusionnés récursivement, le reste remplace).
  - `pub struct SettingsStore` avec :
    - `pub fn load(paths: ConfigPaths) -> (SettingsStore, Option<ConfigError>)` — renvoie **toujours** un store utilisable.
    - `pub fn settings(&self) -> &Settings`, `pub fn read_only(&self) -> bool`, `pub fn paths(&self) -> &ConfigPaths`
    - `pub fn update(&mut self, patch: &Value) -> Result<Settings, ConfigError>`
    - `pub fn reload_from_disk(&mut self) -> Result<ReloadOutcome, ConfigError>` (utilisé en Task 4)
    - `pub enum ReloadOutcome { Changed(Settings), Unchanged, SelfWrite }`
  - Le store conserve le `Value` brut (`raw`) : `update` applique `merge_patch` sur `raw`, désérialise avec `serde_path_to_error`, valide, puis écrit **atomiquement** (`settings.json.tmp` + `rename`) en JSON indenté 2 espaces avec `"$schema": "./settings.schema.json"` en première clé. Il mémorise le hash (`u64`, `DefaultHasher`) des octets écrits dans `last_written_hash`.
  - À chaque `load` réussi, `settings.schema.json` est (ré)écrit dans `paths.root`.

- [ ] **Step 1 : Écrire les tests** (dans `tests/store.rs`, avec `tempfile::TempDir`)
  - `first_launch_creates_file_and_schema` : dossier vide → `settings.json` et `settings.schema.json` existent, `read_only() == false`, contenu parsé == `Settings::default()`, première clé `"$schema"`.
  - `load_with_syntax_error_keeps_defaults_and_is_read_only` : fichier `{"terminal": {` → erreur `Parse` avec `line == 1`, `settings() == default`, `read_only()`, fichier **inchangé** octet pour octet ; `update` renvoie une erreur et n'écrit rien.
  - `invalid_type_reports_key_path` : `{"terminal":{"fontSize":"big"}}` → `ConfigError::Type { path: "terminal.fontSize", .. }`.
  - `future_version_is_read_only_and_untouched` : `{"version": 99}` → `FutureVersion { found: 99, supported: 1 }`, fichier inchangé, `read_only()`.
  - `v0_file_is_migrated_with_backup` : `{"terminal":{"fontSize":18}}` (sans version) → fichier réécrit avec `"version": 1`, `settings.json.v0.bak` contient l'original, `font_size == 18`.
  - `update_preserves_unknown_keys_and_schema` : fichier avec `"x-plugin": {"a": 1}` → `update(json!({"terminal":{"fontSize":20}}))` → le fichier contient toujours `x-plugin.a == 1`, `$schema`, et `fontSize == 20`.
  - `update_rejects_invalid_and_keeps_previous` : `update(json!({"terminal":{"fontSize":500}}))` → `Invalid`, fichier et `settings()` inchangés.
  - `unwritable_dir_falls_back_to_memory` : `ConfigPaths::new` vers un chemin dont le parent est un **fichier** → `load` renvoie `Some(ConfigError::Io{..})`, `settings() == default`, et pas de panic.
  - Dans `merge_patch.rs` : les 3 cas RFC (remplacement, suppression par `null`, fusion imbriquée).
- [ ] **Step 2 : Lancer** `cargo test -p tilde-config` → FAIL.
- [ ] **Step 3 : Implémenter** `paths.rs`, `migrate.rs`, `merge_patch.rs`, `store.rs` selon les interfaces.
- [ ] **Step 4 : Lancer** `cargo test -p tilde-config` → tous PASS ; `cargo clippy -p tilde-config -- -D warnings` → OK.
- [ ] **Step 5 : Commit** `feat(config): settings store with migrations, merge-patch updates and safe fallbacks`

---

### Task 4 : `tilde-config` — hot reload

**Files:**
- Create: `crates/tilde-config/src/watch.rs`
- Modify: `crates/tilde-config/src/store.rs` (`reload_from_disk`)
- Test: `crates/tilde-config/tests/watch.rs`

**Interfaces:**
- Consumes : `SettingsStore`, `ReloadOutcome`, `ConfigPaths` (Task 3).
- Produces : `pub fn watch_settings(paths: &ConfigPaths, on_change: impl Fn() + Send + 'static) -> Result<SettingsWatcher, ConfigError>` ; `SettingsWatcher` arrête la surveillance au `Drop`. Surveille `paths.root` en **non récursif** (pour survivre aux renommages atomiques) et filtre les événements sur le nom `settings.json` ; debounce de 150 ms (`notify-debouncer-full`).
- `reload_from_disk` : lit le fichier, renvoie `SelfWrite` si le hash correspond à `last_written_hash`, sinon parse → migre → valide. En cas de succès, il met à jour `raw`/`settings`, repasse `read_only` à `false` et renvoie `Changed` (ou `Unchanged` si la valeur est identique). En cas d'erreur, il garde l'état précédent et renvoie l'erreur.

- [ ] **Step 1 : Écrire les tests**
  - `reload_detects_external_change` : écrire `fontSize: 22` à la main → `reload_from_disk()` == `Changed(s)` avec `s.terminal.font_size == 22`.
  - `self_write_is_ignored` : `update(...)` puis `reload_from_disk()` == `SelfWrite`.
  - `reload_with_bad_file_keeps_previous` : écrire `{oops` → `Err(Parse)`, `settings()` inchangé ; réécrire un fichier valide → `Changed` et `read_only() == false`.
  - `atomic_rename_triggers_single_reload` : `watch_settings` avec un compteur `AtomicUsize` ; écrire `settings.json.tmp` puis `rename` vers `settings.json` → après 600 ms, compteur == 1.
- [ ] **Step 2 : Lancer** `cargo test -p tilde-config --test watch` → FAIL.
- [ ] **Step 3 : Implémenter** `watch.rs` et `reload_from_disk`.
- [ ] **Step 4 : Lancer** `cargo test -p tilde-config` → PASS (exécuter 3 fois de suite pour détecter une instabilité du test du watcher).
- [ ] **Step 5 : Commit** `feat(config): debounced hot reload with self-write detection`

---

### Task 5 : Câblage Tauri — logs, état, commandes, events, fenêtre, sécurité, types TS générés

**Files:**
- Modify: `src-tauri/Cargo.toml` (deps : `tilde-config` path, `tauri = "2"`, `tauri-plugin-opener = "2"`, `tauri-plugin-single-instance = "2"`, `tauri-plugin-window-state = "2"`, `tracing`, `tracing-subscriber` (features `env-filter`, `json`), `tracing-appender`, `serde_json`, `parking_lot`)
- Create: `src-tauri/src/logging.rs`, `src-tauri/src/state.rs`, `src-tauri/src/commands/{mod.rs,settings.rs,app.rs}`
- Modify: `src-tauri/src/lib.rs`, `src-tauri/tauri.conf.json`, `src-tauri/capabilities/default.json`
- Create: `src-tauri/tauri.macos.conf.json` (`titleBarStyle: "Overlay"`, `hiddenTitle: true`, `decorations: true`)
- Create: `scripts/gen-types.mjs`, `src/ipc/generated/settings.ts` (généré), script npm `gen:types` = `cargo run -q -p tilde-config --bin gen-schema && node scripts/gen-types.mjs` (utilise `json-schema-to-typescript`, sortie `src/ipc/generated/settings.ts`, en-tête « généré — ne pas éditer »)
- Test: `src-tauri/src/logging.rs` (module `tests`)

**Interfaces:**
- Consumes : `SettingsStore`, `watch_settings`, `ConfigPaths`, `ConfigError` (Tasks 2–4).
- Produces (contrat IPC utilisé par Tasks 7–8) :
  - `logging::init(log_dir: &Path) -> tracing_appender::non_blocking::WorkerGuard` — fichiers `tilde.YYYY-MM-DD.log`, format JSON, `max_log_files(7)`, filtre `RUST_LOG` sinon `info` (`debug` pour `tilde*` en build debug) ; + couche console en debug.
  - `struct AppState { settings: parking_lot::Mutex<SettingsStore>, log_dir: PathBuf, _watcher: SettingsWatcher }` géré par `app.manage`.
  - Commandes :
    - `settings_get() -> SettingsSnapshot { settings: Settings, readOnly: bool, error: Option<ConfigErrorDto> }`
    - `settings_update(patch: serde_json::Value) -> Result<Settings, ConfigErrorDto>`
    - `app_info() -> AppInfo { version: String, platform: "windows" | "macos" | "linux" }`
    - `open_logs_dir() -> Result<(), String>`, `open_settings_file() -> Result<(), String>` (via `OpenerExt::opener().open_path`, côté Rust)
  - Events : `settings://changed` (payload `Settings`), `settings://error` (payload `ConfigErrorDto`).
  - Le callback du watcher verrouille le store, appelle `reload_from_disk`, émet `changed` sur `Changed`, `error` sur `Err`, et ne fait rien sur `Unchanged`/`SelfWrite`.
- `tauri.conf.json` : fenêtre `main`, 1200×760, min 720×480, `decorations: false`, `visible: false`, `center: true`, `title: "Tilde"`, `identifier: "dev.tilde.app"`, `productName: "Tilde"`, CSP de la section Global Constraints.
- `capabilities/default.json` : `core:default`, `core:window:allow-minimize`, `allow-toggle-maximize`, `allow-close`, `allow-show`, `allow-start-dragging`, `allow-is-maximized`, `core:event:default` — rien d'autre.
- Si `ConfigPaths::from_os()` vaut `None` ou si le dossier de logs est inaccessible : logs vers stderr seulement, réglages en mémoire, aucun panic au démarrage.

- [ ] **Step 1 : Écrire le test** `log_files_are_created_in_dir` : `init(tmp)` puis `tracing::info!("hello")`, drop du guard → un fichier `tilde.*.log` existe et contient `"hello"`. (Utiliser `tracing::subscriber::with_default` avec un subscriber local exposé par `logging::build_subscriber(dir) -> (impl Subscriber, WorkerGuard)`, pour que le test n'installe pas de subscriber global.)
- [ ] **Step 2 : Lancer** `cargo test -p tilde` → FAIL.
- [ ] **Step 3 : Implémenter** `logging.rs`, `state.rs`, les commandes et `lib.rs` (ordre du setup : chemins → logs → `SettingsStore::load` (journaliser l'erreur éventuelle) → watcher → `manage` → plugins `single_instance` (focus de la fenêtre existante) et `window_state`). Écrire `scripts/gen-types.mjs` et lancer `pnpm gen:types`.
- [ ] **Step 4 : Vérifier** — `cargo test --workspace` PASS ; `cargo clippy --workspace -- -D warnings` OK ; `pnpm gen:types` produit un `settings.ts` qui exporte `interface Settings` avec `terminal.fontSize: number`.
- [ ] **Step 5 : Commit** `feat(app): wire settings, logging, IPC contract and hardened window config`

---

### Task 6 : Moteur de thèmes (front)

**Files:**
- Create: `src/themes/types.ts`, `src/themes/builtin/tilde.ts`, `src/themes/builtin/catppuccin.ts`, `src/themes/registry.ts`, `src/themes/apply.ts`, `src/themes/xterm.ts`, `src/themes/contrast.ts`, `src/themes/useResolvedTheme.ts`
- Modify: `src/styles/globals.css` (bloc `@theme inline` de Tailwind qui mappe `--color-bg`, `--color-surface-1`, `--color-surface-2`, `--color-border`, `--color-text`, `--color-text-muted`, `--color-accent`, `--color-accent-2`, `--color-success`, `--color-warning`, `--color-error` vers les variables `--tilde-*` ; variables shadcn (`--background`, `--primary`, …) aliasées sur ces tokens)
- Test: `src/themes/themes.test.ts`, `src/themes/xterm.test.ts`

**Interfaces:**
- Produces :
  - `type ThemeKind = 'dark' | 'light'`
  - `interface UiTokens { bg; surface1; surface2; border; text; textMuted; accent; accent2; success; warning; error: string }` (hex `#RRGGBB`)
  - `interface TerminalColors { foreground; background; cursor; cursorAccent; selectionBackground; black; red; green; yellow; blue; magenta; cyan; white; brightBlack; brightRed; brightGreen; brightYellow; brightBlue; brightMagenta; brightCyan; brightWhite: string }` (`selectionBackground` en `#RRGGBBAA`)
  - `interface ThemeDefinition { id: string; name: string; kind: ThemeKind; ui: UiTokens; terminal: TerminalColors }`
  - `builtinThemes: readonly ThemeDefinition[]` ; `getTheme(id: string): ThemeDefinition | undefined`
  - `applyTheme(theme: ThemeDefinition, root?: HTMLElement): void` — écrit `--tilde-<token-kebab>` sur `root` (défaut `document.documentElement`) et pose `data-theme-kind`.
  - `toXtermTheme(t: TerminalColors): ITheme` (type local compatible `@xterm/xterm` ; xterm lui-même arrive en phase 2 — on importe seulement le **type**, `import type`).
  - `contrastRatio(fg: string, bg: string): number` (WCAG 2.x).
  - `useResolvedTheme(): ThemeDefinition` — à partir de `appearance.colorScheme`, `themeDark`, `themeLight` et de `matchMedia('(prefers-color-scheme: dark)')` (écoute des changements). Un id inconnu retombe sur `tilde-dark` / `tilde-light`.
- Valeurs exactes :
  - **tilde-dark** ui : bg `#0B0E14`, surface1 `#11151C`, surface2 `#171C26`, border `#232A36`, text `#E6E9EF`, textMuted `#8B93A7`, accent `#7AA2F7`, accent2 `#5EEAD4`, success `#9ECE6A`, warning `#E0AF68`, error `#F7768E`. Terminal : fg `#E6E9EF`, bg `#0B0E14`, cursor `#7AA2F7`, cursorAccent `#0B0E14`, selection `#7AA2F740`, black `#1A1F2B`, red `#F7768E`, green `#9ECE6A`, yellow `#E0AF68`, blue `#7AA2F7`, magenta `#BB9AF7`, cyan `#5EEAD4`, white `#C0C6D4`, brightBlack `#4A5368`, brightRed `#FF8FA3`, brightGreen `#B5E07F`, brightYellow `#F0C48A`, brightBlue `#99B7FF`, brightMagenta `#CDB2FF`, brightCyan `#8AF5E4`, brightWhite `#F5F7FA`.
  - **tilde-light** ui : bg `#F7F8FB`, surface1 `#FFFFFF`, surface2 `#EEF1F6`, border `#D9DEE7`, text `#1B2030`, textMuted `#5C6478`, accent `#3D63D9`, accent2 `#0F8F82`, success `#4C8A1E`, warning `#9A5F0E`, error `#C93A58`. Terminal : fg `#1B2030`, bg `#F7F8FB`, cursor `#3D63D9`, cursorAccent `#F7F8FB`, selection `#3D63D930`, black `#1B2030`, red `#C93A58`, green `#4C8A1E`, yellow `#9A5F0E`, blue `#3D63D9`, magenta `#8A4FD8`, cyan `#0F8F82`, white `#6B7387`, brightBlack `#5C6478`, brightRed `#E25A77`, brightGreen `#5FA02C`, brightYellow `#B87418`, brightBlue `#5479EB`, brightMagenta `#9E66E8`, brightCyan `#16A99A`, brightWhite `#8890A3`.
  - **catppuccin-mocha** / **catppuccin-latte** : palette officielle `catppuccin/palette` (ANSI selon le port officiel `catppuccin/windows-terminal`). Mapping UI : bg = Base, surface1 = Mantle, surface2 = Surface0, border = Surface1, text = Text, textMuted = Subtext0, accent = Blue, accent2 = Teal, success = Green, warning = Yellow, error = Red.

- [ ] **Step 1 : Écrire les tests** (`themes.test.ts`)
  - `every builtin theme has all tokens as valid hex` (regex `^#[0-9A-F]{6}([0-9A-F]{2})?$`, insensible à la casse) et des ids uniques.
  - `text contrast meets WCAG AA` : pour chaque thème, `contrastRatio(ui.text, ui.bg) >= 4.5`, `contrastRatio(ui.textMuted, ui.bg) >= 3`, `contrastRatio(terminal.foreground, terminal.background) >= 4.5`.
  - `applyTheme writes css variables` : sur un `div`, `style.getPropertyValue('--tilde-surface-1') === '#11151C'` et `dataset.themeKind === 'dark'`.
  - `unknown theme id falls back` : `useResolvedTheme` avec `themeDark: 'nope'` et un `matchMedia` simulé en dark → `id === 'tilde-dark'`.
  - `xterm.test.ts` : `toXtermTheme(tildeDark.terminal).selectionBackground === '#7AA2F740'` et `.brightCyan === '#8AF5E4'`.
- [ ] **Step 2 : Lancer** `pnpm test src/themes` → FAIL.
- [ ] **Step 3 : Implémenter.** Si un test de contraste échoue sur une valeur fournie ci-dessus, ajuster **cette** valeur au minimum nécessaire et le signaler dans le message de commit.
- [ ] **Step 4 : Lancer** `pnpm test src/themes` → PASS.
- [ ] **Step 5 : Commit** `feat(themes): token-based theme engine with Tilde and Catppuccin themes`

---

### Task 7 : Store de réglages et wrappers IPC (front)

**Files:**
- Create: `src/ipc/settings.ts`, `src/ipc/app.ts`, `src/ipc/errors.ts`, `src/stores/settings.ts`
- Create: `src/components/ui/sonner.tsx` (via `shadcn add sonner`)
- Test: `src/stores/settings.test.ts`

**Interfaces:**
- Consumes : le contrat IPC de la Task 5 ; le type `Settings` de `src/ipc/generated/settings.ts`.
- Produces :
  - `ipc/settings.ts` : `getSettings(): Promise<SettingsSnapshot>`, `updateSettings(patch: DeepPartial<Settings>): Promise<Settings>`, `onSettingsChanged(cb: (s: Settings) => void): Promise<UnlistenFn>`, `onSettingsError(cb: (e: ConfigErrorDto) => void): Promise<UnlistenFn>`, `openSettingsFile()`, `openLogsDir()`.
  - `ipc/app.ts` : `getAppInfo(): Promise<AppInfo>`.
  - `ipc/errors.ts` : `type ConfigErrorDto = { kind: 'io' | 'parse' | 'type' | 'invalid' | 'futureVersion'; message: string; line?: number; column?: number; path?: string }` ; `formatConfigError(e): string` (FR, par ex. « settings.json ligne 3, colonne 5 : … »).
  - `useSettings` (Zustand) : état `{ settings: Settings | null; readOnly: boolean; error: ConfigErrorDto | null }`, actions `init(): Promise<() => void>` (charge, s'abonne, renvoie la fonction de désabonnement) et `update(patch): Promise<void>` (non optimiste : remplace par la valeur renvoyée ; en cas d'erreur, toast `formatConfigError` et état inchangé). Un event `settings://error` déclenche un toast et `readOnly: true` ; un event `changed` remet `readOnly: false` et `error: null`.
- [ ] **Step 1 : Écrire les tests** avec `vi.mock('@tauri-apps/api/core')` et `vi.mock('@tauri-apps/api/event')`
  - `init loads snapshot and subscribes`
  - `changed event replaces settings and clears error`
  - `update failure keeps previous settings and toasts` (mock de `sonner` : `toast.error` appelé avec un texte contenant `terminal.fontSize`)
  - `formatConfigError includes line and column for parse errors`
- [ ] **Step 2 : Lancer** `pnpm test src/stores` → FAIL.
- [ ] **Step 3 : Implémenter.**
- [ ] **Step 4 : Lancer** `pnpm test` → PASS ; `pnpm typecheck` OK.
- [ ] **Step 5 : Commit** `feat(front): typed settings IPC and store with live updates`

---

### Task 8 : Coquille applicative (titlebar, sidebar, onglets, accueil, réglages rapides)

**Files:**
- Create: `src/app/AppShell.tsx`, `src/app/Titlebar.tsx`, `src/app/WindowControls.tsx`, `src/app/Sidebar.tsx`, `src/app/TabBar.tsx`, `src/app/Welcome.tsx`, `src/app/QuickSettingsDialog.tsx`, `src/app/Logo.tsx`
- Create: composants shadcn `button`, `tooltip`, `dialog`, `select`, `scroll-area`, `toggle-group`
- Modify: `src/App.tsx`, `src/main.tsx`, `src/styles/globals.css` (polices, densité : `--tilde-density` ∈ {0.85, 1, 1.15} par `data-density`, transitions 150 ms)
- Test: `src/app/AppShell.test.tsx`

**Interfaces:**
- Consumes : `useSettings` (Task 7), `useResolvedTheme`, `applyTheme` (Task 6), `getAppInfo` (Task 7).
- Produces : `<AppShell />`, monté par `App` après `useSettings.init()`. `App` applique le thème résolu dans un effet et pose `data-density` sur `<html>`. Après le premier rendu de la coquille (`requestAnimationFrame` dans un effet), il appelle `getCurrentWindow().show()` et journalise `performance.now()` sous la forme `startup: Xms`.
- Comportement :
  - **Titlebar** (hauteur 36 px) : `data-tauri-drag-region` sur toute la barre ; `Logo` (`~` en accent, dessiné en SVG inline) + « Tilde » ; double-clic → maximiser / restaurer (fourni par la zone de drag). `WindowControls` (minimiser, maximiser/restaurer selon `isMaximized`, fermer avec un survol rouge `--tilde-error`) rendu seulement si `platform !== 'macos'` ; sous macOS, padding gauche de 78 px pour les feux tricolores.
  - **Sidebar** : largeur `appearance.sidebarWidth`, côté `appearance.sidebarPosition`. État vide « Aucune connexion pour l'instant » avec une icône Lucide `Server`. Pied de sidebar : bouton réglages (`Settings2`) qui ouvre `QuickSettingsDialog`.
  - **TabBar** : un onglet fixe « Accueil » (icône `House`) et un bouton `+` désactivé avec l'infobulle « Disponible en phase 2 ».
  - **Welcome** : grand `~`, version (`AppInfo.version`), raccourcis à venir (texte statique).
  - **QuickSettingsDialog** : schéma de couleurs (système / sombre / clair), thème sombre, thème clair (listes issues de `builtinThemes` filtrés par `kind`), densité, position de la sidebar, plus les boutons « Ouvrir settings.json » et « Ouvrir le dossier des logs ». Chaque contrôle appelle `useSettings.update` avec un patch minimal. Si `readOnly` est vrai, une bannière `warning` affiche `formatConfigError(error)` et les contrôles sont désactivés.
- [ ] **Step 1 : Écrire les tests** (mocks IPC comme en Task 7, `platform: 'windows'`)
  - `renders titlebar, sidebar, tabbar and welcome`
  - `sidebar moves to the right when sidebarPosition is right` (ordre DOM, ou `data-side="right"` sur la sidebar)
  - `window controls hidden on macos`
  - `quick settings sends minimal patch` : choisir « Clair » → `invoke('settings_update', { patch: { appearance: { colorScheme: 'light' } } })`
  - `read-only banner disables controls`
- [ ] **Step 2 : Lancer** `pnpm test src/app` → FAIL.
- [ ] **Step 3 : Implémenter.**
- [ ] **Step 4 : Vérifier**
  - `pnpm test && pnpm lint && pnpm typecheck` → OK.
  - Manuel avec `pnpm tauri dev` : déplacer la fenêtre en tirant la titlebar ; double-clic pour maximiser ; boutons min/max/fermer ; changer le thème dans la boîte de dialogue → changement immédiat et `settings.json` mis à jour ; éditer `settings.json` dans VS Code (`"density": "compact"`) → l'UI change en < 1 s ; casser le JSON → toast + bannière, puis réparer → retour à la normale ; changer le thème de l'OS avec `colorScheme: system` → bascule automatique.
- [ ] **Step 5 : Commit** `feat(ui): app shell with custom titlebar, sidebar, tabs and quick settings`

---

### Task 9 : CI, documentation et vérification de fin de phase

**Files:**
- Create: `.github/workflows/ci.yml`, `deny.toml`, `README.md`, `CONTRIBUTING.md`, `SECURITY.md`, `docs/architecture.md`, `.github/ISSUE_TEMPLATE/{bug_report.yml,feature_request.yml}`

**Interfaces:**
- `ci.yml` (déclencheurs : push sur `main`, pull_request) :
  - job `frontend` (ubuntu-latest) : `pnpm/action-setup`, Node 24, `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm typecheck`, `pnpm test`.
  - job `rust` (matrice `windows-latest`, `ubuntu-22.04`, `macos-latest`) : dépendances Linux (`libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev libayatana-appindicator3-dev patchelf`), `Swatinem/rust-cache`, `pnpm install` + `pnpm build` (frontendDist requis par `generate_context!`), `cargo fmt --all --check`, `cargo clippy --workspace --all-targets -- -D warnings`, `cargo test --workspace`.
  - job `generated` (ubuntu) : `pnpm gen:types` puis `git diff --exit-code schemas src/ipc/generated` (le schéma et les types doivent être à jour).
  - job `deny` : `EmbarkStudios/cargo-deny-action@v2` (licences autorisées : MIT, Apache-2.0, BSD-2/3, ISC, Zlib, Unicode-3.0, MPL-2.0, CC0-1.0 ; advisories en erreur).
- `README.md` : pitch, captures d'écran (à ajouter plus tard), prérequis (Rust via rustup, Node 24, pnpm 10, dépendances système Tauri par OS), `pnpm install`, `pnpm tauri dev`, `pnpm tauri build`, tests, emplacement de la config et des logs, lien vers `docs/architecture.md`, licence.
- `SECURITY.md` : signalement privé via GitHub Security Advisories, périmètre (secrets, SSH, known_hosts).
- `docs/architecture.md` : résumé du §4 du spec, plus le flux réglages Rust → JSON Schema → types TS.

- [ ] **Step 1 :** Écrire `deny.toml` et lancer `cargo deny check` en local (`cargo install cargo-deny --locked` si nécessaire) → OK, ou ajuster la liste des licences en justifiant chaque ajout dans le commit.
- [ ] **Step 2 :** Écrire `ci.yml` et les documents.
- [ ] **Step 3 : Vérification de fin de phase (Windows)**
  - `cargo fmt --all --check && cargo clippy --workspace --all-targets -- -D warnings && cargo test --workspace` → OK.
  - `pnpm lint && pnpm typecheck && pnpm test` → OK.
  - `pnpm tauri build` → produit MSI et NSIS sans erreur ; installer, lancer la version release ; vérifier que la ligne `startup: Xms` dans le fichier de log est < 1000 et que la console DevTools ne montre **aucune violation CSP**.
  - Relancer la check-list manuelle de la Task 8 sur la build release.
- [ ] **Step 4 : Commit** `ci: lint/test pipeline, cargo-deny and project docs`
- [ ] **Step 5 : Récap pour l'auteur** (fait / reste / check-list manuelle) puis **arrêt** : la phase 2 ne démarre qu'après validation.
