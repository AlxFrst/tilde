# Phase 8 — Packaging et CI : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tilde se publie. Un tag `v*` produit une release GitHub en brouillon avec les installeurs Windows (MSI + NSIS), Linux (AppImage + deb) et macOS (dmg universel), et leurs sommes SHA-256. La signature est prête : il suffit d'ajouter les secrets. Le dépôt se présente avec un README complet en anglais, captures d'écran comprises.

**Architecture:**
- Les métadonnées d'installation vivent dans `src-tauri/tauri.conf.json`.
- Un workflow `release.yml` utilise `tauri-apps/tauri-action`, piloté par le tag. Le même workflow construit sans publier sur les PR qui le touchent : le packaging est vérifié avant le premier tag.
- Un script vérifie que les versions de `package.json`, `Cargo.toml` et `tauri.conf.json` concordent avec le tag.
- La documentation publique passe en anglais. La version française du README est conservée.

**Tech Stack:** GitHub Actions, `tauri-apps/tauri-action@v0`, `rhysd/actionlint`, WiX / NSIS (Tauri), Node 24 pour les scripts.

**Spec:** `docs/superpowers/specs/2026-10-23-tilde-design.md` (§2 « Exigences », §3 « Signature des builds », §6 phase 8). Demande de l'auteur (mémoire) : README en anglais, complet et professionnel, avec captures d'écran.

## Global Constraints

- Tout ce qui précède reste valable (commits conventionnels + `Co-Authored-By`, aucun secret dans le dépôt ni dans les logs).
- Cibles : Windows **MSI + NSIS**, Linux **AppImage + deb**, macOS **dmg**.
- Pas de signature au départ. La CI doit être « prête à recevoir les secrets (certificat Windows, notarisation Apple) sans autre modification ».
- **Mise à jour intégrée** : décision de l'auteur pendant la phase 8, qui lève ce non-objectif. Elle s'installe en un clic et se vérifie au démarrage, au plus une fois par jour, avec un réglage pour la désactiver. Les mises à jour sont signées par la clé du plugin updater de Tauri, indépendante des certificats OS.
- Aucune publication réelle sans l'accord de l'auteur. Pousser un tag ou publier une release est une action externe : la PR ne fait que construire.
- Ne pas lancer l'app sans l'accord de l'auteur. Les captures d'écran demandent son feu vert, ou ses propres captures.

## Review Focus

1. **Tag dont la version ne correspond pas aux fichiers** (`v0.2.0` alors que `package.json` dit 0.1.0) : la release échoue tôt, avec un message clair, avant tout build. Test : Task 1 `check-version` (Vitest).
2. **Secrets de signature absents** (fork, premier tag) : la build réussit sans signature. **Secrets présents** : ils sont utilisés et n'apparaissent dans aucun log. Revue de `release.yml`, et build PR sans secrets.
3. **Workflow invalide** (expression, contexte, permission) : détecté en PR par actionlint, pas au premier tag. Test : job `actionlint`.
4. **Installeur Windows** : l'installation se fait sans droits administrateur (par utilisateur), et WebView2 est téléchargé s'il manque. Test : Task 1 `bundle config` (Vitest), plus la build MSI/NSIS locale.
5. **README** : chaque lien relatif pointe vers un fichier existant, et chaque image référencée existe. Test : Task 3 `docs links` (Vitest).

---

### Task 1 : Métadonnées d'installation et concordance des versions

**Files:**
- Create: `scripts/check-version.mjs`, `scripts/versions.mjs` (pur), `src/test/release.test.ts`
- Modify: `src-tauri/tauri.conf.json`, `package.json` (script `check-version`)

**Interfaces:**
- `scripts/versions.mjs` :
  - `readVersions(root) → { packageJson, cargo, tauri }` ;
  - `versionProblem(versions, tag?) → string | null` : versions différentes entre elles, ou différentes du tag privé de son `v`.
- `scripts/check-version.mjs [tag]` : sort avec le code 1 et un message en cas de problème.
- `tauri.conf.json > bundle` :
  - `publisher`, `copyright`, `category: "DeveloperTool"`, `shortDescription`, `longDescription`, `homepage` ;
  - `windows.webviewInstallMode: { type: "downloadBootstrapper" }` ;
  - `windows.nsis: { installMode: "currentUser", languages: ["English", "French"], displayLanguageSelector: false }` ;
  - `windows.wix.language: ["en-US", "fr-FR"]` ;
  - `macOS.minimumSystemVersion: "11.0"` ;
  - `linux.deb.depends` (WebKitGTK 4.1, libayatana-appindicator) et `linux.appimage.bundleMediaFramework: false`.

- [ ] **Step 1 :** tests `src/test/release.test.ts` :
  - `versions agree across package.json, Cargo.toml and tauri.conf.json` ;
  - `a tag that does not match is refused` (`v0.2.0` contre 0.1.0, avec un message nommant les deux) ;
  - `bundle config targets per-user installs with WebView2 bootstrap` ;
  - `bundle config declares every target the spec asks for` (`targets` est `all`, ou liste `msi`, `nsis`, `appimage`, `deb`, `dmg`).
