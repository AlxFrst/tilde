# Phase 7 — Modularité : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Les panneaux deviennent des modules et trois nouveaux arrivent.
- Le layout passe par un registre `PanelModule` documenté : c'est le contrat des futurs plugins.
- Un **éditeur** (CodeMirror 6) ouvre les fichiers distants (SFTP) et locaux.
- Un **aperçu** affiche Markdown, images et JSON.
- Un **moniteur système** suit la machine locale (`sysinfo`) ou un serveur SSH (lecture de `/proc` par `exec`).

**Architecture:**
- **Front**
  - `src/panels/registry.ts` décrit et enregistre les `PanelModule`. `PaneView`, la restauration du workspace et le libellé des onglets passent par lui ; plus aucun import direct d'un panneau depuis le layout.
  - Les modules internes sont `core.terminal`, `core.ssh`, `core.sftp`, `core.editor`, `core.preview` et `core.monitor`.
  - Éditeur et aperçu sont chargés à la demande (`React.lazy`) pour garder le démarrage sous la seconde.
- **Rust**
  - `tilde-ssh` gagne la lecture et l'écriture de texte distant avec détection de conflit, ainsi qu'un `exec` borné.
  - Un nouveau crate pur, `tilde-monitor`, échantillonne la machine locale et parse les sorties `/proc` distantes. Il est testable sans Tauri.
  - Les commandes Tauri `editor_*`, `preview_*` et `monitor_*` relient le tout. Les fichiers locaux ne s'ouvrent que par un dialogue natif : le front ne peut jamais désigner lui-même un chemin local.

**Tech Stack:** CodeMirror 6 (`@codemirror/*`, langages officiels et `@codemirror/legacy-modes`), `markdown-it` (HTML désactivé), `sysinfo` 0.37 (déjà dans le workspace), russh `exec`, React.lazy.

**Spec:** `docs/superpowers/specs/2026-10-23-tilde-design.md` (§3 « Édition de fichiers distants », §4.8 registre, §4.10, §6 phase 7). Plans précédents : phases 1 à 6.

## Global Constraints

- Tout ce qui précède reste valable :
  - crates métier sans Tauri ;
  - aucun secret sur disque ni dans les logs ;
  - commits conventionnels + `Co-Authored-By` ;
  - clippy pedantic `-D warnings` ;
  - textes de l'UI en français ;
  - `pnpm gen:types` à jour ;
  - aucun plugin `fs` ni `shell`, aucune nouvelle permission côté front ;
  - CSP inchangée (`img-src 'self' data: blob:` suffit pour les images).
- Interface du registre (spec §4.8), à reprendre telle quelle et à compléter :
  ```ts
  interface PanelModule<S = unknown> {
    id: string; title: string; icon: LucideIcon;
    component: React.ComponentType<PanelProps<S>>;
    commands?: CommandContribution[];
    settings?: SettingsContribution;
    serialize?(s: S): unknown; deserialize?(raw: unknown): S;
  }
  ```
- Éditeur : choix par défaut = `sftp.editorMode` (`external` | `builtin`), réglage déjà présent ; l'option « Éditeur intégré » devient active.
- Plafonds :
  - texte ouvert dans l'éditeur ≤ **5 Mio** ;
  - image en aperçu ≤ **20 Mio** ;
  - sortie d'`exec` pour le moniteur ≤ **1 Mio**, délai **10 s**.
- Un fichier non UTF-8 (binaire) est refusé par l'éditeur, avec la proposition de l'ouvrir dans l'éditeur externe.
- Le moniteur interroge toutes les **2 s**, uniquement pour un panneau visible. Le moniteur distant ne vise que Linux ; ailleurs, il affiche un message clair.
- Démarrage < 1 s : éditeur, aperçu et `markdown-it` ne font pas partie du bundle initial.

## Review Focus

