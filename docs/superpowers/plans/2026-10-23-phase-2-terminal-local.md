# Phase 2 — Terminal local : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Des shells locaux (PowerShell 7, Windows PowerShell, cmd, Git Bash, WSL ; bash/zsh/fish sous Unix) dans des onglets et des splits, rendus par xterm.js en WebGL et alimentés par un PTY Rust avec coalescence et contrôle de flux, sans lag sur un `cat` de 100 Mo.

**Architecture:** Deux nouvelles crates sans Tauri : `tilde-pty` (détection des shells, résolution des profils) et `tilde-session` (sessions PTY, pompe de sortie avec coalescence et contrôle de flux, gestionnaire de sessions). `src-tauri` expose des commandes génériques `session_*` ; la sortie arrive au front par un `tauri::ipc::Channel` en octets bruts, l'entrée part en corps brut. Côté front, un store `workspace` gère les onglets et un arbre de splits (fonctions pures testées) ; `TerminalView` encapsule xterm et ses addons.

**Tech Stack:** portable-pty 0.9 · sysinfo · which · winreg (Windows) · tauri-plugin-clipboard-manager 2 · @xterm/xterm 6 + addons fit 0.11, webgl 0.19, search 0.16, web-links 0.12, unicode11 0.9, serialize 0.14, ligatures 0.10 · react-resizable-panels 4 · @dnd-kit/core 6 + @dnd-kit/sortable 10.

**Spec:** `docs/superpowers/specs/2026-10-23-tilde-design.md` (§4.2, §4.3, §4.7, §4.8, §6 phase 2). Plan précédent : `docs/superpowers/plans/2026-10-23-phase-1-fondations.md`.

## Global Constraints

- Tout ce qui est listé dans les Global Constraints de la phase 1 reste valable (Tauri **2.x**, TS ~6.0, notify 8, Rust 1.99, camelCase JSON, aucune requête réseau, pas de plugin `fs`/`shell` côté WebView, commits conventionnels avec `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`).
- Les crates `crates/tilde-pty` et `crates/tilde-session` ne dépendent **pas** de Tauri.
- Flux : sortie en `InvokeResponseBody::Raw` sur un `Channel` ; entrée en `InvokeBody::Raw` avec l'id de session dans l'en-tête `x-session-id`. Jamais de JSON par octet.
- Constantes de la pompe (spec §4.3) : `FLUSH_INTERVAL = 4 ms`, `FLUSH_BYTES = 64 KiB`, `HIGH_WATERMARK = 1 MiB` (pause), `LOW_WATERMARK = 256 KiB` (reprise).
- Variables d'environnement posées pour chaque shell : `TERM=xterm-256color`, `COLORTERM=truecolor`, `TERM_PROGRAM=Tilde`, `TERM_PROGRAM_VERSION=<version du crate>` ; celles du profil les remplacent.
- `settings.json` reste en **version 1** : l'ajout de `profiles` est additif (valeur par défaut `[]`), aucune migration.
- `opener` reste appelé uniquement depuis Rust ; les liens du terminal passent par une commande `open_url` qui n'accepte que `http:` et `https:`.
- Raccourcis de la phase 2 codés en dur dans une table unique (`src/terminal/keys.ts`) ; ils deviendront configurables en phase 6 sans changer leurs ids.

## Review Focus

