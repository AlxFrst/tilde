import { setLocale } from '@/i18n';
import { RUST } from './en/rust';
import { matchingTemplates, templateWeight, tRust } from './rust';

/** Messages exactly as Rust writes them (built from its format strings), and their English. */
const SAMPLES: readonly (readonly [string, string])[] = [
  // tilde-config: errors, validation (ConfigErrorDto.message)
  [
    "impossible d'accéder à /home/me/.config/Tilde/connections.json: fichier trop volumineux (5 Mo au plus)",
    "can't access /home/me/.config/Tilde/connections.json: file too large (at most 5 MB)",
  ],
  [
    "impossible d'accéder à C:\\Users\\me\\AppData\\Roaming\\Tilde\\settings.json: Accès refusé. (os error 5)",
    "can't access C:\\Users\\me\\AppData\\Roaming\\Tilde\\settings.json: Accès refusé. (os error 5)",
  ],
  [
    'type incorrect pour «  » : le fichier doit contenir un objet JSON',
    'wrong type for “”: the file must contain a JSON object',
  ],
  [
    'type incorrect pour « version » : doit être un entier positif',
    'wrong type for “version”: must be a positive integer',
  ],
  [
    'type incorrect pour « connections[0].port » : invalid type: string "22", expected u16',
    'wrong type for “connections[0].port”: invalid type: string "22", expected u16',
  ],
  [
    "valeurs hors limites : terminal.fontSize (2 n'est pas entre 6 et 72), appearance.window.opacity (0.1 n'est pas entre 0.3 et 1)",
    'invalid values: terminal.fontSize (2 is not between 6 and 72), appearance.window.opacity (0.1 is not between 0.3 and 1)',
  ],
  [
    'valeurs hors limites : name (le nom est obligatoire)',
    'invalid values: name (a name is required)',
  ],
  [
    'valeurs hors limites : proxyJump (ProxyJump «  » : saut vide)',
    'invalid values: proxyJump (ProxyJump “”: empty hop)',
  ],
  [
    'valeurs hors limites : proxyJump (ProxyJump « [::1 » : crochet fermant manquant)',
    'invalid values: proxyJump (ProxyJump “[::1”: missing closing bracket)',
  ],
  [
    'valeurs hors limites : proxyJump (ProxyJump « b1:http » : port invalide « http »)',
    'invalid values: proxyJump (ProxyJump “b1:http”: invalid port “http”)',
  ],
  [
    'valeurs hors limites : name (100 caractères au plus)',
    'invalid values: name (at most 100 characters)',
  ],
  [
    'valeurs hors limites : theme (identifiant « Mon Thème » invalide : lettres minuscules, chiffres et tirets (64 au plus))',
    'invalid values: theme (invalid id “Mon Thème”: lowercase letters, digits and hyphens (at most 64))',
  ],
  [
    'valeurs hors limites : terminal.copy-path (raccourci contenant un caractère de contrôle)',
    'invalid values: terminal.copy-path (shortcut contains a control character)',
  ],
  [
    'ce fichier a été écrit par une version plus récente de Tilde (version 2, version supportée 1) ; il est ouvert en lecture seule',
    'this file was written by a newer version of Tilde (version 2, supported version 1); it is open read-only',
  ],
  [
    'keybindings.json contient une erreur : corrigez-le avant de le modifier',
    'keybindings.json has an error: fix it before changing it',
  ],
  [
    'settings.json contient une erreur : corrigez-le avant de modifier les réglages',
    'settings.json has an error: fix it before changing the settings',
  ],
  // connections.json and keybindings.json warnings, theme file errors
  [
    '« Prod » : proxyJump : ProxyJump «  » : saut vide',
    '“Prod”: proxyJump: ProxyJump “”: empty hop',
  ],
  [
    '« Prod : EU » : host : un hôte ou un alias, sans espace',
    '“Prod : EU”: host: a host or an alias, without spaces',
  ],
  ['« bad id » : identifiant de commande invalide', '“bad id”: invalid command id'],
  [
    'plus de 500 raccourcis : les suivants sont ignorés',
    'more than 500 shortcuts: the following ones are ignored',
  ],
  [
    'nom de fichier invalide : lettres minuscules, chiffres et tirets',
    'invalid file name: lowercase letters, digits and hyphens',
  ],
  ['fichier trop volumineux (256 Kio au plus)', 'file too large (at most 256 KB)'],
  ['JSON invalide (ligne 3, colonne 7)', 'invalid JSON (line 3, column 7)'],
  // Sessions and SSH connections (errors and ConnState)
  [
    'impossible de lancer « pwsh » : No such file or directory (os error 2)',
    "can't start “pwsh”: No such file or directory (os error 2)",
  ],
  ['session 7 introuvable', 'session 7 not found'],
  ['session SSH 7 introuvable', 'SSH session 7 not found'],
  ['profil « wsl:Ubuntu » introuvable', 'profile “wsl:Ubuntu” not found'],
  ['bastion 1/2 (b1.example)', 'jump host 1/2 (b1.example)'],
  [
    'bastion 2/2 (b2.example) injoignable : Connection refused (os error 111)',
    "can't reach jump host 2/2 (b2.example): Connection refused (os error 111)",
  ],
  ['example.com : délai de connexion dépassé', 'example.com: connection timed out'],
  [
    "example.com : clé d'hôte refusée (empreinte modifiée)",
    'example.com: host key rejected (fingerprint changed)',
  ],
  [
    "bastion 1/1 (b1) : clé d'hôte refusée (certificats d'hôte non pris en charge)",
    'jump host 1/1 (b1): host key rejected (host certificates are not supported)',
  ],
  [
    'authentification refusée par alice@h — méthodes essayées : agent, ~/.ssh/id_ed25519, mot de passe',
    'authentication refused by alice@h — methods tried: agent, ~/.ssh/id_ed25519, password',
  ],
  [
    'authentification refusée par root@bastion 1/2 (b1) — méthodes essayées : keyboard-interactive',
    'authentication refused by root@jump host 1/2 (b1) — methods tried: keyboard-interactive',
  ],
  [
    'authentification refusée par u@h — méthodes essayées : ',
    'authentication refused by u@h — methods tried: ',
  ],
  ['connexion annulée', 'connection canceled'],
  [
    'example.com : erreur SSH : Connection reset by peer',
    'example.com: SSH error: Connection reset by peer',
  ],
  [
    'ProxyCommand : nc: connect failed (b1 : délai de connexion dépassé)',
    'ProxyCommand: nc: connect failed (b1: connection timed out)',
  ],
  ['trop de sauts ProxyJump (maximum 8)', 'too many ProxyJump hops (at most 8)'],
  ['ProxyJump circulaire : a → b → a', 'circular ProxyJump: a → b → a'],
  [
    'impossible de lancer le ProxyCommand « nc %h %p » : No such file or directory (os error 2)',
    "can't start the ProxyCommand “nc %h %p”: No such file or directory (os error 2)",
  ],
  [
    'indiquez un hôte (alias de ~/.ssh/config ou user@hôte:port)',
    'enter a host (an alias from ~/.ssh/config or user@host:port)',
  ],
  ['« a,b » : un seul hôte attendu', '“a,b”: only one host expected'],
  ['connexion perdue', 'connection lost'],
  [
    '« Prod » ne peut pas être ouverte (proxyJump : ProxyJump «  » : saut vide) : corrigez-la dans la sidebar',
    "“Prod” can't be opened (proxyJump: ProxyJump “”: empty hop): fix it in the sidebar",
  ],
  ["l'application démarre encore, réessayez", 'the app is still starting, try again'],
  // SFTP, transfers, edits, the editor
  ['SFTP indisponible : connexion en cours de rétablissement', 'SFTP unavailable: reconnecting'],
  [
    'SFTP indisponible : le serveur ne répond pas',
    'SFTP unavailable: the server is not responding',
  ],
  ['/etc/shadow : Permission denied', '/etc/shadow: Permission denied'],
  [
    'C:\\Users\\me\\Downloads\\a.txt.part : Accès refusé. (os error 5)',
    'C:\\Users\\me\\Downloads\\a.txt.part: Accès refusé. (os error 5)',
  ],
  [
    '/srv/app.log : fichier distant raccourci pendant le transfert',
    '/srv/app.log: remote file shrank during the transfer',
  ],
  [
    '/var/log/huge.log : fichier trop volumineux pour être modifié (64 Mio au plus) : téléchargez-le',
    '/var/log/huge.log: file too large to edit (at most 64 MB): download it',
  ],
  [
    "/tmp/tilde-edit/1-3/a/notes.txt : impossible d'ouvrir l'éditeur : « code » : No such file or directory (os error 2)",
    "/tmp/tilde-edit/1-3/a/notes.txt: can't open the editor: “code”: No such file or directory (os error 2)",
  ],
  [
    "/tmp/tilde-edit/1-3/a/evil.desktop : impossible d'ouvrir l'éditeur : pour modifier un fichier « .desktop », indiquez un éditeur dans sftp.externalEditor",
    "/tmp/tilde-edit/1-3/a/evil.desktop: can't open the editor: to edit a “.desktop” file, set an editor in sftp.externalEditor",
  ],
  [
    'le fichier a été modifié sur le serveur depuis son ouverture',
    'the file has changed on the server since it was opened',
  ],
  [
    "session fermée avant l'envoi : votre version est conservée dans /tmp/tilde-edit/3/a/notes.txt",
    'session closed before the upload: your version is kept in /tmp/tilde-edit/3/a/notes.txt',
  ],
  [
    "trop d'éléments à supprimer (plus de 100000) : opération arrêtée",
    'too many items to delete (more than 100000): stopped',
  ],
  ['fichier trop volumineux (5 Mio au plus)', 'file too large (at most 5 MB)'],
  [
    "fichier binaire ou non UTF-8 : ouvrez-le avec l'éditeur externe",
    'binary or non-UTF-8 file: open it with the external editor',
  ],
  ["ce fichier n'est plus ouvert : rouvrez-le", 'this file is no longer open: open it again'],
  ['cette session SSH n’est plus ouverte', 'this SSH session is no longer open'],
  // Tunnels, the monitor, shells
  [
    'écoute impossible sur 127.0.0.1:8080 : Address already in use (os error 98)',
    "can't listen on 127.0.0.1:8080: Address already in use (os error 98)",
  ],
  [
    "le serveur refuse d'écouter sur :2222 (Request denied)",
    'the server refused to listen on :2222 (Request denied)',
  ],
  ['commande impossible : channel closed', "couldn't run the command: channel closed"],
  [
    'moniteur distant : Linux uniquement (/proc introuvable sur ce serveur)',
    'remote monitor: Linux only (no /proc on this server)',
  ],
  ['cette machine', 'this machine'],
  ['Invite de commandes', 'Command Prompt'],
  // ssh_config diagnostics
  [
    '« port » : valeur « abc » invalide (port de 1 à 65535)',
    '“port”: invalid value “abc” (a port from 1 to 65535)',
  ],
  [
    '« stricthostkeychecking » : valeur « maybe » invalide (yes, no, ask, accept-new ou off)',
    '“stricthostkeychecking”: invalid value “maybe” (yes, no, ask, accept-new or off)',
  ],
  [
    'redirection « 8080 » : cible manquante, ou redirection dynamique non prise en charge (attendu : [adresse:]port hôte:port)',
    'forward “8080”: missing target, or a dynamic forward, which is not supported (expected: [address:]port host:port)',
  ],
  [
    'redirection « 80 db » : port de destination manquant dans « db »',
    'forward “80 db”: missing destination port in “db”',
  ],
  [
    'redirection « a:b:80 db:80 » : adresse IPv6 sans crochets « a:b:80 »',
    'forward “a:b:80 db:80”: IPv6 address without brackets “a:b:80”',
  ],
  [
    'Match invalide, bloc ignoré : critère inconnu « foo »',
    'invalid Match, block ignored: unknown criterion “foo”',
  ],
  [
    "Match exec n'est pas pris en charge par Tilde : ce bloc ne s'appliquera jamais",
    "Tilde doesn't support Match exec: this block will never apply",
  ],
  ['« host » sans argument : ligne ignorée', '“host” without an argument: line ignored'],
  [
    'Include de /home/me/.ssh/conf.d/a : lecture impossible : Permission denied (os error 13)',
    "Include of /home/me/.ssh/conf.d/a: can't read it: Permission denied (os error 13)",
  ],
  ['octets non UTF-8 remplacés par « \u{fffd} »', 'non-UTF-8 bytes replaced with “\u{fffd}”'],
  // Quake, updates, links
  [
    'Raccourci Quake « Ctrl+ù » indisponible : touche inconnue : « ù »',
    'Quake shortcut “Ctrl+ù” unavailable: unknown key: “ù”',
  ],
  [
    'Raccourci Quake « Ctrl+` » indisponible : choisissez une lettre, un chiffre ou une touche F : un symbole change de place selon la disposition du clavier',
    'Quake shortcut “Ctrl+`” unavailable: choose a letter, a digit or an F key: symbols move with the keyboard layout',
  ],
  [
    'Raccourci Quake « A » indisponible : ajoutez Ctrl ou Alt : une touche seule casserait la saisie',
    'Quake shortcut “A” unavailable: add Ctrl or Alt: a key on its own would break typing',
  ],
  ['mise à jour impossible : error sending request', 'update failed: error sending request'],
  ['Tilde est déjà à jour', 'Tilde is already up to date'],
  ['seuls les liens http et https peuvent être ouverts', 'only http and https links can be opened'],
  // tilde-ssh: files through sudo
  ['/root : permission refusée', '/root: permission denied'],
  ['mot de passe sudo refusé', 'sudo password refused'],
  [
    'sudo refusé : tilde is not in the sudoers file.',
    'sudo refused: tilde is not in the sudoers file.',
  ],
  ["sudo n'est pas installé sur ce serveur", 'sudo is not installed on this server'],
  ["nom d'utilisateur invalide : a b", 'invalid user name: a b'],
  ['sudo ne répond pas : pas de réponse', 'sudo is not answering: no answer'],
  ['sftp-server introuvable sur ce serveur', 'sftp-server not found on this server'],
];

