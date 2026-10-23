# Tilde — Rail et Espaces (refonte de l'interface)

Date : 2026-10-24. Complète `2026-10-23-tilde-design.md` (dont la §4.8 Front-end est
remplacée pour la fenêtre principale). Maquettes de référence (canvas « Tilde — nouvelle
interface », écrans A1 à A3) : https://claude.ai/artifact/9JGRmmQKMGLT91acdg36WB

## 1. Intention

L'auteur trouve l'interface actuelle « trop compliquée, ça ressemble aux autres » : onglets
horizontaux, fonctions cachées dans des menus contextuels, bouton Fichiers à côté des
onglets, moniteur qui « apparaît de nulle part » dans un onglet, panneaux qu'on ne sait pas
fermer ni diviser sans raccourci, `~/.ssh/config` qui inonde la barre latérale. Il veut une
interface **belle, moderne, intuitive, facile à prendre en main, pratique et fiable**, et
« révolutionnaire » dans l'esprit de la barre latérale d'Arc.

Il a choisi, parmi trois concepts maquettés, le concept **A · Rail**, et demandé en plus
**des espaces à la Arc** (« pro, perso, homelab, cloud… on peut se créer des profils »). La
release v0.1.0 suit cette refonte.

Leçon retenue de la recherche (bilan d'Arc par son équipe : « trop différent, trop de
choses nouvelles à apprendre pour trop peu de bénéfice ») : reprendre la **forme** d'Arc
avec **très peu de mots nouveaux**. Les mots nouveaux de Tilde sont : **Espaces**,
**Épinglés**, **Aujourd'hui**, **Bibliothèque**, **Aperçu**. Rien d'autre.

## 2. Objectifs

1. **La barre latérale (le Rail) est la seule navigation** de la fenêtre principale : plus
   de barre d'onglets en haut. Les sessions ouvertes y sont des lignes verticales.
2. **Tout ce qui concerne une connexion est rangé sous elle** : une session se déplie et
   montre ses panneaux (shells, fichiers, moniteur, éditeurs…). Un moniteur ou des
   fichiers ne sont jamais orphelins (déjà vrai depuis f6889ef).
3. **Chaque action a une entrée visible** à la souris, et la palette la retrouve au clavier
   (règle « make everything easy », mémoire de session) : diviser, fermer, fichiers,
   moniteur, tunnels, nouveau shell.
4. **Espaces** : l'utilisateur crée des espaces (nom, couleur, icône). Chaque espace a ses
   connexions épinglées et ses sessions. Changer d'espace change la barre et la session
   affichée ; les sessions des autres espaces continuent de tourner.
5. **`~/.ssh/config` ne va plus dans la barre** : il vit dans la **Bibliothèque**, avec
   toutes les connexions de tous les espaces, d'où on les ouvre, les adopte ou les épingle.
6. Garder tout ce qui marche : sessions, reconnexion, panneaux, persistance, raccourcis
   reconfigurables, thèmes, mode Quake, accessibilité clavier.

## 3. Non-objectifs (cette version)

Glisser une ligne dans le contenu pour diviser ; diffusion de la saisie vers plusieurs
serveurs ; modèles de disposition enregistrés ; annuler une fermeture ; archivage
automatique d'« Aujourd'hui » ; Aperçu d'autre chose que le moniteur ; blocs de commandes
(OSC 133) ; synchronisation entre machines ; thème complet par espace (seule la couleur
d'accent de l'espace teinte le Rail).

## 4. Anti-objectifs

