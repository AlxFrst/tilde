# Phase 6 — Personnalisation avancée : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tilde se règle entièrement depuis l'UI et les fichiers.
- Thèmes : tous les ports, thèmes utilisateur, import iTerm2 / Windows Terminal / base16, éditeur avec aperçu en direct, export.
- Raccourcis reconfigurables dans `keybindings.json`.
- Transparence (Mica / Acrylic / vibrancy / opacité) et mode Quake.
- Une vraie page de réglages qui couvre tous les réglages listés en §4.9.

**Architecture:**
- **Thèmes**
  - Les ports intégrés sont des modules TS.
  - Les thèmes utilisateur sont des fichiers `themes/<id>.json` détenus par Rust : liste, écriture atomique, suppression, surveillance.
  - Le front valide chaque fichier et dérive les tokens UI manquants.
  - Un store `themes` fusionne thèmes intégrés et utilisateur, et porte le thème d'**aperçu** de l'éditeur, appliqué à toute la fenêtre tant que l'éditeur est ouvert.
- **Raccourcis**
  - `keybindings.json` ne contient que les **écarts** aux défauts. Rust le détient (`KeybindingsStore`, même modèle que `ConnectionsStore`).
  - Le front calcule la table effective : défauts + écarts.
  - `keys.ts` devient un moteur paramétré par cette table. `useShortcuts`, le terminal, la palette et l'accueil lisent tous la table effective.
- **Fenêtre**
  - Effets appliqués par Rust via `Window::set_effects` de Tauri, qui s'appuie sur `window-vibrancy` 0.8.1.
  - L'opacité est celle des fonds (CSS et xterm), jamais celle du texte.
  - Quake : `tauri-plugin-global-shortcut` côté Rust, et une seconde fenêtre `quake` qui charge le même front en mode `?window=quake`.

**Tech Stack:** React 19, Zustand, xterm 6 (`registerCharacterJoiner`), Tauri 2.12 (`set_effects`, `WebviewWindowBuilder`), `tauri-plugin-global-shortcut` 2, `windows-version` 0.1 (Windows seulement), `@fontsource-variable/geist-mono`.

**Spec:** `docs/superpowers/specs/2026-10-23-tilde-design.md` (§4.8, §4.9, §4.10, §6 phase 6, §7). Plans précédents : phases 1 à 5.

## Global Constraints

- Tout ce qui précède reste valable :
  - crates métier sans Tauri ;
  - aucun secret sur disque ni dans les logs ;
  - commits conventionnels + `Co-Authored-By` ;
  - clippy pedantic `-D warnings` ;
  - textes de l'UI en français ;
  - `pnpm gen:types` à jour (job CI `generated`).
- Fichiers dans `dirs::config_dir()/Tilde/` : `keybindings.json` et `themes/*.json`. Chacun porte `"version": N`, est rechargé à chaud, et les écritures de l'app sont ignorées par le watcher.
- Pas de nouveau plugin exposé au front : `global-shortcut` est utilisé **depuis Rust uniquement**, et aucune permission `fs` ni `shell` n'est ajoutée. Tout accès fichier passe par des commandes Rust.
- Parsers d'import en TypeScript, testés avec Vitest, **sans dépendance** : `DOMParser` pour le plist, YAML base16 lu par un mini-parser ligne à ligne.
- Contraste WCAG AA de tous les thèmes intégrés : text/bg ≥ 4,5 ; textMuted/bg ≥ 3 ; fg/bg du terminal ≥ 4,5. L'éditeur affiche ces trois ratios et avertit sans bloquer.
- Thème « light » conçu à part ; les ports reprennent les palettes officielles (seuls `textMuted` et les surfaces peuvent être ajustés pour le contraste).
- Fenêtre `main` : `transparent: true` dès la création. L'apparence reste **opaque** tant que `effect = none` et `opacity = 1`.
- Ne jamais lancer l'app ni simuler des frappes pendant l'exécution : la vérification visuelle est une check-list manuelle pour l'auteur.

## Review Focus

1. **Fichier importé hostile ou cassé** : XML invalide, `<!DOCTYPE>`/entités, composantes iTerm hors [0,1], clés manquantes, `settings.json` de Windows Terminal avec commentaires, fichier de 50 Mo, YAML non base16. Attendu : message lisible, rien n'est enregistré, pas de gel. Tests : Task 3 `rejects_hostile_or_broken_files`, Task 4 `import_pick_refuses_large_files`.
2. **Id de thème dangereux ou fichier utilisateur cassé** : `../x`, `CON`, `a/b`, id vide, JSON invalide écrit à la main. Attendu : aucune écriture hors de `themes/` ; le fichier cassé est signalé, les autres se chargent, et le thème choisi retombe sur l'intégré. Tests : Task 4 `theme_ids_cannot_escape_the_themes_dir`, `broken_theme_file_is_reported_not_fatal` ; Task 5 `missing user theme falls back to builtin`.
3. **Raccourci qui casse la frappe ou en vole un autre** : touche seule (`A`, `Enter`), conflit avec une autre commande, `keybindings.json` invalide écrit à la main. Attendu : refus ou avertissement explicite ; un fichier invalide garde les défauts et affiche un toast. Tests : Task 8 `invalid entries keep defaults and are reported`, Task 9 `refuses a binding without modifier` / `shows the conflicting command`.
4. **Effet non pris en charge** : Mica sous Windows 10, vibrancy sous Windows, Mica sous Linux. Attendu : repli sur l'opacité seule, sans fenêtre invisible ni texte illisible ; la page de réglages le dit. Test : Task 10 `effect_plan_falls_back_per_platform`.
5. **Raccourci Quake déjà pris ou invalide** : `Ctrl+``" utilisé par une autre app, chaîne vide, `Ctrl+Truc`. Attendu : toast qui explique ; le reste de l'app n'est pas affecté ; désactiver Quake libère le raccourci. Tests : Task 11 `to_accelerator_maps_tilde_syntax`, `invalid_shortcut_is_an_error`.

---

### Task 1 : Ports de thèmes

**Files:**
- Create: `src/themes/builtin/{tokyo-night,dracula,nord,gruvbox,one,rose-pine}.ts`
- Modify: `src/themes/registry.ts`, `src/themes/themes.test.ts`

**Interfaces:**
- Produces (ids exacts) : `tokyo-night`, `tokyo-night-day`, `dracula`, `nord`, `gruvbox-dark`, `gruvbox-light`, `one-dark`, `one-light`, `rose-pine`, `rose-pine-dawn`. Ils s'ajoutent à `tilde-dark`, `tilde-light`, `catppuccin-mocha` et `catppuccin-latte` dans `builtinThemes`.

- [ ] **Step 1 :** dans `themes.test.ts`, étendre `expect(ids).toEqual(expect.arrayContaining([...]))` aux 10 nouveaux ids. Ajouter le test `every kind has at least four themes` : au moins 4 thèmes `dark` et 4 `light`.
- [ ] **Step 2 :** `pnpm vitest run src/themes` → FAIL (ids absents).
- [ ] **Step 3 :** écrire les 10 thèmes depuis les palettes officielles :
  - les 16 couleurs ANSI, fg/bg, cursor et selection de chaque projet ;
  - tokens UI : `bg` = fond officiel, `surface1/2` = teintes de la palette, `accent` = bleu ou violet signature, `success`/`warning`/`error` = vert/jaune/rouge ANSI ;
  - `textMuted` choisi pour atteindre 3:1 (ex. Nord : ne pas prendre `#4C566A`).
