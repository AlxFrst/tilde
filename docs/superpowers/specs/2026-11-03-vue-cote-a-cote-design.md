# Tilde — Vue côte à côte

Date : 2026-11-03. Complète `2026-10-24-rail-espaces-design.md`, dont elle lève un
non-objectif (§3 : « Glisser une ligne dans le contenu pour diviser »). Maquette cliquable de
référence, validée par le contributeur : https://claude.ai/artifact/U4wsh9qjKUWjN7nkQmeAN5
(ses deux réglages en haut sont sur les valeurs retenues ici).

## 1. Intention

Aujourd'hui, une seule session du Rail est visible à la fois. « Diviser » existe, mais
seulement à l'intérieur d'une session : il ouvre un autre shell dans la même session. Le
contributeur veut **voir plusieurs sessions du Rail en même temps** (un serveur de prod à
gauche, un shell local à droite…), en les ouvrant par **clic droit** sur une session ou en
**glissant une session du Rail vers le contenu**.

Il a choisi la **vue côte à côte** (chaque session reste une session, avec sa ligne dans le
Rail) plutôt que la **fusion** (les panneaux d'une session déplacés dans une autre).

## 2. Objectifs

1. Afficher **de 2 à 4 sessions** de l'espace actif en même temps dans le contenu : la
   **vue**. Elles sont disposées en divisions (à droite, en bas, imbriquées) et
   redimensionnables.
2. Chaque session de la vue **garde tout ce qu'elle a** : sa ligne dans le Rail, ses
   panneaux et leurs divisions, son cadre d'environnement (la prod reste encadrée en rouge).
3. **Rien ne redémarre** : entrer dans une vue, en sortir, la réorganiser ou la redimensionner
   ne relance aucun shell et ne coupe aucune connexion SSH.
4. Chaque action a une **entrée visible** à la souris (menu, glisser, bouton ×) **et** une
   entrée au clavier (palette).

## 3. Non-objectifs

- Fusionner des sessions, ou déplacer un **panneau** d'une session à une autre.
- Mettre dans une même vue des sessions de **plusieurs espaces**.
- La vue dans la fenêtre **Quake**.
- Plusieurs vues enregistrées par espace, modèles de disposition.
- Réordonner la vue en glissant depuis le contenu (on glisse depuis le Rail uniquement).
- Diffusion de la saisie vers plusieurs sessions.

## 4. Anti-objectifs

- **Un shell ou une connexion qui redémarre** à cause d'un changement de disposition.
  `TerminalView` ferme sa session quand il est démonté : un `PaneView` ne doit jamais changer
  de parent ni de `key`.
- **Une session fermée ou cachée sans que l'utilisateur l'ait demandé.** Retirer une session
  de la vue ne la ferme pas.
- **Un doute sur la session où l'on tape** : la session active se voit à trois endroits
  (anneau d'accent sur son emplacement, barre du haut, ligne du Rail).
- **Changer quoi que ce soit pour qui n'utilise pas la vue** : clic sur une ligne, « Diviser »,
  raccourcis, `workspace.json` existants se comportent exactement comme avant.
- Une fonction accessible **uniquement** par menu contextuel ou par glisser (règle du Rail).

## 5. Contraintes

- Stack inchangée, **aucune dépendance nouvelle** (`@dnd-kit` est déjà là).
- Règles de `CONTRIBUTING.md` : une **issue d'abord** (la fonction touche l'architecture du
  front), tests écrits avant le code (RED → GREEN), CI verte (`pnpm lint`, `pnpm typecheck`,
  `pnpm test`), commits Conventional Commits (`feat(rail): …`).
- Interface en français, chaque nouvelle chaîne traduite dans `src/i18n/en/*`.
- `workspace.json` : version 1 inchangée, **champs ajoutés optionnels**, lus via
  `sanitize.ts` (fichier modifiable à la main : ne jamais lui faire confiance). Un fichier
  écrit avant cette fonction s'ouvre tel quel.
- Raccourcis : Windows et AZERTY d'abord. Aucune nouvelle commande n'a de raccourci par
  défaut (elles restent attribuables dans les réglages).

## 6. Décisions du contributeur

- La vue côte à côte, pas la fusion.
- Ouverture par clic droit sur une session et par glisser-déposer d'une session vers le
  contenu.
- La maquette telle quelle, avec ses deux réglages par défaut : **une seule barre d'en-tête**
  qui suit la session active, et **clic hors de la vue = la session s'affiche seule, la vue
  est mise de côté**.

## 7. Comportement

Les choix marqués *(mon choix)* n'ont pas été discutés un par un ; ils figurent dans la
maquette, que le contributeur a validée.

### 7.1 La vue

- Une **vue** est un arbre de divisions dont les feuilles sont des **sessions** (et non des
  panneaux) : même forme que l'arbre de panneaux d'une session (`row` / `column`, tailles en
  pourcentages).
- **Une vue par espace**, de 2 à 4 sessions *(mon choix pour le maximum)*. Une vue réduite à
  une session cesse d'exister : on revient à l'affichage d'aujourd'hui.
- Une vue est soit **affichée**, soit **mise de côté** (§7.5).
- La **session active** (`activeTabId`) est toujours l'une des sessions affichées. Elle reçoit
  le clavier ; les autres continuent de tourner et de s'afficher en direct.

### 7.2 Ce qu'on voit

- **Rail** : la session active garde son style sélectionné ; les autres sessions de la vue
  affichée ont un fond d'accent léger ; toutes les sessions de la vue portent une petite
  icône « colonnes », en couleur accent si la vue est affichée, atténuée si elle est mise de
  côté (infobulle : « Dans la vue côte à côte : clique pour la retrouver »).
- **Emplacement d'une session** : un bandeau fin en haut (icône, nom de la session,
  `user@hôte`, bouton × « Retirer de la vue »), puis son contenu habituel (ses panneaux, avec
  leurs propres en-têtes et séparateurs). L'emplacement de la session active a un anneau
  d'accent et un bandeau légèrement teinté.
