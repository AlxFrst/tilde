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

```
src/themes/builtin      ports intégrés
src/themes/parse        validation d'un fichier de thème, tokens UI dérivés du terminal
src/themes/importers    iTerm2 (DOMParser), Windows Terminal (JSONC), base16 (YAML ligne à ligne)
crates/tilde-config/themes.rs  themes/<id>.json : ids sûrs, taille plafonnée, écriture atomique
src/stores/themes       thèmes utilisateur + thème d'aperçu de l'éditeur
src/themes/useActiveTheme  aperçu, sinon thème choisi : seule source pour le CSS et xterm
```

- **Rust garde le système de fichiers, le front garde les couleurs** : Rust refuse les ids
  dangereux (`..`, séparateurs, noms réservés Windows) et les fichiers trop gros ; le front
  valide chaque couleur avec le même code que pour les imports.
- **Raccourcis** : `keybindings.json` (`KeybindingsStore`, même modèle que `connections.json`)
  ne contient que les écarts aux défauts. Le front calcule la table effective
  (`src/stores/keybindings`) et `src/terminal/keys` la compile pour `matchShortcut`, utilisé par
  `useShortcuts` et le terminal.
- **Transparence** : la fenêtre est créée transparente ; `window_apply_effects` applique Mica,
  Acrylic ou vibrancy via `set_effects` de Tauri (`window-vibrancy`). L'opacité
  (`--tilde-bg-alpha`) ne touche que les fonds de niveau fenêtre et celui du terminal.
- **Quake** : raccourci global enregistré depuis Rust (`tauri-plugin-global-shortcut`, aucune
  permission côté front) ; fenêtre `quake` créée à la première utilisation, masquée au lieu
  d'être fermée. Le front la reconnaît à son label et n'y restaure ni n'enregistre rien.

## Sessions de terminal

```
crates/tilde-pty      détection des shells (+ WSL), fusion avec les profils de settings.json
crates/tilde-session  PTY (portable-pty / ConPTY) : lecteur → pompe → sink
src-tauri commands    session_open / write / resize / ack / close / busy
src/terminal          TerminalView (xterm.js + addons)
src/workspace         arbre de splits (fonctions pures) ; src/stores/workspace : onglets
```

- **Sortie** : un thread lit le PTY par blocs de 64 Kio dans un canal **borné**. La pompe
  regroupe les octets (toutes les 4 ms ou dès 64 Kio) et les envoie au front sur un
  `Channel` Tauri, en binaire brut (`ArrayBuffer` côté JS).
- **Contrôle de flux** : le front acquitte chaque bloc une fois qu'xterm l'a affiché
  (`session_ack`). Au-delà de 1 Mio non acquitté, la pompe cesse de lire ; le canal se
  remplit, le lecteur bloque et la contre-pression remonte jusqu'au processus. Reprise
  sous 256 Kio. C'est ce qui évite de figer l'UI sur un gros `cat`.
- **Entrée** : `session_write` reçoit un corps binaire ; l'id de session est dans l'en-tête
  `x-session-id`.
- **Démarrage sous Windows** : ConPTY demande la position du curseur (`ESC[6n`) et bloque le
  shell jusqu'à la réponse, qu'xterm envoie. Cette demande arrive souvent *avant* que
  `session_open` ait renvoyé l'id : `TerminalView` met donc en file les écritures et les
  acquittements jusqu'à connaître l'id.
- **Fin du processus** : le thread d'attente récupère le code, libère le pseudo-console
  (ce qui débloque le lecteur sous Windows) ; la pompe envoie le reste puis l'événement
  `exit`, et la session se retire du gestionnaire. Code 0 → le panneau se ferme ; sinon un
  bandeau propose de relancer.
- **Splits** : les terminaux sont rendus en **liste plate positionnée en absolu**
  (`layoutRects`), avec une clé stable par panneau. Diviser ou fermer un panneau ne remonte
  donc jamais les autres terminaux (ce qui redémarrerait leur shell).
- **Fermeture** : « programme en cours » = sous Unix, le groupe de premier plan du PTY
  diffère du shell ; sous Windows, le shell a un processus enfant (hors `conhost`).
- **Restauration** : `workspace.json` (format possédé par le front, `version: 1`) est
  sauvegardé 500 ms après chaque changement et à la fermeture. Au démarrage, les panneaux
  dont le profil n'existe plus sont relancés avec le profil par défaut.

