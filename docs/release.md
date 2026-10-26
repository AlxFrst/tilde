# Publier une version

Les installeurs sont construits par `.github/workflows/release.yml` :

| OS | Formats |
|---|---|
| Windows | MSI, NSIS (`-setup.exe`) |
| Linux | AppImage, deb |
| macOS | dmg universel (Apple Silicon + Intel) |

Un tag `vX.Y.Z` crée une release **en brouillon**, avec les installeurs et `SHA256SUMS.txt`.
Rien n'est public tant qu'un mainteneur ne la publie pas.

## Étapes

1. **Mettre la version à jour** dans `package.json`, `Cargo.toml` (`[workspace.package]`) et
   `src-tauri/tauri.conf.json`, puis lancer `cargo check` pour que `Cargo.lock` suive.
   `pnpm check-version` vérifie que les trois fichiers concordent.
2. **Compléter `CHANGELOG.md`** : la section `## [X.Y.Z]` devient le texte de la release.
3. **Fusionner dans `main`** avec la CI verte.
4. **Pousser le tag** : `git tag vX.Y.Z && git push origin vX.Y.Z`. Le workflow refuse un tag qui
   ne correspond pas à la version des fichiers. Sans terminal : *Actions → Release → Run
   workflow* sur `main`, avec le tag `vX.Y.Z` ; le workflow crée le tag sur le dernier commit
   de `main`, puis tout se passe comme pour un tag poussé.
5. **Relire la release brouillon** sur GitHub : les installeurs, `latest.json` et les sommes
   SHA-256. L'éditer si besoin, puis la publier : la mise à jour intégrée ne voit que les
   releases publiées.

`latest.json`, le fichier que lit la mise à jour intégrée, est écrit par le dernier job, une
fois les trois plateformes construites, à partir de leurs signatures (`scripts/updater-json.ts`).
Il manque une plateforme : le job échoue et rien n'est proposé aux utilisateurs.

Si le workflow échoue en route, le relancer (*Re-run all jobs*) : il réutilise le brouillon
du tag au lieu d'en créer un second.

Une PR qui modifie `release.yml` ou `tauri.conf.json` construit aussi les installeurs (en
artefacts, sans release) : le packaging est vérifié avant le prochain tag.

## Signature

Sans secrets, les installeurs ne sont **pas signés**. Windows SmartScreen et macOS
Gatekeeper avertissent alors à l'ouverture (voir « Install » dans le README). Pour signer,
ajoutez ces secrets dans *Settings → Secrets and variables → Actions* : aucune autre
modification n'est nécessaire.

### Windows (Authenticode)

| Secret | Contenu |
|---|---|
| `WINDOWS_CERTIFICATE` | le certificat de signature de code au format PFX, en base64 (`base64 -w0 cert.pfx`) |
| `WINDOWS_CERTIFICATE_PASSWORD` | son mot de passe |

Le certificat est importé dans le magasin de l'utilisateur du runner. Son empreinte est
ensuite passée à Tauri (`certificateThumbprint`, SHA-256, horodatage DigiCert).

### macOS (signature et notarisation)

| Secret | Contenu |
|---|---|
| `APPLE_CERTIFICATE` | le certificat « Developer ID Application » (.p12) en base64 |
| `APPLE_CERTIFICATE_PASSWORD` | son mot de passe |
| `APPLE_SIGNING_IDENTITY` | ex. `Developer ID Application: Nom (TEAMID)` |
| `APPLE_ID` | l'identifiant Apple du compte développeur |
| `APPLE_PASSWORD` | un mot de passe d'application (appleid.apple.com) |
| `APPLE_TEAM_ID` | l'identifiant d'équipe |

Ces valeurs ne sont exportées que si elles existent : un fork sans secrets construit des
installeurs non signés, sans erreur.

## Mises à jour intégrées

Tilde vérifie au démarrage, au plus une fois par jour, s'il existe une version plus récente.
La vérification est désactivable dans Réglages → Général, et « Rechercher des mises à jour »
est aussi disponible dans la palette. Le fichier consulté est le `latest.json` de la dernière
release **publiée** : un brouillon n'est jamais proposé.

Les mises à jour sont signées avec une clé propre à Tilde (minisign), indépendante des
certificats Windows et Apple. Une mise à jour dont la signature ne correspond pas à la clé
publique de `src-tauri/tauri.conf.json` est refusée.

| Secret | Contenu |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | le contenu du fichier de clé privée (`~/.tauri/tilde-updater.key`) |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | son mot de passe (vide pour la clé actuelle) |

Sans `TAURI_SIGNING_PRIVATE_KEY`, la release se construit sans fichiers de mise à jour (un
avertissement l'indique) : les installations existantes ne sont pas mises à jour.

**Ne perdez pas la clé privée.** Sans elle, les versions déjà installées ne pourront plus
accepter de mise à jour. Il faudrait alors publier une nouvelle clé et faire réinstaller Tilde
à la main. Gardez-en une copie dans un gestionnaire de mots de passe.

## Vérifier un téléchargement

```sh
sha256sum -c SHA256SUMS.txt --ignore-missing      # Linux
shasum -a 256 -c SHA256SUMS.txt --ignore-missing  # macOS
Get-FileHash .\Tilde_0.1.0_x64-setup.exe          # Windows (PowerShell), à comparer au fichier
```
