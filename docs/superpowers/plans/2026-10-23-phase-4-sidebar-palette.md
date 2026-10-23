# Phase 4 — Sidebar de connexions et palette : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retrouver et ouvrir ses serveurs en deux secondes : une sidebar de connexions enregistrées (dossiers, couleurs, icônes, tags, favoris, récents), les hôtes de `~/.ssh/config` en lecture seule qu'on peut « adopter », un formulaire d'édition, une recherche floue, une palette de commandes (Ctrl+Maj+P) branchée sur un `CommandRegistry` unique, et l'import/export JSON sans secrets.

**Architecture:**
- `connections.json` appartient à Rust (`tilde-config`, comme `settings.json`). Il est validé, réparé au chargement sans jamais être écrasé s'il est illisible, écrit de façon atomique et surveillé (rechargement à chaud). Il a son JSON Schema et des types TS générés.
- Le front manipule les connexions par des commandes Tauri fines et reçoit le fichier complet après chaque changement (`connections://changed`).
- Ouvrir une connexion enregistrée passe par `session_open` avec `{ kind: 'ssh', target, connectionId }`. Rust construit un `SshTarget::Custom`, résolu à travers `ssh_config` puis surchargé par les champs de la connexion.
- Côté front, un `CommandRegistry` remplace la table `APP_COMMANDS` de `useShortcuts` ; la palette `cmdk` et les raccourcis le lisent tous les deux.

**Tech Stack:** Rust (`tilde-config`, schemars 1, notify), Tauri 2 + `tauri-plugin-dialog` 2 (appelé depuis Rust uniquement), React 19, Zustand, `cmdk` 1.1, `fuzzysort` 3, `@dnd-kit` (déjà présent).

**Spec:** `docs/superpowers/specs/2026-10-23-tilde-design.md` (§4.8, §4.10, §6 phase 4). Plans précédents : phases 1 à 3.

## Global Constraints

- Tout ce qui précède reste valable (crates métier sans Tauri, aucun secret en clair sur disque ni dans les logs, commits conventionnels + `Co-Authored-By`, clippy pedantic `-D warnings`).
- Fichier `dirs::config_dir()/Tilde/connections.json` (à côté de `settings.json`), `version: 1`, écrit en temp + rename.
- `connections.json` ne contient **aucun secret** : les mots de passe et passphrases restent dans le trousseau (`dev.tilde.app`). Un champ inconnu (y compris `password`) est ignoré au chargement, jamais réécrit, jamais exporté.
- Un fichier illisible (JSON invalide, version future) n'est **jamais écrasé** : la sidebar passe en lecture seule et affiche l'erreur avec la ligne, comme pour `settings.json`.
- Recherche floue de la sidebar avec `fuzzysort` ; palette avec `cmdk`.
- Les commandes et raccourcis passent par un **unique** `CommandRegistry`, lu par la palette et par le gestionnaire de raccourcis (spec §4.8).
- Les hôtes à motifs de `ssh_config` (`*`, `?`, `!`) ne sont pas listés (`concrete_hosts`).
- Aucune nouvelle permission front : les dialogues de fichier (import/export) sont ouverts depuis Rust.
- Textes de l'UI en français.

## Review Focus

