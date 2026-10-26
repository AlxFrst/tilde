// Panes and the terminal (src/panels, src/terminal).
export default {
  // core.tsx
  Fichiers: 'Files',

  // editor/EditorPane.tsx
  Modifié: 'Modified',
  Aperçu: 'Preview',
  'Ouvrir dans l’éditeur externe': 'Open in external editor',
  Enregistrer: 'Save',
  'Enregistrement…': 'Saving…',
  Enregistré: 'Saved',
  'Le fichier a changé sur le serveur depuis son ouverture.':
    'The file has changed on the server since it was opened.',
  Écraser: 'Overwrite',
  Recharger: 'Reload',
  'En attente de la connexion SSH…': 'Waiting for the SSH connection…',
  'Ouverture…': 'Opening…',

  // editor/languages.ts
  Propriétés: 'Properties',
  'Texte brut': 'Plain text',

  // editor/module.tsx
  'Chargement de l’éditeur…': 'Loading the editor…',
  Éditeur: 'Editor',
  'Ouvrir un fichier…': 'Open file…',

  // editor/useDocument.ts
  'Connexion SSH perdue : reconnectez l’onglet SSH pour enregistrer ce fichier.':
    'SSH connection lost: reconnect the SSH tab to save this file.',
  'Enregistrement impossible : {error}': "Couldn't save: {error}",

  // monitor/format.ts
  '{days} j {hours} h': '{days} d {hours} h',

  // monitor/MonitorPane.tsx
  Serveur: 'Server',
  'Cette machine': 'This computer',
  'en marche depuis': 'up',
  'charge {load}': 'load {load}',
  Processeur: 'CPU',
  '{percent} %': '{percent}%',
  '{count} cœur': '{count} core',
  '{count} cœurs': '{count} cores',
  'Processeur, 2 dernières minutes': 'CPU, last 2 minutes',
  Mémoire: 'Memory',
  Réseau: 'Network',
  Réception: 'Received',
  Émission: 'Sent',
  Disques: 'Disks',
  'Aucun disque à afficher.': 'No disks to show.',

  // monitor/module.tsx
  Moniteur: 'Monitor',
  'Moniteur du serveur': 'Server monitor',
  'Moniteur système': 'System monitor',

  // monitor/ServerStatusBar.tsx
  'État du serveur': 'Server status',
  'Disque {mount}': 'Disk {mount}',
  'Réseau, reçu': 'Network, received',
  'Réseau, envoyé': 'Network, sent',
  'Statistiques du serveur indisponibles': 'Server stats unavailable',
  'Statistiques du serveur…': 'Server stats…',
  Détails: 'Details',
  'Moniteur détaillé du serveur': 'Detailed server monitor',
  'Masquer le bandeau': 'Hide the status bar',
  'Masquer le bandeau (réactivable dans Réglages → SSH)':
    'Hide the status bar (turn it back on in Settings → SSH)',
  'Bandeau masqué': 'Status bar hidden',
  'Réactivable dans Réglages → SSH.': 'Turn it back on in Settings → SSH.',

  // preview/JsonTree.tsx
  '{count} élément': '{count} item',
  '{count} éléments': '{count} items',
  '{count} clé': '{count} key',
  '{count} clés': '{count} keys',
  racine: 'root',
  'Afficher {count} de plus ({remaining} restants)': 'Show {count} more ({remaining} left)',

  // preview/PreviewPane.tsx, preview/markdown.ts
  'Image non chargée': 'Image not loaded',
  'JSON invalide : {error}': 'Invalid JSON: {error}',
  'Aperçu — {name}': 'Preview — {name}',
  'en direct': 'live',
  Actualiser: 'Refresh',
  'Pas d’aperçu pour ce type de fichier.': 'No preview for this file type.',

  // preview/module.tsx
  'Chargement de l’aperçu…': 'Loading the preview…',

  // sftp/ChmodDialog.tsx
  Propriétaire: 'Owner',
  Groupe: 'Group',
  Autres: 'Others',
  lecture: 'read',
  écriture: 'write',
  exécution: 'execute',
  '{who} : {what}': '{who}: {what}',
  'Mode octal': 'Octal mode',
  Annuler: 'Cancel',
  Appliquer: 'Apply',

  // sftp/FileList.tsx
  Nom: 'Name',
  Taille: 'Size',
  Droits: 'Permissions',
  'Dossier vide': 'Empty folder',

  // sftp/PathBar.tsx
  Chemin: 'Path',
  'Modifier le chemin': 'Edit path',

  // sftp/SftpPanel.tsx
  'Utilisateur (sudo)': 'User (sudo)',
  'Utilisateur des fichiers : {user}': 'Files user: {user}',
  'Fichiers lus et écrits en tant que {user} (sudo)': 'Files read and written as {user} (sudo)',
  '(connexion)': '(login)',
  'Autre utilisateur (sudo)…': 'Other user (sudo)…',
  'Passer en root (sudo)': 'Switch to root (sudo)',
  'Ouvrir en root (sudo)': 'Open as root (sudo)',
  'Les fichiers sont revenus à {user} : {reason}': 'The files are back to {user}: {reason}',
  'Nouveau dossier': 'New folder',
  'Nouveau fichier': 'New file',
  Renommer: 'Rename',
  Valider: 'OK',
  'Le shell distant ne signale pas son dossier courant : le panneau reste sur votre dossier personnel. Pour qu’il suive vos {cd}, ajoutez à {file} :':
    "The remote shell doesn't report its current folder, so the pane stays on your home folder. To make it follow your {cd} commands, add this to {file}:",
  Copié: 'Copied',
  Copier: 'Copy',
  'Ne pas suivre le terminal': "Don't follow the terminal",
  'Déconnecté — reconnectez l’onglet SSH pour voir ses fichiers.':
    'Disconnected — reconnect the SSH tab to see its files.',
  'Supprimer « {name} » ?': 'Delete “{name}”?',
  'Supprimer {count} élément ?': 'Delete {count} item?',
  'Supprimer {count} éléments ?': 'Delete {count} items?',
  'Les dossiers sont supprimés avec tout leur contenu ; les liens symboliques, sans toucher à leur cible.':
    'Folders are deleted with everything in them; symbolic links are deleted without touching their targets.',
  'Le dossier sera supprimé du serveur, et tout son contenu. Les liens symboliques qu’il contient sont supprimés sans toucher à leur cible.':
    'The folder and everything in it will be deleted from the server. Symbolic links inside it are deleted without touching their targets.',
  'Le fichier sera supprimé du serveur.': 'The file will be deleted from the server.',
  Supprimer: 'Delete',
  Ouvrir: 'Open',
  Modifier: 'Edit',
  Télécharger: 'Download',
  'Télécharger vers…': 'Download to…',
  'Renommer…': 'Rename…',
  'Copier le chemin': 'Copy path',
  'Dossier parent': 'Parent folder',
  'Dossier parent (Retour arrière)': 'Parent folder (Backspace)',
  'Suivre le terminal': 'Follow the terminal',
  'Suit le dossier du terminal': "Following the terminal's folder",
  'Ne suit pas le terminal': 'Not following the terminal',
  'Masquer les fichiers cachés': 'Hide hidden files',
  'Afficher les fichiers cachés': 'Show hidden files',
  'Envoyer des fichiers': 'Upload files',
  'Envoyer des fichiers (ou glissez-les ici)': 'Upload files (or drop them here)',
  '« {name} » existe déjà.': '“{name}” already exists.',

  // terminal/ExitOverlay.tsx
  'Processus terminé (code {code})': 'Process exited (code {code})',
  inconnu: 'unknown',
  Relancer: 'Restart',
  Entrée: 'Enter',
  Fermer: 'Close',
  Échap: 'Esc',

  // terminal/keyLabels.ts
  Maj: 'Shift',

  // terminal/SearchBar.tsx
  Rechercher: 'Search',
  'Rechercher dans le terminal': 'Search the terminal',
  'Respecter la casse': 'Match case',
  Précédent: 'Previous',
  Suivant: 'Next',
  'Fermer la recherche': 'Close search',

  // terminal/TerminalView.tsx
  'Connexion annulée': 'Connection canceled',
  Coller: 'Paste',
  'Diviser à droite': 'Split right',
  'Diviser en bas': 'Split down',
  'Déconnecté — Entrée pour reconnecter': 'Disconnected — press Enter to reconnect',
  'Se connecter': 'Connect',
  'Coller {count} ligne ?': 'Paste {count} line?',
  'Coller {count} lignes ?': 'Paste {count} lines?',
  'Chaque ligne sera exécutée par le shell.': 'Each line will be run by the shell.',
} satisfies Record<string, string>;