- [ ] **Step 2 :** `pnpm vitest run src/test/release` → FAIL.
- [ ] **Step 3 :** implémenter.
- [ ] **Step 4 :** `pnpm test` → PASS ; `node scripts/check-version.mjs v0.1.0` → code 0 ; `node scripts/check-version.mjs v9.9.9` → code 1.
- [ ] **Step 5 :** commit `build: installer metadata and version consistency check`.

### Task 2 : Workflow de release et lint des workflows

**Files:**
- Create: `.github/workflows/release.yml`, `docs/release.md` (procédure, signature)
- Modify: `.github/workflows/ci.yml` (job `actionlint`)

**Interfaces:**
- Déclencheurs de `release.yml` :
  - `push: tags: ['v*']` : build et release en brouillon ;
  - `workflow_dispatch` ;
  - `pull_request` limité à `.github/workflows/release.yml` et `src-tauri/tauri.conf.json` : build seule, artefacts téléversés, aucune release.
- Jobs :
  1. `check` : `node scripts/check-version.mjs ${{ github.ref_name }}` (sur tag uniquement).
  2. `build` en matrice :
     - `windows-latest` → msi, nsis ;
     - `ubuntu-22.04` → appimage, deb ;
     - `macos-latest` → `--target universal-apple-darwin`, dmg.
     
     Étapes : setup Node, pnpm et Rust (+ cibles macOS), dépendances Linux, puis `tauri-apps/tauri-action@v0`. Sur tag, avec `tagName` et `releaseDraft: true` ; sinon sans release, avec `actions/upload-artifact`.
  3. `checksums` (sur tag) : télécharge les assets de la release brouillon, écrit `SHA256SUMS.txt` et le téléverse.
- Signature, passée par variables d'environnement (vides si le secret manque) :
  - macOS : `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` ;
  - Windows : étape d'import du certificat `WINDOWS_CERTIFICATE` (base64, PFX) et `WINDOWS_CERTIFICATE_PASSWORD`, exécutée seulement si le secret existe, puis `certificateThumbprint` passé à Tauri par `TAURI_CONFIG`.
- Permissions minimales : `contents: write` seulement pour la release, `contents: read` ailleurs.
- `ci.yml` : job `actionlint` (`rhysd/actionlint` via son script officiel, version épinglée).

- [ ] **Step 1 :** écrire `release.yml` et le job `actionlint`.
- [ ] **Step 2 :** pousser la branche. Attendu : `actionlint` est vert, et la build PR de `release.yml` produit les 5 installeurs en artefacts sur les 3 OS.
- [ ] **Step 3 :** `docs/release.md` :
  - publier une version (bump, tag, release brouillon relue puis publiée) ;
  - ajouter les secrets de signature (où les obtenir, noms exacts) ;
  - vérifier les sommes SHA-256.
- [ ] **Step 4 :** commit `ci: release workflow building MSI, NSIS, AppImage, deb and dmg`.

### Task 3 : Mise à jour intégrée

**Files:**
- Create: `src-tauri/src/updater.rs`, `src/ipc/updates.ts`, `src/app/updates.ts`, `src/app/updates.test.ts`
- Modify:
  - `src-tauri/Cargo.toml` (`tauri-plugin-updater = "2"`), `src-tauri/src/lib.rs` ;
  - `src-tauri/tauri.conf.json` (`plugins.updater { pubkey, endpoints }`, `bundle.createUpdaterArtifacts: true`) ;
  - `crates/tilde-config/src/settings.rs` (`general.checkUpdates: bool`, défaut `true`), le schéma et les types générés ;
  - `src/app/settings/GeneralSection.tsx`, `src/commands/builtin.ts` (`app.checkUpdates`), `src/App.tsx` ;
  - `.github/workflows/release.yml` (clé de signature des mises à jour) ;
  - `SECURITY.md` et `docs/release.md`.

**Interfaces:**
- Rust (`updater.rs`) :
  - `update_check() -> Option<UpdateInfoDto { version, notes, date }>` ;
  - `update_install()` : télécharge et installe, avec la progression sur `update://progress { downloaded, total }`, puis `app.restart()`.
  
  L'updater n'est utilisé que depuis Rust : aucune permission front.
- Endpoint : `https://github.com/AlxFrst/tilde/releases/latest/download/latest.json`. `tauri-action` le produit pour une release publiée ; un brouillon ne le sert donc jamais.
- Clé :
  - générée par `tauri signer generate`, enregistrée hors du dépôt (`~/.tauri/tilde-updater.key`) ;
  - la clé publique va dans `tauri.conf.json` ;
  - la clé privée est le secret `TAURI_SIGNING_PRIVATE_KEY`, que l'auteur ajoute lui-même.
  
  Sans ce secret, `release.yml` désactive `createUpdaterArtifacts` (via `--config`) au lieu d'échouer.