## SSH

```
crates/tilde-ssh-config  parser pur de ssh_config (sémantique `ssh -G`), sans réseau
crates/tilde-ssh         client russh : known_hosts, auth, agent, chaîne de sauts, shell,
                         keepalive, reconnexion, tunnels ; questions via le trait Prompter
crates/tilde-session     trait Backend (PTY ou SSH) + pompe de sortie commune
src-tauri/prompter.rs    Prompter → événement ssh://prompt, réponse ssh_prompt_reply (5 min max)
src-tauri commands/ssh   ssh_hosts, ssh_forwards / _add / _remove, secrets_available
```

- **Un panneau SSH** (`{ kind: 'ssh', target }`) passe par le même `session_open`, avec
  `target: { kind: 'ssh', target }`. La session SSH est un `Backend` comme le PTY : même
  pompe, mêmes acquittements, même `SessionId` pendant les reconnexions. Les états de
  connexion (`resolving`, `connecting { hop }`, `ready`, `lost`, `reconnecting`, `failed`)
  arrivent sur le canal d'événements de la session (`{ type: 'state' }`).
- **Chaîne** : chaque `ProxyJump` est un canal `direct-tcpip` du saut précédent, qui sert de
  flux à la connexion suivante ; chaque saut vérifie sa clé d'hôte et s'authentifie. Comme
  OpenSSH, seul le premier saut suit son propre `ProxyJump`.
- **Contrôle de flux** : russh réajuste seul la fenêtre de chaque canal, on ne peut donc pas
  ralentir le serveur canal par canal. Le lecteur vide le canal en continu, ce qui évite
  qu'un `cat` géant ne bloque toute la connexion (tunnels, keepalive). Pendant que l'UI est
  en pause, il garde jusqu'à 4 Mio, attend au plus 100 ms, puis ignore la sortie jusqu'à la
  reprise et l'écrit dans le terminal (« N Kio de sortie ignorés »). La mémoire reste bornée.
- **Perte et reconnexion** : le keepalive de russh coupe après `countMax + 1` intervalles
  muets ; la session repasse alors par la chaîne complète avec un backoff de 1, 2, 4, 8, 16,
  puis 30 s, rouvre un shell et rétablit les tunnels distants. Les listeners des tunnels
  locaux restent ouverts pendant la reconnexion. Une erreur d'authentification ou de clé
  d'hôte arrête les tentatives. La poignée de main est bornée par le délai de connexion,
  sauf pendant une question sur l'empreinte.
- **Secrets** : trousseau du système uniquement (crate `keyring`, service `dev.tilde.app`),
  jamais dans un fichier ni dans les logs ; les réponses aux questions n'implémentent pas
  `Debug`.

## Connexions et commandes

```
crates/tilde-config/connections.rs  modèle, validation, store de connections.json (+ schéma)
src-tauri commands/connections      commandes, import/export (dialogues natifs côté Rust)
src/stores/connections               état du front, suit connections://changed
src/app/Sidebar + sidebar/           sections, recherche floue (fuzzysort), glisser-déposer
src/commands/registry                CommandRegistry : palette (cmdk) et raccourcis
```