- **Barre du haut** (`SessionHeader`) : inchangée, elle **suit la session active** (pastille
  d'environnement, nom, boutons Fichiers, Moniteur, Tunnels, Nouveau shell, Diviser). Quand
  une vue est affichée, elle gagne une étiquette « session active » pour dire sur quoi ses
  boutons agissent.
- **Cadre d'environnement** : quand une vue est affichée, chaque emplacement porte la bordure
  de couleur de **son** dossier (comme `sessionEnv` aujourd'hui, mais par session) ; `main`
  n'a plus de bordure colorée. Sans vue, rien ne change.
- **Séparateurs** entre emplacements : tirables, même apparence que ceux entre panneaux,
  taille minimale d'un emplacement à fixer par le builder.
- **Les sessions d'une vue gardent leurs propres divisions** : « Diviser » divise toujours
  l'intérieur de la session active, jamais la vue.

### 7.3 Menu contextuel d'une session (Rail)

En tête du menu existant, avant « Renommer » :

- **Ouvrir à droite**, **Ouvrir en bas** : place la session à côté de la **session active**.
  Si elle était déjà dans la vue, elle y est déplacée. Désactivé (avec la raison en
  infobulle) si c'est la session active, ou si la vue a déjà 4 sessions.
- **Afficher seule**, **Retirer de la vue** : seulement pour une session de la vue affichée.
  « Afficher seule » met la vue de côté et affiche cette session seule. « Retirer de la vue »
  la sort de la vue sans la fermer ; si elle était active, une autre session de la vue le
  devient.

Une **connexion épinglée sans session** (ligne « en sommeil ») propose aussi « Ouvrir à
droite » / « Ouvrir en bas » : sa session s'ouvre et prend place dans la vue *(mon choix)*.

### 7.4 Glisser une session du Rail sur le contenu

- Toute ligne de session (Aujourd'hui) ou de connexion épinglée se glisse, avec le même seuil
  qu'aujourd'hui (5 px). Glisser dans le Rail réordonne comme avant.
- Au-dessus du contenu, l'emplacement visé est découpé en zones : les **quatre bords**
  (le quart le plus proche de chaque côté) placent la session **à gauche, à droite,
  au-dessus ou en dessous** de la session visée ; le **centre** la met **à sa place** (la
  session remplacée quitte la vue sans être fermée), ou **échange** les deux si la session
  glissée était déjà dans la vue.
- Pendant le glisser, un aperçu montre la moitié (ou l'emplacement entier pour le centre)
  qu'occupera la session, avec une étiquette : « À droite de demo-server », « À la place de
  … », « Échanger avec … ». Vue pleine : aperçu rouge « 4 sessions au plus dans une vue », et
  rien ne se passe au lâcher.
- Lâcher la session sur elle-même ne fait rien. **Échap** annule le glisser.
- La session déposée devient la session active.

### 7.5 Afficher une session (clic sur une ligne du Rail, et toutes les autres voies)

- Ligne d'une session **de la vue affichée** : elle devient la session active.
- Ligne d'une session **hors de la vue** : elle s'affiche seule, comme aujourd'hui, et la vue
  est **mise de côté** (gardée telle quelle).
- Ligne d'une session **de la vue mise de côté** : toute la vue revient, et cette session
  devient la session active.
- **Toutes les autres façons d'afficher une session suivent la même règle** *(mon choix)* :
  session suivante / précédente (`tab.next`, `tab.prev`), nouvelle session, Dupliquer,
  « Ouvrir une autre session », connexion rapide, tuiles Favoris, Bibliothèque, palette
  (connexions et groupe *Sessions*), clic sur un panneau dans la liste de panneaux du Rail,
  ouverture d'un éditeur ou d'un moniteur dans une nouvelle session. La règle vit donc dans
  l'action qui rend une session active (`activate()` du store), pas dans les lignes du Rail.
- **Session suivante / précédente** parcourt toujours **toutes** les sessions de l'espace,
  dans l'ordre du Rail, avec cette règle : passer d'une session de la vue à une autre la rend
  simplement active ; arriver sur une session hors de la vue l'affiche seule et met la vue de
  côté ; revenir sur une session de la vue la fait revenir *(mon choix)*.

### 7.5 bis Précisions (réglées par la maquette)

- **Ouvrir à côté** quand la vue est mise de côté : une nouvelle vue se forme avec la session
  affichée et la session ajoutée ; l'ancienne vue mise de côté est **abandonnée** (il n'y a
  qu'une vue par espace).
- **Maximum de 4** : on compte les sessions de la vue affichée. Déplacer (menu ou glisser)
  une session qui y est déjà ne compte pas ; remplacer (dépôt au centre) non plus.
- **Session active après chaque action** : celle qu'on vient de placer, de déposer ou de
  cliquer ; après « Retirer de la vue » de la session active, la première session restante
  de la vue (ordre visuel).

### 7.6 Ce qui fait évoluer une vue sans qu'on y touche

- Une session **fermée** (de n'importe quelle façon) quitte la vue ; la vue se resserre, et
  disparaît s'il ne reste qu'une session.
- Une session qui **change d'espace** (« Déplacer vers l'espace », connexion déplacée,
  épinglage qui change son espace) quitte la vue de son ancien espace.
- **Changer d'espace** retrouve la vue de l'espace d'arrivée, affichée ou mise de côté, comme
  on l'avait laissée.
- Rien de tout cela ne ferme jamais une session.

### 7.7 Clavier et palette

- Depuis la palette, on peut au minimum : placer **n'importe quelle session de l'espace** à
  droite ou en bas de la session active, **retirer la session active de la vue**, et
  **afficher la session active seule**. Le builder choisit la forme ; proposition : les
  actions « → » qui existent déjà sur les hôtes, ajoutées aux entrées du groupe *Sessions*
  (Afficher, Ouvrir à droite, Ouvrir en bas), plus deux commandes « Retirer la session de la
  vue » et « Afficher la session seule ».
- Les déplacements de focus entre panneaux (`pane.focusLeft` … `pane.focusDown`)
  **traversent les sessions** d'une vue : au bord d'une session, ils passent à la session
  voisine *(mon choix)*.
- Mots-clés FR/EN pour la palette (« split », « side by side », « côte à côte »).

### 7.8 Interactions avec l'existant

- **Agrandir un panneau** (`toggleZoom`) dans une session de la vue : le panneau remplit
  l'emplacement de sa session ; le Rail ne se masque que si la session est affichée seule
  *(mon choix)*.
- **Aperçu (Peek)** : inchangé, au-dessus de tout le contenu, il suit la session active.
- **Fenêtre Quake** : aucune vue (elle garde sa barre d'onglets).
- **Premier lancement / aucune session** : l'écran d'accueil s'affiche comme aujourd'hui.

### 7.9 Sauvegarde

- `workspace.json` gagne un champ optionnel, la vue de chaque espace (arbre de sessions,
  tailles, affichée ou mise de côté). Proposition de forme :
  `views: { [spaceId]: { root: ViewNode, shown: boolean } }`, où une feuille référence un
  `Tab.id`.
- À la restauration (via `sanitize.ts`) : une feuille dont la session n'existe plus ou n'est
  plus dans cet espace est retirée, l'arbre est réparé (même logique que `removeLeaf`), une
  vue de moins de 2 sessions est abandonnée, les tailles sont renormalisées. Les sessions SSH
  reviennent « déconnectées » comme aujourd'hui (Entrée pour reconnecter), à leur place dans
  la vue.

## 8. Contraintes techniques pour le builder

- **Rendu sans remontage** : `AppShell` rend déjà chaque session dans un `PaneView` frère,
  avec `key={tab.id}`, caché quand la session n'est pas visible. La vue ne change que le
  **style** de ces conteneurs (de `absolute inset-0` vers le rectangle de l'emplacement). Ne
  jamais regrouper les `PaneView` dans un nouveau parent par emplacement.
- **Visible ≠ actif** : aujourd'hui `Leaf` reçoit `active={visible && active}`. Dans une vue,
  plusieurs sessions sont visibles ; seul le panneau actif de la **session active** doit
  recevoir `active` (le terminal prend le focus quand `active` passe à vrai). Il faut donc
  passer à `PaneView` l'information « session active » en plus de `visible`.
- **Redimensionnement** : les terminaux suivent la taille de leur conteneur
  (`ResizeObserver` dans `TerminalView`) ; rien à ajouter, mais à vérifier dans un test.
- **Logique pure et testée** : les opérations sur la vue (placer à côté, retirer, remplacer,
  échanger, rectangles, poignées, redimensionner, zone visée par le pointeur) vont dans des
  fonctions pures, comme `src/workspace/tree.ts`. Réutiliser `resizeAt`, ou généraliser
  `tree.ts` si cela reste lisible ; au choix du builder.
- **Glisser entre le Rail et le contenu** : les lignes sont aujourd'hui glissées dans deux
  `DndContext` séparés (`TodaySection`, `PinnedSection`), qui ne voient pas le contenu.
  Deux voies : un `DndContext` commun remonté dans `AppShell`, ou le suivi du pointeur dans
  `onDragMove` avec un test de position sur le rectangle du contenu (ce que fait la
  maquette). Au choix du builder ; le réordonnancement du Rail et
  `PinnedSection.dnd.test.tsx` doivent continuer de passer.
- **Espaces** : le store garde déjà `activeTabBySpace` ; la vue par espace suit le même modèle.
  `switchSpace`, `moveTabToSpace`, `reconcileSpaces`, `pinTab` / `unpinTab` et `removeTab`
  doivent maintenir les vues (§7.6).

## 9. Tests

Chaque règle de §7 a son test (Vitest + Testing Library), écrit avant le code :

- fonctions pures de la vue (placer à côté, retirer avec effondrement, remplacer, échanger,
  rectangles, poignées, zone visée par le pointeur) ;
- actions du store : ouvrir à côté, maximum de 4, retirer, afficher seule, mise de côté puis
  retour par clic, fermeture d'une session de la vue, changement d'espace d'une session,
  changement d'espace actif ;
- sauvegarde : aller-retour `serialize` → `sanitize`, fichier ancien sans `views`, vue
  corrompue ou pointant vers des sessions absentes ;
- **non-remontage** : le composant d'un panneau n'est pas démonté quand sa session entre dans
  une vue, en sort, ou change d'emplacement ;
- Rail : marqueurs, entrées du menu (actives, désactivées avec leur raison) ;
- glisser : un test d'intégration avec des rectangles donnés à la main, comme
  `PinnedSection.dnd.test.tsx` ;
- tests existants du Rail, de `PaneView`, de `AppShell` et du store : verts sans
  modification de leur intention.

## 10. Laissé au builder

Dimensions exactes, animations (discrètes, `prefers-reduced-motion` respecté), icônes,
formulation secondaire, découpage des composants, ordre des tâches, mécanisme du glisser
(§8), forme exacte des entrées de palette (§7.7), entrée du `CHANGELOG.md` et mise à jour des
README (EN et FR) si l'auteur le souhaite.

## 11. Livraison

1. Une issue sur `AlxFrst/tilde` (modèle *Feature request*, en anglais comme les modèles du
   dépôt) qui décrit le besoin et la proposition, avec un lien vers la maquette. La maquette
   est privée à sa création : le contributeur la partage depuis claude.ai avant que le lien
   ne serve.
2. Le contributeur (compte `LnYKLl`) n'a pas le droit d'écrire sur `AlxFrst/tilde` : la PR part
   de la branche `feat/vue-cote-a-cote` d'un **fork** (`LnYKLl/tilde`), référence l'issue et
   respecte §5. Créer l'issue, le fork et la PR sont des actions publiques : chacune est
   confirmée par le contributeur au moment de la faire.