/** Text that is not in the table: from the system, a server, or already English. */
const UNKNOWN = [
  'Connection refused (os error 111)',
  'example.com',
  'Ubuntu (WSL)',
  'a message : with colons',
  '',
  'constructor',
];

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('tRust', () => {
  test('returns French unchanged in French', () => {
    for (const [fr] of SAMPLES) expect(tRust(fr)).toBe(fr);
  });

  test('translates messages as Rust writes them, nested ones included', () => {
    setLocale('en');
    const wrong = SAMPLES.filter(([fr, en]) => tRust(fr) !== en).map(
      ([fr, en]) => `${fr}\n  got:  ${tRust(fr)}\n  want: ${en}`,
    );
    expect(wrong).toEqual([]);
  });

  test('leaves text without an entry, and English, unchanged', () => {
    setLocale('en');
    for (const text of UNKNOWN) expect(tRust(text)).toBe(text);
    for (const [, en] of SAMPLES) expect(tRust(en)).toBe(en);
  });
});

describe('the table of Rust messages', () => {
  test('keeps the placeholders of each message', () => {
    const wrong = Object.entries(RUST)
      .filter(([fr, en]) => placeholders(fr).join() !== placeholders(en).join())
      .map(([fr]) => fr);
    expect(wrong).toEqual([]);
  });

  test('has no two templates tied for a sample message', () => {
    const ties = SAMPLES.flatMap(([fr]) => {
      const [first, second] = matchingTemplates(fr);
      return first && second && templateWeight(first) === templateWeight(second)
        ? [`${fr}: ${first} / ${second}`]
        : [];
    });
    expect(ties).toEqual([]);
  });

  test('tries each template first for a message of its own shape', () => {
    const sample = (name: string) => (name === 'field' ? 'a.b' : name === 'path' ? '/x/y' : 'zz');
    const shadowed = Object.keys(RUST)
      .filter((fr) => /\{\w+\}/.test(fr))
      .filter((fr) => {
        const message = fr.replace(/\{(\w+)\}/g, (_, name: string) => sample(name));
        return matchingTemplates(message)[0] !== fr;
      });
    expect(shadowed).toEqual([]);
  });
});
