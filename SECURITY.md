# Politique de sécurité

Tilde manipule des accès SSH, des clés et des mots de passe : les failles de sécurité sont
traitées en priorité.

## Signaler une faille

**N'ouvrez pas d'issue publique.** Utilisez le signalement privé de GitHub :
onglet *Security* → *Report a vulnerability* (GitHub Security Advisories).

Indiquez la version de Tilde, l'OS, les étapes de reproduction et l'impact estimé. Nous
accusons réception sous 7 jours.

## Périmètre

Sont notamment concernés :

- la fuite de secrets (mots de passe, passphrases, clés) sur disque, dans les logs ou dans un
  export ;
- le contournement de la vérification `known_hosts` ;
- l'exécution de code à distance, ou l'accès au système de fichiers depuis la WebView ;
- l'affaiblissement de la CSP ou des permissions Tauri.

## Principes

- Les secrets sont stockés uniquement dans le trousseau de l'OS.
- La WebView n'a accès à aucun plugin `fs` ni `shell` : tout passe par des commandes Rust
  dédiées.
- Aucune télémétrie, aucune requête réseau non initiée par l'utilisateur.
