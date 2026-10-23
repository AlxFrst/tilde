# ~ Tilde

**Un terminal moderne, centré SSH/SFTP, open source et gratuit.**

Tilde veut une chose avant tout : que la connexion SSH marche du premier coup, y compris
derrière des bastions en chaîne, avec votre `~/.ssh/config` tel quel, et sans abonnement.
Le tout dans une interface soignée, rapide et entièrement personnalisable.

> 🚧 **En développement.** La phase 1 (fondations) est terminée : coquille de l'application,
> moteur de thèmes et réglages. Le terminal local arrive en phase 2, SSH en phase 3.
> Voir la [feuille de route](#feuille-de-route).

## Fonctionnalités (aujourd'hui)

- Fenêtre sans bordure avec titlebar intégrée, sidebar, barre d'onglets
- Thèmes par design tokens : **Tilde** (sombre/clair), **Catppuccin** (Mocha/Latte), suivi
  automatique du thème de l'OS
- `settings.json` versionné, validé et **rechargé à chaud**, avec autocomplétion dans VS Code
  grâce au JSON Schema fourni
- Logs structurés, accessibles depuis l'interface
- Aucune télémétrie, aucune requête réseau

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
  `sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev libayatana-appindicator3-dev patchelf`
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
2. Terminal local : PTY, onglets, splits, profils de shells
3. SSH : `ssh_config`, known_hosts, agent, ProxyJump, ProxyCommand
4. Sidebar de connexions et palette de commandes
5. SFTP
6. Personnalisation avancée : éditeur et import de thèmes, raccourcis, transparence
7. Panneaux modulaires : éditeur, preview, moniteur
8. Packaging et CI multiplateforme

## Contribuer

Voir [CONTRIBUTING.md](CONTRIBUTING.md). Failles de sécurité : [SECURITY.md](SECURITY.md).

## Licence

Au choix : [MIT](LICENSE-MIT) ou [Apache-2.0](LICENSE-APACHE).
