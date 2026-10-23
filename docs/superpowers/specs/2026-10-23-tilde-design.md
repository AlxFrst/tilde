# Tilde — Document de conception

> Statut : brouillon à valider · Date : 2026-10-23
> Les décisions marquées **[choix Claude]** ont été prises par l'assistant (délégation explicite : « fais ce qui te semble le mieux, l'idée est de faciliter la vie des devs »). Tout le reste vient du cahier des charges de l'auteur.

---

## 1. Intention

Tilde est un terminal desktop open source, centré SSH/SFTP, au niveau visuel de Wave / Warp / Linear.

**Pourquoi il existe.** Les alternatives déçoivent sur l'essentiel : fonctions SSH avancées (jump hosts) derrière un abonnement chez certains, connexion peu fiable / buggée chez d'autres (Wave). Tilde doit avant tout offrir **une connexion SSH qui marche du premier coup, y compris les cas avancés, gratuitement**, dans une UI soignée.

**Critère de réussite** (hypothèse validée implicitement) : double-clic sur un hôte de `~/.ssh/config` situé derrière deux bastions → shell en 1–2 s, sans configuration supplémentaire. En cas d'échec, un message qui dit *pourquoi* (clé refusée, hôte injoignable, empreinte modifiée, timeout sur le bastion n°2…).

### Objectifs
- SSH natif fiable : mot de passe, clé (+ passphrase), agent (OpenSSH Windows named pipe, Pageant, ssh-agent Unix), `ProxyJump` chaîné, forwards, known_hosts.
- Parsing fidèle de `~/.ssh/config` : le fichier existant de l'utilisateur doit « juste marcher ».
- Terminal local performant (ConPTY), onglets + splits.
- SFTP intégré à la session.
- Personnalisation poussée (thèmes, polices, raccourcis, transparence) via UI **et** `settings.json`.
- Architecture modulaire prête pour des plugins tiers.
- Windows d'abord, Linux et macOS supportés dès le départ par le code.

### Non-objectifs (MVP)
- Implémentation des plugins utilisateurs (l'API est préparée, pas exposée).
- Synchronisation cloud des connexions.
- Mosh, Telnet, série, RDP/VNC.
- Auto-update (nécessite des builds signés ; prévu plus tard).
- Reprise d'un shell distant après coupure (une reconnexion ouvre un nouveau shell ; tmux reste l'outil pour ça).

### Anti-objectifs (échec même si « ça marche »)
- Toute fonctionnalité derrière un compte, un abonnement ou un service distant.
- Une connexion qui échoue ou se fige **silencieusement** : chaque état est visible et chaque erreur est expliquée.
- Un secret écrit en clair sur disque, dans les logs ou dans un export.
- Toute télémétrie.
- Un lag perceptible sur un gros `cat`.

---

## 2. Contraintes

### Stack imposée (auteur)
- **Tauri 2** (Rust) ; **React + TypeScript + Vite**, **Tailwind CSS**, **shadcn/ui (Radix)**, **Lucide** ; **Zustand**.
- **xterm.js** (`@xterm/xterm`) + addons fit, webgl, search, web-links, unicode11, serialize.
- Rust : `portable-pty`, `russh` + `russh-sftp`, `tokio`, `keyring`, `serde` (+ JSON/TOML), `tracing`, `dirs`.
- IPC : commandes + events Tauri, flux PTY/SSH **en binaire** (jamais de JSON par octet).

### Exigences
- Ouverture < 1 s ; pas de lag sur un gros `cat` (WebGL + buffering côté Rust).
- Secrets uniquement dans le keyring OS ; CSP stricte ; capabilities Tauri minimales ; zéro télémétrie.
- Config dans le dossier applicatif OS (`dirs`), versionnée avec migrations, hot reload.
- Logs `tracing` structurés, fichier accessible depuis l'UI.
- Tests : unitaires Rust (parser ssh_config prioritaire, cas tordus réels), composants front, serveur SSH Docker pour l'intégration.
- CI : lint, tests, builds Windows (MSI + NSIS), Linux (AppImage + deb), macOS (dmg).
- À chaque fin de phase : app qui compile et fonctionne, commit propre, récap fait / reste. Pas de phase suivante sans que la précédente soit testée.

### Environnement constaté
Windows 11, Rust 1.86, Node 24, pnpm 10, Docker 28. Le dossier `C:\Users\Alex\code\Tilde` est vide et pas encore un dépôt git.

