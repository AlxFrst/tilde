# Personnaliser Tilde

Tout se règle depuis **Réglages** (icône ⚙ de la sidebar, ou « Réglages… » dans la palette
Ctrl+Maj+P). Tout se règle aussi dans des fichiers rechargés à chaud, dans le dossier de
configuration :

| Fichier            | Rôle                                                         |
| ------------------ | ------------------------------------------------------------ |
| `settings.json`    | tous les réglages (schéma JSON fourni pour l'autocomplétion) |
| `keybindings.json` | vos changements de raccourcis                                |
| `themes/*.json`    | vos thèmes, un par fichier                                   |

Ce dossier est `%APPDATA%\Tilde` sous Windows, `~/.config/Tilde` sous Linux et
`~/Library/Application Support/Tilde` sous macOS. Si l'un de ces fichiers contient une erreur,
Tilde l'indique, garde ce qui fonctionnait et n'écrase jamais le fichier.

## Thèmes

Thèmes intégrés :

| Sombres          | Clairs           |
| ---------------- | ---------------- |
| Tilde Dark       | Tilde Light      |
| Catppuccin Mocha | Catppuccin Latte |
| Tokyo Night      | Tokyo Night Day  |
| Dracula          | Gruvbox Light    |
| Nord             | One Light        |
| Gruvbox Dark     | Rosé Pine Dawn   |
| One Dark         |                  |
| Rosé Pine        |                  |

Il y a un thème sombre et un thème clair. L'apparence (Système, Sombre ou Clair) choisit
lequel est affiché ; « Système » suit le réglage de l'OS.

### Éditeur

Dans **Réglages → Thèmes**, « Dupliquer et modifier » ouvre l'éditeur sur une copie. Chaque
changement s'affiche aussitôt sur toute la fenêtre, terminaux compris. « Annuler » rétablit le
thème précédent. Les ratios de contraste (texte, texte secondaire, terminal) sont calculés en
direct ; sous le seuil WCAG AA, un avertissement s'affiche, sans bloquer l'enregistrement.
« Dériver l'interface du terminal » recalcule les couleurs de l'interface à partir de la
palette du terminal.

### Importer

**Réglages → Thèmes → Importer…** accepte :

- **iTerm2** : `.itermcolors` (plist XML) ;
- **Windows Terminal** : un jeu de couleurs seul (objet JSON avec `name`, `background`,
  `black`…), ou un `settings.json` complet, dont on choisit les jeux à importer ;
- **base16 / base24** : YAML (`scheme:` ou `name:`, puis `base00` à `base0F`).
- **Tilde** : un thème exporté depuis Tilde (format ci-dessous).

Ces formats ne décrivent que le terminal ; les couleurs de l'interface en sont **dérivées**.
Un thème importé s'ouvre dans l'éditeur avant d'être enregistré. Les fichiers de plus de
1 Mio, les XML qui déclarent des entités et les fichiers sans couleurs utilisables sont
refusés avec un message.

### Exporter

Le bouton ⬇ d'un thème l'enregistre au format de Tilde (ci-dessous), prêt à être partagé.

### Format d'un thème

`themes/<id>.json`, où l'id (le nom du fichier) ne contient que des minuscules, des chiffres
et des tirets. Seuls `name` et `terminal` sont obligatoires :

```json
{
  "version": 1,
  "name": "Mon thème",
  "kind": "dark",
  "terminal": {
    "foreground": "#E6E9EF",
    "background": "#0B0E14",
    "cursor": "#7AA2F7",
    "cursorAccent": "#0B0E14",
    "selectionBackground": "#7AA2F740",
    "black": "#1A1F2B",
    "red": "#F7768E",
    "green": "#9ECE6A",
    "yellow": "#E0AF68",
    "blue": "#7AA2F7",
    "magenta": "#BB9AF7",
    "cyan": "#5EEAD4",
    "white": "#C0C6D4",
    "brightBlack": "#4A5368",
    "brightRed": "#FF8FA3",
    "brightGreen": "#B5E07F",
    "brightYellow": "#F0C48A",
    "brightBlue": "#99B7FF",
    "brightMagenta": "#CDB2FF",
    "brightCyan": "#8AF5E4",
    "brightWhite": "#FFFFFF"
  }
}
```

- `kind` (`dark` ou `light`) : déduit du fond s'il est absent.
- `ui` : facultatif, et chaque clé peut être omise, auquel cas elle est dérivée du terminal.
  Les clés sont `bg`, `surface1`, `surface2`, `border`, `text`, `textMuted`, `accent`,
  `accent2`, `success`, `warning` et `error`.
- Couleurs au format `#RRGGBB`. Celles du terminal acceptent aussi `#RRGGBBAA`, utile pour
  `selectionBackground`.
- Un fichier ne peut pas reprendre l'id d'un thème intégré : il est signalé et ignoré.

## Raccourcis

**Réglages → Raccourcis** liste toutes les commandes.

- **Modifier** enregistre la prochaine combinaison pressée. Échap annule.
- **Retirer** laisse la commande sans raccourci.
- **Réinitialiser** revient au raccourci par défaut.

Une touche sans Ctrl ni Alt est refusée, car elle casserait la saisie dans le terminal (les
touches F1 à F24 font exception). Une combinaison déjà prise propose de la déplacer.

`keybindings.json` ne contient que vos changements :

```json
{
  "$schema": "./keybindings.schema.json",
  "version": 1,
  "bindings": {
    "tab.new": "Ctrl+Alt+T",
    "pane.close": null
  }
}
```

Une chaîne remplace le raccourci par défaut. `null` retire le raccourci. Une entrée invalide
est signalée, et le raccourci par défaut reste actif pour cette commande.

**Syntaxe** : `Ctrl`, `Alt` et `Shift` (dans n'importe quel ordre), suivis d'**une** touche
parmi les suivantes :

- `A`–`Z`, `0`–`9`, `F1`–`F24` ;
- `` ` `` `-` `=` `[` `]` `\` `;` `'` `,` `.` `/` ;
- `ArrowLeft`, `ArrowRight`, `ArrowUp`, `ArrowDown` ;
- `Tab`, `Enter`, `Escape`, `Space`, `Backspace`, `Delete`, `Insert`, `Home`, `End`,
  `PageUp`, `PageDown`.

Sous macOS, `Ctrl` désigne ⌘.

Les lettres suivent la touche imprimée : en AZERTY, `Ctrl+Shift+W` est la touche W. Les
autres touches suivent la position physique sur un clavier US : en AZERTY, `Alt+Shift+-` se
fait avec la touche `)`.

**Commandes** :

| Id                                   | Action                     | Défaut                      |
| ------------------------------------ | -------------------------- | --------------------------- |
| `tab.new`                            | Nouvel onglet              | Ctrl+Shift+T                |
| `tab.close`                          | Fermer l'onglet            | Ctrl+Shift+W                |
| `tab.next` / `tab.prev`              | Onglet suivant / précédent | Ctrl+Tab / Ctrl+Shift+Tab   |
| `pane.splitRight` / `pane.splitDown` | Diviser                    | Alt+Shift+= / Alt+Shift+-   |
| `pane.close`                         | Fermer le panneau          | Ctrl+Shift+X                |
| `pane.focusLeft` … `pane.focusDown`  | Changer de panneau         | Alt+flèches                 |
| `terminal.copy` / `terminal.paste`   | Copier / coller            | Ctrl+Shift+C / Ctrl+Shift+V |
| `terminal.search`                    | Rechercher                 | Ctrl+Shift+F                |
| `ssh.quickConnect`                   | Connexion SSH              | Ctrl+Shift+K                |
| `palette.toggle`                     | Palette de commandes       | Ctrl+Shift+P                |
| `sftp.open`                          | Fichiers (SFTP)            | Ctrl+Shift+E                |
| `app.settings`                       | Réglages                   | —                           |
| `connections.new`                    | Nouvelle connexion         | —                           |

Les autres commandes de la palette (import et export des connexions, ouverture des fichiers
de réglages…) peuvent aussi recevoir un raccourci : leur id figure dans **Réglages →
Raccourcis**.

## Transparence

**Réglages → Apparence → Fenêtre** :

| Effet    | Windows 11 | Windows 10 (1809+)   | macOS | Linux |
| -------- | ---------- | -------------------- | ----- | ----- |
| Mica     | ✓          | remplacé par Acrylic | —     | —     |
| Acrylic  | ✓          | ✓                    | —     | —     |
| Vibrancy | —          | —                    | ✓     | —     |

Les effets non disponibles sur votre système sont grisés.

**L'opacité**, de 30 à 100 %, s'applique aux fonds de la fenêtre et du terminal. Le texte, les
menus et les dialogues restent opaques. Sous Linux, la transparence demande un compositeur.
Comme un effet ne se voit pas derrière un fond opaque, choisir un effet alors que l'opacité
est à 100 % la règle sur 85 %.

## Mode Quake

**Réglages → Général → Mode Quake**. Un raccourci global (par défaut `Alt+F12`) fonctionne
même quand Tilde n'a pas le focus. Il prend une lettre, un chiffre ou une touche F, mais pas
un symbole : le système enregistre un raccourci global par touche virtuelle, et les symboles
changent de place selon la disposition (en AZERTY, la touche « ` » serait ù).

- Le terminal déroulant s'affiche en haut de l'écran sous la souris, sur toute la largeur et
  40 % de la hauteur.
- Le même raccourci le masque. Fermer son dernier onglet le masque aussi.
- Il ne restaure ni n'enregistre d'onglets, et ne garde pas l'application ouverte si vous
  fermez la fenêtre principale.

Si le raccourci est déjà pris par une autre application, ou s'il est invalide, un message
l'indique ; choisissez-en un autre.

## Polices et ligatures

- **Polices** : JetBrains Mono (terminal), Geist (interface) et Geist Mono sont incluses.
  Toute police installée peut être saisie. Si elle est introuvable, une police de repli est
  utilisée et le réglage le signale.
- **Ligatures** (`=>`, `!==`, `->`…) : réglage **Terminal → Ligatures**, avec le rendu WebGL.