- [ ] **Step 4 :** `pnpm vitest run src/themes` → PASS. Les tests de contraste existants couvrent les 14 thèmes.
- [ ] **Step 5 :** commit `feat(themes): port Tokyo Night, Dracula, Nord, Gruvbox, One, Rosé Pine`.

### Task 2 : Validation et dérivation des thèmes (TS)

**Files:**
- Create: `src/themes/derive.ts`, `src/themes/parse.ts`, `src/themes/parse.test.ts`
- Modify: `src/themes/index.ts`

**Interfaces:**
- Produces :
  - `deriveUiTokens(terminal: TerminalColors, kind: ThemeKind): UiTokens` :
    - `bg = background` ;
    - `surface1` / `surface2` = bg mélangé à 4 % / 8 % de fg ;
    - `border` = 14 % ;
    - `text = foreground` ;
    - `textMuted` = mélange fg/bg rapproché de fg jusqu'à atteindre 3:1 ;
    - `accent = blue`, `accent2 = cyan`, `success = green`, `warning = yellow`, `error = red`.
  - `inferKind(background: string): ThemeKind` : luminance relative < 0,5 → `dark`.
  - `parseThemeFile(raw: unknown, fallbackId?: string): ThemeDefinition`. Il lève `ThemeError` (`class ThemeError extends Error`, message en français qui nomme le champ).
    - Exige `name` (1 à 80 caractères) et `terminal` complet, au format `#RRGGBB` ou `#RRGGBBAA`.
    - `ui` facultatif : dérivé quand il manque ou est partiel (les clés présentes sont gardées).
    - `kind` facultatif : inféré.
    - L'`id` vient de `fallbackId` (nom du fichier) quand il est fourni, sinon de `raw.id`.
  - `serializeTheme(t: ThemeDefinition): string` : JSON indenté de 2 espaces, `{ "version": 1, id, name, kind, ui, terminal }`.
  - `THEME_FILE_VERSION = 1`.

- [ ] **Step 1 :** tests dans `parse.test.ts` :
  - `derives readable ui tokens from terminal colors` : pour les 14 thèmes intégrés, `deriveUiTokens(t.terminal, t.kind)` respecte text/bg ≥ 4,5 et textMuted/bg ≥ 3 ;
  - `infers kind from background` : `#000000` → dark, `#FAFAFA` → light ;
  - `parses a terminal-only theme` ;
  - `keeps provided ui tokens` ;
  - `rejects bad colors naming the field` : `terminal.red = 'red'` → message contenant `terminal.red` ;
  - `rejects missing terminal keys` ;
  - `serialize then parse roundtrips`.
- [ ] **Step 2 :** `pnpm vitest run src/themes/parse` → FAIL (module absent).
- [ ] **Step 3 :** implémenter dans `derive.ts` et `parse.ts`, en réutilisant `contrastRatio` de `contrast.ts`. Les mélanges se font en sRGB et produisent du hex majuscule `#RRGGBB`.
- [ ] **Step 4 :** `pnpm vitest run src/themes` → PASS.
- [ ] **Step 5 :** commit `feat(themes): validate theme files and derive ui tokens from terminal colors`.

### Task 3 : Imports iTerm2 / Windows Terminal / base16 et export

**Files:**
- Create: `src/themes/importers/{iterm.ts,windowsTerminal.ts,base16.ts,index.ts,importers.test.ts}`, `src/themes/importers/fixtures/{Dracula.itermcolors,wt-settings.json,wt-scheme.json,base16-ocean.yaml}`

**Interfaces:**
- Consumes : `deriveUiTokens`, `inferKind`, `ThemeError` (Task 2).
- Produces :
  - `importTheme(fileName: string, text: string): ImportResult`, avec `ImportResult = { themes: ThemeDefinition[]; warnings: string[] }`. Il lève `ThemeError`.
  - Choix du format par extension (`.itermcolors` / `.json` / `.yaml` / `.yml`), sinon par contenu (`<plist`, `{`, `base00:`).
  - Ids générés : `slugify(name)` (`[a-z0-9-]`, 64 caractères au plus).
  - **iTerm2** :
    - `Ansi 0..15 Color`, `Foreground Color`, `Background Color`, `Cursor Color`, `Cursor Text Color`, `Selection Color` ;
    - composantes réelles 0–1, bornées puis arrondies ;
    - `Alpha Component` ignoré, sauf pour la sélection ;
    - nom = nom du fichier sans extension.
  - **Windows Terminal** :
    - un objet scheme (`name`, `foreground`, `background`, `cursorColor`, `selectionBackground`, `black`…`brightWhite` ; WT dit `purple`/`brightPurple` pour magenta) ;
    - ou un `settings.json` complet dont on lit `schemes[]`, ce qui donne plusieurs thèmes ;
    - commentaires `//` et `/* */` et virgules finales tolérés.
  - **base16** :
    - YAML `scheme:`, `author:`, `base00`…`base0F` (valeurs avec ou sans `#`, guillemets facultatifs) ;
    - correspondance ANSI standard base16-shell : 0=base00, 1=base08, 2=base0B, 3=base0A, 4=base0D, 5=base0E, 6=base0C, 7=base05, 8=base03, 9=base08, 10=base0B, 11=base0A, 12=base0D, 13=base0E, 14=base0C, 15=base07 ;
    - fg = base05, bg = base00, cursor = base05, sélection = base02 + `60` ;
    - le format base24 (`base10`+) est accepté, et ses clés en plus sont ignorées.
  - `slugify(name: string): string`.

- [ ] **Step 1 :** tests dans `importers.test.ts` :
  - `imports an itermcolors file` : Dracula, `red === '#FF5555'`, `kind === 'dark'` ;
  - `imports a Windows Terminal scheme` et `imports every scheme of a Windows Terminal settings.json with comments` ;
  - `imports base16 yaml` : base16-ocean, `background === '#2B303B'`, `blue === '#8FA1B3'` ;
  - `rejects_hostile_or_broken_files` : XML invalide, plist contenant `<!DOCTYPE` avec `<!ENTITY`, YAML sans `base00`, JSON sans couleurs, texte de 2 Mo. Chaque cas lève `ThemeError` avec un message en français ;
  - `slugify produces safe ids` : `'../Nord Ⅱ'` → `'nord-ii'` ou `'nord'`, jamais `/`, `.` ni vide (repli `'theme'`).