- Un concept de plus qui ne sert à rien (Arc : 5,5 % d'usage des Spaces). Les espaces
  doivent rester **invisibles tant qu'on n'en crée pas** un deuxième, hormis le bouton « + ».
- Une fonction accessible **uniquement** par raccourci ou menu contextuel.
- Une session SSH fermée ou perdue **sans que l'utilisateur l'ait demandé** (jamais
  d'archivage automatique d'une session vivante).
- Perdre la configuration existante : `connections.json` et `workspace.json` actuels
  s'ouvrent tels quels, sans migration manuelle.
- Un état visible uniquement au survol (leçon Figma UI3) : l'état de connexion se voit
  toujours ; seules les actions secondaires d'une ligne apparaissent au survol.

## 5. Contraintes

- Stack inchangée (Tauri 2, React 19, TypeScript, Tailwind, Radix/shadcn, xterm.js, Rust).
- Windows en priorité, clavier AZERTY : aucun raccourci par défaut sur Ctrl+Alt+… (AltGr) ;
  aucun raccourci par défaut qui vole une touche utile au shell (Ctrl+K, Ctrl+W, Ctrl+D…
  restent au shell : les raccourcis de Tilde gardent Ctrl+Maj).
- Fichiers de config : `connections.json` reste la seule source des connexions, dossiers et
  désormais espaces ; écrit uniquement par Rust ; lisible et réparable à la main.
- Interface en français ; tests RED → GREEN pour chaque comportement ; CI verte.

## 6. Décisions (de l'auteur)

- Concept **A · Rail** comme interface principale.
- **Espaces** créables par l'utilisateur, à la Arc (exemples : Pro, Perso, Homelab, Cloud).
- Release après la refonte.

## 7. Décisions (les miennes, l'auteur m'a délégué ces choix)

### 7.1 Modèle de données

**`connections.json`** (version de fichier inchangée : champs ajoutés, optionnels) :

- `spaces: [{ id, name, color, icon }]` — `color` `#RRGGBB`, `icon` parmi les icônes de
  connexion existantes (`server`, `cloud`, `house`…) plus `briefcase` et `user`.
- `Folder.spaceId` et `Connection.spaceId` (`null` = le premier espace).
- **Liste vide = un espace implicite « Principal »** (id `main`), jamais écrit tant que
  l'utilisateur n'a pas créé de deuxième espace ; créer un espace quand la liste est vide
  écrit « Principal » puis le nouveau.
- Cohérence : une connexion rangée dans un dossier appartient à l'espace de ce dossier
  (réparé au chargement, imposé à l'écriture). Supprimer un espace déplace ses dossiers et
  connexions vers le premier espace restant ; on ne supprime pas le dernier.
- Export : inclut les espaces ; import : crée les espaces manquants par nom.

**`workspace.json`** (version 1, champs optionnels) :

- `Tab.spaceId` (`null` = premier espace), `Tab.pinnedConnectionId` (voir 7.2).
- `activeSpaceId` et `activeTabBySpace: { [spaceId]: tabId }`.
- Les onglets dont l'espace n'existe plus rejoignent le premier espace.

### 7.2 Sessions, Épinglés, Aujourd'hui

- Un **onglet** du modèle actuel devient une **session** : une ligne du Rail, dont le
  contenu (l'arbre de panneaux) s'affiche à droite.
- **Épinglés** = les dossiers et connexions enregistrées de l'espace actif (comme
  aujourd'hui, sans `~/.ssh/config`). Une connexion épinglée a **au plus une session
  épinglée** (`pinnedConnectionId`) : cliquer la ligne active cette session, ou l'ouvre.
  Une ligne épinglée sans session est « en sommeil » (atténuée) ; avec session, elle montre
  son état (point de couleur) et se déplie sur ses panneaux.
- **Aujourd'hui** = les autres sessions de l'espace : shells locaux, connexions tapées,
  doublons d'une session épinglée, éditeurs ouverts seuls. Réordonnables par glisser.
- Ouvrir une connexion épinglée d'un **autre** espace (palette, Bibliothèque) bascule vers
  cet espace. Toute autre ouverture se fait dans l'espace actif.
- Une ligne de session se déplie sur ses **panneaux** (« Shell 1 », « Fichiers »,
  « Moniteur », « NOTES.md »…) ; cliquer un panneau le met au premier plan. Une session à un
  seul panneau ne se déplie pas.
- Menu contextuel d'une session : Renommer, Couleur, Dupliquer, Épingler / Désépingler
  (SSH enregistrée), Déplacer vers l'espace…, Fermer, **Fermer les autres**, **Fermer
  celles en dessous**. Clic du milieu ferme ; double-clic renomme.
- **Favoris** : les connexions favorites de l'espace, en tuiles en haut du Rail (8 au plus).

### 7.3 Contenu : en-tête de session, en-têtes de panneau

- **En-tête de session** (une ligne en haut du contenu, qui sert aussi de zone de
  déplacement de la fenêtre et porte les boutons de fenêtre et des transferts) :
  - à gauche : pastille d'environnement (nom du dossier en capitales, couleur du dossier)
    si la connexion est dans un dossier coloré, nom de la session, `user@hôte`, « via
    <rebonds> » s'il y en a ;
  - à droite pour une session SSH : **Fichiers**, **Moniteur**, **Tunnels (n)**,
    **+ Shell** ; pour toutes : **Diviser à droite**, **Diviser en bas** (panneau actif).
- **Cadre d'environnement** : la carte du contenu prend la couleur du dossier (bordure
  discrète) ; la prod rouge se voit sans lire.
- **En-tête de panneau** (seulement quand la session a plusieurs panneaux) : icône, nom
  (« Fichiers · demo-server », « Moniteur · demo-server »…), Diviser à droite, Diviser en
  bas, **Fermer**. Un éditeur se ferme donc d'un clic.
- Le bandeau d'état du serveur (sous les terminaux SSH) reste ; son bouton « Détails »
  ouvre l'**Aperçu**.
- Le menu contextuel du terminal gagne « Diviser à droite » et « Diviser en bas ».

### 7.4 Aperçu (Peek)

Le moniteur d'une session s'ouvre par défaut en **Aperçu** : une carte flottante au-dessus
du contenu (Échap ou × la ferme), avec « Ancrer à droite » qui le transforme en panneau
(comportement actuel). Les fichiers s'ouvrent directement en panneau (usage long).

### 7.5 Espaces dans le Rail

- En bas du Rail : une rangée d'icônes d'espaces (couleur + icône), l'actif mis en avant,
  et « + ». Tant qu'il n'existe qu'un espace, seule la rangée « + Nouvel espace » discrète
  est montrée.
- Création / modification dans une fenêtre : nom, couleur (le `ColorPicker` existant),
  icône. Clic droit : Modifier, Supprimer (confirmation, avec le nombre de connexions
  déplacées).
- Le fond du Rail prend une **teinte légère** de la couleur de l'espace (signature d'Arc).
- Raccourcis : `space.1` … `space.9` = Ctrl+Maj+1 … 9 (touches physiques, reconfigurables),
  `space.next` / `space.prev` = Ctrl+Maj+Page suivante / précédente.

### 7.6 Bibliothèque

Une grande fenêtre (ouverte depuis le bas du Rail, la palette ou Ctrl+Maj+L) avec une
recherche et deux parties : **Connexions** (toutes, groupées par espace puis dossier) et
**`~/.ssh/config`** (hôtes non adoptés, avec le groupe « Masqués »). Actions par ligne :
Ouvrir, Ouvrir dans l'espace actif, Déplacer vers l'espace…, Adopter (hôtes), Modifier ;
plus Importer / Exporter. Elle remplace la section `~/.ssh/config` du Rail.

### 7.7 Rail : forme et comportement

- De haut en bas : logo et bouton « Masquer le Rail » ; champ « Rechercher, se connecter,
  agir… » (ouvre la palette, montre son raccourci) ; Favoris ; Épinglés ; Aujourd'hui ;
  « + Nouvelle session » (avec le choix du shell) ; en bas Bibliothèque, Espaces, Réglages.
- **Masquer le Rail** : `sidebar.toggle` = Ctrl+Maj+B ; masqué, il réapparaît en
  surimpression quand la souris touche le bord de la fenêtre, et se rentre quand elle part.
- Position gauche ou droite et largeur : réglages existants.
- Navigation clavier : flèches entre les lignes (comme aujourd'hui), Entrée ouvre.

### 7.8 Palette

- Cherche aussi les **sessions ouvertes** (tous espaces) et les **espaces**.
- Sur un hôte ou une connexion, **→** ouvre ses actions (Se connecter, Se connecter à côté,
  Fichiers, Moniteur, Copier la commande ssh, Modifier, Épingler) avec leur raccourci.
- Mots-clés synonymes FR/EN sur les commandes (« split » trouve « Diviser »).

### 7.9 Ce qui ne change pas

Fenêtre Quake : garde sa petite barre d'onglets horizontale (console déroulante, sans
Rail). Réglages, dialogues de connexion, de dossier, de tunnels : inchangés (le dialogue de
dossier gagne le choix de l'espace ; celui de connexion aussi).

### 7.10 Précisions après relecture (mes choix)

1. **Épingler** n'ajoute aucun champ à une connexion : « Épinglés » = toutes les
   connexions enregistrées de l'espace. « Épingler » une session la rattache à la ligne de
   sa connexion (`pinnedConnectionId`), « Désépingler » la renvoie dans Aujourd'hui. Pas
   d'action « Épingler » sur une connexion dans la palette ni la Bibliothèque (la
   Bibliothèque propose « Déplacer vers l'espace actif »).
2. **Une session reste un arbre de divisions où tout est visible** : aucun panneau masqué
   ni empilé. Cliquer un panneau dans le Rail lui donne le focus. « + Shell » ouvre un
   nouveau shell sur le même hôte, à droite du panneau actif (comme Diviser sur un
   panneau SSH, mais aussi depuis Fichiers ou Moniteur).
3. **L'espace d'une session épinglée vient de sa connexion** (calculé, jamais stocké) ;
   `Tab.spaceId` ne compte que pour les sessions non épinglées. « Déplacer vers
   l'espace… » sur une session épinglée déplace la connexion (via Rust ; elle quitte son
   dossier s'il est dans un autre espace) et la session suit. Déplacer une connexion dans
   la Bibliothèque fait de même. Supprimer un espace : ses connexions et ses sessions non
   épinglées rejoignent le premier espace. Aucune session vivante n'est jamais fermée par
   un déplacement.
4. **En-tête de session et cadre d'environnement suivent le panneau actif** : son hôte SSH
   (pour Fichiers ou Moniteur, celui de la session SSH liée) ; un panneau local n'a ni
   pastille ni cadre. La ligne du Rail montre l'état de connexion des panneaux SSH de la
   session vers la connexion épinglée.
5. **Récents** quitte le Rail (la palette et la Bibliothèque les gardent). « Fermer les
   autres » = les autres sessions de l'espace actif ; « Fermer celles en dessous » = dans
   Aujourd'hui. Au premier lancement après la mise à jour, chaque connexion enregistrée
   ouverte dans une session restaurée reçoit sa première session comme session épinglée.

## 8. Laissé au builder

Animations (discrètes, `prefers-reduced-motion` respecté), dimensions exactes, découpage
des composants, ordre des tâches, wording secondaire, icônes exactes.

## 9. Tests

Chaque règle de 7.1 à 7.8 a son test (Rust pour le modèle de `connections.json`, Vitest +
Testing Library pour le reste) ; les tests existants de la barre latérale et de la barre
d'onglets sont réécrits pour le Rail. Les maquettes ne sont pas une source de tests
pixel ; les captures du README sont refaites après la refonte.