1. **`connections.json` édité à la main et cassé** (JSON invalide, types faux, ids en double, dossier inconnu, port 0, version future) → jamais écrasé ni crash ; erreur visible avec la ligne ; ce qui est réparable l'est (dossier inconnu → racine, id en double → nouvel id). Tests : Task 1 `invalid_json_is_never_overwritten`, `repairs_duplicate_ids_and_unknown_folders`, `future_version_is_read_only`.
2. **Supprimer un dossier ou une connexion utilisés par des onglets ouverts** → un dossier supprimé ne supprime pas ses connexions ; un onglet dont la connexion a disparu continue de fonctionner (il retombe sur son hôte). Tests : Task 1 `removing_a_folder_keeps_its_connections`, Task 2 `deleted_connection_falls_back_to_the_saved_target`.
3. **Import d'un fichier venant d'ailleurs** (champ `password`, ids qui collent avec les existants, doublons, entrées invalides) → aucun secret écrit, ids régénérés, doublons ignorés, compte rendu « N importées, M ignorées ». Tests : Task 1 `import_drops_unknown_fields_and_skips_duplicates`, `export_contains_no_recents_and_no_unknown_fields`.
4. **Beaucoup d'entrées, recherche avec accents et majuscules** (« Préprod » trouvé par `prepro`, recherche sur le nom, l'hôte, l'utilisateur et les tags) → résultats pertinents, sections vides masquées. Test : Task 3 `fuzzy search ignores case and accents and matches host user and tags`.
5. **Raccourcis tapés dans un champ de saisie** (renommage d'onglet, formulaire, palette) → aucune commande d'app ne se déclenche, sauf l'ouverture/fermeture de la palette ; Échap dans la palette rend le focus au terminal. Test : Task 6 `app shortcuts are ignored while typing in a field, except the palette`.

---

### Task 1 : `tilde-config` — modèle et store de `connections.json`

**Files:**
- Create: `crates/tilde-config/src/connections.rs`, `crates/tilde-config/tests/connections.rs`
- Modify: `crates/tilde-config/src/lib.rs`, `src/paths.rs` (`connections_file()`), `Cargo.toml` (dépendance `tilde-ssh-config` pour valider `proxyJump`), `src/bin/gen-schema.rs` (écrit aussi `schemas/connections.schema.json`), `scripts/gen-types.mjs` (génère aussi `src/ipc/generated/connections.ts`)

**Interfaces:**
- Produces :
  - `pub struct ConnectionsFile { pub version: u32, pub folders: Vec<Folder>, pub connections: Vec<Connection>, pub recents: Vec<Recent> }` (serde camelCase, `JsonSchema`, `Default` = version 1, listes vides)
  - `pub struct Folder { pub id: String, pub name: String, pub color: Option<String> }` (un seul niveau de dossiers)
  - `pub struct Connection { pub id: String, pub name: String, pub host: String, pub port: Option<u16>, pub user: Option<String>, pub identity_file: Option<String>, pub proxy_jump: Option<String>, pub forward_agent: Option<bool>, pub folder_id: Option<String>, pub color: Option<String>, pub icon: Option<String>, pub tags: Vec<String>, pub favorite: bool }` — `host` est un alias de `ssh_config` ou un nom/IP.
  - `pub struct Recent { pub key: String, pub label: String, pub at: u64 }` — `key` = `conn:<id>` ou `ssh:<cible tapée>`, `at` en secondes Unix ; au plus `MAX_RECENTS = 10`, le plus récent en tête, sans doublon de `key`.
  - `pub const ICONS: &[&str] = &["server", "database", "cloud", "globe", "terminal", "box", "cpu", "shield", "house", "rocket"]` ; une icône inconnue devient `None`.
  - `pub struct ConnectionsStore` : `load(paths: ConfigPaths) -> (Self, Option<ConfigError>)`, `file(&self) -> &ConnectionsFile`, `read_only(&self) -> bool`, `reload_from_disk(&mut self) -> Result<bool, ConfigError>` (true si changé), `upsert_connection(c: Connection) -> Result<Connection, ConfigError>` (id vide → nouvel id), `remove_connection(id)`, `upsert_folder(f: Folder) -> Result<Folder, ConfigError>`, `remove_folder(id)` (ses connexions passent à la racine), `record_recent(key, label)`, `import(text: &str) -> Result<ImportReport, ConfigError>`, `export(&self) -> String`.
  - `pub struct ImportReport { pub imported: usize, pub skipped: usize }`
  - `pub fn new_id() -> String` (16 caractères hexadécimaux, sans dépendance supplémentaire : temps + compteur + hachage).
  - `ConfigError::Invalid { field, message }` réutilisé pour la validation.
- Règles de validation (refus avec `ConfigError::Invalid` sur upsert ; au chargement : réparation + `tracing::warn`) :
  - `name` non vide après trim, au plus 100 caractères ;
  - `host` non vide, sans espace ;
  - `port` dans 1..=65535 ;
  - `user` sans espace ni `@` ;
  - `color` au format `#RRGGBB` ;
  - `proxyJump` accepté par `tilde_ssh_config::parse_proxy_jump` ;
  - `tags` trimés, sans doublon, sans tag vide ;
  - `folderId` inconnu → `None`.
- [ ] **Step 1 : Écrire les tests** (`tests/connections.rs`, fichiers dans un `TempDir`) :
  - `missing_file_is_an_empty_list` ;
  - `upsert_assigns_an_id_and_persists_atomically` (relu par un second `load`, pas de `.tmp` restant) ;
  - `invalid_json_is_never_overwritten` (contenu identique après `upsert`, qui renvoie une erreur `readOnly` ; `ConfigError` avec `line`) ;
  - `future_version_is_read_only` ;
  - `repairs_duplicate_ids_and_unknown_folders` (le fichier n'est réécrit qu'au prochain changement) ;
  - `rejects_invalid_fields` (port 0, host avec espace, couleur `red`, proxyJump `a,,b`) ;
  - `removing_a_folder_keeps_its_connections` ;
  - `recents_are_capped_deduplicated_and_most_recent_first` ;
  - `unknown_fields_are_dropped` (`"password": "x"` absent après réécriture) ;
  - `import_drops_unknown_fields_and_skips_duplicates` (doublon = même `host`, `user`, `port` ; ids régénérés ; dossiers fusionnés par nom ; rapport `{ imported: 2, skipped: 1 }`) ;
  - `export_contains_no_recents_and_no_unknown_fields`.
- [ ] **Step 2 → 4 :** RED, implémentation, GREEN (`cargo test -p tilde-config`).
- [ ] **Step 5 :** `pnpm gen:types` produit `schemas/connections.schema.json` et `src/ipc/generated/connections.ts` ; relancer ne produit aucun diff.
- [ ] **Step 6 : Commit** `feat(config): connections.json model, validation and store`

### Task 2 : Commandes Tauri, rechargement à chaud et ouverture d'une connexion

**Files:**
- Modify: `crates/tilde-config/src/watch.rs` (`watch_config(paths, on_change: impl Fn(ConfigFile) + Send + 'static)` avec `pub enum ConfigFile { Settings, Connections }`, remplace `watch_settings`), `crates/tilde-config/tests/watch.rs`
- Modify: `crates/tilde-ssh/src/connection.rs` (`SshTarget::Custom`)
- Create: `src-tauri/src/commands/connections.rs`
- Modify: `src-tauri/src/state.rs` (`connections: Mutex<ConnectionsStore>`), `src-tauri/src/lib.rs`, `src-tauri/src/commands/session.rs` (`OpenTarget::Ssh { target, connection_id: Option<String> }`, enregistrement du récent après `Ready`), `src-tauri/Cargo.toml` (`tauri-plugin-dialog = "2"`)

**Interfaces:**
- Consumes : Task 1 `ConnectionsStore`, `Connection`.
- Produces :
  - `SshTarget::Custom { host: String, user: Option<String>, port: Option<u16>, identity_file: Option<PathBuf>, proxy_jump: Option<String>, forward_agent: Option<bool> }`. `resolve` résout `host` à travers `ssh_config`, puis applique les champs renseignés. `identity_file` est inséré en tête de `identity_files`, avec `~` développé. `proxy_jump` remplace la chaîne (une valeur invalide est ignorée avec un `warn`).
  - Commandes :
    - `connections_get() -> ConnectionsView { file, readOnly, error: Option<ConfigErrorDto> }` ;
    - `connections_upsert(connection) -> Result<Connection, ConfigErrorDto>` ;
    - `connections_remove(id)` ;
    - `folders_upsert(folder) -> Result<Folder, ConfigErrorDto>` ;
    - `folders_remove(id)` ;
    - `connections_set_favorite(id, favorite)` ;
    - `connections_import() -> Result<Option<ImportReport>, ConfigErrorDto>` (dialogue « Ouvrir » natif ; `None` si annulé) ;
    - `connections_export() -> Result<bool, ConfigErrorDto>` (dialogue « Enregistrer sous » ; `false` si annulé).
    Chaque commande qui modifie émet `connections://changed` avec la `ConnectionsView`.
  - `session_open` : avec `connectionId`, la connexion est relue dans le store. Si elle n'existe plus, on retombe sur `target`. Le récent est enregistré une fois l'état `Ready` atteint : `conn:<id>` avec le nom, sinon `ssh:<target>`.
  - Le watcher émet `connections://changed` quand le fichier change sur disque. Une erreur de lecture émet `connections://error`.
- [ ] **Step 1 : Tests**
  - `tilde-ssh` : `custom_target_overrides_config_and_prepends_identity` (unitaire, avec `parse_str`).
  - `tilde-config` : `watch_reports_which_file_changed` (dans `tests/watch.rs`, en remplacement du test existant).
  - `src-tauri` : `deleted_connection_falls_back_to_the_saved_target` (fonction pure `ssh_target_for(store, target, connection_id) -> SshTarget`).
- [ ] **Step 2 → 4 :** RED, implémentation, GREEN (`cargo test --workspace`).
- [ ] **Step 5 : Commit** `feat(connections): tauri commands, hot reload, open a saved connection`

### Task 3 : Front — IPC, store et recherche floue

**Files:**
- Create: `src/ipc/connections.ts`, `src/stores/connections.ts`, `src/connections/search.ts`
- Test: `src/ipc/connections.test.ts`, `src/stores/connections.test.ts`, `src/connections/search.test.ts`
- Modify: `package.json` (`fuzzysort@^3`), `src/workspace/types.ts` (`SshPanel.connectionId: string | null`), `src/workspace/sanitize.ts`, `src/stores/workspace.ts` (`openSshTab(target, connectionId = null)`), `src/terminal/TerminalView.tsx` (passe `connectionId`), `src/ipc/session.ts`, `src/app/TabBar.tsx` (titre = nom de la connexion si elle existe)

**Interfaces:**
- Consumes : Task 2 commandes et événements ; types générés `src/ipc/generated/connections.ts`.
- Produces :
  - `useConnections` (Zustand) : `{ file, readOnly, error, sshHosts: SshHostEntry[], load(), save(c), remove(id), saveFolder(f), removeFolder(id), setFavorite(id, v), importFile(), exportFile() }`, abonné à `connections://changed` et `connections://error`. `sshHosts` est rechargé à `load()` et quand la fenêtre reprend le focus.
  - `openConnection(c: Connection)` dans `src/app/actions.ts` → `openSshTab(c.host, c.id)`.
  - `search(query, items: SearchItem[]) -> SearchItem[]`, avec `SearchItem = { key, label, host, user, tags, kind: 'connection' | 'sshConfig' | 'recent' }`. Utilise `fuzzysort.go` sur des clés normalisées (minuscules, sans accents via `normalize('NFD')`), et renvoie tout dans l'ordre d'origine si la requête est vide.
- [ ] **Step 1 : Tests**
  - `fuzzy search ignores case and accents and matches host user and tags` ;
  - `empty query keeps the original order` ;
  - `store applies connections://changed and exposes read-only errors` ;
  - `opening a saved connection stores its id on the ssh panel` ;
  - `an ssh panel with a connectionId survives sanitize`.
- [ ] **Step 2 → 4 :** RED, implémentation, GREEN (`pnpm test`).
- [ ] **Step 5 : Commit** `feat(connections): front-end store, ipc and fuzzy search`

### Task 4 : Sidebar

**Files:**
- Modify: `src/app/Sidebar.tsx` (devient la coquille : recherche, sections, pied « Réglages »)
- Create: `src/app/sidebar/ConnectionList.tsx`, `src/app/sidebar/ConnectionItem.tsx`, `src/app/sidebar/SshConfigSection.tsx`
- Test: `src/app/sidebar/Sidebar.test.tsx`

**Interfaces:**
- Consumes : Task 3 `useConnections`, `search`, `openConnection` ; `useSsh.setQuickConnectOpen`.
- Produces (comportement) :
  - En-tête : champ « Rechercher… » (Ctrl+F quand la sidebar a le focus) et bouton `+` (« Nouvelle connexion », « Nouveau dossier »).
  - Sections, dans cet ordre, masquées si vides : **Favoris**, **Récents** (5 au plus), un groupe repliable par **dossier** (pastille de couleur ; état replié gardé en `localStorage`), **Sans dossier**, puis **~/.ssh/config** en lecture seule (les alias déjà adoptés, c'est-à-dire avec une connexion où `host === alias` sans surcharge, sont masqués).
  - Chaque entrée affiche son icône (lucide, couleur de la connexion), son nom et `user@host` en sourdine.
    - Double-clic ou Entrée : ouvre un onglet.
    - Menu contextuel : Ouvrir, Modifier…, Dupliquer, Favori ☆/★, Déplacer vers ▸ (dossiers), Supprimer (avec confirmation).
    - Une entrée `ssh_config` propose Ouvrir et **Adopter**, qui crée une connexion `{ name: alias, host: alias }` et ouvre le formulaire.
  - Glisser-déposer (`@dnd-kit`) d'une connexion sur un dossier ou sur « Sans dossier » → `folderId` mis à jour.
  - Navigation clavier : ↑/↓ dans la liste, Entrée pour ouvrir.
  - Avec une recherche active, une liste plate de résultats remplace les sections ; « Aucun résultat » + « Se connecter à “texte” » si le texte est une cible valide.
  - En lecture seule : bandeau d'erreur (message + ligne) avec « Ouvrir le fichier », et actions d'édition désactivées.
- [ ] **Step 1 : Tests**
  - `sections are ordered and empty ones hidden` ;
  - `double click opens a tab on the saved connection` ;
  - `adopting an ssh_config host creates a connection and hides it from the section` ;
  - `search shows a flat result list and offers to connect to a typed target` ;
  - `deleting asks for confirmation` ;
  - `read-only file shows the error and disables editing`.
- [ ] **Step 2 → 4 :** RED, implémentation, GREEN.
- [ ] **Step 5 : Commit** `feat(sidebar): saved connections, folders, favorites, recents and ssh_config hosts`

### Task 5 : Formulaire de connexion et de dossier

**Files:**
- Create: `src/app/ConnectionDialog.tsx`, `src/app/FolderDialog.tsx`
- Test: `src/app/ConnectionDialog.test.tsx`
- Modify: `src/stores/connections.ts` (`editing: Connection | 'new' | null`, `editingFolder`)

**Interfaces:**
- Consumes : Task 3 `save`, `saveFolder` ; Task 1 `ICONS`, règles de validation.
- Produces :
  - `ConnectionDialog` : champs Nom, Hôte, Port, Utilisateur, Clé (chemin), ProxyJump, Transférer l'agent (oui / non / selon ssh_config), Dossier, Couleur (6 pastilles + aucune), Icône (grille de `ICONS`), Tags (saisie séparée par virgules), Favori.
    - Validation locale identique à Task 1 (messages par champ).
    - Une erreur `invalid` renvoyée par Rust s'affiche sous le champ nommé par `field`.
    - « Enregistrer » ; « Enregistrer et se connecter ».
    - Un hôte correspondant à un alias `ssh_config` affiche « Les réglages de ~/.ssh/config pour cet alias s'appliquent ; les champs remplis ici les remplacent ».
  - `FolderDialog` : Nom et Couleur.
- [ ] **Step 1 : Tests**
  - `validates fields before saving` (port 70000, hôte vide) ;
  - `shows a backend field error under that field` ;
  - `save and connect opens a tab` ;
  - `editing keeps the id and unknown values untouched`.
- [ ] **Step 2 → 4 :** RED, implémentation, GREEN.
- [ ] **Step 5 : Commit** `feat(connections): connection and folder forms`

### Task 6 : `CommandRegistry`, raccourcis et palette

**Files:**
- Create: `src/commands/registry.ts`, `src/commands/builtin.ts`, `src/terminal/terminalActions.ts`, `src/app/CommandPalette.tsx`, `src/stores/ui.ts` (ouverture des réglages et de la palette)
- Test: `src/commands/registry.test.ts`, `src/app/CommandPalette.test.tsx`, `src/app/useShortcuts.test.ts`
- Modify: `src/app/useShortcuts.ts` (lit le registry), `src/terminal/keys.ts` (`'palette.toggle': 'Ctrl+Shift+P'`), `src/terminal/TerminalView.tsx` (enregistre copier, coller et rechercher pour le panneau actif dans `terminalActions`), `src/app/AppShell.tsx` (`QuickSettingsDialog` piloté par `useUi`), `package.json` (`cmdk@^1.1`)

**Interfaces:**
- Produces :
  - `interface Command { id: string; title: string; group: 'Onglets' | 'Panneaux' | 'Terminal' | 'Connexions' | 'Application'; run: () => void; keybinding?: CommandId }`.
  - `registerCommands(cmds: Command[]): () => void`, `listCommands(): Command[]`, `runCommand(id: string): boolean`.
  - `builtin.ts` enregistre :
    - tous les `CommandId` existants (onglets, panneaux, terminal, `ssh.quickConnect`) ;
    - `palette.toggle` ;
    - `connections.new` (« Nouvelle connexion »), `connections.import` (« Importer des connexions… »), `connections.export` (« Exporter les connexions… ») ;
    - `app.settings` (« Réglages »), `app.openSettingsFile` (« Ouvrir settings.json »), `app.openLogs` (« Ouvrir le dossier des logs »).
  - `terminalActions` : `setActiveTerminal(leafId, actions: { copy, paste, search })` / `activeTerminal()`. Les commandes `terminal.*` du registry agissent sur le panneau actif.
  - `useShortcuts` : `matchShortcut(e)` → `runCommand(id)`. Si la cible est un `input`, un `textarea` ou un élément `contenteditable` (hors terminal xterm), seul `palette.toggle` passe.
  - `CommandPalette` (`cmdk`, Ctrl+Maj+P) :
    - deux groupes, **Connexions** (récents d'abord, puis connexions enregistrées et hôtes `ssh_config`, chacun « Se connecter à … ») et **Commandes** (titre + raccourci affiché via `keyLabels`) ;
    - Entrée exécute ; Échap ferme et rend le focus au terminal actif.
- [ ] **Step 1 : Tests**
  - `registry runs, lists and unregisters commands` ;
  - `every CommandId has a registered command` ;
  - `app shortcuts are ignored while typing in a field, except the palette` ;
  - `palette lists connections first and runs the chosen command` ;
  - `escape closes the palette and focuses the active terminal`.
- [ ] **Step 2 → 4 :** RED, implémentation, GREEN.
- [ ] **Step 5 : Commit** `feat(commands): command registry, shortcuts and command palette`

### Task 7 : Import/export, documentation et fin de phase

**Files:**
- Modify: `src/app/sidebar/*` (menu `+` : « Importer… », « Exporter… »), toasts de compte rendu, `README.md` (section « Connexions » et raccourci Ctrl+Maj+P), `docs/architecture.md` (section « Connexions et commandes »)

**Interfaces:**
- Consumes : Task 2 `connections_import` / `connections_export` ; Task 6 commandes `connections.import` / `connections.export`.
- Produces :
  - Import réussi : toast « N connexions importées, M ignorées (déjà présentes) ».
  - Export : toast « Connexions exportées (aucun mot de passe n'est inclus) ».
  - Les annulations ne produisent aucun toast.
- [ ] **Step 1 : Test** `import reports what was imported and skipped` (front, IPC mocké).
- [ ] **Step 2 → 4 :** RED, implémentation, GREEN.
- [ ] **Step 5 : Vérification de fin de phase**
  - `cargo test --workspace`, `cargo test -p tilde-ssh --features integration` (CI), `pnpm test`, lint, clippy, `cargo deny check`, `pnpm gen:types` sans diff.
  - Manuel (avec l'auteur) :
    - créer un dossier et deux connexions, dont une avec ProxyJump ; ouvrir par double-clic et par la palette ;
    - adopter un hôte de `~/.ssh/config` ;
    - casser `connections.json` à la main (sidebar en lecture seule, fichier intact), puis le réparer (rechargement à chaud) ;
    - exporter puis réimporter (doublons ignorés) ;
    - Ctrl+Maj+P depuis un terminal, puis Échap.
- [ ] **Step 6 : Commit** `feat(connections): import and export` puis `docs: phase 4`. Récap, puis **arrêt** pour validation.