- [ ] **Step 2 :** `pnpm vitest run src/themes/importers` → FAIL.
- [ ] **Step 3 :** implémenter.
  - Le texte est refusé au-delà de **1 Mio**.
  - Le plist est refusé s'il contient `<!DOCTYPE` avec `[` ou `<!ENTITY` : pas d'entités. Il est lu ensuite avec `DOMParser('application/xml')`, et l'erreur est détectée par `parsererror`.
  - Les commentaires JSON sont retirés par un petit scanner qui respecte les chaînes.
- [ ] **Step 4 :** `pnpm vitest run src/themes` → PASS.
- [ ] **Step 5 :** commit `feat(themes): import iTerm2, Windows Terminal and base16 color schemes`.

### Task 4 : Thèmes utilisateur sur disque (Rust)

**Files:**
- Create: `crates/tilde-config/src/themes.rs`, `crates/tilde-config/tests/themes.rs`, `src-tauri/src/commands/themes.rs`, `src/ipc/themes.ts`
- Modify: `crates/tilde-config/src/{lib.rs,paths.rs,watch.rs}`, `crates/tilde-config/tests/watch.rs`, `src-tauri/src/{lib.rs,commands/mod.rs,state.rs}`

**Interfaces:**
- Produces (Rust) :
  - `ConfigPaths::themes_dir() -> PathBuf` (`root/themes`).
  - `MAX_THEME_BYTES: u64 = 256 * 1024`.
  - `is_valid_theme_id(id: &str) -> bool` : `^[a-z0-9][a-z0-9-]{0,63}$`, à l'exception des noms réservés Windows (`con`, `nul`, `aux`, `prn`, `com1`-`9`, `lpt1`-`9`).
  - `#[derive(Serialize)] #[serde(rename_all = "camelCase")] pub struct UserTheme { pub id: String, pub data: serde_json::Value }`.
  - `#[derive(Serialize)] pub struct ThemeFileError { pub file: String, pub message: String }`.
  - `list_user_themes(paths: &ConfigPaths) -> (Vec<UserTheme>, Vec<ThemeFileError>)` :
    - lit les `*.json` du dossier (absent → vide), triés par id ;
    - ignore ce qui n'a pas un id valide (signalé), ce qui dépasse la taille (signalé) et ce qui n'est pas un objet JSON (signalé).
  - `save_user_theme(paths: &ConfigPaths, id: &str, data: &Value) -> Result<(), ConfigError>` :
    - id invalide → `ConfigError::Invalid` ;
    - objet exigé, taille sérialisée ≤ `MAX_THEME_BYTES` ;
    - force `data.id = id` et `data.version = 1` ;
    - écriture atomique (tmp + rename) ; crée le dossier.
  - `delete_user_theme(paths, id) -> Result<(), ConfigError>` : id invalide → `Invalid` ; fichier absent → `Ok`.
  - `ConfigFile::Themes` et `ConfigFile::Keybindings` (ce dernier pour la Task 7). `watch_config` surveille en plus `themes_dir()`, créé au besoin, en non récursif : tout événement sur un `*.json` → `Themes`.
  - Commandes Tauri :
    - `themes_list() -> ThemesSnapshot { themes: Vec<UserTheme>, errors: Vec<ThemeFileError> }` ;
    - `themes_save(id, data)` et `themes_delete(id)` (les deux émettent `themes://changed` avec le snapshot) ;
    - `themes_import_pick() -> Option<PickedFile { name: String, text: String }>` : dialogue natif avec filtres `itermcolors`, `json`, `yaml`, `yml` ; refuse au-delà de 1 Mio et le non-UTF-8 avec un message clair ;
    - `themes_export(id: String, text: String) -> bool` : dialogue d'enregistrement, nom par défaut `<id>.json` ;
    - `open_themes_dir()` : crée le dossier puis l'ouvre via opener depuis Rust.
  - Le watcher appelle `on_themes_changed(&AppHandle)`, qui émet `themes://changed`.
- Produces (TS, `src/ipc/themes.ts`) : `themesList()`, `themesSave(id, data)`, `themesDelete(id)`, `themesImportPick()`, `themesExport(id, text)`, `openThemesDir()`, `onThemesChanged(cb)`, et les types `UserTheme`, `ThemeFileError`, `ThemesSnapshot`, `PickedFile`.

- [ ] **Step 1 :** tests `crates/tilde-config/tests/themes.rs` :
  - `theme_ids_cannot_escape_the_themes_dir` : `../x`, `a/b`, `a\\b`, `CON`, `nul`, `''`, `X`, 65 caractères → `Invalid`, et aucun fichier créé hors de `themes/` ;
  - `save_list_delete_roundtrip` ;
  - `broken_theme_file_is_reported_not_fatal` : un fichier `bad.json` invalide à côté d'un `good.json` → 1 thème et 1 erreur nommant `bad.json` ;
  - `oversized_theme_is_refused`.
  
  Dans `tests/watch.rs` : `theme_file_change_is_reported`.
- [ ] **Step 2 :** `cargo test -p tilde-config --test themes --test watch` → FAIL (fonctions absentes).
- [ ] **Step 3 :** implémenter `themes.rs` et l'extension du watcher. Réutiliser `io_err` et le motif d'écriture atomique de `workspace.rs`.
- [ ] **Step 4 :** `cargo test -p tilde-config` → PASS.
- [ ] **Step 5 :** commandes Tauri + `src/ipc/themes.ts`, avec un test Rust `import_pick_refuses_large_files` sur une fonction pure `read_import(path: &Path) -> Result<PickedFile, String>`. Puis `cargo clippy --workspace --all-targets -- -D warnings` → propre.
- [ ] **Step 6 :** commit `feat(config): user themes in themes/*.json with hot reload`.

### Task 5 : Store de thèmes, registre fusionné et aperçu

**Files:**
- Create: `src/stores/themes.ts`, `src/stores/themes.test.ts`, `src/themes/useActiveTheme.ts`
- Modify: `src/themes/{registry.ts,useResolvedTheme.ts,index.ts}`, `src/App.tsx`, `src/terminal/TerminalView.tsx`, `src/app/QuickSettingsDialog.tsx` (sélecteurs de thème)

