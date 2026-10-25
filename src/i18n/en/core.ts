// Stores, connections, themes, workspace and the app root (src/stores, src/connections, src/themes, src/workspace, src/ipc, src/lib, src/*.tsx).
export default {
  // src/ipc/errors.ts
  '{file} ligne {line}, colonne {column} : {message}':
    '{file} line {line}, column {column}: {message}',

  // src/connections/colors.ts
  Pervenche: 'Periwinkle',
  Turquoise: 'Turquoise',
  Vert: 'Green',
  Ambre: 'Amber',
  Rouge: 'Red',
  Violet: 'Purple',

  // src/connections/spaces.ts
  Principal: 'Main',

  // src/connections/transfer.ts
  '{count} connexion importée': '{count} connection imported',
  '{count} connexions importées': '{count} connections imported',
  '{imported}, {skipped} (déjà présentes ou invalides)':
    '{imported}, {skipped} (already present or invalid)',
  '{count} ignorée': '{count} skipped',
  '{count} ignorées': '{count} skipped',
  'À vérifier : {names} (clé ou bastion importés). Le transfert d’agent n’est jamais importé.':
    'To review: {names} (key or jump host imported). Agent forwarding is never imported.',
  'Fichier importé': 'Imported file',
  'Connexions exportées (aucun mot de passe n’est inclus)':
    'Connections exported (no passwords included)',

  // src/connections/validate.ts
  'Le nom est obligatoire': 'Name is required',
  '100 caractères au plus': '100 characters at most',
  'Indiquez un hôte ou un alias de ~/.ssh/config': 'Enter a host or a ~/.ssh/config alias',
  'Entre 1 et 65535': 'Between 1 and 65535',
  'Sans espace ni @': 'No spaces or @',
  'Format : [user@]hôte[:port], séparés par des virgules':
    'Format: [user@]host[:port], comma-separated',

  // src/stores/settings.ts
  'Erreur inattendue lors de la mise à jour des réglages':
    'Unexpected error while updating settings',

  // src/stores/keybindings.ts (« Erreur inattendue » also in src/stores/themes.ts)
  '{binding} est attribué à plusieurs commandes ({ids})':
    '{binding} is assigned to several commands ({ids})',
  'Erreur inattendue': 'Unexpected error',
  'keybindings.json : raccourci refusé pour {id} (« {binding} ») : syntaxe inconnue, ou touche sans Ctrl ni Alt':
    'keybindings.json: shortcut rejected for {id} (“{binding}”): unknown syntax, or a key without Ctrl or Alt',
  'keybindings.json : {warning}': 'keybindings.json: {warning}',

  // src/stores/themes.ts
  thème: 'theme',
  'id réservé par un thème intégré : renommez le fichier':
    'id reserved by a built-in theme: rename the file',
  'themes/{file} : {message}': 'themes/{file}: {message}',

  // src/stores/transfers.ts
  '« {name} » a été modifié sur le serveur': '“{name}” was changed on the server',
  'Ouvrez les transferts pour choisir la version à garder.':
    'Open transfers to choose which version to keep.',
  'Échec du transfert « {name} »': 'Transfer of “{name}” failed',
  '{count} transferts ont échoué': '{count} transfers failed',
  '« {name} » téléchargé': '“{name}” downloaded',
  '{count} fichiers téléchargés': '{count} files downloaded',
  'Ouvrir le dossier': 'Open folder',

  // src/workspace/persistence.ts
  '{count} panneau relancé avec « {name} » : son profil n’existe plus.':
    '{count} pane restarted with “{name}”: its profile no longer exists.',
  '{count} panneaux relancés avec « {name} » : leur profil n’existe plus.':
    '{count} panes restarted with “{name}”: their profile no longer exists.',

  // src/themes/parse.ts
  '{field} : couleur invalide (attendu #RRGGBB)': '{field}: invalid color (expected #RRGGBB)',
  'Le thème doit être un objet JSON': 'The theme must be a JSON object',
  'version : thème créé par une version plus récente de Tilde':
    'version: theme made by a newer version of Tilde',
  'id : lettres minuscules, chiffres et tirets uniquement':
    'id: lowercase letters, digits and hyphens only',
  'name : nom requis (80 caractères au plus)': 'name: name required (80 characters at most)',
  'terminal : couleurs du terminal manquantes': 'terminal: terminal colors missing',
  'kind : « dark » ou « light »': 'kind: “dark” or “light”',
  'ui : doit être un objet': 'ui: must be an object',

  // src/themes/importers/index.ts
  'Format non reconnu : .itermcolors, JSON Windows Terminal ou YAML base16 attendus':
    'Unrecognized format: expected .itermcolors, Windows Terminal JSON or base16 YAML',
  'Fichier trop volumineux (1 Mio au plus)': 'File too large (1 MiB at most)',
  Importé: 'Imported',
  '{name} : {message}': '{name}: {message}',
  'Aucun thème utilisable dans ce fichier': 'No usable theme in this file',

  // src/themes/importers/iterm.ts
  '{key} : composante {name} invalide': '{key}: invalid {name} component',
  '{key} : couleur attendue': '{key}: color expected',
  'Fichier iTerm2 refusé : il déclare des entités XML':
    'iTerm2 file rejected: it declares XML entities',
  'Fichier iTerm2 illisible : XML invalide': 'Unreadable iTerm2 file: invalid XML',
  'Fichier iTerm2 illisible : pas de dictionnaire de couleurs':
    'Unreadable iTerm2 file: no color dictionary',
  '{key} : couleur manquante': '{key}: missing color',

  // src/themes/importers/base16.ts
  '{key} : couleur manquante ou invalide (fichier base16 attendu)':
    '{key}: missing or invalid color (base16 file expected)',

  // src/themes/importers/windowsTerminal.ts
  'Sans nom': 'Untitled',
  'JSON invalide': 'Invalid JSON',
  'JSON invalide : objet attendu': 'Invalid JSON: object expected',
  'Aucun jeu de couleurs Windows Terminal dans ce fichier':
    'No Windows Terminal color scheme in this file',
} satisfies Record<string, string>;