1. **Sortie massive** (`cat` d'un fichier de 100 Mo, `yes`) → l'UI reste réactive, Ctrl+C arrête l'affichage en moins d'une seconde, la mémoire reste bornée. Tests : Task 2 `pauses_above_high_watermark_and_resumes_below_low`, Task 3 `flood_is_backpressured_until_acked`.
2. **Le shell se termine tout seul** (`exit`, crash, `exit 3`) → la session Rust est retirée (pas de thread ni de processus zombie), le pane affiche le code ; un `exit 0` ferme le pane. Tests : Task 3 `exit_code_is_reported_and_session_removed`, Task 7 `pane closes on exit code 0 and shows the code otherwise`.
3. **Fermeture pendant qu'un programme tourne** (vim, ssh, ping) → confirmation ; shell inactif → aucune question. Tests : Task 3 `busy_while_child_runs_idle_otherwise`, Task 7 `closing a busy pane asks for confirmation`.
4. **Profil disparu** (distribution WSL désinstallée, Git désinstallé, id inconnu dans `workspace.json` ou `defaultProfile`) → repli sur le profil par défaut avec un toast, jamais d'onglet cassé ni de crash. Tests : Task 1 `unknown_default_falls_back_to_first`, Task 8 `restore replaces missing profiles with the default`.
5. **Tempête de redimensionnements** (glisser un séparateur, redimensionner la fenêtre) → au plus un `session_resize` par taille effective et par 50 ms, jamais de taille 0. Test : Task 6 `resize scheduler debounces, dedups and ignores zero sizes`.

---

### Task 1 : `tilde-pty` — détection des shells et profils

**Files:**
- Create: `crates/tilde-pty/Cargo.toml` (deps : `tilde-config` path, `serde`, `which = "8"`, `tracing` ; `[target.'cfg(windows)'.dependencies] winreg = "0.56"`)
- Create: `crates/tilde-pty/src/lib.rs`, `src/detect.rs`, `src/profiles.rs`
- Modify: `crates/tilde-config/src/settings.rs` (champ `profiles`), `schemas/settings.schema.json`, `src/ipc/generated/settings.ts`, snapshot insta
- Test: modules `tests` de `detect.rs` et `profiles.rs`

**Interfaces:**
- Produces (tilde-config) : `pub struct Profile { pub id: String, pub name: String, pub command: String, pub args: Vec<String>, pub cwd: Option<String>, pub env: BTreeMap<String, String>, pub icon: Option<String>, pub color: Option<String>, pub hidden: bool }` (`#[serde(default, rename_all = "camelCase")]`) ; `Settings.profiles: Vec<Profile>` (défaut `[]`).
- Produces (tilde-pty) :
  - `pub struct ShellCandidate { pub id: String, pub name: String, pub command: String, pub args: Vec<String>, pub icon: &'static str }`. Ids et icônes : `pwsh`/`powershell` « PowerShell » ; `powershell`/`powershell` « Windows PowerShell » ; `cmd`/`cmd` « Invite de commandes » ; `git-bash`/`git` « Git Bash » (args `["--login", "-i"]`) ; `wsl:<Distro>`/`linux` « <Distro> (WSL) » (command `wsl.exe`, args `["-d", "<Distro>"]`) ; Unix : id = nom du fichier (`bash`, `zsh`, `fish`…), icône `terminal`, args `["-l"]`.
  - `pub fn parse_wsl_list(stdout: &[u8]) -> Vec<String>` — décode l'UTF-16LE (avec ou sans BOM ; repli UTF-8 si la longueur est impaire ou s'il n'y a aucun octet nul), retire `\r`, les NUL et les blancs, ignore les lignes vides et les noms commençant par `docker-desktop`.
  - `pub fn parse_etc_shells(text: &str) -> Vec<String>` — lignes non vides, sans commentaires `#`, dans l'ordre.
  - `pub fn detect_shells() -> Vec<ShellCandidate>` — Windows, dans cet ordre : pwsh (`which("pwsh")` puis `%ProgramFiles%\PowerShell\7\pwsh.exe`), `powershell.exe`, `cmd.exe`, Git Bash (registre `HKLM` puis `HKCU` `SOFTWARE\GitForWindows` valeur `InstallPath` + `\bin\bash.exe`, repli `%ProgramFiles%\Git\bin\bash.exe`), puis une entrée par distribution de `wsl.exe -l -q` (timeout 3 s ; échec → aucune). Unix : `$SHELL` d'abord, puis `/etc/shells` (fichiers existants seulement), dédoublonnés par nom de fichier. Rien n'est inclus si l'exécutable est introuvable.
  - `pub enum ProfileSource { Detected, User }` (sérialisé `detected`/`user`)
  - `pub struct ResolvedProfile { pub id: String, pub name: String, pub command: String, pub args: Vec<String>, pub cwd: Option<String>, pub env: BTreeMap<String, String>, pub icon: String, pub color: Option<String>, pub source: ProfileSource }` (Serialize camelCase)
  - `pub fn resolve_profiles(detected: &[ShellCandidate], user: &[Profile]) -> Vec<ResolvedProfile>` — d'abord les détectés dans l'ordre. Un profil utilisateur de même id **surcharge** les champs non vides (`name`, `command`, `args` non vide, `cwd`, `env` fusionné, `icon`, `color`) et `hidden: true` le retire. Les profils utilisateur d'id nouveau sont ajoutés à la suite (icône par défaut `terminal`), sauf s'ils sont `hidden` ou que leur `command` est vide.
  - `pub fn pick_default<'a>(profiles: &'a [ResolvedProfile], wanted: Option<&str>) -> Option<&'a ResolvedProfile>` — le profil `wanted` s'il existe, sinon le premier.

- [ ] **Step 1 : Écrire les tests**
  - `wsl_list_utf16_with_bom` : octets UTF-16LE de `"\u{feff}Ubuntu\r\nDebian\r\ndocker-desktop\r\n\r\n"` → `["Ubuntu", "Debian"]`.
  - `wsl_list_utf8_fallback` : `b"Ubuntu\nkali-linux\n"` → `["Ubuntu", "kali-linux"]`.
  - `wsl_list_empty_or_error_text` : `b""` → `[]`.
  - `etc_shells_skips_comments` : `"# /etc/shells\n/bin/sh\n\n/usr/bin/zsh\n"` → `["/bin/sh", "/usr/bin/zsh"]`.
  - `user_profile_overrides_detected_fields` : détecté `pwsh` + utilisateur `{id:"pwsh", name:"", color:Some("#7AA2F7"), env:{"FOO":"1"}}` → `name == "PowerShell"`, `color == Some("#7AA2F7")`, `env["FOO"] == "1"`, `source == Detected`.
  - `hidden_user_profile_removes_detected` : utilisateur `{id:"cmd", hidden:true}` → aucun profil `cmd`.
  - `custom_user_profile_is_appended` : utilisateur `{id:"htop", name:"htop", command:"wsl.exe", args:["-e","htop"]}` → dernier élément, `source == User`, `icon == "terminal"` ; un profil utilisateur sans `command` et d'id inconnu est ignoré.
  - `unknown_default_falls_back_to_first` : `pick_default(&[a, b], Some("nope"))` → `a` ; `Some("b")` → `b` ; liste vide → `None`.
  - `detect_finds_a_shell_on_this_machine` : `detect_shells()` non vide ; sous Windows contient `cmd` dont `command` se termine (insensible à la casse) par `cmd.exe`.
  - tilde-config : `partial_json_fills_defaults` étendu par `assert!(s.profiles.is_empty())`, et un test `profiles_roundtrip` (JSON `{"profiles":[{"id":"x","name":"X","command":"bash"}]}` → `args` vide, `hidden == false`).
- [ ] **Step 2 : Lancer** `cargo test -p tilde-pty -p tilde-config` → FAIL.
- [ ] **Step 3 : Implémenter** `Profile`, `detect.rs`, `profiles.rs`. Lancer ensuite `pnpm gen:types` et mettre à jour le snapshot insta après relecture.
- [ ] **Step 4 : Lancer** `cargo test -p tilde-pty -p tilde-config` → PASS ; `cargo clippy --workspace --all-targets -- -D warnings` → OK.
- [ ] **Step 5 : Commit** `feat(pty): shell detection and profile resolution`

---

### Task 2 : `tilde-session` — coalescence et contrôle de flux

**Files:**
- Create: `crates/tilde-session/Cargo.toml` (deps : `portable-pty = "0.9"`, `thiserror`, `tracing`, `parking_lot`, `serde` ; `sysinfo` pour Windows uniquement), `src/lib.rs`, `src/coalescer.rs`
- Test: module `tests` de `coalescer.rs`

**Interfaces:**
- Produces : constantes publiques `FLUSH_INTERVAL: Duration = 4 ms`, `FLUSH_BYTES: usize = 65_536`, `HIGH_WATERMARK: usize = 1_048_576`, `LOW_WATERMARK: usize = 262_144` ; `pub struct Coalescer` avec :
  - `pub fn new() -> Self`
  - `pub fn push(&mut self, data: &[u8], now: Instant) -> Option<Vec<u8>>` — ajoute au tampon ; renvoie le tampon entier (et le vide) dès qu'il atteint `FLUSH_BYTES`. Mémorise l'instant du premier octet en attente.
  - `pub fn poll(&mut self, now: Instant) -> Option<Vec<u8>>` — vide le tampon s'il n'est pas vide et que `now - premier_octet >= FLUSH_INTERVAL`.
  - `pub fn flush(&mut self) -> Option<Vec<u8>>` — vide inconditionnellement (fin de flux).
  - `pub fn next_deadline(&self) -> Option<Instant>` — instant du prochain `poll` utile.
  - `pub fn ack(&mut self, bytes: usize)` — décrémente le compteur de non-acquittés (saturant à 0).
  - `pub fn is_paused(&self) -> bool` — passe à `true` quand les non-acquittés atteignent `HIGH_WATERMARK`, repasse à `false` seulement sous `LOW_WATERMARK` (hystérésis).
  - Chaque octet renvoyé par `push`/`poll`/`flush` s'ajoute aux non-acquittés.

- [ ] **Step 1 : Écrire les tests** (instants construits à partir d'un `Instant::now()` de référence + `Duration`)
  - `small_writes_wait_for_interval` : `push(b"ab", t0)` → `None` ; `poll(t0 + 3ms)` → `None` ; `poll(t0 + 4ms)` → `Some(b"ab")`.
  - `large_write_flushes_immediately` : `push(&[0; 70_000], t0)` → `Some` de longueur 70 000.
  - `writes_are_merged_in_order` : `push(b"a")`, `push(b"b")`, `push(b"c")` puis `poll(+4ms)` → `b"abc"`.
  - `pauses_above_high_watermark_and_resumes_below_low` : 16 flushs de 65 536 → `is_paused()` ; `ack(700_000)` → toujours en pause (reste 348 576 > LOW) ; `ack(100_000)` → `!is_paused()`.
  - `ack_saturates_at_zero` : `ack(10)` sur un coalescer neuf ne panique pas et `!is_paused()`.
  - `next_deadline_tracks_first_pending_byte` : après `push(b"x", t0)` → `Some(t0 + 4ms)` ; après un flush → `None`.
- [ ] **Step 2 : Lancer** `cargo test -p tilde-session` → FAIL.
- [ ] **Step 3 : Implémenter** `coalescer.rs`.
- [ ] **Step 4 : Lancer** `cargo test -p tilde-session` → PASS ; clippy OK.
- [ ] **Step 5 : Commit** `feat(session): output coalescer with ack-based flow control`

---

### Task 3 : `tilde-session` — sessions PTY et gestionnaire

**Files:**
- Create: `crates/tilde-session/src/spec.rs`, `src/pty.rs`, `src/manager.rs`, `src/busy.rs`, `src/error.rs`
- Test: `crates/tilde-session/tests/sessions.rs`

**Interfaces:**
- Consumes : `Coalescer` (Task 2).
- Produces :
  - `pub struct SessionSpec { pub command: String, pub args: Vec<String>, pub cwd: Option<PathBuf>, pub env: BTreeMap<String, String>, pub cols: u16, pub rows: u16 }`
  - `pub trait OutputSink: Send + Sync + 'static { fn data(&self, bytes: Vec<u8>); fn exited(&self, code: Option<i32>); }` — `exited` est appelé **une seule fois**, après le dernier `data`.
  - `#[derive(Copy, Clone, Eq, Hash, Serialize, Deserialize)] pub struct SessionId(pub u32)` (sérialisé comme un nombre).
  - `pub enum SessionError { Spawn { command: String, source: Box<dyn std::error::Error + Send + Sync> }, NotFound(SessionId), Io(std::io::Error) }` (thiserror, messages FR).
  - `pub struct SessionManager` (`Clone`, `Arc` interne) :
    - `pub fn new() -> Self`
    - `pub fn open(&self, spec: SessionSpec, sink: Arc<dyn OutputSink>) -> Result<SessionId, SessionError>`
    - `pub fn write(&self, id: SessionId, data: &[u8]) -> Result<(), SessionError>`
    - `pub fn resize(&self, id: SessionId, cols: u16, rows: u16) -> Result<(), SessionError>` (ignore `cols == 0 || rows == 0`)
    - `pub fn ack(&self, id: SessionId, bytes: usize) -> Result<(), SessionError>`
    - `pub fn is_busy(&self, id: SessionId) -> Result<bool, SessionError>`
    - `pub fn close(&self, id: SessionId) -> Result<(), SessionError>` — tue l'arbre de processus, attend la fin des threads au plus 2 s.
    - `pub fn count(&self) -> usize`
  - Threads par session : **lecteur** (lit le PTY par blocs de 64 KiB et les envoie dans un `sync_channel(8)` borné : quand la pompe est en pause, le lecteur bloque et la contre-pression remonte jusqu'au processus) ; **pompe** (reçoit avec `recv_timeout` jusqu'à `next_deadline`, pousse dans le `Coalescer`, appelle `sink.data` ; en pause, attend un ack sur une `Condvar` au lieu de lire le canal) ; **attente** (`child.wait()`, puis après l'EOF du lecteur et le dernier flush, `sink.exited(code)` et retrait de la session du gestionnaire).
  - `busy.rs` : `pub fn has_running_child(shell_pid: u32, pty_leader: Option<i32>) -> bool` — Unix : `pty_leader` (groupe de premier plan du PTY, via `MasterPty::process_group_leader`) différent du PID du shell ; Windows : au moins un processus `sysinfo` dont le parent est `shell_pid`, en excluant `conhost.exe` et `OpenConsole.exe`.
  - L'environnement de la Global Constraint est appliqué avant celui de `SessionSpec.env`.

- [ ] **Step 1 : Écrire les tests** (`tests/sessions.rs`, shell de test : `cmd.exe` sous Windows, `/bin/sh` ailleurs ; sink de test qui accumule les octets dans un `Mutex<Vec<u8>>`, ignore les séquences d'échappement à la comparaison, et signale `exited` via un canal ; chaque attente plafonnée à 10 s)
  - `echo_roundtrip` : ouvrir, `write(b"echo tilde-ok\r")` → la sortie contient `tilde-ok`.
  - `env_vars_are_set` : `echo %TERM_PROGRAM%` / `echo $TERM_PROGRAM` → la sortie contient `Tilde` ; `COLORTERM` contient `truecolor`.
  - `exit_code_is_reported_and_session_removed` : commande `cmd /c exit 3` / `sh -c "exit 3"` → `exited(Some(3))` reçu une fois, puis `count() == 0` en moins de 2 s.
  - `busy_while_child_runs_idle_otherwise` : shell interactif ; `is_busy == false` ; écrire `ping -n 5 127.0.0.1\r` / `sleep 5\n` → `is_busy == true` en moins de 2 s ; `close` → `count() == 0`.
  - `flood_is_backpressured_until_acked` : commande produisant plus de 8 Mio (`cmd /c "for /L %i in (1,1,200000) do @echo 0123456789012345678901234567890123456789"` ou `sh -c "yes 0123456789 | head -c 8000000"`), **sans ack** → après 1 s, les octets reçus restent ≤ `HIGH_WATERMARK + FLUSH_BYTES` ; acquitter tout au fil de l'eau → `exited` finit par arriver et le total reçu ≥ 8 000 000.
  - `resize_and_write_to_unknown_session_error` : `write(SessionId(999), b"x")` → `NotFound`.
  - `zero_size_resize_is_ignored` : `resize(id, 0, 10)` → `Ok(())`.
- [ ] **Step 2 : Lancer** `cargo test -p tilde-session --test sessions` → FAIL.
- [ ] **Step 3 : Implémenter** `spec.rs`, `pty.rs`, `manager.rs`, `busy.rs`, `error.rs`.
- [ ] **Step 4 : Lancer** `cargo test -p tilde-session` → PASS, 3 fois de suite (stabilité) ; clippy OK.
- [ ] **Step 5 : Commit** `feat(session): PTY sessions with backpressured output pump`

---

### Task 4 : Câblage Tauri et IPC typé

**Files:**
- Create: `src-tauri/src/commands/session.rs`, `src-tauri/src/commands/profiles.rs`, `src-tauri/src/commands/workspace.rs`
- Modify: `src-tauri/src/lib.rs`, `src-tauri/src/state.rs`, `src-tauri/src/commands/mod.rs`, `src-tauri/src/commands/app.rs` (`open_url`), `src-tauri/Cargo.toml` (`tilde-pty`, `tilde-session`, `tauri-plugin-clipboard-manager = "2"`), `src-tauri/capabilities/default.json` (`clipboard-manager:allow-read-text`, `clipboard-manager:allow-write-text`, `core:window:allow-set-title`)
- Create: `crates/tilde-config/src/workspace.rs` (`load_workspace(&ConfigPaths) -> Option<serde_json::Value>`, `save_workspace(&ConfigPaths, &Value) -> Result<(), ConfigError>`, fichier `workspace.json`, écriture atomique)
- Create: `src/ipc/session.ts`, `src/ipc/profiles.ts`, `src/ipc/workspace.ts`
- Test: `crates/tilde-config/tests/workspace.rs`, `src/ipc/session.test.ts`

**Interfaces:**
- Consumes : `SessionManager`, `SessionSpec`, `OutputSink` (Task 3) ; `detect_shells`, `resolve_profiles`, `pick_default`, `ResolvedProfile` (Task 1).
- Produces (commandes) :
  - `profiles_list() -> Vec<ResolvedProfile>` — détection mise en cache dans `AppState` (`OnceLock`, calculée en tâche de fond au démarrage) puis `resolve_profiles` avec `settings.profiles` courant ; `profiles_refresh()` vide le cache.
  - `session_open(profile_id: String, cwd: Option<String>, cols: u16, rows: u16, output: Channel<InvokeResponseBody>, events: Channel<SessionEvent>) -> Result<SessionOpened, SessionErrorDto>`. `SessionOpened { id: u32, profileId: String }`. Si `profile_id` est inconnu, renvoie `SessionErrorDto { kind: "profileNotFound", message }` ; si le `cwd` n'existe pas, démarre dans le `cwd` du profil (ou le dossier personnel) et journalise un avertissement.
  - `#[serde(tag = "type", rename_all = "camelCase")] enum SessionEvent { Exit { code: Option<i32> } }`
  - `session_write(request: tauri::ipc::Request)` — corps `InvokeBody::Raw`, en-tête `x-session-id`.
  - `session_resize(id: u32, cols: u16, rows: u16)`, `session_ack(id: u32, bytes: usize)`, `session_close(id: u32)`, `session_busy(id: u32) -> bool`.
  - `open_url(url: String) -> Result<(), String>` — refuse tout schéma autre que `http`/`https`.
  - `workspace_load() -> Option<Value>`, `workspace_save(state: Value) -> Result<(), ConfigErrorDto>`.
  - À la fermeture de l'app (`RunEvent::Exit`), toutes les sessions sont fermées.
- Produces (TS) :
  - `ipc/profiles.ts` : `interface ResolvedProfile { id; name; command; args: string[]; cwd: string | null; env: Record<string, string>; icon: string; color: string | null; source: 'detected' | 'user' }`, `listProfiles()`, `refreshProfiles()`, `pickDefaultProfile(profiles: ResolvedProfile[], wanted: string | null): ResolvedProfile | null` (même règle que `pick_default` en Rust ; testé par `pickDefaultProfile falls back to the first profile`).
  - `ipc/session.ts` : `openSession(o: { profileId: string; cwd?: string; cols: number; rows: number; onData: (d: Uint8Array) => void; onExit: (code: number | null) => void }): Promise<{ id: number; profileId: string }>`, `writeSession(id: number, data: string | Uint8Array): Promise<void>` (chaîne encodée en UTF-8 par `TextEncoder`), `resizeSession`, `ackSession`, `closeSession`, `isSessionBusy(id): Promise<boolean>`, `openUrl(url)`. `onData` reçoit un `Uint8Array` construit depuis l'`ArrayBuffer` du channel.
  - `ipc/workspace.ts` : `loadWorkspace(): Promise<unknown>`, `saveWorkspace(state: unknown)`.
  - `type SessionErrorDto = { kind: 'profileNotFound' | 'spawn' | 'notFound' | 'io'; message: string }`.

- [ ] **Step 1 : Écrire les tests**
  - `workspace.rs` : `save_then_load_roundtrip` (`json!({"version":1,"tabs":[]})`) ; `missing_file_loads_none` ; `corrupt_file_loads_none` (`{oops` → `None` avec un avertissement journalisé, fichier laissé intact).
  - `session.test.ts` (mocks `@tauri-apps/api/core` : `invoke` et `Channel`) :
    - `writeSession sends raw bytes with the session header` : `writeSession(7, 'é')` → `invoke('session_write', Uint8Array[0xC3, 0xA9], { headers: { 'x-session-id': '7' } })`.
    - `openSession forwards channel data as Uint8Array` : simuler `onmessage(new Uint8Array([104, 105]).buffer)` → `onData` reçoit `Uint8Array [104, 105]`.
    - `openSession forwards exit events` : message `{ type: 'exit', code: 3 }` sur le channel d'événements → `onExit(3)`.
- [ ] **Step 2 : Lancer** `cargo test -p tilde-config --test workspace` et `pnpm test src/ipc` → FAIL.
- [ ] **Step 3 : Implémenter** les commandes, l'état (`sessions: SessionManager`, `shells: OnceLock<Vec<ShellCandidate>>`) et les wrappers TS. `OutputSink` côté Tauri : `data` → `output.send(InvokeResponseBody::Raw(bytes))`, `exited` → `events.send(SessionEvent::Exit { code })`.
- [ ] **Step 4 : Vérifier**
  - `cargo test --workspace`, `pnpm test`, clippy, lint → OK.
  - **Spike manuel** (à garder dans le ledger) : dans `pnpm tauri dev`, depuis la console de la WebView, ouvrir une session `cmd`/`pwsh` avec un channel, écrire `dir\r` et vérifier que `onmessage` reçoit bien un `ArrayBuffer` (pas un tableau de nombres). Si ce n'est pas le cas, adapter `ipc/session.ts` (convertir `number[]` → `Uint8Array`) et consigner une ruling.
- [ ] **Step 5 : Commit** `feat(app): session, profile and workspace IPC`

---

### Task 5 : Modèle de layout et store `workspace`

**Files:**
- Create: `src/workspace/tree.ts`, `src/workspace/types.ts`, `src/stores/workspace.ts`
- Test: `src/workspace/tree.test.ts`, `src/stores/workspace.test.ts`

**Interfaces:**
- Produces :
  - `types.ts` : `type Direction = 'row' | 'column'` (`row` = côte à côte, `column` = l'un sous l'autre) ; `interface TerminalPanel { kind: 'terminal'; profileId: string; cwd: string | null; title: string | null }` ; `type LayoutNode = { type: 'leaf'; id: string; panel: TerminalPanel } | { type: 'split'; id: string; direction: Direction; children: LayoutNode[]; sizes: number[] }` (sizes en pourcentages, somme 100) ; `interface Tab { id: string; customTitle: string | null; color: string | null; root: LayoutNode; activeLeafId: string }` ; `interface WorkspaceSnapshot { version: 1; tabs: Tab[]; activeTabId: string | null }`.
  - `tree.ts` (pur, sans mutation) :
    - `splitLeaf(root, leafId, direction, newLeaf): LayoutNode` — si le parent est un split de même direction, insère `newLeaf` juste après la feuille et répartit les tailles à parts égales ; sinon remplace la feuille par un split `[feuille, newLeaf]` à `[50, 50]`.
    - `removeLeaf(root, leafId): LayoutNode | null` — retire la feuille, renormalise les tailles des frères à 100, remplace un split à un seul enfant par cet enfant ; `null` si l'arbre devient vide.
    - `leaves(root): LeafNode[]` dans l'ordre visuel (profondeur, gauche → droite / haut → bas).
    - `findLeaf(root, leafId): LeafNode | null`, `updatePanel(root, leafId, patch: Partial<TerminalPanel>): LayoutNode`, `setSizes(root, splitId, sizes): LayoutNode`.
    - `neighbor(root, leafId, dir: 'left' | 'right' | 'up' | 'down'): string | null` — calcule les rectangles normalisés (0–1) de chaque feuille à partir des tailles, puis choisit, parmi les feuilles situées strictement du côté demandé et dont la projection chevauche, la plus proche (distance des bords, puis distance des centres).
  - `stores/workspace.ts` (Zustand) : état `{ tabs: Tab[]; activeTabId: string | null }` ; actions `openTab(profileId: string, cwd?: string | null): string` (renvoie l'id de l'onglet), `closeTab(tabId)`, `activateTab(tabId)`, `activateRelative(delta: 1 | -1)` (circulaire), `moveTab(fromIndex, toIndex)`, `renameTab(tabId, title: string | null)`, `setTabColor(tabId, color: string | null)`, `splitActive(direction, profileId?: string)` (profil de la feuille active par défaut, même `cwd`), `closeLeaf(tabId, leafId)` (ferme l'onglet si c'était la dernière feuille et active l'onglet voisin), `focusLeaf(tabId, leafId)`, `focusNeighbor(dir)`, `updatePanel(tabId, leafId, patch)`, `setSizes(tabId, splitId, sizes)`, `snapshot(): WorkspaceSnapshot`, `hydrate(s: WorkspaceSnapshot, availableProfileIds: string[], fallbackProfileId: string): { replaced: number }`.
  - Ids générés par `crypto.randomUUID()`.
  - Titre affiché d'un onglet : `customTitle ?? panel.title de la feuille active ?? nom du profil` (résolu par l'UI).

- [ ] **Step 1 : Écrire les tests**
  - `tree.test.ts` :
    - `split same direction inserts sibling with equal sizes` : `row[a,b]` (50/50), `splitLeaf(…, 'a', 'row', c)` → enfants `[a, c, b]`, tailles `[33.33…, 33.33…, 33.33…]` (somme 100 ± 0,01).
    - `split other direction nests` : feuille seule `a`, `splitLeaf(a, 'a', 'column', b)` → `column[a, b]` à `[50, 50]`.
    - `remove collapses single-child splits` : `row[a, column[b, c]]`, retirer `b` → `row[a, c]` ; retirer ensuite `c` → feuille `a` ; retirer `a` → `null`.
    - `remove renormalizes sizes` : `row[a,b,c]` à `[20, 30, 50]`, retirer `b` → tailles `[28.57…, 71.42…]`.
    - `neighbor finds panes geometrically` : `row[a, column[b, c]]` → `neighbor('a','right') === 'b'` (le plus haut à égalité de chevauchement), `neighbor('c','left') === 'a'`, `neighbor('b','down') === 'c'`, `neighbor('a','left') === null`.
    - `leaves are in visual order`.
  - `workspace.test.ts` :
    - `openTab activates the new tab`.
    - `closing the last leaf closes the tab and activates a neighbor` : 3 onglets, fermer celui du milieu (actif) → l'actif devient celui de droite ; fermer le dernier → celui de gauche ; fermer tout → `activeTabId === null`.
    - `splitActive inherits profile and cwd` : feuille `{profileId:'pwsh', cwd:'C:\\x'}` → la nouvelle feuille a le même profil et le même cwd, et devient active.
    - `moveTab reorders`.
    - `activateRelative wraps around`.
    - `snapshot and hydrate roundtrip`.
    - `hydrate replaces unknown profiles` : snapshot avec `profileId: 'wsl:Gone'` et profils disponibles `['pwsh']` → la feuille utilise `pwsh`, `replaced === 1`.
    - `hydrate ignores an invalid snapshot` : `hydrate({ version: 2 } as never, …)` → état inchangé, `replaced === 0`.
- [ ] **Step 2 : Lancer** `pnpm test src/workspace src/stores/workspace` → FAIL.
- [ ] **Step 3 : Implémenter** `tree.ts`, `types.ts`, `stores/workspace.ts`.
- [ ] **Step 4 : Lancer** `pnpm test` → PASS ; `pnpm lint && pnpm typecheck` → OK.
- [ ] **Step 5 : Commit** `feat(workspace): tab and split layout model`

---

### Task 6 : `TerminalView` (xterm et addons)

**Files:**
- Create: `src/terminal/TerminalView.tsx`, `src/terminal/createTerminal.ts`, `src/terminal/resize.ts`, `src/terminal/paste.ts`, `src/terminal/osc7.ts`, `src/terminal/keys.ts`, `src/terminal/SearchBar.tsx`, `src/terminal/ExitOverlay.tsx`
- Test: `src/terminal/resize.test.ts`, `src/terminal/paste.test.ts`, `src/terminal/osc7.test.ts`, `src/terminal/keys.test.ts`, `src/terminal/TerminalView.test.tsx`

**Interfaces:**
- Consumes : `ipc/session.ts` (Task 4), `useSettings`, `useResolvedTheme`, `toXtermTheme` (phase 1), `TerminalPanel` (Task 5).
- Produces :
  - `resize.ts` : `createResizeScheduler(send: (cols: number, rows: number) => void, delayMs = 50): { schedule(cols: number, rows: number): void; dispose(): void }` — debounce ; n'envoie pas si la taille est identique à la dernière envoyée ; ignore `cols <= 0 || rows <= 0`.
  - `paste.ts` : `needsPasteConfirmation(text: string, bracketedPasteMode: boolean): boolean` — `true` si le texte contient au moins un saut de ligne **non final** et que le mode bracketed paste est désactivé ; `normalizePaste(text): string` — convertit `\r\n` et `\n` en `\r`.
  - `osc7.ts` : `parseOsc7(data: string): string | null` — accepte `file://host/path` ; décode les `%XX` ; convertit `/C:/Users/x` en `C:\Users\x` ; renvoie `null` pour tout autre schéma.
  - `keys.ts` : `type CommandId = 'tab.new' | 'tab.close' | 'tab.next' | 'tab.prev' | 'pane.splitRight' | 'pane.splitDown' | 'pane.close' | 'pane.focusLeft' | 'pane.focusRight' | 'pane.focusUp' | 'pane.focusDown' | 'terminal.copy' | 'terminal.paste' | 'terminal.search'` ; `DEFAULT_KEYBINDINGS: Record<CommandId, string>` = `tab.new: 'Ctrl+Shift+T'`, `tab.close: 'Ctrl+Shift+W'`, `tab.next: 'Ctrl+Tab'`, `tab.prev: 'Ctrl+Shift+Tab'`, `pane.splitRight: 'Alt+Shift+='`, `pane.splitDown: 'Alt+Shift+-'`, `pane.close: 'Ctrl+Shift+X'`, `pane.focusLeft: 'Alt+ArrowLeft'` (et Right/Up/Down), `terminal.copy: 'Ctrl+Shift+C'`, `terminal.paste: 'Ctrl+Shift+V'`, `terminal.search: 'Ctrl+Shift+F'` ; `matchShortcut(e: Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'metaKey'>): CommandId | null` — compare sur `e.code` pour les touches imprimables (`Equal`, `Minus`, `KeyT`…) afin de ne pas dépendre de la disposition du clavier (AZERTY) ; sous macOS, `Ctrl` correspond à `Meta`.
  - `createTerminal.ts` : `createTerminal(opts: { container: HTMLElement; settings: Settings['terminal']; theme: ITheme }): TerminalHandle`, où `TerminalHandle = { term: Terminal; fit: FitAddon; search: SearchAddon; dispose(): void }`. Charge unicode11 (`term.unicode.activeVersion = '11'`), fit, search, web-links (handler → `openUrl`), serialize, puis WebGL dans un `try` avec repli sur le renderer DOM en cas d'échec ou de `onContextLoss`, puis ligatures si `settings.ligatures` (dans un `try` : en cas d'échec, journaliser et continuer). Options : `fontFamily`, `fontSize`, `lineHeight`, `cursorStyle`, `cursorBlink`, `scrollback`, `allowProposedApi: true`, `macOptionIsMeta: true`.
  - `TerminalView` (props `{ tabId: string; leafId: string; panel: TerminalPanel; active: boolean; onExit(code: number | null): void; onTitle(title: string): void; onCwd(cwd: string): void; onSessionError(err: SessionErrorDto): void }`) :
    - Au montage : `createTerminal`, `fit`, puis `openSession({ profileId, cwd, cols, rows })`. `onData` → `term.write(data, () => ackSession(id, data.length))`. Saisie (`term.onData`) → `writeSession`. Dans `term.onBinary`, les octets sont transmis tels quels.
    - `ResizeObserver` sur le conteneur → `fit.fit()` → `scheduler.schedule(term.cols, term.rows)` → `resizeSession`.
    - Mise à jour en direct quand le thème ou les réglages terminal changent (`term.options = …`), sans recréer la session.
    - OSC 7 via `term.parser.registerOscHandler(7, …)` → `onCwd` ; `term.onTitleChange` → `onTitle`.
    - `attachCustomKeyEventHandler` : renvoie `false` pour tout `matchShortcut(e) !== null`, qui est alors traité par l'application ; `terminal.copy` copie la sélection, `terminal.paste` passe par le flux de collage intelligent, `terminal.search` ouvre `SearchBar`.
    - Copier-coller via `@tauri-apps/plugin-clipboard-manager` (`writeText`, `readText`). Si `copyOnSelect` est actif, la sélection est copiée dès qu'elle change. Clic droit : `menu` (menu contextuel Copier / Coller / Rechercher), `paste` ou `copyPaste` (copie s'il y a une sélection, sinon colle).
    - Si `needsPasteConfirmation` est vrai : `confirm` dans un `Dialog` shadcn « Coller N lignes ? » avant d'envoyer `normalizePaste(text)`.
    - `active` vrai → `term.focus()`.
    - À la sortie du processus : `onExit(code)` ; si le pane reste ouvert, `ExitOverlay` affiche « Processus terminé (code N) » avec les boutons Relancer / Fermer (Entrée relance, Échap ferme).
    - Au démontage : `closeSession` et `dispose`.
  - `SearchBar` : champ, précédent/suivant (Entrée / Maj+Entrée), sensibilité à la casse, Échap ferme ; utilise `search.findNext/findPrevious` avec des décorations aux couleurs du thème.

- [ ] **Step 1 : Écrire les tests**
  - `resize.test.ts` (faux timers) : `resize scheduler debounces, dedups and ignores zero sizes` — `schedule(80,24)` ×3 en 10 ms → 1 envoi après 50 ms ; `schedule(80,24)` à nouveau → 0 envoi ; `schedule(0,24)` → 0 envoi ; `schedule(100,30)` → 1 envoi `(100,30)`.
  - `paste.test.ts` : `'ls'` → `false` ; `'ls\n'` → `false` (saut final seul) ; `'a\nb'` → `true` ; `'a\nb'` avec bracketed → `false` ; `normalizePaste('a\r\nb\n')` → `'a\rb\r'`.
  - `osc7.test.ts` : `'file://host/home/al%20ex'` → `'/home/al ex'` ; `'file:///C:/Users/Alex'` → `'C:\\Users\\Alex'` ; `'http://x/y'` → `null` ; `'garbage'` → `null`.
  - `keys.test.ts` : `{code:'KeyT', ctrlKey:true, shiftKey:true}` → `'tab.new'` ; `{code:'Equal', key:'+', altKey:true, shiftKey:true}` → `'pane.splitRight'` (indépendant de `key`, AZERTY) ; `{code:'KeyT', ctrlKey:true}` → `null` ; `{code:'ArrowLeft', key:'ArrowLeft', altKey:true}` → `'pane.focusLeft'`.
  - `TerminalView.test.tsx` (mock de `@xterm/xterm` par une classe factice qui enregistre `write`, `onData`, `options`, `unicode` ; mock des addons ; mock des IPC) :
    - `opens a session with the fitted size and acks written data` : `openSession` appelé avec `profileId` et des `cols`/`rows` ; `onData(Uint8Array(3))` → `term.write` puis `ackSession(id, 3)` une fois le callback exécuté.
    - `keyboard input is written to the session`.
    - `unicode 11 is active`.
    - `theme change updates options without reopening the session`.
    - `unmount closes the session`.
    - `webgl failure falls back without crashing` : le constructeur de `WebglAddon` lève une exception → le terminal fonctionne et aucune erreur n'est propagée.
- [ ] **Step 2 : Lancer** `pnpm test src/terminal` → FAIL.
- [ ] **Step 3 : Installer** les paquets xterm et `@tauri-apps/plugin-clipboard-manager`, puis **implémenter**. Côté Rust, enregistrer le plugin clipboard.
- [ ] **Step 4 : Lancer** `pnpm test` → PASS ; lint et typecheck OK.
- [ ] **Step 5 : Commit** `feat(terminal): xterm view with WebGL, search, links, clipboard and smart paste`

---

### Task 7 : Onglets, splits, raccourcis et confirmations de fermeture

**Files:**
- Create: `src/app/PaneView.tsx`, `src/app/NewTabMenu.tsx`, `src/app/ConfirmCloseDialog.tsx`, `src/app/useShortcuts.ts`, `src/app/useCloseGuard.ts`
- Modify: `src/app/TabBar.tsx` (réécriture), `src/app/AppShell.tsx`, `src/app/Welcome.tsx` (raccourcis réels, bouton « Nouveau terminal »)
- Create: composants shadcn `context-menu`, `dropdown-menu`, `input`
- Test: `src/app/TabBar.test.tsx`, `src/app/PaneView.test.tsx`, `src/app/closeGuard.test.ts`

**Interfaces:**
- Consumes : store `workspace` (Task 5), `TerminalView` (Task 6), `listProfiles`/`isSessionBusy`/`closeSession` (Task 4), `matchShortcut` (Task 6).
- Produces :
  - `PaneView({ tab })` : rend l'arbre avec `react-resizable-panels` (`Group` / `Panel` / `Separator`), en persistant les tailles via `setSizes`. La feuille active a un liseré `accent` de 1 px quand le split contient plus d'une feuille ; un clic dans une feuille appelle `focusLeaf`. Les onglets inactifs restent montés (`display: none`) pour que leurs sessions continuent de tourner.
  - `TabBar` : onglets triables avec `@dnd-kit/sortable` (axe horizontal, activation à 5 px) → `moveTab` ; double-clic → renommage inline (Entrée valide, Échap annule, valeur vide → `renameTab(id, null)`) ; menu contextuel : Renommer, Couleur (pastilles `accent`, `accent2`, `success`, `warning`, `error`, aucune), Dupliquer, Fermer ; clic du milieu → fermer ; pastille de couleur sous le titre ; icône du profil (`icon` → icône Lucide : `powershell`→`SquareTerminal`, `cmd`→`Terminal`, `git`→`GitBranch`, `linux`→`Server`, sinon `Terminal`) ; bouton `+` qui ouvre un nouvel onglet avec le profil par défaut, et chevron `NewTabMenu` listant tous les profils.
  - `useCloseGuard()` : `confirmClose(targets: { sessionIds: number[] }): Promise<boolean>` — si `settings.terminal.confirmClose` est faux, renvoie `true` ; sinon interroge `isSessionBusy` pour chaque id et ouvre `ConfirmCloseDialog` (« Un programme est en cours dans ce terminal. Fermer quand même ? ») si au moins une est occupée. Utilisé par la fermeture de pane, d'onglet et de fenêtre (`getCurrentWindow().onCloseRequested` → `preventDefault` puis fermeture après confirmation).
  - Registre `sessionId` par feuille : `src/terminal/sessionRegistry.ts`, avec `registerSession(leafId, id)`, `unregisterSession(leafId)`, `sessionsFor(leafIds: string[]): number[]`.
  - `useShortcuts()` : un écouteur `keydown` sur `window` (phase de capture) qui associe `matchShortcut` aux actions du store et aux commandes de la vue active ; `tab.close` et `pane.close` passent par `useCloseGuard`.
  - Fin de processus : code `0` → `closeLeaf` ; sinon le pane reste ouvert avec `ExitOverlay`.
  - Démarrage sans aucun onglet : `Welcome` avec un bouton « Nouveau terminal » et la liste des profils détectés.

- [ ] **Step 1 : Écrire les tests**
  - `TabBar.test.tsx` : `renders tabs with resolved titles` (`customTitle` > titre du panneau > nom du profil) ; `double click renames, empty restores default` ; `middle click closes` ; `+ opens default profile` ; `new tab menu lists profiles`.
  - `PaneView.test.tsx` (mock de `TerminalView`) : `renders one TerminalView per leaf` ; `clicking a pane focuses it` ; `pane closes on exit code 0 and shows the code otherwise`.
  - `closeGuard.test.ts` : `closing a busy pane asks for confirmation` (`isSessionBusy` → `true` → dialogue ; Annuler → `false`) ; `idle sessions close without asking` ; `confirmClose disabled skips the check`.
- [ ] **Step 2 : Lancer** `pnpm test src/app` → FAIL.
- [ ] **Step 3 : Implémenter.** Le bouton `+` désactivé et son infobulle « Disponible en phase 2 » (phase 1) disparaissent.
- [ ] **Step 4 : Vérifier**
  - `pnpm test`, lint, typecheck → OK.
  - Manuel (`pnpm tauri dev`) : ouvrir pwsh, cmd, Git Bash et une distribution WSL ; splits Alt+Maj+= et Alt+Maj+- ; déplacement du focus avec Alt+flèches ; redimensionnement des séparateurs ; glisser-déposer des onglets ; renommage ; couleur ; fermer un pane pendant `ping -t` → confirmation ; `exit` → le pane se ferme ; `exit 3` → overlay ; fermer la fenêtre pendant un programme → confirmation.
- [ ] **Step 5 : Commit** `feat(ui): tabs, resizable splits, shortcuts and close confirmation`

---

### Task 8 : Restauration de session, performance et fin de phase

**Files:**
- Create: `src/workspace/persistence.ts`
- Modify: `src/App.tsx` (hydratation au démarrage, sauvegarde), `README.md` (fonctionnalités, raccourcis), `docs/architecture.md` (sessions et flux)
- Test: `src/workspace/persistence.test.ts`

**Interfaces:**
- Consumes : `loadWorkspace`/`saveWorkspace`, `listProfiles`, `pickDefaultProfile` (Task 4), `snapshot`/`hydrate` (Task 5).
- Produces :
  - `startPersistence(): () => void` — s'abonne au store `workspace` et sauvegarde le snapshot 500 ms après la dernière modification (debounce), puis une dernière fois à la fermeture de la fenêtre.
  - `restoreWorkspace(profiles: ResolvedProfile[], settings: Settings): Promise<void>` — si `general.restoreSession` est vrai et qu'un snapshot valide existe, `hydrate` avec le profil par défaut comme repli, puis un toast « N onglet(s) restauré(s) avec le profil par défaut » si `replaced > 0` ; sinon, ou si le snapshot est vide, ouvre un onglet avec le profil par défaut. Aucun profil disponible → `Welcome` avec le message « Aucun shell détecté ».
  - Chaque feuille restaurée relance son shell dans son dernier `cwd` connu (OSC 7) ; le scrollback n'est pas restauré (spec §4.8).

- [ ] **Step 1 : Écrire les tests** (`persistence.test.ts`, faux timers, mocks IPC)
  - `saves debounced snapshots` : 3 modifications en 100 ms → un seul `saveWorkspace` après 500 ms.
  - `restore replaces missing profiles with the default` : snapshot avec `wsl:Gone` → l'onglet utilise le profil par défaut et un toast mentionne « 1 ».
  - `restore disabled opens a fresh default tab`.
  - `empty or invalid snapshot opens a fresh default tab`.
- [ ] **Step 2 : Lancer** `pnpm test src/workspace/persistence` → FAIL.
- [ ] **Step 3 : Implémenter** et brancher dans `App.tsx` après le chargement des réglages et des profils.
- [ ] **Step 4 : Vérification de fin de phase (Windows)**
  - `cargo fmt --all --check && cargo clippy --workspace --all-targets -- -D warnings && cargo test --workspace` → OK.
  - `pnpm lint && pnpm typecheck && pnpm test` → OK ; `cargo deny check` → OK ; `pnpm gen:types` ne produit aucun diff.
  - **Performance** (`pnpm tauri build`, exécutable release) : générer un fichier de 100 Mo (`fsutil file createnew` ne convient pas, car il n'écrit que des zéros ; utiliser `python -c` ou PowerShell pour écrire 100 Mo de texte), puis `type big.txt` dans cmd et `Get-Content big.txt` dans pwsh. Critères : l'UI reste réactive (on peut changer d'onglet), Ctrl+C reprend la main en moins d'une seconde, la mémoire de `tilde.exe` et de `msedgewebview2.exe` reste sous 500 Mo. Mesurer et consigner le temps total.
  - Vérifier que les ligatures (`=>`, `!=`, `->`) s'affichent avec JetBrains Mono ; sinon consigner une ruling (limite de l'addon avec une police embarquée) et ouvrir une issue.
  - CSP : un terminal xterm en build release s'affiche correctement (styles injectés non bloqués).
  - Démarrage de la build release avec restauration de 3 onglets : fenêtre visible en moins d'une seconde.
- [ ] **Step 5 : Commit** `feat(workspace): session restore` puis `docs: phase 2 terminal features`. Récap pour l'auteur, puis **arrêt** pour validation.
