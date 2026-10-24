<div align="center">

<img src="docs/logo.svg" alt="Logo de Tilde" width="96" height="96" />

# Tilde

</div>

*[English](README.md) · Français*

**Un terminal moderne, centré SSH/SFTP, open source et gratuit.**

Tilde veut une chose avant tout : que la connexion SSH marche du premier coup, y compris
derrière des bastions en chaîne, avec votre `~/.ssh/config` tel quel, et sans abonnement.
Le tout dans une interface soignée, rapide et entièrement personnalisable.

> 🚧 **Version 0.1** : première version publique. Voir la [feuille de route](#feuille-de-route).

## Installer

Téléchargez l'installeur de votre système depuis les
[releases GitHub](https://github.com/AlxFrst/tilde/releases/latest) :

| Système | Fichier |
|---|---|
| Windows 10/11 | `Tilde_x.y.z_x64-setup.exe` (sans droits administrateur) ou `.msi` |
| macOS 11+ (Apple Silicon et Intel) | `Tilde_x.y.z_universal.dmg` |
| Linux | `.AppImage` (toutes distributions) ou `.deb` (Debian, Ubuntu) |

Les installeurs ne sont pas encore signés. Windows SmartScreen affiche « Windows a protégé
votre ordinateur » : cliquez sur *Informations complémentaires* puis *Exécuter quand même*.
Sous macOS, faites un clic droit sur l'app, puis *Ouvrir*. Les sommes SHA-256 sont dans
`SHA256SUMS.txt` (voir [docs/release.md](docs/release.md)).

Tilde se met ensuite à jour tout seul : au démarrage, au plus une fois par jour, il propose
la nouvelle version, et la mise à jour est vérifiée par signature. C'est désactivable dans
Réglages → Général.

## Fonctionnalités (aujourd'hui)

- **Terminal local** : PowerShell 7, Windows PowerShell, cmd, Git Bash et chaque
  distribution WSL détectés automatiquement (bash/zsh/fish sous Linux et macOS)
- **Le Rail** à la place des onglets : vos serveurs **épinglés** (en sommeil tant qu'ils ne
  sont pas ouverts), les sessions **d'aujourd'hui**, et sous chaque session ses panneaux
  (shells, fichiers, moniteur) ; **espaces** à la Arc (Pro, Perso, Homelab…) avec leur
  couleur ; **Bibliothèque** (Ctrl+Maj+L) pour toutes les connexions et `~/.ssh/config`
- En-tête de session (Fichiers, Moniteur, Tunnels, Nouveau shell, Diviser), en-têtes de
  panneau (diviser, fermer), cadre de couleur d'environnement, moniteur en aperçu
- **Splits** redimensionnables, sessions renommables et colorables
- Rendu WebGL (xterm.js), Unicode/emoji, recherche dans le scrollback, liens cliquables,
  copie à la sélection, confirmation avant de coller plusieurs lignes
- Confirmation avant de fermer un terminal où un programme tourne
- Onglets et splits **restaurés** au redémarrage (dans le dernier dossier connu)
- Profils personnalisés dans `settings.json` (commande, arguments, dossier, variables,
  couleur), ou masquage d'un shell détecté
- Fenêtre sans bordure ; sous Windows, « Ouvrir dans Tilde » dans le menu de l'Explorateur
- **14 thèmes** : Tilde, Catppuccin, Tokyo Night, Dracula, Nord, Gruvbox, One, Rosé Pine
  (sombres et clairs), suivi automatique du thème de l'OS
- **Personnalisation** (voir [docs/personnalisation.md](docs/personnalisation.md)) :
  - éditeur de thèmes avec aperçu en direct ;
  - import iTerm2, Windows Terminal et base16, et export ;
  - raccourcis reconfigurables ;
  - Mica, Acrylic, vibrancy et opacité ;
  - mode Quake ;
  - ligatures ;
  - une page de réglages qui couvre tout
- `settings.json` versionné, validé et **rechargé à chaud**, avec autocomplétion dans VS Code
  grâce au JSON Schema fourni
- Logs structurés, accessibles depuis l'interface
- **SSH** (voir [plus bas](#ssh)) : votre `~/.ssh/config` tel quel, bastions en chaîne,
  agent, reconnexion automatique, tunnels
- **Connexions enregistrées** dans le Rail (voir [plus bas](#connexions)) et **palette de
  commandes** (Ctrl+Maj+P) : connexions, sessions, espaces, commandes, et → pour les actions
  d'un serveur
- **Fichiers (SFTP)** sur la même connexion que le terminal (voir [plus bas](#fichiers-sftp))
- **Éditeur intégré**, **aperçu** et **moniteur système** à côté du terminal (voir
  [plus bas](#éditeur-aperçu-et-moniteur))
- Aucune télémétrie : la seule requête que Tilde fait d'elle-même est la vérification
  quotidienne des mises à jour (désactivable)

## Raccourcis

| Raccourci | Action |
|---|---|
| Ctrl+Maj+T | Nouvelle session (shell par défaut) |
| Ctrl+Maj+W | Fermer la session |
| Ctrl+Tab / Ctrl+Maj+Tab | Session suivante / précédente de l'espace |
| Ctrl+Maj+1 … 9, Ctrl+Maj+Page suiv. / préc. | Aller à un espace, espace suivant / précédent |
| Ctrl+Maj+L | Bibliothèque |
| Ctrl+Maj+B | Masquer / afficher le Rail |
| Alt+Maj+= | Diviser à droite |
| Alt+Maj+- | Diviser en bas |
| Ctrl+Maj+X | Fermer le panneau |
| Alt+← ↑ → ↓ | Changer de panneau |
| Ctrl+C (avec une sélection) / Ctrl+V, ou Ctrl+Maj+C / Ctrl+Maj+V | Copier / coller (Ctrl+C sans sélection interrompt la commande) |
| Ctrl+Maj+F | Rechercher |
| Ctrl+Maj+K | Connexion SSH |
| Ctrl+Maj+P | Palette de commandes (connexions et commandes) |
| Ctrl+Maj+E | Afficher / masquer les fichiers (SFTP) de la session SSH |

Les lettres suivent la touche **imprimée** (Ctrl+Maj+W = la touche W, y compris en AZERTY).
Les symboles suivent la **position physique** (disposition US) : sur un clavier AZERTY,
« Alt+Maj+- » se fait avec la touche `)`, et l’écran d’accueil affiche les touches de votre
clavier. Le `+` et le `-` du pavé numérique fonctionnent aussi.

Tous ces raccourcis se changent dans **Réglages → Raccourcis** ou dans `keybindings.json`
(voir [docs/personnalisation.md](docs/personnalisation.md#raccourcis)).

### Profils personnalisés

```jsonc
// settings.json
"terminal": { "defaultProfile": "wsl:Ubuntu" },
"profiles": [
  // Masquer un shell détecté
  { "id": "cmd", "hidden": true },
  // Surcharger un shell détecté (même id)
  { "id": "pwsh", "color": "#7AA2F7", "env": { "EDITOR": "code --wait" } },
  // Ajouter un profil
  { "id": "htop", "name": "htop (WSL)", "command": "wsl.exe", "args": ["-e", "htop"] }
]
```

Pour que Tilde restaure le dossier courant d'un onglet, le shell doit émettre la séquence
OSC 7 (c'est le cas par défaut de nombreuses configurations bash/zsh/fish sous Linux et macOS).

## SSH

**Ctrl+Maj+K** (ou « Connexion SSH » dans le menu `+` et sur l'écran d'accueil) : tapez un
alias de `~/.ssh/config` (proposé à la saisie) ou `user@hôte:port`, puis Entrée.

Ce qui est pris en charge :

- **`~/.ssh/config`** lu comme OpenSSH (la première valeur gagne, `Include`, `Host`/`Match`
  avec motifs, `%h %p %r…`). Les problèmes sont journalisés avec fichier:ligne et les autres
  hôtes restent utilisables. Les `Match exec` ne sont pas évalués.
- **Bastions** : `ProxyJump a,b,c` (chaque saut est vérifié et authentifié) et
  **`ProxyCommand`** (lancé par `cmd /C` sous Windows, `sh -c` ailleurs ; sa sortie d'erreur
  apparaît dans le message en cas d'échec).
- **`known_hosts`** d'OpenSSH (entrées hachées, `[hôte]:port`, motifs, `@revoked`). Un hôte
  inconnu affiche son empreinte avant tout ; une empreinte **modifiée** est refusée par défaut,
  et la remplacer demande une confirmation explicite.
- **Authentification**, dans cet ordre : agent, `IdentityFile`, clés par défaut
  (`id_ed25519`, `id_ecdsa`, `id_rsa`), keyboard-interactive (2FA), mot de passe.
  `IdentitiesOnly yes` est respecté.
- **Agent** : `SSH_AUTH_SOCK` s'il est défini ; sinon, sous Windows, l'agent OpenSSH
  (`\\.\pipe\openssh-ssh-agent`, service « OpenSSH Authentication Agent ») puis Pageant.
  `ForwardAgent yes` transmet l'agent au serveur.
- **Keepalive** (`ServerAliveInterval`/`ServerAliveCountMax`, sinon `ssh.keepaliveIntervalSecs`
  et `ssh.keepaliveCountMax`) et **reconnexion automatique** (`ssh.autoReconnect`) : 1, 2, 4,
  8, 16 puis 30 s entre les tentatives, une ligne « reconnecté » marque le nouveau shell.
  Une authentification refusée arrête les tentatives.
- **Tunnels** : `LocalForward`/`RemoteForward` de la config ouverts automatiquement, et menu
  de l'onglet → « Tunnels… » pour en ajouter ou en arrêter. Ils survivent aux reconnexions.

**Secrets.** Les mots de passe et phrases secrètes ne sont mémorisés que si vous cochez
« Mémoriser dans le trousseau », et uniquement dans le trousseau du système (Gestionnaire
d'identification Windows, Trousseau macOS, Secret Service sous Linux), service
`dev.tilde.app`. Jamais dans `settings.json`, `workspace.json` ni les logs.

Fermer une session SSH connectée demande toujours confirmation, sauf si
`ssh.confirmCloseSsh` vaut `false`.

## Connexions

Le Rail range les serveurs de l'**espace** affiché : les **Favoris** en tuiles, puis
**Épinglés** (vos **dossiers**, couleur, repliables, et les connexions hors dossier), et
**Aujourd'hui** pour les autres sessions. Les hôtes de **`~/.ssh/config`** sont dans la
**Bibliothèque** (Ctrl+Maj+L), en lecture seule.

- Un clic ou Entrée ouvre la session épinglée d'une connexion (ou l'affiche si elle est déjà
  ouverte) ; ↑/↓ pour se déplacer ; la palette et la Bibliothèque cherchent par nom, hôte,
  utilisateur et tags, sans tenir compte des accents.
- **Espaces** : « + Nouvel espace » en bas du Rail (nom, couleur, icône). Clic droit sur une
  session ou une connexion : « Déplacer vers l'espace ». Supprimer un espace ne ferme rien.
- `+` (Épinglés) → « Nouvelle connexion… » : nom, hôte (ou alias de `~/.ssh/config`), port,
  utilisateur, clé, rebonds (choisis dans une liste), transfert d'agent, espace, dossier, tags,
  couleur, icône. Pour un alias, les réglages
  de `~/.ssh/config` s'appliquent et les champs remplis les remplacent.
- Un hôte de `~/.ssh/config` s'**adopte** d'un clic dans la Bibliothèque (dans l'espace
  affiché) pour lui donner un dossier, une couleur ou des tags. Votre `~/.ssh/config` n'est jamais modifié.
- Clic droit : ouvrir, ouvrir une autre session, modifier, dupliquer, favori, ranger dans un
  dossier, déplacer vers un espace, supprimer. On peut aussi glisser une connexion sur un
  dossier.
- **Import / export** (menu `+` ou palette) : un fichier JSON **sans aucun secret**. À l'import,
  les doublons (même hôte, utilisateur et port) sont ignorés et les dossiers fusionnés par nom.

Tout est dans `connections.json`, à côté de `settings.json`, éditable à la main (schéma JSON
fourni pour l'autocomplétion, rechargement à chaud). S'il contient une erreur, Tilde l'affiche
avec la ligne et ne l'écrase jamais. Les mots de passe restent dans le trousseau du système.

## Fichiers (SFTP)

Depuis un onglet SSH : **Ctrl+Maj+E** (ou clic droit sur l'onglet → « Fichiers… »). Le panneau
s'ouvre à droite du terminal, sur la même connexion : pas de seconde authentification, et il
revient tout seul après une reconnexion.

- **Il suit votre `cd`** si le shell distant signale son dossier (séquence OSC 7). Sinon, le
  panneau propose la ligne à ajouter à `~/.bashrc`, `~/.zshrc` ou `config.fish`. Naviguer à la
  main détache le suivi ; le bouton 🔗 le rétablit.
- Double-clic sur un dossier pour y entrer, sur un fichier pour le télécharger (dans
  *Téléchargements*, sans jamais écraser un fichier existant). Retour arrière : dossier
  parent ; Suppr : supprimer ; F2 : renommer. Ctrl et Maj pour la sélection multiple.
- Clic droit : télécharger, télécharger vers…, **modifier** dans votre éditeur, renommer,
  permissions (octal + cases à cocher), copier le chemin, supprimer. Les suppressions
  demandent confirmation ; un lien symbolique est supprimé sans toucher à sa cible.
- **Nouveau fichier**, **nouveau dossier** : boutons de la barre d'outils. Le fichier créé
  s'ouvre dans l'éditeur ; un fichier existant n'est jamais écrasé.
- **Envoyer** : bouton ⬆ ou glisser-déposer des fichiers et dossiers depuis l'explorateur.
- **Transferts** (icône dans la barre de titre) : progression, vitesse, temps restant,
  annulation. « Réessayer » **reprend** où le transfert s'est arrêté. Trois transferts à la
  fois par défaut (`sftp.concurrency`).
- **Édition** : « Modifier » ouvre le fichier dans l'éditeur intégré ou dans votre éditeur,
  au choix (`sftp.editorMode`).
  - L'éditeur externe est `sftp.externalEditor` (par exemple `code --wait`), à défaut
    l'éditeur de texte du système. Chaque enregistrement est renvoyé sur le serveur.
  - Dans les deux cas, si le fichier a changé sur le serveur entre-temps, Tilde ne l'écrase
    pas et vous demande quelle version garder.
- **Aperçu** (clic droit) des fichiers Markdown, JSON et des images.
- Un nom de fichier distant ne peut jamais faire écrire en dehors du dossier choisi (`..`,
  noms réservés Windows, caractères interdits).

## Éditeur, aperçu et moniteur

Chaque panneau s'ouvre à côté du panneau actif.

- **Éditeur** (« Modifier » dans les fichiers, ou « Ouvrir un fichier… » dans la palette) :
  - coloration de plus de 15 langages, numéros de ligne, repli, recherche (Ctrl+F) ;
  - Ctrl+S enregistre ; un point signale les modifications non enregistrées, et fermer
    demande toujours confirmation ;
  - si le fichier a changé ailleurs entre-temps, un bandeau propose « Écraser » ou
    « Recharger » ;
  - les fichiers binaires et ceux de plus de 5 Mio sont refusés et renvoyés vers l'éditeur
    externe ;
  - un fichier local ne s'ouvre que par le dialogue du système.
- **Aperçu** :
  - Markdown, rendu sans HTML brut ; seuls les liens web s'ouvrent, dans le navigateur ;
  - JSON en arbre repliable, avec la position de l'erreur s'il est invalide ;
  - images.
  
  Depuis l'éditeur, l'aperçu suit le texte pendant la frappe.
- **Moniteur système** (bouton « Moniteur » de l'en-tête de session, ou la palette) :
  - processeur, mémoire, réseau, disques, charge et uptime, actualisés toutes les 2 s tant
    que le panneau est visible ;
  - pour un serveur, Tilde lit `/proc` par la connexion SSH déjà ouverte : rien à installer.
    Seul Linux est pris en charge.
- **Bandeau d'état** sous chaque session SSH : processeur, mémoire, disque et charge du
  serveur en une ligne. Tilde lit `/proc` et lance `df` (disques locaux) toutes les 3 s par
  la connexion ouverte, ce qui apparaît dans les journaux d'audit du serveur. Désactivable
  dans *Réglages → SSH → Bandeau d'état du serveur*.

Ces panneaux sont des modules du registre décrit dans [docs/panneaux.md](docs/panneaux.md).

## Prérequis

| Outil | Version |
|---|---|
| [Rust](https://rustup.rs) (via rustup) | la version de `rust-toolchain.toml` est installée automatiquement |
| [Node.js](https://nodejs.org) | 24+ |
| [pnpm](https://pnpm.io) | 10+ |

Dépendances système de Tauri :

- **Windows** : WebView2 (présent sur Windows 10/11) et les « Build Tools for Visual Studio »
  (composant C++).
- **Linux (Debian/Ubuntu)** :
  `sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev libayatana-appindicator3-dev patchelf libdbus-1-dev pkg-config`
- **macOS** : Xcode Command Line Tools (`xcode-select --install`).

Détails : [prérequis Tauri](https://tauri.app/start/prerequisites/).

## Développer

```sh
pnpm install
pnpm tauri dev          # lance l'app avec rechargement à chaud
```

| Commande | Rôle |
|---|---|
| `pnpm test` | tests front (Vitest) |
| `cargo test --workspace` | tests Rust |
| `pnpm lint` / `pnpm typecheck` | ESLint / TypeScript |
| `cargo clippy --workspace --all-targets -- -D warnings` | lint Rust |
| `pnpm gen:types` | régénère le JSON Schema et les types TS des réglages |
| `scripts/ssh-test-env.sh up` puis `cargo test -p tilde-ssh --features integration` | tests SSH contre un banc Docker (2 bastions + 1 cible, voir [tests/docker](tests/docker/README.md)) |
| `pnpm tauri build` | produit les installeurs (MSI/NSIS sous Windows) ; voir [docs/release.md](docs/release.md) pour publier une version |

Les types TypeScript des réglages sont **générés** depuis Rust : après avoir modifié
`crates/tilde-config/src/settings.rs`, lancez `pnpm gen:types` et commitez le résultat
(la CI le vérifie).

## Où sont mes fichiers ?

| | Windows | Linux | macOS |
|---|---|---|---|
| Réglages | `%APPDATA%\Tilde\settings.json` | `~/.config/Tilde/settings.json` | `~/Library/Application Support/Tilde/settings.json` |
| Connexions | `%APPDATA%\Tilde\connections.json` | `~/.config/Tilde/connections.json` | `~/Library/Application Support/Tilde/connections.json` |
| Raccourcis | `%APPDATA%\Tilde\keybindings.json` | `~/.config/Tilde/keybindings.json` | `~/Library/Application Support/Tilde/keybindings.json` |
| Thèmes | `%APPDATA%\Tilde\themes\` | `~/.config/Tilde/themes/` | `~/Library/Application Support/Tilde/themes/` |
| Logs | `%LOCALAPPDATA%\Tilde\logs\` | `~/.local/share/Tilde/logs/` | `~/Library/Application Support/Tilde/logs/` |

Ils sont aussi accessibles depuis **Réglages → Général** dans l'application. Si `settings.json`
contient une erreur, Tilde garde la dernière configuration valide, vous indique la ligne
fautive et n'écrase jamais votre fichier.

## Architecture

Voir [docs/architecture.md](docs/architecture.md) et le
[document de conception](docs/superpowers/specs/2026-10-23-tilde-design.md).

## Feuille de route

1. ✅ Fondations : coquille, thèmes, réglages
2. ✅ Terminal local : PTY, onglets, splits, profils de shells
3. ✅ SSH : `ssh_config`, known_hosts, agent, ProxyJump, ProxyCommand, tunnels
4. ✅ Sidebar de connexions et palette de commandes
5. ✅ SFTP
6. ✅ Personnalisation avancée : éditeur et import de thèmes, raccourcis, transparence, mode Quake
7. ✅ Panneaux modulaires : éditeur, aperçu, moniteur
8. ✅ Packaging et CI multiplateforme, le Rail et les espaces

## Contribuer

Voir [CONTRIBUTING.md](CONTRIBUTING.md). Failles de sécurité : [SECURITY.md](SECURITY.md).

## Licence

Au choix : [MIT](LICENSE-MIT) ou [Apache-2.0](LICENSE-APACHE).