1. **Fichier distant modifié entre l'ouverture et l'enregistrement** (autre personne, `git pull`) : l'enregistrement est refusé et l'utilisateur choisit entre « Écraser » et « Recharger ». Rien n'est écrasé en silence. Tests : Task 2 `save_refuses_a_changed_remote_file` (banc Docker) et Task 4 `a conflict on save asks before overwriting`.
2. **Fichier binaire, énorme ou non UTF-8 ouvert dans l'éditeur** : message clair, pas de gel, et proposition de l'éditeur externe. Tests : Task 2 `decode_text_refuses_binary_and_large`, Task 4 `a binary file shows a message instead of the editor`.
3. **Markdown hostile** (`<script>`, `<img onerror>`, liens `javascript:` ou `file:`) : rien ne s'exécute, et seuls les liens http(s) s'ouvrent, dans le navigateur. Test : Task 5 `markdown never renders raw HTML or unsafe links`.
4. **Fermer un panneau, un onglet ou la fenêtre avec un éditeur non enregistré** : confirmation explicite, et rien n'est perdu sans accord. Test : Task 4 `closing a dirty editor asks first`.
5. **Moniteur sur un hôte non Linux, ou connexion perdue** : un message, l'interrogation ralentit, pas de pluie de toasts. Tests : Task 6 `non_linux_output_is_a_clear_error`, Task 7 `a failing remote monitor backs off and shows one message`.

---

### Task 1 : Registre de panneaux (`PanelModule`)

**Files:**
- Create: `src/panels/registry.ts`, `src/panels/registry.test.ts`, `src/panels/core.tsx` (enregistrement des modules internes), `docs/panneaux.md`
- Modify: `src/workspace/types.ts`, `src/workspace/sanitize.ts`, `src/app/PaneView.tsx`, `src/app/TabBar.tsx` (libellé et icône via le module), `src/main.tsx` (enregistrement au démarrage), tests existants touchés (`PaneView.test.tsx`, `persistence.test.ts`)

**Interfaces:**
- Produces :
  ```ts
  interface PanelProps<S> {
    tabId: string; leafId: string; state: S; active: boolean;
    update(patch: Partial<S>): void;  // applique au panneau du layout
    close(): void;
  }
  interface PanelModule<S = unknown> {
    id: string;                 // "core.editor"
    kind: S extends { kind: infer K } ? K : string;  // clé dans le layout
    title: string; icon: LucideIcon;
    component: ComponentType<PanelProps<S>>;
    /** Libellé d'onglet ; défaut : title. */
    tabTitle?(s: S): string;
    commands?: Command[];       // enregistrées avec le module
    settings?: SettingsContribution;  // { section: string; render: ComponentType } (réservé)
    /** null : le panneau n'est pas sauvegardé (et disparaît à la restauration). */
    serialize?(s: S): unknown | null;
    /** null : donnée inutilisable, la feuille est retirée. */
    deserialize?(raw: unknown): S | null;
  }
  registerPanel<S>(m: PanelModule<S>): () => void;  // remplace par kind ; retourne le désenregistrement
  getPanelModule(kind: string): PanelModule | undefined;
  listPanelModules(): PanelModule[];
  registerCorePanels(): void;  // core.tsx : terminal, ssh, sftp (+ editor, preview, monitor dans leurs tâches)
  ```
- `Panel` (types.ts) reste une union typée ; elle s'élargit à chaque tâche (`EditorPanel`, `PreviewPanel`, `MonitorPanel`).
- `PanelPatch` devient `Partial<Panel>` sans `kind`.
- `sanitizePanel` délègue à `getPanelModule(raw.kind)?.deserialize`. Une `kind` inconnue est retirée.
- La sauvegarde du workspace applique `serialize` ; une feuille `null` est retirée de l'arbre sauvegardé.
- Les commandes déclarées dans `commands` sont enregistrées dans le `CommandRegistry` par `registerPanel` et retirées au désenregistrement.

