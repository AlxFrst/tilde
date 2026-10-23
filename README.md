# ~ Tilde

**Un terminal moderne, centré SSH/SFTP, open source et gratuit.**

Tilde veut une chose avant tout : que la connexion SSH marche du premier coup, y compris
derrière des bastions en chaîne, avec votre `~/.ssh/config` tel quel, et sans abonnement.
Le tout dans une interface soignée, rapide et entièrement personnalisable.

> 🚧 **En développement.** Les phases 1 (fondations), 2 (terminal local) et 3 (SSH) sont
> terminées. Voir la [feuille de route](#feuille-de-route).

## Fonctionnalités (aujourd'hui)

- **Terminal local** : PowerShell 7, Windows PowerShell, cmd, Git Bash et chaque
  distribution WSL détectés automatiquement (bash/zsh/fish sous Linux et macOS)
- Onglets (glisser-déposer, renommage, couleur) et **splits** redimensionnables
- Rendu WebGL (xterm.js), Unicode/emoji, recherche dans le scrollback, liens cliquables,
  copie à la sélection, confirmation avant de coller plusieurs lignes
- Confirmation avant de fermer un terminal où un programme tourne
- Onglets et splits **restaurés** au redémarrage (dans le dernier dossier connu)
- Profils personnalisés dans `settings.json` (commande, arguments, dossier, variables,
  couleur), ou masquage d'un shell détecté
- Fenêtre sans bordure avec titlebar intégrée
- Thèmes par design tokens : **Tilde** (sombre/clair), **Catppuccin** (Mocha/Latte), suivi
  automatique du thème de l'OS
- `settings.json` versionné, validé et **rechargé à chaud**, avec autocomplétion dans VS Code
  grâce au JSON Schema fourni
- Logs structurés, accessibles depuis l'interface
- **SSH** (voir [plus bas](#ssh)) : votre `~/.ssh/config` tel quel, bastions en chaîne,
  agent, reconnexion automatique, tunnels
- Aucune télémétrie ; aucune requête réseau en dehors des connexions que vous ouvrez

## Raccourcis

| Raccourci | Action |
|---|---|
| Ctrl+Maj+T | Nouvel onglet (profil par défaut) |
| Ctrl+Maj+W | Fermer l'onglet |
| Ctrl+Tab / Ctrl+Maj+Tab | Onglet suivant / précédent |
| Alt+Maj+= | Diviser à droite |
| Alt+Maj+- | Diviser en bas |
| Ctrl+Maj+X | Fermer le panneau |
| Alt+← ↑ → ↓ | Changer de panneau |
| Ctrl+Maj+C / Ctrl+Maj+V | Copier / coller |
| Ctrl+Maj+F | Rechercher |
| Ctrl+Maj+K | Connexion SSH |

Les lettres suivent la touche **imprimée** (Ctrl+Maj+W = la touche W, y compris en AZERTY).
Les symboles suivent la **position physique** (disposition US) : sur un clavier AZERTY,
« Alt+Maj+- » se fait avec la touche `)`, et l’écran d’accueil affiche les touches de votre
clavier. Le `+` et le `-` du pavé numérique fonctionnent aussi. Ils deviendront
configurables en phase 6.

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

Fermer un onglet SSH connecté demande toujours confirmation, sauf si
`ssh.confirmCloseSsh` vaut `false`.

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
| `pnpm tauri build` | produit les installeurs (MSI/NSIS sous Windows) |

Les types TypeScript des réglages sont **générés** depuis Rust : après avoir modifié
`crates/tilde-config/src/settings.rs`, lancez `pnpm gen:types` et commitez le résultat
(la CI le vérifie).

## Où sont mes fichiers ?

| | Windows | Linux | macOS |
|---|---|---|---|
| Réglages | `%APPDATA%\Tilde\settings.json` | `~/.config/Tilde/settings.json` | `~/Library/Application Support/Tilde/settings.json` |
| Logs | `%LOCALAPPDATA%\Tilde\logs\` | `~/.local/share/Tilde/logs/` | `~/Library/Application Support/Tilde/logs/` |

Les deux sont aussi accessibles depuis **Réglages** dans l'application. Si `settings.json`
contient une erreur, Tilde garde la dernière configuration valide, vous indique la ligne
fautive et n'écrase jamais votre fichier.

## Architecture

Voir [docs/architecture.md](docs/architecture.md) et le
[document de conception](docs/superpowers/specs/2026-10-23-tilde-design.md).

## Feuille de route

1. ✅ Fondations : coquille, thèmes, réglages
2. ✅ Terminal local : PTY, onglets, splits, profils de shells
3. ✅ SSH : `ssh_config`, known_hosts, agent, ProxyJump, ProxyCommand, tunnels
4. Sidebar de connexions et palette de commandes
5. SFTP
6. Personnalisation avancée : éditeur et import de thèmes, raccourcis, transparence
7. Panneaux modulaires : éditeur, preview, moniteur
8. Packaging et CI multiplateforme

## Contribuer

Voir [CONTRIBUTING.md](CONTRIBUTING.md). Failles de sécurité : [SECURITY.md](SECURITY.md).

## Licence

Au choix : [MIT](LICENSE-MIT) ou [Apache-2.0](LICENSE-APACHE).
