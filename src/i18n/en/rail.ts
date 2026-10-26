// The Rail, session content headers, sidebar and commands (src/app/rail, src/app/content, src/app/sidebar, src/commands).
export default {
  // src/commands/registry.ts
  Sessions: 'Sessions',
  Espaces: 'Spaces',
  Panneaux: 'Panes',
  Terminal: 'Terminal',
  Connexions: 'Connections',
  Application: 'Application',

  // src/commands/builtin.ts
  'Les fichiers s’ouvrent depuis un onglet SSH ({keys} pour se connecter).':
    'Files open from an SSH tab ({keys} to connect).',
  'Agrandir / réduire le panneau': 'Maximize / restore pane',
  'Plein écran': 'Full screen',
  'Nouvelle session': 'New session',
  'Fermer la session': 'Close session',
  'Session suivante': 'Next session',
  'Session précédente': 'Previous session',
  'Masquer / afficher la barre latérale': 'Hide / show sidebar',
  Bibliothèque: 'Library',
  'Espace suivant': 'Next space',
  'Espace précédent': 'Previous space',
  'Nouvel espace…': 'New space…',
  'Aller à l’espace {n}': 'Go to space {n}',
  'Diviser à droite': 'Split right',
  'Diviser en bas': 'Split down',
  'Fermer le panneau': 'Close pane',
  'Panneau de gauche': 'Focus left pane',
  'Panneau de droite': 'Focus right pane',
  'Panneau du dessus': 'Focus pane above',
  'Panneau du dessous': 'Focus pane below',
  'Copier la sélection': 'Copy selection',
  Coller: 'Paste',
  'Rechercher dans le terminal': 'Search the terminal',
  'Connexion SSH rapide…': 'SSH quick connect…',
  'Afficher / masquer les fichiers (SFTP)': 'Show / hide files (SFTP)',
  'Nouvelle connexion…': 'New connection…',
  'Nouveau dossier…': 'New folder…',
  'Importer des connexions…': 'Import connections…',
  'Exporter les connexions…': 'Export connections…',
  'Palette de commandes': 'Command palette',
  'Réglages…': 'Settings…',
  'Ouvrir settings.json': 'Open settings.json',
  'Ouvrir keybindings.json': 'Open keybindings.json',
  'Ouvrir le dossier des thèmes': 'Open themes folder',
  'Rechercher des mises à jour': 'Check for updates',
  'Ouvrir le dossier des logs': 'Open logs folder',

  // src/app/rail/Rail.tsx
  '{count} hôte': '{count} host',
  '{count} hôtes': '{count} hosts',
  'Rechercher, se connecter, agir…': 'Search, connect, run…',
  'Barre latérale': 'Sidebar',
  'Masquer la barre latérale': 'Hide sidebar',
  'Masquer la barre latérale ({keys})': 'Hide sidebar ({keys})',
  'Ouvrir le fichier': 'Open file',
  'À corriger avant de pouvoir s’y connecter :': 'Fix these before connecting:',

  // src/app/rail/RailFooter.tsx
  Réglages: 'Settings',

  // src/app/rail/FavoriteTiles.tsx
  Favoris: 'Favorites',

  // src/app/rail/PaneList.tsx
  'Panneaux de {name}': 'Panes of {name}',

  // src/app/rail/TodaySection.tsx
  'Aujourd’hui': 'Today',
  'Nouvelle session ({keys})': 'New session ({keys})',

  // src/app/rail/PinnedSection.tsx
  'Autres sessions de {name}': 'Other sessions of {name}',
  'Session {n}': 'Session {n}',
  'Nouvelle connexion ici…': 'New connection here…',
  'Renommer…': 'Rename…',
  'Supprimer le dossier « {name} » ?': 'Delete folder “{name}”?',
  'Ses connexions sont conservées et passent hors dossier.':
    'Its connections are kept and moved out of the folder.',
  Supprimer: 'Delete',
  'Supprimer le dossier': 'Delete folder',
  'Fermer la session {name}': 'Close session {name}',
  Ajouter: 'Add',
  'Nouvelle connexion ou dossier': 'New connection or folder',
  'Importer…': 'Import…',
  'Exporter…': 'Export…',
  Épinglés: 'Pinned',
  'Aucune connexion dans cet espace.': 'No connections in this space.',
  'Ouvrir la Bibliothèque': 'Open the Library',

  // src/app/rail/SessionRow.tsx
  '{n} panneau': '{n} pane',
  '{n} panneaux': '{n} panes',
  'Déplacer vers l’espace': 'Move to space',
  Renommer: 'Rename',
  Couleur: 'Color',
  'Aucune couleur': 'No color',
  Dupliquer: 'Duplicate',
  'Désépingler la session': 'Unpin session',
  Épingler: 'Pin',
  Fermer: 'Close',
  'Fermer les autres': 'Close others',
  'Fermer celles en dessous': 'Close sessions below',
  'Nom de la session': 'Session name',
  'Fermer {name}': 'Close {name}',

  // src/app/rail/ConnectionMenu.tsx
  'Afficher la session': 'Show session',
  Ouvrir: 'Open',
  'Ouvrir une autre session': 'Open another session',
  'Modifier…': 'Edit…',
  '{name} (copie)': '{name} (copy)',
  'Retirer des favoris': 'Remove from favorites',
  'Ajouter aux favoris': 'Add to favorites',
  'Ranger dans': 'Move to folder',
  'Sans dossier': 'No folder',
  'Supprimer « {name} » ?': 'Delete “{name}”?',
  'Les sessions déjà ouvertes restent connectées.': 'Sessions already open stay connected.',

  // src/app/sidebar/SshConfigSection.tsx
  'Masqués ({count})': 'Hidden ({count})',
  'Ouvrir {name}': 'Open {name}',
  'Adopter {name}': 'Adopt {name}',
  'Enregistrer dans Tilde (espace, dossier, couleur, tags…)':
    'Save in Tilde (space, folder, color, tags…)',
  Adopter: 'Adopt',
  'Ne plus masquer {name}': 'Unhide {name}',
  'Masquer {name}': 'Hide {name}',
  'Ne plus masquer': 'Unhide',
  Masquer: 'Hide',

  // src/app/content/PaneHeader.tsx (also the editor's and the session header's)
  'Panneau {name}': 'Pane {name}',
  'Agrandir le panneau': 'Maximize pane',
  'Réduire le panneau': 'Restore pane',
  'Fermer ce panneau': 'Close this pane',

  // src/app/content/Peek.tsx
  'Moniteur · {name}': 'Monitor · {name}',
  Moniteur: 'Monitor',
  'Ancrer à droite': 'Dock right',
  'Fermer l’aperçu (Échap)': 'Close peek (Esc)',

  // src/app/content/SessionHeader.tsx
  'Afficher la barre latérale': 'Show sidebar',
  'via {hosts}': 'via {hosts}',
  Fichiers: 'Files',
  'Masquer les fichiers': 'Hide files',
  'Afficher les fichiers (SFTP)': 'Show files (SFTP)',
  'Processeur, mémoire, disque et réseau du serveur': 'Server CPU, memory, disk and network',
  Tunnels: 'Tunnels',
  'Redirections de ports de cette session': 'Port forwards of this session',
  'Nouveau shell': 'New shell',
  'Un autre shell sur ce serveur': 'Another shell on this server',
} satisfies Record<string, string>;
