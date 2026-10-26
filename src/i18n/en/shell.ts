// Top-level app components and dialogs (src/app/*.ts, src/app/*.tsx). A string used by
// several files is listed once, under the first.
export default {
  // src/app/paneLabel.ts (« Fichiers », « Moniteur » also in TabBar, CommandPalette)
  Fichiers: 'Files',
  Moniteur: 'Monitor',
  'cette machine': 'this machine',

  // src/app/tabColors.ts
  Pervenche: 'Periwinkle',
  Turquoise: 'Turquoise',
  Vert: 'Green',
  Ambre: 'Amber',
  Rouge: 'Red',

  // src/app/updates.ts
  'Téléchargement de la mise à jour…': 'Downloading the update…',
  'Téléchargement de la mise à jour… {percent} %': 'Downloading the update… {percent}%',
  'Tilde {version} est disponible': 'Tilde {version} is available',
  'La mise à jour redémarre Tilde.': 'Updating restarts Tilde.',
  'Mettre à jour': 'Update',
  'Tilde est à jour.': 'Tilde is up to date.',
  'Recherche de mise à jour impossible : {error}': "Couldn't check for updates: {error}",

  // src/app/ConnectionStatus.tsx
  Connecté: 'Connected',
  'Connexion en cours': 'Connecting',
  'Connexion perdue': 'Connection lost',
  'Préparation de la connexion…': 'Preparing the connection…',
  'Connexion à {hop}…': 'Connecting to {hop}…',
  'Connexion perdue : {reason}': 'Connection lost: {reason}',
  'Reconnexion dans {seconds} s… (tentative {attempt})':
    'Reconnecting in {seconds} s… (attempt {attempt})',
  Réessayer: 'Retry',

  // src/app/ColorPicker.tsx
  Aucune: 'None',

  // src/app/ConfirmCloseDialog.tsx (« Annuler », « Fermer » also elsewhere)
  'Fermer quand même ?': 'Close anyway?',
  'Modifications non enregistrées dans {files} : elles seront perdues.':
    'Unsaved changes in {files} will be lost.',
  'Un programme est en cours dans ce terminal.': 'A program is running in this terminal.',
  Annuler: 'Cancel',
  Fermer: 'Close',

  // src/app/StartupError.tsx
  'Tilde n’a pas pu démarrer': "Tilde couldn't start",
  'Les logs (dossier Tilde/logs de votre profil) contiennent plus de détails.':
    'The logs (the Tilde/logs folder of your profile) have more details.',

  // src/app/ConnectionDialog.tsx
  'Selon ~/.ssh/config': 'As in ~/.ssh/config',
  Oui: 'Yes',
  Non: 'No',
  'Modifier « {name} »': 'Edit “{name}”',
  'Nouvelle connexion': 'New connection',
  'Aucun mot de passe n’est enregistré ici : ils restent dans le trousseau du système.':
    'No password is saved here: passwords stay in the system keychain.',
  Nom: 'Name',
  'Base de prod': 'Production database',
  Hôte: 'Host',
  'Les réglages de ~/.ssh/config pour cet alias s’appliquent ; les champs remplis ici les remplacent.':
    'The ~/.ssh/config settings for this alias apply; fields filled in here override them.',
  'Nom, IP ou alias de ~/.ssh/config': 'Name, IP or ~/.ssh/config alias',
  Port: 'Port',
  Utilisateur: 'User',
  Clé: 'Key',
  'Rebonds (ProxyJump)': 'Jump hosts (ProxyJump)',
  'Tilde passe par chaque bastion dans l’ordre, puis se connecte à l’hôte ; les fichiers et le bandeau d’état suivent le même chemin.':
    'Tilde goes through each jump host in order, then connects to the host; files and the status banner take the same route.',
  Espace: 'Space',
  Dossier: 'Folder',
  'Sans dossier': 'No folder',
  'Transférer l’agent': 'Forward agent',
  Tags: 'Tags',
  'Séparés par des virgules': 'Comma-separated',
  Couleur: 'Color',
  'Couleur de la connexion': 'Connection color',
  Icône: 'Icon',
  'Enregistrer et se connecter': 'Save and connect',
  Enregistrer: 'Save',

  // src/app/CredentialDialog.tsx
  'Mot de passe': 'Password',
  'Mot de passe sudo pour {target}': 'sudo password for {target}',
  'Le mot de passe que sudo demande (en général le vôtre), pour lire et écrire les fichiers en tant que {user}.':
    'The password sudo asks for (usually yours), to read and write the files as {user}.',
  'Phrase secrète': 'Passphrase',
  'Vérification pour {target}': 'Verification for {target}',
  'Mot de passe pour {target}': 'Password for {target}',
  'Phrase secrète de la clé': 'Key passphrase',
  '{key} — pour {target}': '{key} — for {target}',
  'Le mot de passe n’est jamais écrit sur le disque ni dans les journaux.':
    'The password is never written to disk or to the logs.',
  'Refusé. Tentative {attempt}/{max}': 'Denied. Attempt {attempt}/{max}',
  'Mémoriser dans le trousseau': 'Remember in the keychain',
  'Aucun trousseau système disponible : rien ne sera enregistré.':
    'No system keychain available: nothing will be saved.',
  'Se connecter': 'Connect',

  // src/app/HostKeyDialog.tsx
  'L’empreinte de {host} a changé': 'The fingerprint of {host} has changed',
  'Le serveur ne présente plus la clé enregistrée. Quelqu’un intercepte peut-être la connexion. Ne continuez que si vous savez que la clé du serveur a été changée.':
    "The server no longer presents the saved key. Someone may be intercepting the connection. Only continue if you know the server's key was changed.",
  'Empreinte enregistrée': 'Saved fingerprint',
  'Nouvelle empreinte ({type})': 'New fingerprint ({type})',
  'Enregistrée dans': 'Saved in',
  'Je comprends le risque': 'I understand the risk',
  'Remplacer et continuer': 'Replace and continue',
  'Première connexion à {host}': 'First connection to {host}',
  'Vérifiez que cette empreinte est bien celle du serveur avant de lui faire confiance.':
    "Check that this fingerprint is really the server's before trusting it.",
  'Empreinte ({type})': 'Fingerprint ({type})',
  'Une seule fois': 'Just once',
  'Faire confiance et enregistrer': 'Trust and save',

  // src/app/FolderDialog.tsx
  'Le nom est obligatoire': 'Name is required',
  'Nouveau dossier': 'New folder',
  'Renommer le dossier': 'Rename folder',
  'Nom du dossier': 'Folder name',
  'Espace du dossier': 'Folder space',
  'Couleur du dossier': 'Folder color',

  // src/app/JumpHosts.tsx
  'Rebond {n}': 'Jump host {n}',
  'alias, ou user@hôte:port': 'alias, or user@host:port',
  'Retirer le rebond {n}': 'Remove jump host {n}',
  'Ajouter un rebond': 'Add a jump host',
  'Passer par un bastion': 'Connect through a jump host',
  'Connexions enregistrées': 'Saved connections',
  'Saisir une adresse…': 'Type an address…',

  // src/app/NewTabMenu.tsx
  'Choisir un profil': 'Choose a profile',
  'Aucun shell détecté': 'No shell found',
  'Connexion SSH…': 'SSH connection…',
  'Rechercher à nouveau les shells': 'Detect shells again',

  // src/app/PaneView.tsx
  'Le panneau « {title} » a rencontré une erreur.': 'The “{title}” pane ran into an error.',
  'Fermer le panneau': 'Close pane',
  'Panneau inconnu : « {kind} »': 'Unknown pane: “{kind}”',

  // src/app/QuickConnectDialog.tsx
  'Connexion SSH': 'SSH connection',
  'Un alias de ~/.ssh/config ou user@hôte:port. Entrée pour ouvrir un onglet.':
    'A ~/.ssh/config alias or user@host:port. Enter opens a tab.',
  'Hôte SSH': 'SSH host',
  'Hôte invalide : indiquez un alias de ~/.ssh/config ou user@hôte:port.':
    'Invalid host: enter a ~/.ssh/config alias or user@host:port.',

  // src/app/TabBar.tsx
  'Nom de l’onglet': 'Tab name',
  'Fermer l’onglet': 'Close tab',
  Renommer: 'Rename',
  'Aucune couleur': 'No color',
  'Fichiers…': 'Files…',
  'Tunnels…': 'Tunnels…',
  Dupliquer: 'Duplicate',
  Onglets: 'Tabs',
  'Nouvel onglet': 'New tab',
  'Nouvel onglet (Ctrl+Maj+T)': 'New tab (Ctrl+Shift+T)',

  // src/app/TransfersButton.tsx
  'En attente': 'Queued',
  Terminé: 'Done',
  Annulé: 'Canceled',
  'Échec : {message}': 'Failed: {message}',
  'Conflit : {message}': 'Conflict: {message}',
  'Réessayer (reprend où il s’est arrêté)': 'Retry (resumes where it stopped)',
  'Afficher dans le dossier': 'Show in folder',
  Écraser: 'Overwrite',
  'Prendre la version du serveur': "Use the server's version",
  'Transferts : {count} en cours': 'Transfers: {count} in progress',
  Transferts: 'Transfers',
  'Effacer les terminés': 'Clear finished',
  '… et {count} transfert plus ancien': '… and {count} older transfer',
  '… et {count} transferts plus anciens': '… and {count} older transfers',

  // src/app/TunnelsDialog.tsx
  'ici {listen} → serveur {target}': 'here {listen} → server {target}',
  'serveur {listen} → ici {target}': 'server {listen} → here {target}',
  'Tunnels — {title}': 'Tunnels — {title}',
  'Local : un port de ce PC mène à une adresse vue depuis le serveur. Distant : un port du serveur mène à une adresse vue depuis ce PC. Rétablis après une reconnexion.':
    'Local: a port on this PC leads to an address seen from the server. Remote: a port on the server leads to an address seen from this PC. Restored after a reconnection.',
  'Aucun tunnel.': 'No tunnels.',
  '{count} connexion': '{count} connection',
  '{count} connexions': '{count} connections',
  'Arrêter le tunnel': 'Stop tunnel',
  'Sens du tunnel': 'Tunnel direction',
  Local: 'Local',
  Distant: 'Remote',
  'Port d’écoute': 'Listening port',
  'port (auto)': 'port (auto)',
  'Hôte de destination': 'Destination host',
  'Port de destination': 'Destination port',
  port: 'port',
  Ajouter: 'Add',

  // src/app/Welcome.tsx (« Nouvel onglet », « Connexion SSH » also above)
  'Palette de commandes': 'Command palette',
  'Diviser à droite': 'Split right',
  'Diviser en bas': 'Split down',
  'Changer de panneau': 'Switch pane',
  Rechercher: 'Search',

  // src/app/WindowControls.tsx
  Réduire: 'Minimize',
  Restaurer: 'Restore',
  Agrandir: 'Maximize',

  // src/app/CommandPalette.tsx
  récent: 'recent',
  'Se connecter à côté': 'Connect in a split pane',
  'Copier la commande ssh': 'Copy ssh command',
  'Commande copiée': 'Command copied',
  'Impossible de copier la commande': "Couldn't copy the command",
  'Modifier…': 'Edit…',
  'Adopter (enregistrer dans Tilde)…': 'Adopt (save in Tilde)…',
  'Que faire avec ce serveur ?': 'What to do with this server?',
  'Se connecter à… ou lancer une commande': 'Connect to… or run a command',
  'Aucun résultat': 'No results',
  'Actions · {name}': 'Actions · {name}',
  Connexions: 'Connections',
  'Actions de {name}': 'Actions for {name}',
  'Actions (→)': 'Actions (→)',
  Sessions: 'Sessions',
  Espaces: 'Spaces',
  Commandes: 'Commands',
} satisfies Record<string, string>;