**Interfaces:**
- Consumes : `parseThemeFile` (Task 2), `src/ipc/themes.ts` (Task 4).
- Produces :
  - `useThemes` (zustand) :
    - `{ user: ThemeDefinition[]; errors: ThemeFileError[]; preview: ThemeDefinition | null; init(): Promise<() => void>; save(t: ThemeDefinition): Promise<void>; remove(id: string): Promise<void>; setPreview(t: ThemeDefinition | null): void }` ;
    - les fichiers invalides au regard de `parseThemeFile` rejoignent `errors` ;
    - un id utilisateur qui reprend un id intégré est ignoré avec l'erreur « id réservé par un thème intégré ».
  - `allThemes(user: readonly ThemeDefinition[]): ThemeDefinition[]` : intégrés d'abord, puis utilisateur triés par nom.
  - `findTheme(id: string, user: readonly ThemeDefinition[]): ThemeDefinition | undefined`. `getTheme(id)` reste, limité aux intégrés.
  - `resolveTheme(choice, osPrefersDark, user = [])` : les thèmes utilisateur sont pris en compte, avec repli sur Tilde.
  - `useActiveTheme(): ThemeDefinition` : `preview ?? resolveTheme(...)`. C'est la **seule** source du thème pour `App` (CSS) et `TerminalView` (xterm).
  - `toast.error` à chaque nouvelle erreur de fichier (« themes/bad.json : … »).

- [ ] **Step 1 :** tests dans `stores/themes.test.ts` (ipc mocké comme dans `connections.test.ts`) :
  - `loads valid user themes and reports broken ones` ;
  - `missing user theme falls back to builtin` ;
  - `user theme cannot shadow a builtin id` ;
  - `preview overrides the resolved theme` (avec `renderHook(useActiveTheme)`) ;
  - `reloads on themes://changed`.
- [ ] **Step 2 :** `pnpm vitest run src/stores/themes` → FAIL.
- [ ] **Step 3 :** implémenter. `App.tsx` appelle `useThemes.getState().init()` au démarrage, comme `useConnections`, et `applyTheme(useActiveTheme())`. `TerminalView` remplace `useResolvedTheme` par `useActiveTheme`. Les sélecteurs de thème listent `allThemes(user)` filtré par `kind`.
- [ ] **Step 4 :** `pnpm test` → PASS (suite complète).
- [ ] **Step 5 :** commit `feat(themes): user themes in the theme pickers and a live preview slot`.

### Task 6 : Éditeur de thème, import et export (UI)

**Files:**
- Create: `src/app/settings/ThemesSection.tsx`, `src/app/settings/ThemeEditor.tsx`, `src/app/settings/ThemeEditor.test.tsx`, `src/app/settings/ColorField.tsx`

**Interfaces:**
- Consumes : `useThemes` (Task 5), `importTheme` / `slugify` (Task 3), `serializeTheme` / `deriveUiTokens` (Task 2), `themesImportPick` / `themesExport` / `openThemesDir` (Task 4).
- Produces :
  - `ThemesSection` (utilisée par la page de réglages, Task 12) :
    - liste des thèmes avec pastilles (bg, accent et 8 ANSI) ;
    - actions : « Utiliser comme thème sombre/clair », « Dupliquer et modifier », « Modifier » et « Supprimer » (utilisateur seulement, via `confirmAction`), « Exporter » ;
    - boutons « Importer… » et « Ouvrir le dossier des thèmes ».
  - `ThemeEditor({ initial: ThemeDefinition, isNew: boolean, onClose })` :
    - champs `name` et `kind` ;
    - groupes « Interface » (11 tokens), « Terminal » (fg, bg, cursor, cursorAccent, selection) et « ANSI » (16) ;
    - `ColorField` = `<input type="color">` + champ hex validé (le champ sélection accepte `#RRGGBBAA`) ;
    - bouton « Dériver l'interface des couleurs du terminal » ;
    - panneau des contrastes : trois ratios, avertissement sous le seuil ;
    - aperçu : chaque modification appelle `setPreview(draft)` ; « Annuler » et la fermeture appellent `setPreview(null)` ;
    - « Enregistrer » → `save()` avec l'id `slugify(name)`, rendu unique par un suffixe `-2`, `-3`… s'il est nouveau ou en collision, puis `setPreview(null)`.
  - Import : `themesImportPick()` → `importTheme()`.
    - Un seul thème → l'éditeur s'ouvre, pré-rempli et `isNew`.
    - Plusieurs thèmes (settings.json WT) → liste à cocher, puis enregistrement des thèmes choisis.
    - Erreur → `toast.error(message)`.
  - Export : `themesExport(id, serializeTheme(theme))` → toast « Thème exporté ».

- [ ] **Step 1 :** tests `ThemeEditor.test.tsx` :
  - `editing a color previews it live` (le store `preview.ui.accent` suit) ;
  - `cancel restores the previous theme` (`preview === null`) ;
  - `warns when contrast is too low` (texte sur fond à 2:1 → alerte visible) ;
  - `saving a new theme picks a unique id` (`tilde-dark` existant → `tilde-dark-2`) ;
  - `import with several schemes asks which to keep` (ipc et `importTheme` réels sur la fixture WT).
- [ ] **Step 2 :** `pnpm vitest run src/app/settings` → FAIL.
- [ ] **Step 3 :** implémenter.
- [ ] **Step 4 :** `pnpm vitest run src/app/settings` → PASS, puis `pnpm lint` → propre.
- [ ] **Step 5 :** commit `feat(themes): theme editor with live preview, import and export`.

### Task 7 : `keybindings.json` (Rust)

**Files:**
- Create: `crates/tilde-config/src/keybindings.rs`, `crates/tilde-config/tests/keybindings.rs`, `src-tauri/src/commands/keybindings.rs`, `src/ipc/keybindings.ts`
- Modify: `crates/tilde-config/src/{lib.rs,paths.rs,watch.rs}`, `crates/tilde-config/src/bin/gen-schema.rs`, `scripts/gen-types.mjs`, `src-tauri/src/{lib.rs,state.rs,commands/mod.rs}`, `schemas/`, `src/ipc/generated/keybindings.ts`

**Interfaces:**
- Produces (Rust) :
  - Format :
    ```json
    { "$schema": "./keybindings.schema.json", "version": 1,
      "bindings": { "tab.new": "Ctrl+Alt+T", "pane.close": null } }
    ```
    Seuls les **écarts** aux défauts y figurent : une chaîne remplace le raccourci, `null` le retire.
  - `KEYBINDINGS_VERSION = 1`.
  - `#[serde(default, rename_all = "camelCase")] pub struct KeybindingsFile { pub version: u32, pub bindings: BTreeMap<String, Option<String>> }`.
  - `ConfigPaths::keybindings_file()` et `keybindings_schema_file()`.
  - `KeybindingsStore` sur le modèle de `ConnectionsStore` (seul écrivain, `disk_hash`, lecture seule si le fichier est inutilisable, `$schema` en tête) :
    - `load(paths) -> (Self, Option<ConfigError>)` ;
    - `file()`, `read_only()` ;
    - `reload_from_disk() -> Result<bool, ConfigError>` ;
    - `set(command: &str, binding: Option<String>) -> Result<(), ConfigError>` ;
    - `reset(command: Option<&str>) -> Result<(), ConfigError>` : `None` → tout réinitialiser.
  - Validation par `set` et au chargement :
    - id de commande `^[A-Za-z0-9._-]{1,64}$` ;
    - raccourci de 1 à 64 caractères, sans caractère de contrôle ;
    - au plus 500 entrées.
    
    Au chargement, une entrée invalide est **retirée en mémoire** et signalée par `warnings() -> Vec<String>`. Rust ne connaît pas les commandes (plugins à venir) : le front valide la syntaxe fine.
  - `keybindings_schema() -> Value`. `gen-schema` écrit `schemas/keybindings.schema.json` ; `gen-types.mjs` génère `src/ipc/generated/keybindings.ts` (`KeybindingsFile`).
  - Commandes Tauri :
    - `keybindings_get() -> KeybindingsSnapshot { bindings, readOnly, error: Option<ConfigErrorDto>, warnings }` ;
    - `keybindings_set(command, binding: Option<String>)` ;
    - `keybindings_reset(command: Option<String>)` ;
    - `open_keybindings_file()` : crée le fichier `{ version, bindings: {} }` s'il manque ;
    - événements `keybindings://changed` (snapshot) et `keybindings://error` ;
    - le watcher envoie `ConfigFile::Keybindings` → `on_keybindings_file_changed`.
