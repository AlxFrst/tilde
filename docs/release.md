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
   ne correspond pas à la version des fichiers.
5. **Relire la release brouillon** sur GitHub : les installeurs et les sommes SHA-256.
   L'éditer si besoin, puis la publier.

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

## Vérifier un téléchargement

```sh
sha256sum -c SHA256SUMS.txt --ignore-missing      # Linux
shasum -a 256 -c SHA256SUMS.txt --ignore-missing  # macOS
Get-FileHash .\Tilde_0.1.0_x64-setup.exe          # Windows (PowerShell), à comparer au fichier
```