- Front (`src/app/updates.ts`) :
  - `shouldAutoCheck(settings, lastCheck: number | null, now: number): boolean` : réglage actif, et dernière vérification il y a plus de 24 h. L'horodatage est conservé dans `localStorage`, avec try/catch ;
  - `checkForUpdates({ manual }): Promise<void>` :
    - en automatique, un échec est silencieux ;
    - en manuel, « Tilde est à jour » ou l'erreur ;
    - si une version est disponible : toast « Tilde X.Y.Z est disponible » avec l'action « Mettre à jour » → `confirmClose(allSessions(), dirtyEditors())` → `updateInstall()`, avec un toast de progression.
  - Fenêtre principale seulement (pas Quake).

- [ ] **Step 1 :** tests `src/app/updates.test.ts` :
  - `checks at most once a day, only when enabled` ;
  - `a failed automatic check stays silent, a manual one says why` ;
  - `installing asks first when sessions or editors would be lost`.
  
  Rust : `settings` (défaut `checkUpdates = true`), snapshot du schéma.
- [ ] **Step 2 :** `pnpm vitest run src/app/updates` → FAIL.
- [ ] **Step 3 :** implémenter, générer la clé et mettre à jour `release.yml` et la documentation.
- [ ] **Step 4 :** `pnpm test`, `cargo test --workspace`, `cargo clippy --workspace --all-targets -- -D warnings` et `pnpm gen:types` → PASS, sans écart.
- [ ] **Step 5 :** commit `feat(app): built-in updates from GitHub releases`.

### Task 4 : Documentation publique en anglais

**Files:**
- Create: `README.fr.md` (le README français actuel, mis à jour), `CHANGELOG.md`, `docs/screenshots/.gitkeep`
- Modify: `README.md` (réécrit en anglais), `CONTRIBUTING.md` et `SECURITY.md` (en anglais), test `src/test/docs.test.ts`

**Interfaces:**
- `README.md` (anglais) :
  - logo, accroche, badges (CI, licence, plateformes) et capture principale ;
  - **Why Tilde** ;
  - **Features** : SSH, connexions, SFTP, terminal, éditeur/aperçu/moniteur, personnalisation, sécurité ;
  - **Screenshots** : galerie ;
  - **Install** : releases, par OS, avertissement « non signé » (SmartScreen, Gatekeeper) ;
  - **Quick start** ;
  - **Configuration** : fichiers et emplacements, `settings.json`, `keybindings.json`, thèmes ;
  - **Keyboard shortcuts** ;
  - **Security & privacy** ;
  - **Build from source** ; **Architecture** (lien) ; **Roadmap** ; **Contributing** ; **License**.
  - Note honnête : l'interface est en français pour l'instant.
- `CHANGELOG.md` : format Keep a Changelog, entrée `0.1.0` qui résume les phases 1 à 8.
- Les images sont attendues dans `docs/screenshots/` sous ces noms : `hero.png`, `ssh.png`, `sftp.png`, `editor.png`, `monitor.png`, `settings.png`, `themes.png`, `quake.png`.
- `src/test/docs.test.ts` : `every relative link and image in the README files resolves`. Ce test lit `README.md`, `README.fr.md`, `CONTRIBUTING.md`, `SECURITY.md` et `docs/*.md`.

- [ ] **Step 1 :** écrire le test des liens → FAIL (`README.fr.md` absent, images absentes).
- [ ] **Step 2 :** rédiger les documents. Tant que les captures n'existent pas, le test les signale : c'est la Task 5 qui les fournit.
- [ ] **Step 3 :** commit `docs: English README, changelog, contributing and security`.

### Task 5 : Captures d'écran (avec l'auteur)

- [ ] **Step 1 :** demander à l'auteur s'il fournit les captures, ou s'il autorise le lancement de l'app pour les prendre (fenêtre 1280×800, thème Tilde Dark, données de démonstration sans hôte réel).
- [ ] **Step 2 :** placer les images dans `docs/screenshots/` (PNG optimisés, moins de 500 Kio chacune).
- [ ] **Step 3 :** `pnpm vitest run src/test/docs` → PASS.
- [ ] **Step 4 :** commit `docs: screenshots`.

### Task 6 : Vérification et fin de phase

- [ ] **Step 1 :** `pnpm tauri build` en local (Windows), sans lancer l'app. Attendu : `target/release/bundle/msi/*.msi` et `nsis/*-setup.exe`.
- [ ] **Step 2 :** vérification complète :
  - `cargo fmt --all --check` ;
  - `cargo clippy --workspace --all-targets -- -D warnings` ;
  - `cargo test --workspace` ;
  - `cargo deny check` ;
  - `pnpm lint`, `pnpm typecheck`, `pnpm test` ;
  - `pnpm gen:types` sans écart.
- [ ] **Step 3 :** CI verte (dont `actionlint` et la build `release.yml` sur les 3 OS).
- [ ] **Step 4 :** proposer à l'auteur, sans le faire, de pousser le tag `v0.1.0` après la fusion.