- Produces (TS, `src/ipc/keybindings.ts`) : `keybindingsGet()`, `keybindingsSet(command, binding | null)`, `keybindingsReset(command?)`, `openKeybindingsFile()`, `onKeybindingsChanged(cb)`, `onKeybindingsError(cb)`, type `KeybindingsSnapshot`.

- [ ] **Step 1 :** tests `tests/keybindings.rs` :
  - `missing_file_means_no_overrides` ;
  - `set_and_reset_roundtrip` (le fichier ne contient que les écarts ; `reset(None)` vide `bindings`) ;
  - `null_unbinds` ;
  - `invalid_entries_are_dropped_with_warnings` (id `"../x"`, raccourci de 200 caractères) ;
  - `broken_file_is_read_only_and_untouched` ;
  - `self_write_is_not_a_change`.
  
  Dans `watch.rs` : `keybindings_change_is_reported`. Ajouter un snapshot insta du schéma.
- [ ] **Step 2 :** `cargo test -p tilde-config --test keybindings` → FAIL.
- [ ] **Step 3 :** implémenter, puis les commandes Tauri et le câblage (state, watcher, `generate_handler!`).
- [ ] **Step 4 :** lancer `cargo test -p tilde-config` → PASS ; `pnpm gen:types` → fichiers générés ; `cargo clippy --workspace --all-targets -- -D warnings` → propre.
- [ ] **Step 5 :** commit `feat(config): keybindings.json with overrides, schema and hot reload`.

### Task 8 : Moteur de raccourcis dynamique (front)

**Files:**
- Create: `src/stores/keybindings.ts`, `src/stores/keybindings.test.ts`
- Modify: `src/terminal/keys.ts`, `src/terminal/keys.test.ts`, `src/terminal/keyLabels.ts`, `src/terminal/keyLabels.test.ts`, `src/app/useShortcuts.ts`, `src/terminal/TerminalView.tsx`, `src/commands/{registry.ts,builtin.ts}`, `src/app/{CommandPalette.tsx,Welcome.tsx}`, `src/App.tsx`

**Interfaces:**
- Consumes : `src/ipc/keybindings.ts` (Task 7).
- Produces :
  - `keys.ts` :
    - `DEFAULT_KEYBINDINGS: Readonly<Record<string, string>>` : mêmes 17 entrées. Le type `CommandId` est retiré, `Command.keybinding` disparaît.
    - `parseBinding(s: string): Binding | null`.
      - Syntaxe : modificateurs `Ctrl`, `Alt`, `Shift` (ordre libre en entrée), puis une touche parmi : `A`–`Z`, `0`–`9`, `F1`–`F24`, `` ` `` `-` `=` `[` `]` `\` `;` `'` `,` `.` `/`, `ArrowLeft/Right/Up/Down`, `Tab`, `Enter`, `Escape`, `Space`, `Backspace`, `Delete`, `Insert`, `Home`, `End`, `PageUp`, `PageDown`.
      - `null` si la syntaxe est invalide.
    - `formatBinding(b: Binding): string` : forme canonique `Ctrl+Alt+Shift+<Touche>`.
    - `type BindingTable = ReadonlyMap<string, Binding>`, construite par `compileBindings(effective: Record<string, string | null>): BindingTable`.
    - `matchShortcut(e, table: BindingTable, mac?): string | null` : mêmes règles qu'aujourd'hui (lettres par caractère, le reste par code puis par caractère, Ctrl = ⌘ sous macOS).
    - `eventToBinding(e: KeyEventLike): string | null` : `null` pour une touche de modification seule. Lettres par `e.key`, sinon par `e.code`.
    - `requiresModifier(b: Binding): boolean` : vrai sauf pour F1–F24.
  - `useKeybindings` (zustand) :
    - `{ overrides: Record<string, string | null>; effective: Record<string, string | null>; table: BindingTable; invalid: string[]; readOnly: boolean; init(): Promise<() => void>; set(command: string, binding: string | null): Promise<void>; reset(command?: string): Promise<void> }` ;
    - `effective` = défauts + écarts. Un écart dont `parseBinding` échoue est ignoré : on garde le défaut, et l'écart rejoint `invalid` avec un toast « keybindings.json : raccourci invalide pour tab.new ».
  - `bindingOf(commandId: string): string | null` : lit `useKeybindings.getState().effective`.
  - `useShortcuts` et le gestionnaire de `TerminalView` appellent `matchShortcut(e, useKeybindings.getState().table)` : lecture à chaque frappe, sans abonnement React.
  - `keyLabels.ts` : `bindingKeys(binding: string): string[]` et `resolveKeyLabels(bindings: string[], keyboard?)` travaillent sur des chaînes.
  - La palette et l'accueil affichent `bindingOf(id)`, ou rien si la commande n'a pas de raccourci.

- [ ] **Step 1 :** tests :
  - `keys.test.ts` : les tests existants sont adaptés à `compileBindings(DEFAULT_KEYBINDINGS)`, plus :
    - `parse/format roundtrip canonicalises modifier order` ;
    - `rejects unknown keys` ;
    - `eventToBinding records letters by character and symbols by physical key` (AZERTY : `key ')'`, `code 'Minus'` + Alt+Shift → `'Alt+Shift+-'`) ;
    - `an unbound command no longer matches`.
  - `stores/keybindings.test.ts` :
    - `overrides replace defaults` ;
    - `invalid entries keep defaults and are reported` ;
    - `null unbinds` ;
    - `updates on keybindings://changed`.
