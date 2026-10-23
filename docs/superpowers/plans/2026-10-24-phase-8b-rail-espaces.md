# Phase 8b — Rail et Espaces : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** remplacer la barre d'onglets et la barre latérale de la fenêtre principale par le
Rail (sessions verticales, Épinglés, Aujourd'hui, Bibliothèque) et ajouter les Espaces.

**Architecture :** les espaces vivent dans `connections.json` (Rust, seul écrivain) ; les
sessions restent les onglets du store `workspace` (arbre de panneaux inchangé), enrichis de
`spaceId` et `pinnedConnectionId`. Le Rail, l'en-tête de session, les en-têtes de panneau,
l'Aperçu et la Bibliothèque sont de nouveaux composants React ; la fenêtre Quake garde sa
barre d'onglets.

**Tech Stack :** Tauri 2, Rust (`tilde-config`), React 19, TypeScript, Zustand, Tailwind,
Radix (shadcn), cmdk, dnd-kit, Vitest + Testing Library.

**Spec :** `docs/superpowers/specs/2026-10-24-rail-espaces-design.md` (§7.10 tranche les
questions de la relecture). Maquettes A1–A3 :
https://claude.ai/artifact/9JGRmmQKMGLT91acdg36WB

Branche : `phase-8-packaging` (PR #10). Ce plan s'exécute avant les tâches 5 (captures) et
6 (vérification, revue, release) de `2026-10-23-phase-8-packaging.md` ; une seule revue
finale couvre toute la branche.

## Global Constraints

- Interface en français ; identifiants et commentaires de code en anglais.
- Raccourcis par défaut : Ctrl+Maj+… uniquement ; jamais Ctrl+Alt (AltGr sur AZERTY) ;
  jamais une touche utile au shell (Ctrl+K, Ctrl+W, Ctrl+D, Ctrl+S, Ctrl+T restent au shell).
- `connections.json` : écrit par Rust seulement ; un fichier sans `spaces` ni `spaceId`
  s'ouvre inchangé et n'est réécrit qu'au premier changement.
- `workspace.json` : version 1 conservée, champs nouveaux optionnels ; un ancien fichier se
  restaure sans perte.
- Aucune session vivante n'est fermée sans demande explicite de l'utilisateur.
- Chaque comportement : test RED → GREEN. Suite verte à chaque commit : `pnpm vitest run`
  (hors `src/test/docs.test.ts`, rouge jusqu'aux captures), `cargo test --workspace`,
  `cargo clippy --workspace --all-targets -- -D warnings`, `pnpm eslint src`,
  `pnpm tsc -b --noEmit` (supprimer `tsconfig.tsbuildinfo` ensuite), `pnpm prettier --check src`.
- Pièges : les heredocs Bash cassent les antislashs (écrire via Write/Edit) ; ne pas lancer
  Prettier sur `docs/` ; ne pas mettre `grep -n`/`sed -n` dans la même commande qu'un
  `git commit` (faux positif du hook).
- Commits terminés par les deux lignes d'attribution de la session.

## Review Focus

1. **Fichiers d'avant la refonte** (`workspace.json` sans `spaceId`, `connections.json`
   sans `spaces`) : tout se restaure, chaque connexion ouverte retrouve sa session épinglée
   (test Tâche 2 « legacy snapshot »).
2. **Supprimer l'espace actif pendant qu'une session SSH y tourne** : la session survit,
   rejoint le premier espace, qui devient actif (test Tâche 5).
3. **Supprimer la connexion d'une session épinglée** : la session reste ouverte et passe
   dans Aujourd'hui (test Tâche 3).
4. **Beaucoup d'éléments** (50 connexions, 30 sessions) : le Rail défile verticalement,
   jamais horizontalement, et son pied (Bibliothèque, Espaces, Réglages) reste visible
   (test Tâche 3).
5. **Clavier seul** : flèches entre les lignes du Rail, Entrée ouvre, Maj+F10 ouvre le menu
   d'une ligne ; dans la palette, → ouvre les actions (tests Tâches 3 et 8).

---

### Task 1 : Espaces dans `connections.json`

**Files :**
- Modify : `crates/tilde-config/src/connections.rs` (+ snapshot de schéma)
- Modify : `src-tauri/src/commands/connections.rs`, `src-tauri/src/lib.rs`
- Regenerate : `schemas/connections.schema.json`, `src/ipc/generated/connections.ts` (`pnpm gen:types`)
- Modify : `src/ipc/connections.ts`, `src/stores/connections.ts`
- Create : `src/connections/spaces.ts`, `src/connections/spaces.test.ts`

**Interfaces :**
- Produces (Rust) : `pub struct Space { id, name, color: Option<String>, icon: Option<String> }` ;
  `ConnectionsFile.spaces: Vec<Space>` ; `Folder.space_id`, `Connection.space_id`
  (`Option<String>`) ; `pub const SPACE_ICONS = ICONS + ["briefcase", "user"]` ;
  `pub const MAIN_SPACE_ID: &str = "main"` ; `ConnectionsStore::upsert_space(Space) -> Result<Space>`,
  `remove_space(&str) -> Result<()>` ; commandes `spaces_upsert(space)`, `spaces_remove(id)`.
- Produces (TS) : `type Space` (généré) ; `upsertSpace(space)`, `removeSpace(id)`,
  `SPACE_ICONS` dans `src/ipc/connections.ts` ; store : `saveSpace(s)`, `removeSpace(id)` ;
  `src/connections/spaces.ts` :
  `MAIN_SPACE: Space` (`{ id: 'main', name: 'Principal', color: null, icon: null }`),
  `listSpaces(file): Space[]` (fichier ou `[MAIN_SPACE]`),
  `spaceIdOf(item: { spaceId: string | null }, spaces: Space[]): string` (inconnu ou `null` → premier),
  `connectionSpace(c: Connection, file): string` (l'espace du dossier s'il y en a un).

Règles (spec §7.1, §7.10-3) :
- Liste vide = espace implicite « Principal » non écrit. `upsert_space` sur liste vide écrit
  d'abord `{ id: "main", name: "Principal" }` puis le nouvel espace (id neuf).
- Validation d'espace : nom non vide, ≤ 100 caractères, couleur `#RRGGBB`, icône dans
  `SPACE_ICONS`.
- `upsert_connection` / `upsert_folder` : `spaceId` inconnu → erreur « espace inconnu »
  (`path` = `spaceId`) ; une connexion dont le dossier est dans un autre espace **quitte le
  dossier** (`folder_id = None`).
- Chargement (`repair`) : `spaceId` inconnu → `None` ; connexion dans un dossier d'un autre
  espace → prend l'espace du dossier.
- `remove_space` : refuse le dernier espace (« il faut garder au moins un espace ») ;
  dossiers et connexions de l'espace supprimé → `space_id` du premier espace restant.
- Import : espaces appariés par nom (insensible à la casse), créés sinon ; ids remappés
  pour dossiers et connexions. Export : inclut `spaces`.

- [ ] **Step 1 : tests Rust (RED)** dans `connections.rs` :
  `no_space_means_one_implicit_main_space` (fichier sans `spaces` → `file().spaces` vide,
  rien n'est écrit au chargement), `creating_a_space_writes_main_first`,
  `a_connection_takes_its_folder_space_on_load`, `moving_a_connection_to_another_space_leaves_its_folder`,
  `unknown_space_is_refused_on_write_and_repaired_on_load`,
  `removing_a_space_moves_its_folders_and_connections_to_the_first_one`,
  `the_last_space_cannot_be_removed`, `import_matches_spaces_by_name`,
  `export_keeps_the_spaces`, `space_names_colors_and_icons_are_checked`.
- [ ] **Step 2 :** `cargo test -p tilde-config --lib connections` → FAIL (champs absents).
- [ ] **Step 3 : implémenter** le modèle, la validation, `repair`, `upsert_space`,
  `remove_space`, l'import ; commandes Tauri ; `INSTA_UPDATE=always` pour le snapshot de
  schéma ; `pnpm gen:types`.
- [ ] **Step 4 :** tests Rust GREEN ; clippy propre.
- [ ] **Step 5 : tests TS (RED puis GREEN)** `src/connections/spaces.test.ts` :
  `listSpaces returns Principal when the file has none`, `spaceIdOf falls back to the first
  space for null or unknown ids`, `connectionSpace follows the folder`. Ajouter
  `spaceId: null` aux fixtures de connexions/dossiers des tests existants (`tsc` les signale).
- [ ] **Step 6 : commit** `feat(connections): spaces in connections.json`.

### Task 2 : Sessions dans les espaces (store `workspace`)

**Files :**
- Modify : `src/workspace/types.ts`, `src/workspace/sanitize.ts`, `src/workspace/serialize.ts`,
  `src/stores/workspace.ts`, `src/stores/workspace.test.ts`
- Create : `src/workspace/spaces.ts`, `src/workspace/spaces.test.ts`
- Modify : `src/App.tsx` (installer le résolveur d'espace une fois les connexions chargées)

**Interfaces :**
- Consumes : `listSpaces`, `connectionSpace`, `MAIN_SPACE` (Tâche 1).
- Produces :
  - `Tab.spaceId: string | null`, `Tab.pinnedConnectionId: string | null` ;
    `WorkspaceSnapshot.activeSpaceId?: string | null`, `activeTabBySpace?: Record<string, string>`.
  - `src/workspace/spaces.ts` : `type SpaceResolver = (tab: Tab) => string` ;
    `setSpaceResolver(r: SpaceResolver)`, `spaceOfTab(tab: Tab): string` (défaut :
    `tab.spaceId ?? 'main'`) ; `makeSpaceResolver(file: ConnectionsFile): SpaceResolver`
    (épinglée sur connexion connue → `connectionSpace` ; sinon `spaceIdOf(tab)`).
  - Store : `activeSpaceId: string` ; `switchSpace(spaceId)` ; `spaceTabs(spaceId): Tab[]` ;
    `openPinned(connectionId, target, spaceId): string` ; `pinTab(tabId, connectionId)` ;
    `unpinTab(tabId)` ; `moveTabToSpace(tabId, spaceId)` ;
    `tabsAfter(tabId): string[]` (dans Aujourd'hui de l'espace) ; `otherTabs(tabId): string[]`
    (même espace). `openTab`/`openSshTab`/`openEditor`/`openMonitor(null…)` créent dans
    `activeSpaceId`. `activateTab` bascule `activeSpaceId` sur l'espace de l'onglet.
    `activateRelative` et la fermeture choisissent dans le même espace.

Règles : `switchSpace` mémorise l'onglet actif de l'espace quitté dans `activeTabBySpace`
et restaure celui de l'espace rejoint (ou son premier, ou `null`). `openPinned` active la
session épinglée existante (et bascule d'espace) ou en crée une. `pinTab` retire
l'épinglage d'un autre onglet sur la même connexion. `unpinTab` fige `spaceId` à l'espace
courant de l'onglet. Snapshot ancien (sans `activeSpaceId`) : `sanitizeSnapshot` renvoie
`legacy: true` et `hydrate` épingle, par `connectionId` SSH rencontré, le premier onglet
dont le premier panneau SSH porte ce `connectionId`.

- [ ] **Step 1 : tests (RED)** dans `workspace.test.ts` / `spaces.test.ts` :
  `new tabs belong to the active space`, `switching space restores that space's last tab`,
  `a pinned session follows its connection's space`, `opening a pinned connection twice
  activates the same session and switches space`, `pinning a tab unpins the previous one`,
  `unpinning keeps the session where it is`, `closing a tab activates a neighbour of the
  same space`, `ctrl+tab cycles within the space`, `otherTabs and tabsAfter stay within
  the space and Aujourd'hui`, `snapshot round-trips spaces, pins and active tabs`,
  `a legacy snapshot pins each saved connection's first session` (Review Focus 1),
  `hostile space fields are dropped`.
- [ ] **Step 2 :** `pnpm vitest run src/stores src/workspace` → FAIL.
- [ ] **Step 3 : implémenter** ; dans `App.tsx`, `setSpaceResolver(makeSpaceResolver(file))`
  à chaque changement de `useConnections().file`.
- [ ] **Step 4 :** GREEN, suite complète verte.
- [ ] **Step 5 : commit** `feat(workspace): sessions belong to spaces and pin to connections`.

### Task 3 : Le Rail

**Files :**
- Create : `src/app/rail/Rail.tsx`, `src/app/rail/FavoriteTiles.tsx`,
  `src/app/rail/PinnedSection.tsx`, `src/app/rail/SessionRow.tsx`,
  `src/app/rail/TodaySection.tsx`, `src/app/rail/RailFooter.tsx`,
  `src/app/rail/sessionStatus.ts`, `src/app/paneLabel.ts`, `src/app/rail/Rail.test.tsx`,
  `src/app/paneLabel.test.ts`
- Modify : `src/app/AppShell.tsx` (Rail dans la fenêtre principale, `TabBar` seulement en
  Quake), `src/app/actions.ts` (`closeTabs(ids: string[]): Promise<void>` avec une seule
  confirmation), `src/app/TabBar.tsx` (retirer `SessionActions` et le menu « Moniteur »)
- Delete : `src/app/Sidebar.tsx`, `src/app/sidebar/ConnectionList.tsx` (logique reprise dans
  `PinnedSection`), `src/app/sidebar/Sidebar.test.tsx` (scénarios repris dans `Rail.test.tsx`)
  ; `SshConfigSection.tsx` et `Section.tsx`/`ConnectionItem.tsx` restent (réutilisés).

**Interfaces :**
- Consumes : Tâches 1–2.
- Produces : `<Rail side width onOpenSettings />` ; `paneLabel(tab: Tab, leaf: LeafNode,
  names: { connectionName(id: string | null): string | null; profileName(id: string): string | null }):
  { title: string; Icon: LucideIcon }` — « Shell 1 », « Shell 2 » (rang parmi les panneaux
  SSH/terminal de la session), « Fichiers · <connexion> », « Moniteur · <connexion> »,
  nom du fichier pour un éditeur/aperçu ; `sessionTitle(tab, names): string`
  (titre perso, sinon connexion, sinon titre du shell, sinon profil) ;
  `sessionStatus(tab): ConnectionState | null`.

Contenu (spec §7.2, §7.7) : en-tête (logo, « Masquer le Rail » — inactif jusqu'à la Tâche 7),
bouton « Rechercher, se connecter, agir… » avec le raccourci de `palette.toggle`, Favoris
(tuiles, 8 max, de l'espace), Épinglés (dossiers et connexions de l'espace, glisser vers
un dossier conservé, ligne en sommeil atténuée / vivante avec point d'état et dépliable),
Aujourd'hui (sessions non épinglées de l'espace, réordonnables), « + Nouvelle session » avec
le menu des shells (`NewTabMenu`), pied (Bibliothèque — inactif jusqu'à la Tâche 6, place
des espaces — Tâche 5, Réglages). Défilement vertical seul ; pied toujours visible.
Menu d'une session : Renommer, Couleur, Dupliquer, Épingler/Désépingler, Fermer, Fermer
les autres, Fermer celles en dessous (« Déplacer vers l'espace… » arrive en Tâche 5).

- [ ] **Step 1 : tests (RED)** `Rail.test.tsx` : `shows favourites, pinned and today of the
  active space only`, `a pinned row is asleep until its session opens, then shows its
  state`, `clicking a pinned row opens then re-activates its session`, `a session with
  several panes unfolds and a pane click focuses it`, `today lists the unpinned sessions
  and reorders them`, `close others and close below ask once and close only those`,
  `rename by double click`, `middle click closes`, `a session whose connection was deleted
  stays, in today` (Review Focus 3), `the rail scrolls vertically and keeps its footer`
  (classes, Review Focus 4), `arrow keys move between rows and Enter opens` (Review Focus 5),
  `new session opens the default shell`. `paneLabel.test.ts` : les libellés ci-dessus.
  `AppShell.test.tsx` : `the main window has the rail and no tab bar; quake keeps its tab bar`.
- [ ] **Step 2 :** FAIL.
- [ ] **Step 3 : implémenter** ; supprimer les fichiers listés ; adapter les tests de
  `TabBar` (plus de bouton Fichiers).
- [ ] **Step 4 :** GREEN, suite complète verte.
- [ ] **Step 5 : commit** `feat(ui): the Rail replaces the tab bar and the sidebar`.

### Task 4 : En-tête de session, en-têtes de panneau, cadre d'environnement

**Files :**
- Create : `src/app/content/SessionHeader.tsx`, `src/app/content/PaneHeader.tsx`,
  `src/app/content/sessionEnv.ts`, `src/app/content/SessionHeader.test.tsx`,
  `src/app/content/sessionEnv.test.ts`
- Modify : `src/app/AppShell.tsx` (colonne de droite : `SessionHeader` + carte de contenu
  arrondie dont la bordure prend la couleur d'environnement ; plus de `Titlebar` dans la
  fenêtre principale — le logo est dans le Rail, `TransfersButton` et `WindowControls`
  dans l'en-tête de session, toute la ligne est `data-tauri-drag-region`),
  `src/app/PaneView.tsx` (`PaneHeader` quand la session a plusieurs panneaux),
  `src/terminal/TerminalView.tsx` (menu : Diviser à droite / en bas),
  `src/app/actions.ts` (`splitPane(tabId, leafId, direction)` : focus puis `splitActive`,
  avec `defaultProfileId()` pour un panneau qui n'est ni terminal ni SSH ni fichiers),
  `src/app/PaneView.test.tsx`, `src/terminal/TerminalView.test.tsx`

**Interfaces :**
- Consumes : `paneLabel` (Tâche 3), `toggleSftp`, `toggleRemoteMonitor`, `closePane`.
- Produces : `sessionEnv(tab, file): { label: string; color: string } | null` — dossier
  coloré de la connexion du panneau actif (ou de la session SSH liée pour Fichiers et
  Moniteur), sinon `null` ; `activeSshLeafId(tab): string | null`.

En-tête (spec §7.3) : pastille (nom du dossier en capitales), titre de session, `user@hôte`,
« via <rebonds> » (ProxyJump de la connexion) ; actions SSH : Fichiers (bascule), Moniteur
(bascule en panneau ici ; l'Aperçu le remplace en Tâche 7), Tunnels (nombre de tunnels de
la session ; ouvre `TunnelsDialog`), « + Shell » (nouveau shell sur le même hôte à droite du
panneau actif) ; pour toutes : Diviser à droite, Diviser en bas. Sans session : titre
« Tilde » et contrôles de fenêtre seulement.

- [ ] **Step 1 : tests (RED)** : `the header names the session, its host and its jump
  hosts`, `ssh actions toggle files and the monitor of the active pane's session`,
  `plus shell opens a shell on the same host`, `split buttons split the active pane`,
  `a local session shows no ssh actions`, `sessionEnv follows the active pane` (ssh, sftp
  lié, local → null), `pane headers appear with two panes and close one` (PaneView),
  `splitting an editor opens the default shell`, `the terminal menu splits`.
- [ ] **Step 2 :** FAIL. **Step 3 :** implémenter. **Step 4 :** GREEN, suite verte.
- [ ] **Step 5 : commit** `feat(ui): session header, pane headers and environment frame`.

### Task 5 : Espaces dans l'interface

**Files :**
- Create : `src/app/spaces/SpaceSwitcher.tsx`, `src/app/spaces/SpaceDialog.tsx`,
  `src/app/spaces/spaceActions.ts`, `src/app/spaces/Spaces.test.tsx`
- Modify : `src/app/rail/RailFooter.tsx`, `src/app/rail/Rail.tsx` (teinte), 
  `src/app/rail/SessionRow.tsx` (« Déplacer vers l'espace… »), `src/app/ConnectionDialog.tsx`
  et `src/app/FolderDialog.tsx` (choix de l'espace quand il y en a plusieurs),
  `src/terminal/keys.ts` (défauts), `src/commands/builtin.ts`, `docs/personnalisation.md`

**Interfaces :**
- Consumes : Tâches 1, 2, 3.
- Produces : `moveSessionToSpace(tabId, spaceId): Promise<void>` (épinglée → enregistre la
  connexion avec `spaceId`, via le store connexions ; sinon `moveTabToSpace`) ;
  `deleteSpace(id): Promise<void>` (confirmation avec le nombre de connexions et de
  sessions déplacées ; si c'était l'espace actif, bascule sur le premier restant) ;
  commandes `space.1` … `space.9`, `space.next`, `space.prev`, `space.new`.

Défauts : `space.1`…`space.9` = `Ctrl+Shift+1`…`9`, `space.next` = `Ctrl+Shift+PageDown`,
`space.prev` = `Ctrl+Shift+PageUp`. Rangée d'espaces cachée tant qu'il n'y en a qu'un (un
discret « + Nouvel espace » reste). Teinte : variable CSS `--tilde-space` (couleur de
l'espace) et fond du Rail `color-mix(in srgb, var(--tilde-space) 7%, var(--tilde-window-bg))`.

- [ ] **Step 1 : tests (RED)** : `one space shows only the new-space button`, `creating a
  space from the dialog saves it and switches to it`, `clicking a space switches the rail
  and the shown session`, `ctrl+shift+2 switches to the second space`, `moving a pinned
  session moves its connection`, `moving a today session moves only the session`,
  `deleting the active space with a live ssh session keeps the session in the first space`
  (Review Focus 2), `the connection and folder dialogs offer the space when there are
  several`, `the rail takes the space colour`.
- [ ] **Step 2 :** FAIL. **Step 3 :** implémenter. **Step 4 :** GREEN, suite verte.
- [ ] **Step 5 : commit** `feat(ui): spaces — create, switch, move, delete`.

### Task 6 : La Bibliothèque

**Files :**
- Create : `src/app/library/LibraryDialog.tsx`, `src/app/library/LibraryDialog.test.tsx`
- Modify : `src/stores/ui.ts` (`libraryOpen`, `setLibraryOpen`), `src/app/AppShell.tsx`,
  `src/app/rail/RailFooter.tsx`, `src/commands/builtin.ts` (`library.open`),
  `src/terminal/keys.ts` (`library.open` = `Ctrl+Shift+L`), `src/app/sidebar/SshConfigSection.tsx`
  (réutilisée dans la Bibliothèque)

Contenu (spec §7.6) : recherche (mêmes règles que la palette : `fold`, nom, hôte,
utilisateur, tags) ; « Connexions » groupées par espace (nom de dossier en détail) avec
Ouvrir (épinglée : bascule d'espace), Ouvrir ici (session non épinglée dans l'espace
actif), Déplacer vers l'espace actif, Modifier ; « ~/.ssh/config » (section existante :
ouvrir, adopter — dans l'espace actif —, masquer) ; Récents ; pied : Importer, Exporter,
Nouvelle connexion.

- [ ] **Step 1 : tests (RED)** : `lists every space's connections grouped by space`,
  `search filters connections and hosts`, `opening a connection of another space switches
  to it`, `open here keeps the current space and does not pin`, `move to the active space`,
  `adopting a host saves it in the active space`, `ctrl+shift+l and the rail button open it`.
- [ ] **Step 2 :** FAIL. **Step 3 :** implémenter. **Step 4 :** GREEN, suite verte.
- [ ] **Step 5 : commit** `feat(ui): the Library — every connection and ~/.ssh/config host`.

### Task 7 : Aperçu du moniteur et Rail masquable

**Files :**
- Create : `src/app/content/Peek.tsx`, `src/app/content/Peek.test.tsx`,
  `src/app/rail/useRailVisibility.ts`, `src/app/rail/useRailVisibility.test.ts`
- Modify : `src/stores/ui.ts` (`peek: { sshLeafId: string } | null`, `setPeek`),
  `src/app/content/SessionHeader.tsx` (Moniteur → Aperçu), `src/panels/monitor/ServerStatusBar.tsx`
  (« Détails » → Aperçu), `src/app/AppShell.tsx`, `src/commands/builtin.ts`
  (`sidebar.toggle`), `src/terminal/keys.ts` (`sidebar.toggle` = `Ctrl+Shift+B`)

Aperçu (spec §7.4) : carte flottante au-dessus du contenu (pas dans l'arbre), rendant
`MonitorPane` pour `{ kind: 'monitor', source: { kind: 'remote', linkedLeafId } }` ;
en-tête « Moniteur · <connexion> », « Ancrer à droite » (`toggleRemoteMonitor` puis fermer),
× ; Échap ou clic hors de la carte ferme ; fermer la session SSH ferme l'Aperçu.
Rail masqué : état dans `localStorage` (`tilde.rail.hidden`, lu avec try/catch) ; zone
sensible de 8 px au bord ; le Rail glisse en surimpression, se rentre 300 ms après la
sortie de la souris ; `prefers-reduced-motion` : sans animation.

- [ ] **Step 1 : tests (RED)** : `the monitor opens as a peek over the session`, `dock
  turns the peek into a pane`, `escape closes the peek`, `closing the ssh session closes
  its peek`, `the status strip's details open the peek`, `ctrl+shift+b hides the rail and
  the edge brings it back over the content`, `the hidden state survives a reload and a
  blocked storage`.
- [ ] **Step 2 :** FAIL. **Step 3 :** implémenter. **Step 4 :** GREEN, suite verte.
- [ ] **Step 5 : commit** `feat(ui): monitor peek and a rail that hides`.

### Task 8 : Palette — sessions, espaces, actions, synonymes

**Files :**
- Modify : `src/app/CommandPalette.tsx`, `src/app/CommandPalette.test.tsx`,
  `src/commands/registry.ts` (`keywords?: string[]`), `src/commands/builtin.ts` (mots-clés)

Règles (spec §7.8) : groupes « Sessions » (tous espaces ; choisir active la session et son
espace) et « Espaces » ; sur une connexion ou un hôte, → (ou le bouton « Actions »)
ouvre une page d'actions : Se connecter, Se connecter à côté (nouveau panneau SSH à
droite du panneau actif), Fichiers, Moniteur, Copier la commande ssh
(`ssh [-J rebonds] [-p port] [user@]hôte`), Modifier ; ← ou Échap revient. Mots-clés
anglais et synonymes : split/diviser, close/fermer, files/sftp/fichiers,
monitor/moniteur/stats, tunnel/forward/redirection, settings/réglages, space/espace,
library/bibliothèque.

- [ ] **Step 1 : tests (RED)** : `open sessions are listed and switch space`, `spaces are
  listed`, `arrow right opens a host's actions and arrow left goes back` (Review Focus 5),
  `copy ssh command builds the command with jump hosts and port`, `connect beside splits
  the active pane`, `english words find french commands`.
- [ ] **Step 2 :** FAIL. **Step 3 :** implémenter. **Step 4 :** GREEN, suite verte.
- [ ] **Step 5 : commit** `feat(palette): sessions, spaces, per-host actions and synonyms`.

### Task 9 : Documentation et nettoyage

**Files :**
- Modify : `README.md`, `README.fr.md` (fonctionnalités : Rail, Espaces, Bibliothèque,
  Aperçu ; tableau des raccourcis), `docs/personnalisation.md` (raccourcis `space.*`,
  `sidebar.toggle`, `library.open`), `CHANGELOG.md`, `docs/superpowers/plans/2026-10-23-phase-8-packaging.md`
  (renvoi vers ce plan)
- Delete : code mort repéré par `pnpm eslint` / `tsc` (exports inutilisés de l'ancienne
  barre latérale)

- [ ] **Step 1 :** mettre à jour la documentation (texte seulement, pas de Prettier sur `docs/`).
- [ ] **Step 2 :** suite complète, clippy, eslint, tsc, prettier `src` : verts (hors
  test des captures).
- [ ] **Step 3 : commit** `docs: the Rail, spaces and the Library`.
