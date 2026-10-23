# Contribuer à Tilde

Merci de votre intérêt ! Quelques règles simples pour que tout le monde gagne du temps.

## Avant de coder

- Pour un bug : ouvrez une issue avec les étapes pour le reproduire, votre OS et la version de
  Tilde, et joignez les logs si possible (Réglages → « Ouvrir le dossier des logs »).
- Pour une fonctionnalité : ouvrez d'abord une issue pour en discuter, surtout si elle touche
  l'architecture.

## Mise en place

Voir la section « Développer » du [README](README.md).

## Règles

- **Tests d'abord.** Toute correction de bug arrive avec un test qui échouait avant.
- La CI doit être verte : `pnpm lint`, `pnpm typecheck`, `pnpm test`,
  `cargo fmt --all --check`, `cargo clippy --workspace --all-targets -- -D warnings`,
  `cargo test --workspace`, `cargo deny check`.
- Les crates de `crates/` ne dépendent **pas** de Tauri : elles se testent seules.
- Toute nouvelle commande Tauri passe par `src-tauri/src/commands/` et un wrapper typé dans
  `src/ipc/`. Le front n'appelle jamais `invoke` directement depuis un composant.
- Aucun secret ne doit être écrit sur disque, dans les logs ou dans un export.
- Commits au format [Conventional Commits](https://www.conventionalcommits.org/fr/)
  (`feat(ssh): …`, `fix(config): …`).

## Licence

En contribuant, vous acceptez que votre contribution soit publiée sous la double licence
MIT OR Apache-2.0 du projet.