- [ ] **Step 2 :** `pnpm vitest run src/terminal/keys src/stores/keybindings` → FAIL.
- [ ] **Step 3 :** implémenter, puis migrer les consommateurs (`grep -rn "CommandId\|DEFAULT_KEYBINDINGS\|bindingKeys" src` doit ne renvoyer que les usages prévus). `App.tsx` initialise le store avant d'afficher le shell. En cas d'échec, les défauts s'appliquent et l'erreur va dans la console.
- [ ] **Step 4 :** `pnpm test` → PASS (dont `useShortcuts.test.ts`, `CommandPalette.test.tsx` et `TerminalView.test.tsx` adaptés), puis `pnpm typecheck` → propre.
- [ ] **Step 5 :** commit `feat(shortcuts): effective bindings from keybindings.json drive every shortcut`.

### Task 9 : Éditeur de raccourcis (UI)

**Files:**
- Create: `src/app/settings/ShortcutsSection.tsx`, `src/app/settings/ShortcutRecorder.tsx`, `src/app/settings/ShortcutsSection.test.tsx`
- Modify: `src/app/useShortcuts.ts` (aucun raccourci pendant un enregistrement)

**Interfaces:**
- Consumes : `useKeybindings`, `eventToBinding`, `parseBinding`, `requiresModifier` (Task 8), `listCommands()` (registry), `bindingKeys` / `resolveKeyLabels`.
- Produces :
  - `ShortcutsSection` :
    - un tableau groupé par `Command.group`, commandes cachées incluses, avec un filtre texte ;
    - chaque ligne montre le titre, les touches (`bindingKeys`) et un badge « modifié » si un écart existe ;
    - actions par ligne : « Modifier » (ouvre `ShortcutRecorder`), « Retirer » (`set(id, null)`) et « Réinitialiser » (`reset(id)`) ;
    - « Tout réinitialiser » passe par `confirmAction`, et « Ouvrir keybindings.json » est disponible ;
    - le tout est désactivé si `readOnly`.
  - `ShortcutRecorder({ label: string; onRecord(binding: string): void; onCancel(): void; conflictOf?: (binding: string) => string | null })`, réutilisé pour le raccourci Quake (Task 12) :
    - capture `keydown` en phase capture et appelle `preventDefault()` ;
    - `Échap` sans modificateur annule ;
    - refus avec message pour une touche sans modificateur (sauf F1–F24) : « Ajoutez Ctrl ou Alt : une touche seule casserait la saisie dans le terminal » ;
    - si `conflictOf` renvoie un titre → « Déjà utilisé par « Nouvel onglet » », avec les choix « Remplacer » et « Annuler ». Dans `ShortcutsSection`, « Remplacer » donne `null` à l'autre commande, puis le raccourci à la commande éditée.
  - `useUi.recordingShortcut: boolean` : `useShortcuts` ignore tout raccourci tant qu'il est vrai.

- [ ] **Step 1 :** tests `ShortcutsSection.test.tsx` :
  - `records a new binding` (`set('tab.new', 'Ctrl+Alt+N')`) ;
  - `refuses a binding without modifier` ;
  - `shows the conflicting command and can replace it` ;
  - `reset restores the default` ;
  - `app shortcuts are paused while recording` (`runCommand` non appelé).
- [ ] **Step 2 :** `pnpm vitest run src/app/settings/Shortcuts` → FAIL.
- [ ] **Step 3 :** implémenter.
- [ ] **Step 4 :** `pnpm vitest run src/app` → PASS.
- [ ] **Step 5 :** commit `feat(shortcuts): shortcut editor with recording, conflicts and reset`.

### Task 10 : Transparence et effets de fenêtre

**Files:**
- Create: `src-tauri/src/window_effects.rs`, `src/themes/opacity.ts`, `src/themes/opacity.test.ts`, `src/ipc/window.ts`
- Modify: `src-tauri/Cargo.toml` (`[target.'cfg(windows)'.dependencies] windows-version = "0.1"`), `src-tauri/tauri.conf.json` (`"transparent": true` sur `main`, `"macOSPrivateApi": true` dans `app`), `src-tauri/src/{lib.rs,commands/mod.rs}`, `src/App.tsx`, `src/terminal/{createTerminal.ts,TerminalView.tsx}`, `src/styles/globals.css`, `src/app/capabilities.test.ts` si nécessaire

**Interfaces:**
- Produces (Rust) :
  - `#[derive(Clone, Copy, Debug, PartialEq, Eq)] pub enum Platform { Windows { build: u32 }, MacOs, Linux }` et `Platform::current()`.
  - `#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)] #[serde(rename_all = "camelCase")] pub enum AppliedEffect { None, Mica, Acrylic, Vibrancy }`.
  - `effect_plan(effect: WindowEffect, platform: Platform) -> AppliedEffect` :
    - Mica : Windows build ≥ 22000 seulement, sinon Acrylic sous Windows 10 (build ≥ 17763), sinon None ;
    - Acrylic : Windows ≥ 17763 ;
    - Vibrancy : macOS seulement ;
    - tout autre cas → None.
  - Commande `window_apply_effects(window: WebviewWindow, dark: bool) -> AppliedEffect` : lit `settings.appearance.window.effect` et applique `set_effects` avec, pour chaque effet :
    - Mica → `MicaDark` ou `MicaLight` selon `dark` ;
    - Acrylic → `Acrylic` ;
    - Vibrancy → `UnderWindowBackground` avec `state: FollowsWindowActiveState` ;
    - None → `set_effects(None)`.
    
    Une erreur de `set_effects` est loggée et renvoie `None`.
- Produces (TS) :
  - `windowApplyEffects(dark: boolean): Promise<AppliedEffect>` ;
  - `useAppliedEffect` (petit store) : `{ applied: AppliedEffect }` ;
  - l'alpha des fonds vaut `appearance.window.opacity`, quel que soit l'effet appliqué ;
  - `withAlpha(hex: string, alpha: number): string` → `#RRGGBBAA`, `alpha = 1` → inchangé.
  - Application :
    - `App` appelle `windowApplyEffects(theme.kind === 'dark')` quand l'effet ou le thème change, puis pose `--tilde-bg-alpha` sur `<html>` ;
    - `globals.css` : `body { background: color-mix(in srgb, var(--tilde-bg) calc(var(--tilde-bg-alpha) * 100%), transparent) }`, et de même pour sidebar et barre de titre ;
    - xterm : `allowTransparency: alpha < 1` et `theme.background = withAlpha(bg, alpha)`.

- [ ] **Step 1 :** tests :
  - Rust (`window_effects.rs`) : `effect_plan_falls_back_per_platform`, table complète :
    - (Mica, Win 22631) → Mica ;
    - (Mica, Win 19045) → Acrylic ;
    - (Mica, Win 17000) → None ;
    - (Vibrancy, Win) → None ;
    - (Vibrancy, macOS) → Vibrancy ;
    - (Mica, Linux) → None ;
    - (None, *) → None.
  - TS : `opacity.test.ts` → `withAlpha('#0B0E14', 0.8) === '#0B0E14CC'` ; `withAlpha(x, 1) === x` ; et `terminal theme gets transparent background below 1` via `toXtermTheme` + `withAlpha`.