---

## 3. Décisions de fond

| Sujet | Décision | Source |
|---|---|---|
| Licence | **MIT OR Apache-2.0** (double licence, convention Rust/Tauri) | [choix Claude] |
| Hébergement / CI | **GitHub + GitHub Actions** uniquement (runners Win/macOS/Linux gratuits pour l'open source) | [choix Claude] |
| Signature des builds | Pas de signature au départ ; CI prête à recevoir les secrets (certificat Windows, Apple notarization) sans autre modification | [choix Claude] |
| Gestionnaire de paquets JS | **pnpm** | [choix Claude] |
| Toolchain Rust | `rust-toolchain.toml` épinglé sur une stable récente (≥ MSRV de russh/Tauri) ; un `rustup update` sera probablement nécessaire en local | [choix Claude] |
| Polices | UI : **Geist** ; terminal : **JetBrains Mono** par défaut (ligatures complètes), **Geist Mono** proposée. Embarquées via `@fontsource` (pas de CDN) | [choix Claude] |
| Édition de fichiers distants | **Les deux**, par étapes : (1) Phase 5 — « Ouvrir avec l'éditeur externe » (éditeur système ou commande configurable, ex. `code --wait`) avec surveillance du fichier temporaire et ré-upload à chaque sauvegarde ; (2) Phase 7 — panneau **éditeur intégré CodeMirror 6** (léger, s'intègre au registry de panneaux). Le choix par défaut est un réglage | [choix Claude] |
| `settings.json` | JSON + **JSON Schema généré** (`schemars`) référencé via `$schema` → autocomplétion et validation dans VS Code. Erreur de parsing = toast non bloquant, dernière config valide conservée | [choix Claude] |
| CI de lint/test | Mise en place **dès la phase 1** (lint, tests) ; le packaging multiplateforme reste en phase 8 | [choix Claude] (l'auteur la plaçait en phase 8 ; avancer le lint/test est peu coûteux et protège chaque phase) |
| Parser ssh_config | **Écrit sur mesure** (crate dédiée), pas de dépendance tierce : c'est le cœur de la promesse « ça marche du premier coup », il doit être entièrement maîtrisé et testé | [choix Claude] |
| Validation de phase | Fin de phase = tests verts + build + commit + récap, puis **arrêt** pour que l'auteur teste l'app avant de passer à la suite | auteur + [choix Claude] sur le point d'arrêt |

---

## 4. Architecture

### 4.1 Vue d'ensemble

```
┌───────────────────────── WebView (React) ─────────────────────────┐
│ Titlebar · Sidebar (connexions) · Tabs · Layout (arbre de splits) │
│ Panels (registry) : terminal │ sftp │ editor │ preview │ monitor  │
│ Stores Zustand : settings, themes, layout, sessions, connections  │
│                        ▲ Channel<bytes>        │ invoke (raw)     │
└────────────────────────┼───────────────────────┼──────────────────┘
                         │                       ▼
┌──────────────────────── Tauri (Rust) ─────────────────────────────┐
│ commands/  ──►  SessionManager ──► LocalPty (portable-pty)        │
│                       │          └► SshShell (russh channel)      │
│                 SshManager (connexions, jump chain, agent,        │
│                 known_hosts, keepalive, reconnexion, forwards)    │
│                 SftpManager (russh-sftp, file de transferts)      │
│ ConfigService (settings / connections / thèmes, migrations, watch)│
│ Secrets (keyring) · Logging (tracing) · Shell detection           │
└───────────────────────────────────────────────────────────────────┘
```

### 4.2 Abstraction de session (point clé)
Le panneau terminal ne sait pas s'il parle à un PTY local ou à un canal SSH. Côté Rust, un trait commun :

```rust
// Enum plutôt que `dyn Trait` : un trait avec `async fn` n'est pas object-safe. [choix Claude]
enum TermSession { Local(LocalPty), Ssh(SshShell) }

impl TermSession {
    fn write(&self, data: &[u8]) -> Result<()>;
    fn resize(&self, cols: u16, rows: u16) -> Result<()>;
    fn close_policy(&self) -> ClosePolicy;  // voir ci-dessous
    async fn close(&self) -> Result<()>;
}
```

**Confirmation de fermeture** [choix Claude] : en local, on confirme si un processus enfant tourne (détection §4.7). En SSH, le protocole ne permet pas de connaître le processus distant au premier plan : on confirme donc **toujours** la fermeture d'une session SSH connectée. Un réglage `confirmCloseSsh` permet de désactiver cette confirmation.

Commandes Tauri génériques : `session_open(spec, channel)`, `session_write` (corps brut ; l'id de session voyage dans un **en-tête** de requête, car un corps `Raw` exclut les arguments nommés : les wrappers IPC typés en tiennent compte), `session_resize`, `session_close`, `session_ack(id, bytes)`.

### 4.3 Flux de données haute performance
- **Sortie** : `tauri::ipc::Channel` en payload **brut** (`InvokeResponseBody::Raw`), ordonné. Une tâche Rust par session lit le PTY / canal et **coalesce** les chunks (vidage toutes les ~4 ms ou dès 64 Kio).
- **Contrôle de flux** : le front accuse réception (`session_ack`) une fois que `term.write(data, cb)` a traité les données. Au-delà d'un seuil haut (~1 Mio non acquitté), la session est mise en pause. C'est ce qui empêche le blocage de l'UI sur un gros `cat`.
  - **Local** : la pause arrête la lecture du PTY, et la contre-pression remonte jusqu'au processus.
  - **SSH** : russh achemine tous les canaux d'une connexion par une boucle d'événements commune avec des buffers bornés. Arrêter de lire un canal pourrait donc figer le SFTP et les tunnels de la même connexion. Chaque canal est vidé **en continu** dans un buffer propre à Tilde, et c'est ce buffer qui applique la pause : on ajuste la fenêtre SSH du canal si la version de russh épinglée le permet, sinon on plafonne le buffer en mémoire. Un test d'intégration le vérifie : un `cat` géant ne doit pas ralentir un transfert SFTP concurrent. [choix Claude, suite à la relecture]
- Note : les petits payloads `Raw` d'un Channel Tauri passent par un tableau d'octets évalué côté JS, pas en binaire pur. La coalescence à ~64 Kio rend ce surcoût négligeable.
- **Entrée** : `invoke` avec corps brut (`tauri::ipc::Request` / `InvokeBody::Raw`).
- **Rendu** : addon WebGL ; repli automatique sur le renderer DOM en cas de perte de contexte.

### 4.4 SSH
- **Machine d'états explicite** par connexion : `Resolving → Connecting(hop i/n) → Authenticating → Ready → Lost → Reconnecting(attempt k) → Closed / Failed(cause)`. Diffusée au front par event ; c'est elle qui alimente l'indicateur d'état.
- **Résolution** : hôte UI ou alias ssh_config → `ResolvedHost` (hostname, port, user, identités, chaîne de sauts, forwards, options). Les champs explicites de l'UI priment sur ssh_config.
- **ProxyJump** : chaque saut ouvre un canal `direct-tcpip` vers le suivant, transformé en stream et passé à `russh::client::connect_stream`. Chaîne de longueur arbitraire, sauts eux-mêmes résolus via ssh_config (récursif, détection de cycles).
- **ProxyCommand : supporté dès la phase 3** [choix Claude]. On lance la commande (tokens `%h %p %r` expansés) comme sous-processus, et son stdin/stdout sert de stream à `connect_stream`. Cela couvre `ssh -W`, AWS SSM, cloudflared et `nc`. Sous Windows, la commande passe par `cmd /C` ; sous Unix, par `sh -c`, comme OpenSSH. Le stderr du sous-processus est journalisé et affiché en cas d'échec.
- **Types de clés et d'auth** [choix Claude] :
  - **Natif** : ed25519, ecdsa, RSA (avec négociation `rsa-sha2-256/512`, et repli `ssh-rsa` pour les vieux serveurs uniquement si `PubkeyAcceptedAlgorithms` l'autorise), formats OpenSSH et PEM, mot de passe, keyboard-interactive (2FA/OTP via dialogue).
  - **Via l'agent uniquement** : clés FIDO (`sk-*`) et certificats utilisateur (`CertificateFile`). Si la clé est chargée dans l'agent, ça marche ; sinon, un message explique comment la charger.
  - **Hors MVP** : GSSAPI/Kerberos.
- **Authentification** (ordre type OpenSSH) : agent → `IdentityFile`s → clés par défaut → keyboard-interactive / mot de passe. Passphrase et mot de passe demandés via dialogue, avec option « mémoriser dans le trousseau ».
- **Agent** : named pipe `\\.\pipe\openssh-ssh-agent` (Windows), Pageant (Windows), `SSH_AUTH_SOCK` (Unix). `ForwardAgent` honoré.
- **known_hosts** : lecture de `~/.ssh/known_hosts` (+ `UserKnownHostsFile`), y compris entrées hachées `|1|`, `[host]:port`, marqueurs `@revoked` / `@cert-authority` (reconnus ; `@cert-authority` traité comme non vérifiable au MVP). Nouvel hôte → dialogue empreinte SHA256 + type + « accepter et enregistrer / une fois / refuser ». Empreinte modifiée → dialogue d'alerte rouge, refus par défaut. Écriture au format OpenSSH dans le même fichier (compatible avec `ssh` en ligne de commande).
- **Keepalive** : `ServerAliveInterval` / `ServerAliveCountMax` (défaut Tilde : 15 s / 3). **Reconnexion auto** avec backoff exponentiel (1 → 30 s, plafonnée) ; un nouveau shell est ouvert et une ligne de séparation est affichée dans le terminal.
- **Forwards** : `LocalForward` / `RemoteForward` depuis ssh_config + création, liste et arrêt depuis l'UI (panneau « Tunnels » de la session).
- Une connexion SSH = un `SshClient` partagé entre les canaux shell, SFTP et forwards (pas de double authentification).
- **Ce qui survit à une reconnexion** [choix Claude] : `SshManager` possède une `Connection` durable (identité, ResolvedHost, forwards déclarés, file de transferts), qui survit aux `SshClient` successifs.
  - Après reconnexion, les **tunnels sont rétablis automatiquement**.
  - Les **transferts SFTP en cours reprennent** grâce au mécanisme de reprise par offset (§4.6).
  - Le shell est rouvert, avec une ligne séparatrice dans le terminal.
  - Si la reconnexion échoue définitivement, tout passe à l'état « échoué » avec la cause, rien n'est abandonné en silence.

### 4.5 Parser `ssh_config` (crate `tilde-ssh-config`)
Sémantique OpenSSH : **la première valeur obtenue gagne** ; mots-clés insensibles à la casse ; séparateur espace ou `=` ; arguments entre guillemets ; commentaires.
- `Host` : motifs multiples, `*` / `?`, négation `!` ; `Match` : `all`, `host`, `originalhost`, `user`, `localuser` supportés ; `exec` / `canonical` / `final` ignorés avec un avertissement (le bloc est considéré comme non correspondant).
- `Include` : globs, chemins relatifs à `~/.ssh`, récursion bornée (profondeur 16), Include à l'intérieur d'un bloc `Host`.
- Directives cumulatives : `IdentityFile`, `LocalForward`, `RemoteForward`, `DynamicForward` (parsé ; support UI plus tard).
- Tokens `%h %p %r %u %d %%`, `~`, variables `${ENV}`.
- `ProxyJump` : liste séparée par des virgules, `user@host:port`, `none`.
- Directives inconnues conservées (diagnostics, pas d'erreur fatale) ; chaque diagnostic porte fichier et ligne.
- API : `parse(path) -> Config` (avec diagnostics), `config.resolve(alias, ctx) -> ResolvedHost`, `config.concrete_hosts()` pour l'import dans la sidebar (les motifs à wildcards ne sont pas listés comme hôtes).
- Tests : table de cas + snapshots (`insta`), corpus de fichiers « tordus » réels, et à terme comparaison avec `ssh -G` en CI Linux.

### 4.6 SFTP
- Session `russh-sftp` ouverte à la demande sur la connexion existante.
- **Suivi du cwd** : via la séquence OSC 7 émise par le shell distant ; si elle est absente, le panneau reste sur `$HOME` et propose un snippet à ajouter au `.bashrc` / `.zshrc`. Une option permet de lier ou de détacher le suivi.
- File de transferts côté Rust (concurrence configurable, défaut 3) : progression, vitesse, annulation ; **reprise** en comparant les tailles distante et locale puis en écrivant avec un offset. Événements de progression limités à environ 10/s.
- Suppression : confirmation, récursive pour les dossiers. chmod via un dialogue octal + cases à cocher.
- Édition externe : téléchargement dans un dossier temporaire par session, surveillance avec `notify`, ré-upload après debounce, statut visible dans la file.

### 4.7 Terminal local
- **Détection des shells** — Windows : pwsh 7 (PATH + chemins standard), Windows PowerShell, cmd, Git Bash (registre `GitForWindows`), distributions WSL (`wsl.exe -l -q`, sortie UTF-16). Unix : `/etc/shells` + `$SHELL`. Résultat mis en cache, rafraîchissable.
- **Profils** : commande, args, cwd, env, icône, couleur ; profils détectés + profils utilisateur. Un profil par défaut.
- **Fermeture** : `has_running_child` (Unix : groupe de premier plan du PTY ≠ shell ; Windows : processus enfants du shell via `sysinfo`) → confirmation.
- OSC 7 également pris en charge en local (nouvel onglet ou split dans le même cwd).

### 4.8 Front-end
- **Modèle de layout** : chaque onglet contient un arbre `Split { direction, children, sizes } | Leaf { panelId, state }`. Rendu avec `react-resizable-panels` (déjà utilisé par le composant `Resizable` de shadcn). Drag & drop des onglets et de la sidebar avec `@dnd-kit`.
- **Registry de panneaux** (le contrat que les plugins utiliseront plus tard) :
  ```ts
  interface PanelModule<S = unknown> {
    id: string;                       // "core.terminal"
    title: string; icon: LucideIcon;
    component: React.ComponentType<PanelProps<S>>;
    commands?: CommandContribution[];
    settings?: SettingsContribution;  // fragment de schéma + valeurs par défaut
    serialize?(s: S): unknown; deserialize?(raw: unknown): S;
  }
  ```
  Les modules internes s'enregistrent par ce seul chemin : aucun import direct d'un panneau depuis le layout. Les commandes et raccourcis passent par un `CommandRegistry` unique, que la palette (`cmdk`) et le gestionnaire de raccourcis lisent tous les deux.
- **Stores Zustand** découpés par domaine ; pas de store global monolithique.
- **Restauration au redémarrage** [choix Claude] : les onglets, les splits et l'état des panneaux sont sauvegardés (`workspace.json`, via `serialize`/`deserialize` dès la phase 2). Les shells locaux sont relancés dans leur dernier cwd connu, et le scrollback **n'est pas** restauré au MVP. Les onglets SSH sont restaurés à l'état **« déconnecté — Entrée pour reconnecter »**, sans reconnexion automatique au lancement. Ce comportement est désactivable dans les réglages.
- **Recherche floue** dans la sidebar avec `fuzzysort`.

### 4.9 Thèmes et apparence
- Tokens : UI (`bg`, `surface-1/2`, `border`, `text`, `text-muted`, `accent`, `accent-2`, `success`, `warning`, `error`…) + terminal (16 ANSI, fg, bg, cursor, cursorAccent, selection). Tokens UI exposés en **variables CSS** consommées par Tailwind ; terminal mappé vers un `ITheme` xterm.
- Thème « Tilde » dark — palette de l'auteur, point de départ à affiner : fond `#0B0E14`, surfaces `#11151C` / `#171C26`, bordures `#232A36`, texte `#E6E9EF`, texte secondaire `#8B93A7`, accent pervenche `#7AA2F7`, accent secondaire teal `#5EEAD4`, succès `#9ECE6A`, warning `#E0AF68`, erreur `#F7768E`. Les 16 couleurs ANSI sont dérivées de cette palette [choix Claude]. Un thème light est conçu à part (pas une simple inversion) ; ports Catppuccin Mocha/Latte, Tokyo Night, Dracula, Nord, Gruvbox, One Dark, Rosé Pine.
- Imports : `.itermcolors` (plist XML), Windows Terminal JSON, base16 YAML. Parsers en TypeScript (testés avec Vitest). Pour un thème importé qui n'a que des couleurs de terminal, les tokens UI sont **dérivés** des couleurs ANSI et du fond.
- **Réglages (liste complète, schéma posé dès la phase 1** pour éviter de multiplier les migrations ensuite) :
  - Apparence : thème, police UI, police terminal, taille, interligne, ligatures, opacité et blur de la fenêtre (effet : aucun / Mica / Acrylic / vibrancy), densité de l'UI, position de la sidebar (gauche / droite).
  - Curseur : forme (bloc / barre / souligné), clignotement.
  - Terminal : profil par défaut, taille du scrollback, comportement du copier/coller (copie à la sélection, clic droit), confirmations de fermeture.
  - SSH : keepalive, reconnexion auto, `confirmCloseSsh`.
  - SFTP : concurrence, éditeur externe.
  - Divers : restauration de session, mode Quake + raccourci.
  - Raccourcis : dans `keybindings.json`, à part.
- Effets de fenêtre : crate `window-vibrancy` (Mica / Acrylic sous Windows 11, vibrancy sous macOS, opacité sous Linux selon le compositeur).
- Titlebar custom (`decorations: false`) avec zones de drag et boutons natifs dessinés.
- Mode Quake : `tauri-plugin-global-shortcut` + fenêtre dédiée ancrée en haut de l'écran.

### 4.10 Configuration et sécurité
- Fichiers dans `dirs::config_dir()/Tilde/` : `settings.json`, `connections.json`, `keybindings.json`, `themes/*.json`, `known_hosts` non utilisé (on utilise celui d'OpenSSH). Logs dans `dirs::data_local_dir()/Tilde/logs/` (rotation quotidienne, 7 jours).
- Chaque fichier porte `"version": N` ; migrations Rust séquentielles et testées, sauvegarde `.bak` avant toute migration.
- Hot reload avec `notify` (debounce), émission d'un event ; les écritures faites par l'app sont ignorées par le watcher pour éviter les boucles.
- Secrets : `keyring` (service `dev.tilde.app`, compte `<connection-id>:<password|passphrase>`). Jamais dans un fichier, un log (champs filtrés) ou un export.
- **Pas de trousseau disponible** (Linux sans Secret Service, WSL minimal) [choix Claude] : l'option « mémoriser » est désactivée, avec une explication. Les secrets sont redemandés à chaque connexion et gardés en mémoire uniquement le temps de la session de l'app. Un coffre chiffré par mot de passe maître est hors MVP.
- CSP : `default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src ipc: http://ipc.localhost` (`'unsafe-inline'` pour les styles est requis par xterm et Radix ; pas d'`unsafe-eval`). Attention : Tauri injecte des nonces ou des hashes dans la CSP au build, et les navigateurs ignorent alors `'unsafe-inline'`. Il faut donc `dangerousDisableAssetCspModification: ["style-src"]`, et vérifier en build release (pas seulement en dev) que xterm s'affiche correctement.
- Capabilities Tauri minimales : pas de plugin `fs` ni `shell` exposé au front. Plugins utilisés : `opener` (liens), `dialog`, `clipboard-manager`, `global-shortcut`, `single-instance`, `window-state`. Tout accès fichier passe par des commandes Rust dédiées.
- `cargo deny` (licences et avis de sécurité), `cargo audit` en CI, `SECURITY.md`.

---

## 5. Arborescence

```
tilde/
├─ Cargo.toml                    # workspace
├─ rust-toolchain.toml
├─ package.json  pnpm-lock.yaml  vite.config.ts  tsconfig.json  components.json
├─ index.html
├─ src/                          # front React
│  ├─ main.tsx  App.tsx
│  ├─ app/                       # shell UI : titlebar, sidebar, tabs, layout
│  ├─ panels/                    # modules : terminal/, sftp/, editor/, preview/, monitor/
│  ├─ registry/                  # PanelRegistry, CommandRegistry, keybindings
│  ├─ stores/                    # zustand : settings, layout, sessions, connections, themes
│  ├─ themes/                    # thèmes intégrés, tokens, importers/
│  ├─ ipc/                       # wrappers typés des commandes et events Tauri
│  ├─ components/ui/             # shadcn
│  └─ lib/
├─ src-tauri/                    # crate app (fine : câblage, commandes)
│  ├─ src/{main.rs, lib.rs, commands/, state.rs}
│  ├─ capabilities/  icons/  tauri.conf.json
├─ crates/
│  ├─ tilde-ssh-config/          # parser pur, sans I/O réseau, tests++
│  ├─ tilde-config/              # settings, connections, migrations, schéma, watch
│  ├─ tilde-pty/                 # sessions locales, détection des shells
│  ├─ tilde-ssh/                 # russh : connexion, jump, agent, known_hosts, forwards, sftp
│  └─ tilde-session/             # trait TermSession, SessionManager, flux et contrôle de flux
├─ tests/docker/                 # docker-compose : bastion1, bastion2, target (+ clés de test)
├─ docs/                         # architecture.md, specs/, plans/
├─ .github/workflows/            # ci.yml, release.yml
├─ README.md  CONTRIBUTING.md  SECURITY.md  LICENSE-MIT  LICENSE-APACHE
```

Les crates métier ne dépendent pas de Tauri : elles sont testables avec `cargo test` seul.

---

## 6. Phases

Chaque phase se termine par : `cargo test` + `pnpm test` + lint verts, `pnpm tauri build` OK, commit(s) conventionnels, récap « fait / reste », puis **arrêt pour validation par l'auteur**.

1. **Fondations** — workspace Rust + Tauri 2 + React/Vite/Tailwind/shadcn ; titlebar custom, sidebar vide, zone d'onglets ; moteur de thèmes (tokens, Tilde dark/light + 1–2 ports) ; `tilde-config` (settings.json + schéma + migrations + hot reload) ; logging `tracing` + bouton « ouvrir les logs » ; CSP et capabilities ; CI lint/test ; README, licences.
2. **Terminal local** — `tilde-pty` + `tilde-session` (Channel binaire, coalescence, contrôle de flux) ; panneau terminal xterm + addons ; détection des shells et profils ; onglets (DnD, renommage, couleur) ; splits ; recherche, liens, copier/coller, confirmation de fermeture. *Test perf : `cat` d'un fichier de 100 Mo.*
3. **SSH** — `tilde-ssh-config` complet et testé **en premier** ; `tilde-ssh` : connexion, auth (mot de passe, clé, agent), known_hosts + dialogues, ProxyJump chaîné, keepalive, reconnexion, machine d'états, forwards (back-end + UI minimale) ; harnais Docker avec 2 bastions. Connexion via une saisie rapide temporaire.
4. **Sidebar et palette** — `connections.json` (dossiers, couleurs, icônes, tags, favoris, récents) ; section ssh_config en lecture seule + « adopter » ; formulaire d'édition ; recherche floue ; palette `cmdk` + CommandRegistry ; import/export JSON sans secrets.
5. **SFTP** — panneau fichiers, suivi du cwd (OSC 7), opérations, chmod, file de transferts (progression, vitesse, annulation, reprise), édition externe avec ré-upload.
6. **Personnalisation avancée** — éditeur de thème avec aperçu en direct, imports iTerm2 / Windows Terminal / base16, export ; tous les ports de thèmes ; raccourcis reconfigurables ; transparence (Mica/Acrylic/vibrancy) ; mode Quake ; tous les réglages listés.
7. **Modularité** — formalisation et documentation de l'API du registry ; panneaux éditeur (CodeMirror 6), preview (markdown, image, JSON), moniteur système (local via `sysinfo`, distant via SSH `exec` sur `/proc`).
8. **Packaging et CI** — `release.yml` : MSI + NSIS, AppImage + deb, dmg ; tests d'intégration Docker en CI Linux ; emplacements de signature prêts ; finalisation de la doc.

---

## 7. Stratégie de test
- **Rust unitaire** : parser ssh_config (le plus gros corpus), résolution, tokens, known_hosts (hachage, ports, révoqués), migrations de config, détection de shells (fonctions pures sur des entrées simulées), coalescence et contrôle de flux.
- **Rust intégration** (`--features integration`, Docker) : mot de passe, clé, clé avec passphrase, agent, 1 et 2 bastions, ProxyCommand (`ssh -W`), changement d'empreinte, coupure réseau puis reconnexion (tunnels rétablis), SFTP upload / download / reprise, `cat` géant pendant un transfert SFTP (pas de famine entre canaux).
- **Front** : Vitest + Testing Library (stores, arbre de layout, importers de thèmes, registry, composants clés).
- **Manuel par phase** : check-list courte dans le récap.

---

## 8. Laissé au builder
- Noms exacts des commandes et events Tauri, découpage interne des modules.
- Seuils précis de coalescence et de contrôle de flux (à calibrer par mesure).
- Choix des composants shadcn et détails de micro-animation, dans la limite de la direction artistique (coins 6–10 px, 150–200 ms, ombres douces, icônes fines).
- Design du logo autour de `~`.
- Ordre des tâches à l'intérieur d'une phase.