- **`connections.json` appartient à Rust**, comme `settings.json` : Rust doit pouvoir résoudre
  une connexion enregistrée en ouvrant la session (`SshTarget::Custom` : `ssh_config` s'applique
  à l'hôte, puis les champs enregistrés gagnent). Le front n'écrit jamais le fichier ; il appelle
  des commandes fines et reçoit le fichier entier après chaque changement.
- **Jamais de perte** : une entrée de mauvais type rend le fichier lecture seule plutôt que d'être
  ignorée (une réécriture l'effacerait). Seules les incohérences réparables sans perte le sont
  (id en double, dossier ou icône inconnus). Les clés inconnues — y compris un éventuel
  `password` — ne sont ni réécrites ni exportées.
- **Panneaux SSH** : ils retiennent `connectionId` et leur `target`. Si la connexion est supprimée,
  l'onglet se reconnecte à `target`. Une ouverture réussie alimente les récents (10 au plus).
- **Commandes** : chaque action utilisateur est une commande du registre (id, titre, groupe,
  raccourci). `useShortcuts` et la palette lisent le même registre. Les raccourcis sont ignorés
  quand on tape dans un champ ou un dialogue, sauf l'ouverture de la palette. Copier, coller et
  rechercher agissent sur le terminal du panneau actif (`terminalActions`).

## SFTP

```
crates/tilde-ssh/sftp.rs      SftpClient (russh-sftp sur un canal de la connexion), noms sûrs
crates/tilde-ssh/transfer.rs  TransferQueue : streaming, reprise, annulation, progression
crates/tilde-ssh/edit.rs      EditSession : édition externe, debounce, détection de conflit
src-tauri commands/sftp       sftp_*, transfer_*, événement sftp://transfer
src/panels/sftp               panneau fichiers (lié à un panneau SSH)
src/app/TransfersButton       file de transferts dans la barre de titre
```

- **Une session SFTP par session SSH**, ouverte à la demande sur la connexion existante
  (`channel_open_session` + sous-système `sftp`). `SshShell::sftp()` la partage tant que la
  connexion est la même et en rouvre une après une reconnexion.
- **Panneau** : `{ kind: 'sftp', linkedLeafId, path, follow }` dans l'arbre de layout, à droite du
  panneau SSH. Il retrouve la session par le registre des sessions (observable) et suit le `cwd`
  OSC 7 du panneau lié tant que `follow` est vrai.
- **Transferts** en blocs de 256 Kio : la mémoire ne dépend jamais de la taille du fichier. Les
  données passent par un fichier partiel (`.part` localement, `.tilde-part` sur le serveur)
  renommé à la fin ; « Réessayer » reprend à la taille de ce fichier partiel. Concurrence :
  `settings.sftp.concurrency`, relue à chaud. Progression : au plus un événement toutes les
  100 ms par transfert, vitesse moyenne sur 2 s.
- **Dossiers** : un transfert par fichier ; les liens symboliques ne sont pas suivis.
- **Noms locaux** : `safe_local_name` ne garde que le dernier segment et neutralise `..`, les
  séparateurs, les caractères et noms réservés de Windows ; un fichier existant n'est jamais
  écrasé (« nom (1).ext »).
- **Édition externe** : copie dans `cache/Tilde/edit/<pid>-<session>/`, surveillée par `notify`.
  Après 500 ms de calme, si le contenu a changé et que le fichier distant n'a pas changé depuis
  le dernier échange (taille + mtime), il est renvoyé ; sinon c'est un conflit, résolu par
  l'utilisateur. Le dossier est supprimé à la fermeture de la session ; les restes de plus de
  7 jours sont nettoyés au démarrage.

## Panneaux

```
src/panels/registry.ts        PanelModule : rendu, sauvegarde, restauration, commandes
src/panels/core.tsx           modules internes : terminal, ssh, sftp, editor, preview, monitor
src/panels/editor             CodeMirror 6 (chargé à la demande), useDocument (version lue)
src/panels/preview            Markdown (markdown-it, sans HTML), JSON, images (blob:)
src/panels/monitor            échantillonnage toutes les 2 s, recul après échec
crates/tilde-ssh/textfile.rs  texte distant et local : plafonds, binaire refusé, conflit
crates/tilde-ssh/exec.rs      commande sur la connexion existante (sortie et délai bornés)
crates/tilde-monitor          sysinfo local ; parseur de /proc pour un serveur Linux
```

- **Le layout ne connaît aucun panneau** : `PaneView`, la restauration de `workspace.json` et
  la barre d'onglets passent par le registre (voir [panneaux.md](panneaux.md)). Un `kind`
  inconnu est retiré à la restauration.
- **Éditeur et aperçu ne sont pas restaurés** (`serialize` renvoie `null`). Le moniteur l'est.
- **Pas de chemin local venant du front** : un fichier local ne s'ouvre que par le dialogue
  natif. Rust garde le chemin et ne rend qu'un identifiant de document.
- **Conflits** : chaque ouverture renvoie la version lue (taille + mtime) ; l'enregistrement la
  renvoie, et Rust refuse si le fichier a changé, sauf « Écraser ». L'écriture distante se
  fait en place, ce qui garde le propriétaire et les permissions.

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
  côté WebView ; `opener` et `global-shortcut` ne sont utilisés que depuis Rust.