- [ ] **Step 2 :** `cargo test -p tilde window_effects` et `pnpm vitest run src/themes/opacity` → FAIL.
- [ ] **Step 3 :** implémenter. L'effet est appliqué par la commande Rust : aucune permission `set-effects` n'est ajoutée au front.
  - Vérifier que `pnpm tauri build --debug --no-bundle` compile, **sans lancer** l'app.
- [ ] **Step 4 :** `cargo test --workspace --exclude tilde` (rappel CI), `cargo test -p tilde` et `pnpm test` → PASS.
- [ ] **Step 5 :** commit `feat(window): Mica, Acrylic, vibrancy and background opacity`.

### Task 11 : Mode Quake

**Files:**
- Create: `src-tauri/src/quake.rs`, `src/app/quake.ts`, `src/app/quake.test.tsx`
- Modify: `src-tauri/Cargo.toml` (`tauri-plugin-global-shortcut = "2"`), `src-tauri/src/{lib.rs,commands/settings.rs}`, `src-tauri/capabilities/default.json` (`"windows": ["main", "quake"]`, `core:window:allow-hide`), `src/main.tsx`, `src/App.tsx`, `src/app/AppShell.tsx`, `src/app/capabilities.test.ts`

**Interfaces:**
- Produces (Rust, `quake.rs`) :
  - `to_accelerator(binding: &str) -> Result<String, String>` : syntaxe Tilde → syntaxe `global-hotkey`, validée par `Shortcut::from_str`.
    - `Ctrl` → `CommandOrControl`, `Alt` → `Alt`, `Shift` → `Shift` ;
    - touches : `A` → `KeyA`, `1` → `Digit1`, `` ` `` → `Backquote`, `-` → `Minus`, `=` → `Equal`, `F5` → `F5`, flèches et noms identiques ;
    - erreur en français pour une chaîne vide, une touche inconnue ou l'absence de modificateur (sauf F-keys).
  - `QUAKE_LABEL = "quake"`, `QUAKE_HEIGHT_RATIO = 0.4`.
  - `quake_geometry(monitor_pos: (i32, i32), monitor_size: (u32, u32)) -> (i32, i32, u32, u32)` : pleine largeur, 40 % de hauteur, ancrée en haut.
  - `sync_quake(app: &AppHandle, quake: &Quake)` :
    - désenregistre le raccourci précédent (mémorisé dans `AppState.quake_shortcut: Mutex<Option<Shortcut>>`) ;
    - si `enabled`, enregistre le nouveau ; en cas d'échec, `tracing::warn` et émission de `quake://error` avec le message (« Raccourci Quake indisponible : … ») ;
    - si désactivé, détruit la fenêtre `quake` si elle existe.
    
    Appelée au démarrage et depuis `apply_live`, seulement quand `general.quake` a changé.
  - `toggle_quake(app)` :
    - crée la fenêtre à la demande (`WebviewWindowBuilder` avec l'URL `index.html?window=quake`, `decorations(false)`, `always_on_top(true)`, `skip_taskbar(true)`, `transparent(true)`, `visible(false)`) ;
    - la positionne sur le moniteur sous le curseur (`cursor_position` + `available_monitors`, sinon le moniteur principal) ;
    - visible et focalisée → `hide` ; visible mais pas focalisée → `set_focus` ; sinon → position, `show`, `set_focus`.
  - Fenêtres :
    - `CloseRequested` sur `quake` → `prevent_close` + `hide` ;
    - `Destroyed` sur `main` → `app.exit(0)` (une fenêtre Quake cachée ne garde pas l'app en vie) ;
    - `window-state` reçoit `.with_denylist(&[QUAKE_LABEL])`.
- Produces (TS) :
  - `isQuakeWindow(search = location.search): boolean`.
  - `App({ mode }: { mode: 'main' | 'quake' })` : en mode quake, ni `restoreWorkspace` ni `startPersistence` ; un onglet par défaut est ouvert au démarrage.
  - `AppShell` en mode quake :
    - ni sidebar ni barre de titre (la `TabBar` reste) ;
    - quand le dernier onglet se ferme → `getCurrentWindow().hide()`, puis un nouvel onglet par défaut est rouvert ;
    - `onCloseRequested` → `hide` sans quitter.
  - Le mode main écoute `quake://error` et affiche un toast.

- [ ] **Step 1 :** tests :
  - Rust : `to_accelerator_maps_tilde_syntax` (`Ctrl+\`` → `CommandOrControl+Backquote`, `Alt+Shift+F12`, `Ctrl+1`), `invalid_shortcut_is_an_error` (`''`, `Ctrl+Truc`, `` ` `` seul), `quake_geometry_spans_the_top_of_the_monitor` (moniteur à (-1920, 0) en 1920×1080 → (-1920, 0, 1920, 432)).
  - TS `quake.test.tsx` : `quake window shows no sidebar and does not persist`, `closing the last tab hides the window and reopens a tab`, `isQuakeWindow reads the query`.
  - `capabilities.test.ts` : la capability couvre `quake`, et aucune permission `global-shortcut` n'est exposée au front.
- [ ] **Step 2 :** `cargo test -p tilde quake` et `pnpm vitest run src/app/quake src/app/capabilities` → FAIL.
- [ ] **Step 3 :** implémenter. Le plugin est initialisé dans `lib.rs` avec `Builder::new().with_handler(...)`, qui appelle `toggle_quake` sur `ShortcutState::Pressed`.
- [ ] **Step 4 :** `cargo test -p tilde`, `cargo clippy --workspace --all-targets -- -D warnings`, `pnpm test` → PASS.
- [ ] **Step 5 :** commit `feat(window): Quake mode with a global shortcut and a top-anchored window`.

### Task 12 : Page de réglages complète et polices

**Files:**
- Create: `src/app/settings/{SettingsDialog.tsx,SettingsDialog.test.tsx,fields.tsx,AppearanceSection.tsx,TerminalSection.tsx,SshSection.tsx,SftpSection.tsx,GeneralSection.tsx,FontField.tsx}`, `src/themes/fonts.ts`, `src/themes/fonts.test.ts`
- Delete: `src/app/QuickSettingsDialog.tsx` (remplacé)
- Modify: `src/app/AppShell.tsx`, `src/App.tsx` (police UI), `src/styles/globals.css` (`--tilde-font-ui`), `package.json` (`@fontsource-variable/geist-mono`), `src/commands/builtin.ts` (commandes `app.settings`, `app.openKeybindingsFile` et `app.openThemesDir`)

**Interfaces:**
- Consumes : `ThemesSection` (Task 6), `ShortcutsSection` / `ShortcutRecorder` (Task 9), `useAppliedEffect` (Task 10), `useSettings().update`.
- Produces :
  - `SettingsDialog({ open, onOpenChange, section? })` : grande fenêtre modale (`sm:max-w-4xl`, 80vh), navigation à gauche entre les sections Apparence, Thèmes, Terminal, Raccourcis, SSH, SFTP et Général. La section active est mémorisée dans `useUi.settingsSection`.
  - `fields.tsx` : `Row`, `Choice` (repris de `QuickSettingsDialog`), `NumberField` (bornes du schéma, valide au blur ou sur Entrée, erreur en ligne), `SwitchField` et `TextField`.
  - **Apparence** :
    - schéma de couleurs, thème sombre et thème clair ;
    - police UI (`FontField`) et taille UI (10–20) ;
    - densité, position et largeur (180–480) de la sidebar ;
    - effet (aucun / Mica / Acrylic / vibrancy, chaque option non prise en charge étant grisée avec la mention « non pris en charge sur ce système ») ;
    - opacité : curseur de 0,30 à 1,00. Choisir un effet alors que l'opacité vaut 1 envoie aussi `opacity: 0.85` dans le même patch.
  - **Terminal** :
    - police (`FontField` : JetBrains Mono, Geist Mono, Cascadia Mono, Consolas, Fira Code, Menlo, SF Mono, DejaVu Sans Mono, ou texte libre) ;
    - taille (6–72), interligne (0,8–3), ligatures ;
    - forme du curseur et clignotement ;
    - scrollback (0–1 000 000) ;
    - profil par défaut (liste de `useProfiles`) ;
    - copie à la sélection, clic droit, confirmation de fermeture.
  - **SSH** : intervalle keepalive (0–3600 s), `keepaliveCountMax` (1–100), reconnexion auto, `confirmCloseSsh`.
  - **SFTP** : concurrence (1–16), éditeur externe (texte, avec l'aide « vide = éditeur de texte du système »). `editorMode` est affiché désactivé, avec la mention « éditeur intégré : phase 7 ».
  - **Général** :
    - restauration de session ;
    - Quake : activé + raccourci (`ShortcutRecorder` en mode valeur libre, qui écrit `general.quake.shortcut`) ;
    - boutons « Ouvrir settings.json », « Ouvrir keybindings.json », « Ouvrir le dossier des thèmes » et « Ouvrir les logs ».
  - Avertissement « fichier invalide » en tête quand `readOnly`, comme aujourd'hui.
  - `fonts.ts` : `isFontAvailable(name: string, measure: (font: string) => number): boolean`, qui compare les largeurs mesurées avec la police demandée puis avec les replis `monospace` et `serif`. `FontField` affiche « police introuvable, repli utilisé » quand c'est faux (mesure par un canvas dans l'app).
  - La police UI s'applique via `--tilde-font-ui` sur `<html>` (`body { font-family: var(--tilde-font-ui), 'Geist Variable', system-ui, sans-serif }`).

- [ ] **Step 1 :** tests `SettingsDialog.test.tsx` :
  - `every settings key has a control` : on parcourt les clés de `defaultSettings` (fixture), hors `version` et `profiles`, et chacune a un contrôle étiqueté (`data-setting="terminal.fontSize"`) ;
  - `number fields refuse out-of-range values` (fontSize 100 → erreur affichée, pas de patch) ;
  - `choosing an effect at full opacity lowers it` (patch `{ appearance: { window: { effect: 'mica', opacity: 0.85 } } }`) ;
  - `read-only settings disable every control`.
  
  Dans `fonts.test.ts` : `detects a missing font`.
- [ ] **Step 2 :** `pnpm vitest run src/app/settings/SettingsDialog src/themes/fonts` → FAIL.
- [ ] **Step 3 :** implémenter, ajouter `@fontsource-variable/geist-mono` (`pnpm add`) et l'importer dans `globals.css`. Supprimer `QuickSettingsDialog` et ses usages.
- [ ] **Step 4 :** `pnpm test`, `pnpm lint`, `pnpm typecheck` → PASS.
- [ ] **Step 5 :** commit `feat(settings): full settings page covering every setting`.

### Task 13 : Ligatures

**Files:**
- Create: `src/terminal/ligatures.ts`, `src/terminal/ligatures.test.ts`
- Modify: `src/terminal/{createTerminal.ts,TerminalView.tsx}`

**Interfaces:**
- Produces :
  - `LIGATURES: readonly string[]` : séquences de JetBrains Mono / Fira Code, triées de la plus longue à la plus courte. Par exemple `<!--`, `===`, `!==`, `<=>`, `->`, `=>`, `<-`, `<=`, `>=`, `==`, `!=`, `::`, `&&`, `||`, `++`, `//`, `/*`, `*/`, `..`, `...`, `|>`, `<|`, `>>`, `<<`, `??`, `?.`, `:=`, `www`.
  - `ligatureRanges(text: string): [number, number][]` : plages `[début, fin)` sans chevauchement, la plus longue séquence gagnant à chaque position.
  - `enableLigatures(term: Terminal): () => void` : `term.registerCharacterJoiner(ligatureRanges)` ; la fonction renvoyée appelle `deregisterCharacterJoiner`.
  - `TerminalView` active ou retire le joiner quand `settings.terminal.ligatures` change. Le joiner n'agit qu'avec le rendu WebGL ; le rendu DOM reste sans ligatures (noté dans le commentaire de `createTerminal`).

- [ ] **Step 1 :** tests : `ligatureRanges('a => b !== c')` → `[[2, 4], [7, 10]]` ; `'a ->> b'` → la plus longue séquence connue ; `'->'.repeat(3)` → 3 plages contiguës ; `''` → `[]`.
- [ ] **Step 2 :** `pnpm vitest run src/terminal/ligatures` → FAIL.
- [ ] **Step 3 :** implémenter.
- [ ] **Step 4 :** `pnpm vitest run src/terminal` → PASS.
- [ ] **Step 5 :** commit `feat(terminal): render ligatures through a character joiner`.

### Task 14 : Documentation et fin de phase

**Files:**
- Create: `docs/personnalisation.md`
- Modify: `README.md`, `docs/architecture.md` (si présent)

- [ ] **Step 1 :** `docs/personnalisation.md` :
  - format d'un thème `themes/<id>.json`, avec un exemple minimal limité au terminal et la liste des tokens ;
  - formats importés ;
  - format de `keybindings.json`, syntaxe des raccourcis et liste des ids de commandes ;
  - effets par plateforme ;
  - mode Quake.

  Le README pointe vers ce document ; la case de la phase 6 reste à cocher après la validation.
- [ ] **Step 2 :** vérification complète :
  - `cargo fmt --all --check` ;
  - `cargo clippy --workspace --all-targets -- -D warnings` ;
  - `cargo test --workspace` ;
  - `pnpm lint`, `pnpm typecheck`, `pnpm test` ;
  - `pnpm gen:types && git diff --exit-code schemas src/ipc/generated` ;
  - `pnpm tauri build --no-bundle`.

  Attendu : tout vert, et l'app **n'est pas lancée**.
- [ ] **Step 3 :** commit `docs: customisation guide (themes, keybindings, window effects, Quake)`.