- [ ] **Step 1 :** tests dans `registry.test.ts` :
  - `registers, finds and unregisters a module` ;
  - `a module's commands join the command registry while it is registered` ;
  - `unknown kinds are dropped at restore` (`sanitizeSnapshot` avec `kind: 'nope'`) ;
  - `a module can refuse to be saved` (serialize → null : la feuille disparaît du snapshot sauvegardé, l'arbre reste valide).
  
  Dans `PaneView.test.tsx` : `renders a pane through its module` (module de test `kind: 'test'`).
- [ ] **Step 2 :** `pnpm vitest run src/panels src/app/PaneView src/workspace` → FAIL.
- [ ] **Step 3 :** implémenter et migrer `terminal`, `ssh` et `sftp` en modules. Le `deserialize` de chacun reprend la logique actuelle de `sanitizePanel` ; les props spécifiques (`onExit`, `onTitle`…) passent par `update`/`close`.
- [ ] **Step 4 :** `pnpm test` → PASS. `grep -rn "panels/sftp\|TerminalView" src/app/PaneView.tsx` → aucun résultat.
- [ ] **Step 5 :** `docs/panneaux.md` : le contrat, le cycle de vie (`serialize`/`deserialize`, `update`, `close`), un exemple de module minimal, et ce qui reste privé (pas de chargement de plugins tiers au MVP).
- [ ] **Step 6 :** commit `refactor(panels): a PanelModule registry drives the layout`.

### Task 2 : Lecture et écriture de texte distant et local (Rust)

**Files:**
- Create: `crates/tilde-ssh/src/textfile.rs`, `src-tauri/src/commands/editor.rs`, `src/ipc/editor.ts`
- Modify: `crates/tilde-ssh/src/{lib.rs,sftp.rs}`, `crates/tilde-ssh/tests/sftp.rs` (`integration`), `src-tauri/src/{lib.rs,state.rs,commands/mod.rs}`

**Interfaces:**
- Produces (`tilde-ssh`) :
  - `pub const TEXT_MAX_BYTES: u64 = 5 * 1024 * 1024;` et `pub const PREVIEW_MAX_BYTES: u64 = 20 * 1024 * 1024;`.
  - `pub enum TextError { TooLarge { size: u64, max: u64 }, Binary, Conflict { current: Stamp }, Sftp(SftpError), Io(String) }`, avec un `Display` en français :
    - `TooLarge` → « fichier trop volumineux pour l'éditeur (… Mio au plus) » ;
    - `Binary` → « fichier binaire ou non UTF-8 : ouvrez-le avec l'éditeur externe ».
  - `pub fn decode_text(bytes: Vec<u8>, max: u64) -> Result<String, TextError>` : refuse au-delà de `max`, refuse un octet NUL dans les 8 premiers Kio, sinon UTF-8 strict. Un BOM UTF-8 est retiré.
  - `SftpClient::read_text(path) -> Result<(String, Stamp), TextError>` : `stat` d'abord (refus avant téléchargement si trop gros), puis lecture et `decode_text`.
  - `SftpClient::write_text(path, text, expected: Option<Stamp>) -> Result<Stamp, TextError>` : `Conflict` si le `stamp` actuel diffère de `expected` ; écriture en place, ce qui garde les permissions (comme `push`) ; renvoie le nouveau `Stamp`.
  - `SftpClient::read_bytes(path, max) -> Result<Vec<u8>, TextError>`.
  - Les mêmes opérations côté local : `read_local_text(path) -> Result<(String, Stamp), TextError>`, `write_local_text(path, text, expected) -> Result<Stamp, TextError>` (stamp = taille + mtime en secondes ; écriture tmp + rename) et `read_local_bytes(path, max)`.
- Produces (Tauri, `commands/editor.rs`) :
  - `editor_open_remote(session_id, path) -> OpenedText { text, stamp: StampDto }` et `editor_save_remote(session_id, path, text, expected: Option<StampDto>, force: bool) -> StampDto`. Avec `force`, `expected` est ignoré.
  - `editor_open_local() -> Option<LocalOpened { doc_id: u32, name, text, stamp }>` : dialogue natif. Le chemin reste côté Rust, dans `AppState.local_docs: Mutex<HashMap<u32, PathBuf>>`.
  - `editor_save_local(doc_id, text, expected, force) -> StampDto`.
  - `editor_close_local(doc_id)`.
  - `preview_read_remote(session_id, path) -> tauri::ipc::Response` (octets bruts, plafond `PREVIEW_MAX_BYTES`) et `preview_read_local(doc_id) -> Response`.
  - Les erreurs passent par un `EditorErrorDto { kind: "tooLarge" | "binary" | "conflict" | "notFound" | "io", message, current?: StampDto }`.
  - `StampDto { size: u64, mtime: Option<u64> }`.
- Produces (TS, `src/ipc/editor.ts`) : les wrappers `editorOpenRemote`, `editorSaveRemote`, `editorOpenLocal`, `editorSaveLocal`, `editorCloseLocal`, `previewReadRemote` (→ `ArrayBuffer`), `previewReadLocal`, ainsi que les types `Stamp`, `EditorErrorDto` et `isEditorError`.

- [ ] **Step 1 :** tests unitaires dans `textfile.rs` :
  - `decode_text_refuses_binary_and_large` (NUL → `Binary` ; `0xFF 0xFE` → `Binary` ; 5 Mio + 1 → `TooLarge` ; BOM retiré) ;
  - `local_write_detects_a_changed_file` (tempfile : lu, modifié à côté → `Conflict` ; `expected: None` → écrit) ;
  - `local_write_keeps_the_file_whole_on_conflict`.
  
  Tests du banc (`integration`) :
  - `read_and_write_text_roundtrip` ;
  - `save_refuses_a_changed_remote_file` ;
  - `write_text_keeps_permissions` (0640 conservé) ;
  - `read_text_refuses_large_files_before_downloading`.
- [ ] **Step 2 :** `cargo test -p tilde-ssh textfile` → FAIL (module absent).
- [ ] **Step 3 :** implémenter, puis les commandes Tauri et leurs wrappers TS.
- [ ] **Step 4 :** `cargo test -p tilde-ssh` → PASS (le banc tourne en CI), puis `cargo clippy --workspace --all-targets -- -D warnings` → propre.
- [ ] **Step 5 :** commit `feat(ssh): read and write text files with conflict detection`.

### Task 3 : Moteur de l'éditeur (CodeMirror 6)

**Files:**
- Create: `src/panels/editor/{codemirror.ts,languages.ts,languages.test.ts,editorTheme.ts,editorTheme.test.ts}`
- Modify: `package.json` (`@codemirror/state`, `@codemirror/view`, `@codemirror/commands`, `@codemirror/language`, `@codemirror/search`, `@codemirror/autocomplete`, `@codemirror/lang-javascript`, `@codemirror/lang-json`, `@codemirror/lang-markdown`, `@codemirror/lang-python`, `@codemirror/lang-rust`, `@codemirror/lang-html`, `@codemirror/lang-css`, `@codemirror/lang-yaml`, `@codemirror/lang-xml`, `@codemirror/lang-sql`, `@codemirror/legacy-modes`)

**Interfaces:**
- Produces :
  - `languageFor(fileName: string): Promise<Extension | null>`, par extension ou nom :
    - `.ts .tsx .js .jsx .mjs .cjs` → JavaScript (avec `typescript`/`jsx` selon le cas) ;
    - `.json .jsonc` → JSON ;
    - `.md .markdown` → Markdown ;
    - `.py` → Python ; `.rs` → Rust ;
    - `.html .htm` → HTML ; `.css .scss` → CSS ;
    - `.yml .yaml` → YAML ; `.xml .svg` → XML ; `.sql` → SQL ;
    - `.sh .bash .zsh` et `.bashrc`, `.zshrc`, `.profile` → shell (legacy) ;
    - `.toml` → TOML ; `Dockerfile` → dockerfile ; `.ini .conf .cfg .env` → properties ;
    - `nginx.conf` → nginx.
    
    Chaque langage est chargé par `import()` dynamique.
  - `languageLabel(fileName): string` (« TypeScript », « Texte brut »…).
  - `editorTheme(theme: ThemeDefinition, font: { family: string; size: number }): Extension` : `EditorView.theme` construit sur les tokens UI (fond `bg`, gouttière `surface1`, sélection `selectionBackground`, curseur `cursor`), plus un `HighlightStyle` dont les couleurs viennent de l'ANSI du thème (mots-clés = magenta, chaînes = green, nombres = yellow, commentaires = brightBlack, fonctions = blue, types = cyan, propriétés = foreground).
  - `createEditor({ parent, doc, language, theme, readOnly, onChange, onSave }): EditorHandle` :
    - extensions de base : numéros de ligne, repli, historique, recherche (Ctrl+F dans l'éditeur), correspondance des crochets, indentation, `Mod-s` → `onSave` ;
    - `EditorHandle = { view, setDoc(text), setTheme(ext), setLanguage(ext|null), destroy() }` via `Compartment`.

- [ ] **Step 1 :** tests :
  - `languages.test.ts` : `detects languages by extension and name` (une table de 15 noms → libellés attendus, dont `Dockerfile`, `.bashrc` et `README` → « Texte brut ») ;
  - `editorTheme.test.ts` : `builds an extension from any builtin theme` (14 thèmes, sans exception) et `keywords use the theme's magenta`.
- [ ] **Step 2 :** `pnpm vitest run src/panels/editor` → FAIL.
- [ ] **Step 3 :** `pnpm add` les paquets, puis implémenter.
- [ ] **Step 4 :** `pnpm vitest run src/panels/editor` → PASS, puis `pnpm build` → le chunk principal ne contient pas `@codemirror`. À vérifier dans `dist/assets` : les fichiers `*codemirror*` sont des chunks séparés, ou le chunk d'entrée ne contient pas `EditorView`.
- [ ] **Step 5 :** commit `feat(editor): CodeMirror engine with languages and Tilde theming`.

### Task 4 : Panneau éditeur

**Files:**
- Create: `src/panels/editor/{EditorPane.tsx,EditorPane.test.tsx,useDocument.ts,useDocument.test.ts,module.ts}`, `src/stores/editors.ts`
- Modify: `src/workspace/types.ts` (`EditorPanel`), `src/stores/workspace.ts` (`openEditor`), `src/panels/core.tsx`, `src/panels/sftp/SftpPanel.tsx` (« Modifier » suit `sftp.editorMode`), `src/app/settings/SftpSection.tsx` (option active), `src/app/closeGuard.ts` + `src/app/actions.ts` + `src/app/AppShell.tsx` (éditeurs non enregistrés), `src/commands/builtin.ts` (`editor.openFile`)

**Interfaces:**
- Consumes : Task 1 (`registerPanel`, `PanelProps`), Task 2 (`src/ipc/editor.ts`), Task 3 (`createEditor`, `languageFor`, `editorTheme`).
- Produces :
  - `EditorPanel = { kind: 'editor'; source: { kind: 'remote'; linkedLeafId: string; path: string } | { kind: 'local'; docId: number; name: string }; cwd: null; title: null }`.
  - Module `core.editor` (`kind: 'editor'`, icône `FileCode`) :
    - `tabTitle` = nom du fichier ;
    - `serialize` → `null` : un éditeur n'est pas restauré au redémarrage (ses modifications non enregistrées sont confirmées à la fermeture).
  - `useEditors` (zustand) : `{ dirty: Record<string /* leafId */, boolean>; setDirty(leafId, d) }`, et `dirtyEditors(leafIds: string[]): string[]` (noms des fichiers).
  - `useDocument(source, sessionId)` → `{ status: 'loading' | 'ready' | 'error'; text; error?: EditorErrorDto; save(text, force?) → Promise<'saved' | 'conflict' | 'error'>; reload() }` : il garde le `Stamp` reçu et l'envoie comme `expected`.
  - `EditorPane` (composant) :
    - barre : nom, langage, point « modifié », boutons « Enregistrer » (Ctrl+S), « Aperçu » (Markdown/JSON, Task 5) et « Ouvrir dans l'éditeur externe » (distant) ;
    - en cas de conflit : bandeau « Le fichier a changé sur le serveur » avec « Écraser » et « Recharger » ;
    - fichier binaire ou trop gros : message et bouton éditeur externe.
  - `useWorkspace.openEditor(besideLeafId: string, source)` : divise à droite du panneau donné, ou focalise un éditeur déjà ouvert sur la même source.
  - `confirmClose` compte aussi les éditeurs modifiés des feuilles concernées (fermeture de panneau, d'onglet ou de fenêtre). Message : « Modifications non enregistrées dans config.yml ».
  - Commande `editor.openFile` « Ouvrir un fichier… » (palette) → `editorOpenLocal()` → `openEditor(activeLeaf)`.

- [ ] **Step 1 :** tests :
  - `useDocument.test.ts` (ipc mocké) : `loads then saves with the stamp it read` ; `a conflict on save asks before overwriting` (save → `'conflict'`, puis `save(text, true)` envoie `force: true`) ; `reload replaces the text and the stamp`.
  - `EditorPane.test.tsx` (CodeMirror réel sous jsdom, ou `createEditor` mocké si jsdom ne suffit pas, avec une ruling) : `a binary file shows a message instead of the editor` ; `Ctrl+S saves and clears the dirty mark` ; `closing a dirty editor asks first` (via `closePane` + `ConfirmCloseDialog`).
  - `SftpPanel.test.tsx` : `Modifier opens the built-in editor when editorMode is builtin`.
- [ ] **Step 2 :** `pnpm vitest run src/panels/editor src/panels/sftp` → FAIL.
- [ ] **Step 3 :** implémenter. `EditorPane` est chargé par `React.lazy` depuis `module.ts`.
- [ ] **Step 4 :** `pnpm test` → PASS.
- [ ] **Step 5 :** commit `feat(editor): built-in editor panel for remote and local files`.

### Task 5 : Panneau aperçu (Markdown, image, JSON)

**Files:**
- Create: `src/panels/preview/{PreviewPane.tsx,PreviewPane.test.tsx,markdown.ts,markdown.test.ts,JsonTree.tsx,JsonTree.test.tsx,previewKind.ts,module.ts}`
- Modify: `package.json` (`markdown-it`, `@types/markdown-it`), `src/workspace/types.ts` (`PreviewPanel`), `src/stores/workspace.ts` (`openPreview`), `src/panels/core.tsx`, `src/panels/sftp/SftpPanel.tsx` (« Aperçu » dans le menu contextuel des fichiers pris en charge), `src/panels/editor/EditorPane.tsx` (bouton « Aperçu »), `src/stores/editors.ts` (texte courant par éditeur pour l'aperçu en direct)

**Interfaces:**
- Produces :
  - `previewKind(fileName): 'markdown' | 'image' | 'json' | null` :
    - `.md .markdown` → markdown ;
    - `.png .jpg .jpeg .gif .webp .bmp .ico .svg` → image ;
    - `.json` → json.
  - `renderMarkdown(text: string): string` : markdown-it avec `{ html: false, linkify: true }`. Le validateur de liens n'accepte que `http:`, `https:`, `mailto:` et les ancres `#…` ; les images ne sont pas chargées depuis le réseau (la CSP les bloque), et leur texte alternatif s'affiche.
  - `JsonTree({ value })` : arbre repliable (objets et tableaux), valeurs colorées par type, chemin copiable ; au-delà de 5 000 nœuds, les enfants ne sont rendus qu'à l'ouverture.
  - `PreviewPanel = { kind: 'preview'; source: { kind: 'remote'; linkedLeafId; path } | { kind: 'editor'; editorLeafId: string } | { kind: 'local'; docId; name }; cwd: null; title: null }`.
    - Module `core.preview` (`kind: 'preview'`, icône `Eye`) ; `serialize` → `null`.
    - La source `editor` suit le texte de l'éditeur en direct (debounce de 300 ms), via `useEditors.text[editorLeafId]`.
    - Les liens sont interceptés au clic ; seuls http(s) passent par `openUrl`.
    - Les images utilisent une URL `blob:` révoquée au démontage.
  - `useWorkspace.openPreview(besideLeafId, source)`.

- [ ] **Step 1 :** tests :
  - `markdown.test.ts` : `markdown never renders raw HTML or unsafe links`. Entrée : `<script>alert(1)</script>`, `<img src=x onerror=alert(1)>`, `[a](javascript:alert(1))`, `[b](file:///etc/passwd)`, `[c](https://x.dev)`. Sortie : aucune balise `<script` ni `<img` produite depuis du HTML brut, aucun `href="javascript:` ni `href="file:`, et le lien https est présent.
  - `JsonTree.test.tsx` : `renders nested values and folds` ; `invalid JSON shows the error position` (dans `PreviewPane`).
  - `PreviewPane.test.tsx` : `follows the editor text live` ; `an image is shown from a blob URL and revoked on unmount`.
- [ ] **Step 2 :** `pnpm vitest run src/panels/preview` → FAIL.
- [ ] **Step 3 :** `pnpm add markdown-it` (et `-D @types/markdown-it`), puis implémenter. Le panneau est chargé par `React.lazy`. Ajouter des styles de prose (titres, listes, code, tableaux) qui suivent les tokens du thème.
- [ ] **Step 4 :** `pnpm test` → PASS.
- [ ] **Step 5 :** commit `feat(preview): Markdown, image and JSON preview panel`.

### Task 6 : `tilde-monitor` et `exec` SSH (Rust)

**Files:**
- Create: `crates/tilde-monitor/{Cargo.toml,src/lib.rs,src/local.rs,src/remote.rs,tests/fixtures/*}`, `src-tauri/src/commands/monitor.rs`, `src/ipc/monitor.ts`
- Modify: `Cargo.toml` (workspace), `crates/tilde-ssh/src/shell.rs` (`exec`), `crates/tilde-ssh/tests/*` (`integration`), `src-tauri/{Cargo.toml,src/lib.rs,src/state.rs,src/commands/mod.rs}`, `deny.toml` si nécessaire

**Interfaces:**
- Produces (`tilde-monitor`, sans Tauri ni réseau) :
  ```rust
  #[derive(Serialize, Clone, Debug, PartialEq)] #[serde(rename_all = "camelCase")]
  pub struct Snapshot {
      pub cpu_percent: Option<f32>,        // None au premier échantillon
      pub cores: usize,
      pub mem_total: u64, pub mem_used: u64,   // octets
      pub swap_total: u64, pub swap_used: u64,
      pub load: Option<[f64; 3]>,
      pub uptime_secs: u64,
      pub net_rx_per_sec: Option<u64>, pub net_tx_per_sec: Option<u64>,
      pub disks: Vec<Disk>,                // { mount, total, used }, sans pseudo-FS
      pub host: String,
  }
  ```
  - `LocalMonitor::new()` et `sample(&mut self) -> Snapshot` : `sysinfo` (CPU, mémoire, réseau, disques, charge, uptime).
  - `pub const REMOTE_COMMAND: &str` : une seule commande POSIX qui affiche `/proc/stat`, `/proc/meminfo`, `/proc/loadavg`, `/proc/uptime`, `/proc/net/dev`, `hostname` puis `df -kP`, séparés par `@@tilde:<section>@@`. `LC_ALL=C`.
  - `parse_remote(output: &str) -> Result<RemoteRaw, MonitorError>`. `MonitorError::NotLinux` si `/proc/stat` manque, avec le message « moniteur distant : Linux uniquement (/proc introuvable) ».
  - `RemoteMonitor::default()` et `update(&mut self, raw: RemoteRaw, at: Instant) -> Snapshot` : CPU et réseau calculés par différence avec l'échantillon précédent. Les compteurs revenus à zéro (redémarrage) donnent `None`, sans valeur négative. `lo` est exclu du réseau. Les montages `tmpfs`, `devtmpfs`, `overlay` et `squashfs` sont exclus des disques.
- Produces (`tilde-ssh`) : `SshShell::exec(command: &str, max_output: usize, timeout: Duration) -> Result<ExecOutput { stdout: String, exit: Option<u32> }, SshError>`, sur un nouveau canal de la connexion existante. Il échoue proprement si la connexion est perdue.
- Produces (Tauri) :
  - `monitor_local() -> Snapshot` (`AppState.monitor_local: Mutex<LocalMonitor>`) ;
  - `monitor_remote(session_id) -> Result<Snapshot, MonitorErrorDto>` (`AppState.monitor_remote: Mutex<HashMap<u32, RemoteMonitor>>`, entrée retirée à la fermeture de la session) ;
  - `MonitorErrorDto { kind: "notLinux" | "disconnected" | "failed", message }`.
- Produces (TS) : `monitorLocal()`, `monitorRemote(sessionId)`, types `Snapshot`, `Disk`, `MonitorErrorDto`.

- [ ] **Step 1 :** tests dans `crates/tilde-monitor`, avec des fixtures de sortie réelle (Debian, Alpine/BusyBox, un conteneur sans swap) :
  - `parses_proc_outputs` ;
  - `cpu_and_network_rates_come_from_deltas` (deux échantillons à 2 s : CPU à 25 %, 1 Mio/s reçu) ;
  - `counter_reset_gives_no_rate` ;
  - `non_linux_output_is_a_clear_error` (sortie d'un hôte macOS/BSD : `cat: /proc/stat: No such file`) ;
  - `pseudo_filesystems_are_skipped` ;
  - `local_sample_is_sane` (cores ≥ 1, `mem_used ≤ mem_total`).
  
  Banc (`integration`) : `exec_returns_output_and_exit_code` et `monitor_command_parses_on_the_bench`.
- [ ] **Step 2 :** `cargo test -p tilde-monitor` → FAIL (crate absent).
- [ ] **Step 3 :** implémenter le crate, `exec`, puis les commandes et les wrappers.
- [ ] **Step 4 :** `cargo test --workspace` → PASS, `cargo clippy --workspace --all-targets -- -D warnings` et `cargo deny check` → propres.
- [ ] **Step 5 :** commit `feat(monitor): local and remote (/proc over SSH) system sampling`.

### Task 7 : Panneau moniteur

**Files:**
- Create: `src/panels/monitor/{MonitorPane.tsx,MonitorPane.test.tsx,format.ts,format.test.ts,Sparkline.tsx,useSampler.ts,useSampler.test.ts,module.ts}`
- Modify: `src/workspace/types.ts` (`MonitorPanel`), `src/stores/workspace.ts` (`openMonitor`), `src/panels/core.tsx`, `src/app/TabBar.tsx` (menu d'un onglet SSH : « Moniteur »), `src/commands/builtin.ts` (`monitor.open`)

**Interfaces:**
- Produces :
  - `MonitorPanel = { kind: 'monitor'; source: { kind: 'local' } | { kind: 'remote'; linkedLeafId: string }; cwd: null; title: null }`.
    - Module `core.monitor` (icône `Activity`).
    - `serialize` garde le panneau (local, ou distant lié à un panneau SSH restauré). `deserialize` exige un `linkedLeafId` pour la source distante.
  - `useSampler(fetch: () => Promise<Snapshot>, active: boolean, intervalMs = 2000)` → `{ latest; history: Snapshot[] /* 60 au plus */; error: MonitorErrorDto | null }`.
    - En pause tant que `active` est faux (onglet caché, panneau non visible).
    - Après une erreur, l'intervalle double jusqu'à 30 s.
    - Un même message d'erreur n'est affiché qu'une fois : bandeau dans le panneau, pas de toast.
  - `formatBytes(n)` (« 1,5 Gio »), `formatRate(n)` (« 2,3 Mio/s »), `formatUptime(s)` (« 3 j 4 h »), en français.
  - `Sparkline({ values, max?, label })` : SVG inline, couleur `accent`.
  - `MonitorPane` (composant) :
    - en-tête : hôte, uptime, charge ;
    - cartes CPU (% et sparkline, nombre de cœurs), Mémoire (barre + swap), Réseau (↓↑ par seconde, sparklines) et Disques (barres par montage, rouge au-delà de 90 %).
  - `useWorkspace.openMonitor(besideLeafId: string | null, source)` : sans `besideLeafId`, nouvel onglet.
  - Commande `monitor.open` « Moniteur système » : celui du serveur si le panneau actif est SSH, sinon local.

- [ ] **Step 1 :** tests :
  - `format.test.ts` : `formats bytes, rates and uptime in French` ;
  - `useSampler.test.ts` (fake timers) : `polls every 2 s only while active` ; `a failing remote monitor backs off and shows one message` (3 échecs → intervalles 4, 8, 16 s ; une seule erreur exposée) ; `keeps 60 samples` ;
  - `MonitorPane.test.tsx` : `shows CPU, memory, network and disks` ; `a non-Linux server shows the explanation`.
- [ ] **Step 2 :** `pnpm vitest run src/panels/monitor` → FAIL.
- [ ] **Step 3 :** implémenter.
- [ ] **Step 4 :** `pnpm test` → PASS.
- [ ] **Step 5 :** commit `feat(monitor): system monitor panel, local or over SSH`.

### Task 8 : Documentation et fin de phase

**Files:**
- Modify: `README.md` (fonctionnalités : éditeur, aperçu, moniteur ; la case de la phase 7 reste à cocher après validation), `docs/architecture.md` (registre de panneaux, `tilde-monitor`, fichiers texte), `docs/panneaux.md` (exemples à jour avec les modules réels)

- [ ] **Step 1 :** rédiger les ajouts.
- [ ] **Step 2 :** vérification complète :
  - `cargo fmt --all --check` ;
  - `cargo clippy --workspace --all-targets -- -D warnings` ;
  - `cargo test --workspace` ;
  - `cargo deny check` ;
  - `pnpm lint`, `pnpm typecheck`, `pnpm test` ;
  - `pnpm gen:types && git diff --exit-code schemas src/ipc/generated` ;
  - `pnpm tauri build --no-bundle`.
  
  Attendu : tout vert, et l'app **n'est pas lancée**.
- [ ] **Step 3 :** commit `docs: panels, editor, preview and monitor`.
