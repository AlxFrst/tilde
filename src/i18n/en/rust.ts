// English for the messages Rust writes (errors, connection states, validation), grouped
// by the Rust file that writes them. The key is the French text; a `{part}` stands for
// any text, translated in turn. `{name}` (kept as it is), `{field}` (a settings key),
// `{path}` (a file path) and `{…List}` (a list "a, b, c") are special: see ../rust.ts.
export const RUST: Readonly<Record<string, string>> = {
  // crates/tilde-config/src/error.rs
  "impossible d'accéder à {file}: {source}": "can't access {file}: {source}",
  'JSON invalide (ligne {line}, colonne {column}) : {message}':
    'invalid JSON (line {line}, column {column}): {message}',
  'type incorrect pour « {key} » : {message}': 'wrong type for “{key}”: {message}',
  'valeurs hors limites : {fieldList}': 'invalid values: {fieldList}',
  '{field} ({message})': '{field} ({message})',
  'ce fichier a été écrit par une version plus récente de Tilde (version {found}, version supportée {supported}) ; il est ouvert en lecture seule':
    'this file was written by a newer version of Tilde (version {found}, supported version {supported}); it is open read-only',
  'settings.json contient une erreur : corrigez-le avant de modifier les réglages':
    'settings.json has an error: fix it before changing the settings',
  '{file} contient une erreur : corrigez-le avant de le modifier':
    '{file} has an error: fix it before changing it',

  // crates/tilde-config/src/connections.rs
  'espace inconnu': 'unknown space',
  'le nom est obligatoire': 'a name is required',
  '{max} caractères au plus': 'at most {max} characters',
  'un hôte ou un alias, sans espace': 'a host or an alias, without spaces',
  'entre 1 et 65535': 'between 1 and 65535',
  'sans espace ni @': 'no spaces or @',
  'format #RRGGBB': '#RRGGBB format',
  'dossier inconnu': 'unknown folder',
  'icône inconnue': 'unknown icon',
  'connexion inconnue': 'unknown connection',
  'il faut garder au moins un espace': 'at least one space must remain',
  '{field} : {message}': '{field}: {message}',
  // Also keybindings.rs (dropped entries) and src-tauri/src/commands/sftp.rs (editor).
  '« {name} » : {message}': '“{name}”: {message}',

  // crates/tilde-config/src/keybindings.rs
  'identifiant de commande invalide': 'invalid command id',
  'raccourci vide ou trop long (64 caractères au plus)':
    'shortcut empty or too long (at most 64 characters)',
  'raccourci contenant un caractère de contrôle': 'shortcut contains a control character',
  'plus de {max} raccourcis : les suivants sont ignorés':
    'more than {max} shortcuts: the following ones are ignored',
  '{max} raccourcis au plus': 'at most {max} shortcuts',

  // crates/tilde-config/src/migrate.rs
  'le fichier doit contenir un objet JSON': 'the file must contain a JSON object',
  'doit être un entier positif': 'must be a positive integer',

  // crates/tilde-config/src/settings.rs
  "{value} n'est pas entre {min} et {max}": '{value} is not between {min} and {max}',

  // crates/tilde-config/src/themes.rs
  'identifiant « {id} » invalide : lettres minuscules, chiffres et tirets (64 au plus)':
    'invalid id “{id}”: lowercase letters, digits and hyphens (at most 64)',
  'fichier trop volumineux ({max} Kio au plus)': 'file too large (at most {max} KB)',
  'JSON invalide (ligne {line}, colonne {column})': 'invalid JSON (line {line}, column {column})',
  'un objet JSON est attendu': 'a JSON object is expected',
  'nom de fichier invalide : lettres minuscules, chiffres et tirets':
    'invalid file name: lowercase letters, digits and hyphens',
  'thème trop volumineux ({max} Kio au plus)': 'theme too large (at most {max} KB)',

  // crates/tilde-monitor/src/lib.rs
  'moniteur distant : Linux uniquement (/proc introuvable sur ce serveur)':
    'remote monitor: Linux only (no /proc on this server)',

  // crates/tilde-monitor/src/local.rs (the host name when the system gives none)
  'cette machine': 'this machine',

  // crates/tilde-pty/src/detect.rs (a detected shell's name)
  'Invite de commandes': 'Command Prompt',

  // crates/tilde-session/src/error.rs
  'impossible de lancer « {command} » : {source}': "can't start “{command}”: {source}",
  'session {id} introuvable': 'session {id} not found',

  // crates/tilde-ssh/src/error.rs
  'bastion {index}/{count} ({host})': 'jump host {index}/{count} ({host})',
  '{hop} injoignable : {source}': "can't reach {hop}: {source}",
  '{hop} : délai de connexion dépassé': '{hop}: connection timed out',
  "{hop} : clé d'hôte refusée ({reason})": '{hop}: host key rejected ({reason})',
  'authentification refusée par {user}@{hop} — méthodes essayées : {methodList}':
    'authentication refused by {user}@{hop} — methods tried: {methodList}',
  'connexion annulée': 'connection canceled',
  '{hop} : erreur SSH : {source}': '{hop}: SSH error: {source}',

  // crates/tilde-ssh/src/connect.rs
  "certificats d'hôte non pris en charge": 'host certificates are not supported',
  'cette clé est révoquée dans known_hosts': 'this key is revoked in known_hosts',
  'empreinte modifiée': 'fingerprint changed',
  'hôte inconnu refusé': 'unknown host rejected',
  'mot de passe': 'password',

  // crates/tilde-ssh/src/chain.rs
  'ProxyCommand : {output} ({error})': 'ProxyCommand: {output} ({error})',
  'trop de sauts ProxyJump (maximum {max})': 'too many ProxyJump hops (at most {max})',
  'ProxyJump circulaire : {cycle}': 'circular ProxyJump: {cycle}',

  // crates/tilde-ssh/src/connection.rs
  'indiquez un hôte (alias de ~/.ssh/config ou user@hôte:port)':
    'enter a host (an alias from ~/.ssh/config or user@host:port)',
  'un seul hôte attendu': 'only one host expected',
  'connexion perdue': 'connection lost',

  // crates/tilde-ssh/src/edit.rs, sftp.rs, textfile.rs, transfer.rs (a file's problem)
  '{path} : {message}': '{path}: {message}',
  'fichier trop volumineux pour être modifié ({max} Mio au plus) : téléchargez-le':
    'file too large to edit (at most {max} MB): download it',
  "impossible d'ouvrir l'éditeur : {message}": "can't open the editor: {message}",
  'le fichier a été modifié sur le serveur depuis son ouverture':
    'the file has changed on the server since it was opened',
  'fichier distant raccourci pendant le transfert': 'remote file shrank during the transfer',

  // crates/tilde-ssh/src/exec.rs
  "la session SSH n'est pas connectée": 'the SSH session is not connected',
  'le serveur ne répond pas': 'the server is not responding',
  'sortie trop volumineuse ({max} octets au plus)': 'output too large (at most {max} bytes)',
  'commande impossible : {error}': "couldn't run the command: {error}",

  // crates/tilde-ssh/src/forward.rs
  'écoute impossible sur {address} : {error}': "can't listen on {address}: {error}",
  "le serveur refuse d'écouter sur {address} ({error})":
    'the server refused to listen on {address} ({error})',

  // crates/tilde-ssh/src/proxy_command.rs
  'impossible de lancer le ProxyCommand « {command} » : {error}':
    "can't start the ProxyCommand “{command}”: {error}",
  'ProxyCommand sans entrée/sortie': 'ProxyCommand without input/output',

  // crates/tilde-ssh/src/sftp.rs
  'SFTP indisponible : {reason}': 'SFTP unavailable: {reason}',
  '{path} : permission refusée': '{path}: permission denied',

  // crates/tilde-ssh/src/sudo.rs
  "nom d'utilisateur invalide : {name}": 'invalid user name: {name}',
  'sudo demande un mot de passe': 'sudo asks for a password',
  'mot de passe sudo refusé': 'sudo password refused',
  'sudo refusé : {reason}': 'sudo refused: {reason}',
  "sudo n'est pas installé sur ce serveur": 'sudo is not installed on this server',
  'sftp-server introuvable sur ce serveur': 'sftp-server not found on this server',
  annulé: 'cancelled',
  'sudo ne répond pas : {reason}': 'sudo is not answering: {reason}',
  'pas de réponse': 'no answer',
  "trop d'éléments à supprimer (plus de {max}) : opération arrêtée":
    'too many items to delete (more than {max}): stopped',

  // crates/tilde-ssh/src/shell.rs
  'connexion en cours de rétablissement': 'reconnecting',

  // crates/tilde-ssh/src/textfile.rs
  'fichier trop volumineux ({max} Mio au plus)': 'file too large (at most {max} MB)',
  "fichier binaire ou non UTF-8 : ouvrez-le avec l'éditeur externe":
    'binary or non-UTF-8 file: open it with the external editor',
  'le fichier a changé depuis son ouverture': 'the file has changed since it was opened',

  // crates/tilde-ssh-config/src/jump.rs
  'ProxyJump « {hop} » : {reason}': 'ProxyJump “{hop}”: {reason}',
  'saut vide': 'empty hop',
  'espace inattendu': 'unexpected space',
  'utilisateur vide': 'empty user',
  'crochet fermant manquant': 'missing closing bracket',
  'texte inattendu après « ] » : {text}': 'unexpected text after “]”: {text}',
  'adresse IPv6 sans crochets ([…])': 'IPv6 address without brackets ([…])',
  'hôte vide': 'empty host',
  'port invalide « {port} »': 'invalid port “{port}”',

  // crates/tilde-ssh-config/src/forward.rs
  'redirection « {forward} » : {reason}': 'forward “{forward}”: {reason}',
  'cible manquante, ou redirection dynamique non prise en charge (attendu : [adresse:]port hôte:port)':
    'missing target, or a dynamic forward, which is not supported (expected: [address:]port host:port)',
  'deux arguments attendus ([adresse:]port hôte:port)':
    'two arguments expected ([address:]port host:port)',
  'les sockets Unix ne sont pas pris en charge': 'Unix sockets are not supported',
  'port de destination manquant dans « {target} »': 'missing destination port in “{target}”',
  "port d'écoute invalide « {port} »": 'invalid listening port “{port}”',
  "adresse d'écoute invalide « {address} »": 'invalid listening address “{address}”',
  'adresse IPv6 sans crochets « {address} »': 'IPv6 address without brackets “{address}”',

  // crates/tilde-ssh-config/src/include.rs
  'lecture impossible : {error}': "can't read the file: {error}",
  'octets non UTF-8 remplacés par « \u{fffd} »': 'non-UTF-8 bytes replaced with “\u{fffd}”',
  'Include « {pattern} » : motif invalide ({error})':
    'Include “{pattern}”: invalid pattern ({error})',
  'Include de {file} ignoré : profondeur maximale ({max}) atteinte':
    'Include of {file} ignored: maximum depth ({max}) reached',
  'Include circulaire ignoré : {file} est déjà en cours de lecture':
    'circular Include ignored: {file} is already being read',
  'Include de {file} : lecture impossible : {error}': "Include of {file}: can't read it: {error}",

  // crates/tilde-ssh-config/src/lexer.rs
  '« {keyword} » sans argument : ligne ignorée': '“{keyword}” without an argument: line ignored',
  'guillemets non fermés après « {keyword} » : ligne ignorée':
    'unclosed quotes after “{keyword}”: line ignored',

  // crates/tilde-ssh-config/src/validate.rs
  "« {keyword} » n'accepte qu'un argument : seul le premier est lu":
    '“{keyword}” takes a single argument: only the first one is read',
  '« {keyword} » : valeur « {value} » invalide ({expected})':
    '“{keyword}”: invalid value “{value}” ({expected})',
  'port de 1 à 65535': 'a port from 1 to 65535',
  'durée : 30, 30s, 1m30s…': 'a duration: 30, 30s, 1m30s…',
  'nombre entier': 'an integer',
  'yes ou no': 'yes or no',
  'yes, no, ask, accept-new ou off': 'yes, no, ask, accept-new or off',
  'Match invalide, bloc ignoré : {problem}': 'invalid Match, block ignored: {problem}',
  "Match {criterion} n'est pas pris en charge par Tilde : ce bloc ne s'appliquera jamais":
    "Tilde doesn't support Match {criterion}: this block will never apply",
  'aucun critère': 'no criteria',
  'argument manquant après « {name} »': 'missing argument after “{name}”',
  'critère inconnu « {name} »': 'unknown criterion “{name}”',
  "« all » ne se combine qu'avec canonical ou final": '“all” only combines with canonical or final',

  // src-tauri/src/commands/app.rs
  'aucun dossier de logs disponible': 'no logs folder available',
  'seuls les liens http et https peuvent être ouverts': 'only http and https links can be opened',

  // src-tauri/src/commands/connections.rs
  'fichier trop volumineux ({max} Mo au plus)': 'file too large (at most {max} MB)',
  '« {name} » ne peut pas être ouverte ({problem}) : corrigez-la dans la sidebar':
    "“{name}” can't be opened ({problem}): fix it in the sidebar",

  // src-tauri/src/commands/editor.rs
  "ce fichier n'est plus ouvert : rouvrez-le": 'this file is no longer open: open it again',

  // src-tauri/src/commands/monitor.rs
  "cette session SSH n'est plus ouverte": 'this SSH session is no longer open',

  // src-tauri/src/commands/session.rs
  'profil « {id} » introuvable': 'profile “{id}” not found',
  "l'application démarre encore, réessayez": 'the app is still starting, try again',
  'en-tête x-session-id manquant': 'missing x-session-id header',
  'corps binaire attendu': 'binary body expected',

  // src-tauri/src/commands/sftp.rs
  'cette session SSH n’est plus ouverte': 'this SSH session is no longer open',
  "commande d'éditeur vide": 'empty editor command',
  'pour modifier un fichier « .{ext} », indiquez un éditeur dans sftp.externalEditor':
    'to edit a “.{ext}” file, set an editor in sftp.externalEditor',
  'transfert inconnu': 'unknown transfer',
  "session fermée avant l'envoi : votre version est conservée dans {file}":
    'session closed before the upload: your version is kept in {file}',

  // src-tauri/src/commands/ssh.rs
  'session SSH {id} introuvable': 'SSH session {id} not found',

  // src-tauri/src/commands/themes.rs
  "le fichier n'est pas du texte UTF-8": 'the file is not UTF-8 text',

  // src-tauri/src/quake.rs
  'raccourci vide': 'empty shortcut',
  'choisissez une lettre, un chiffre ou une touche F : un symbole change de place selon la disposition du clavier':
    'choose a letter, a digit or an F key: symbols move with the keyboard layout',
  'touche inconnue : « {key} »': 'unknown key: “{key}”',
  'modificateur inconnu : « {modifier} »': 'unknown modifier: “{modifier}”',
  'ajoutez Ctrl ou Alt : une touche seule casserait la saisie':
    'add Ctrl or Alt: a key on its own would break typing',
  'raccourci refusé par le système : {error}': 'shortcut refused by the system: {error}',
  'Raccourci Quake « {shortcut} » indisponible : {error}':
    'Quake shortcut “{shortcut}” unavailable: {error}',

  // src-tauri/src/updater.rs
  'mise à jour impossible : {error}': 'update failed: {error}',
  'une mise à jour est déjà en cours': 'an update is already in progress',
  'Tilde est déjà à jour': 'Tilde is already up to date',
};
