# Vue côte à côte : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** afficher de 2 à 4 sessions du Rail en même temps dans le contenu (la « vue »), par
clic droit, glisser-déposer et palette, sans jamais relancer un shell.

**Architecture :** une vue est un arbre de divisions dont les feuilles sont des `Tab.id`
(`src/workspace/view.ts`, fonctions pures). Le store `workspace` garde une vue par espace
(`views`), affichée ou mise de côté ; la règle d'affichage vit dans `activate()`. `AppShell`
rend toujours un `PaneView` par session, frères avec `key={tab.id}` ; la vue ne change que
le **style** de leur conteneur (rectangle de l'emplacement), donc rien n'est remonté.

**Tech Stack :** React 19, TypeScript, Zustand, Tailwind, Radix (shadcn), cmdk, dnd-kit,
Vitest + Testing Library. Aucun changement Rust.

**Spec :** `docs/superpowers/specs/2026-11-03-vue-cote-a-cote-design.md` (maquette :
https://claude.ai/artifact/U4wsh9qjKUWjN7nkQmeAN5). Issue : AlxFrst/tilde#22.

Branche : `feat/vue-cote-a-cote` (remote `fork` = `LnYKLl/tilde`).

## Global Constraints

- Aucune dépendance nouvelle.
- Maximum : `MAX_VIEW_SESSIONS = 4`. Zone de bord pour le dépôt : 0,25 de la taille de
  l'emplacement. Espace entre emplacements : 3 px de chaque côté (`calc(x% + 3px)`, largeur
  `calc(w% - 6px)`). Taille minimale d'un emplacement au redimensionnement : 15 %.
- Un `PaneView` ne change jamais de parent ni de `key`, et sa structure DOM interne est la
  même avec ou sans emplacement (sinon `TerminalView` se démonte et ferme son shell).
- Toute chaîne passée à `t()`, `tn()` ou `msg()` est en français et a son entrée anglaise
  dans `src/i18n/en/<zone>.ts` (`src/i18n/i18n.test.ts` échoue sinon). Chaînes fixées par la
  spec : « Ouvrir à droite », « Ouvrir en bas », « Afficher seule », « Retirer de la vue »,
  « Retirer {name} de la vue », « session active », « Dans la vue côte à côte : clique pour
  la retrouver », « À gauche de {name} », « À droite de {name} », « Au-dessus de {name} »,
  « En dessous de {name} », « À la place de {name} », « Échanger avec {name} »,
  « {n} sessions au plus dans une vue », « Retirer la session de la vue », « Afficher la
  session seule ».
- Aucune nouvelle commande n'a de raccourci par défaut.
- `workspace.json` reste en version 1 ; `views` est optionnel ; un fichier sans `views`
  s'ouvre tel quel.
- Fenêtre Quake : aucune vue (elle ne passe ni `slot` ni `focused` à `PaneView`).
- Commits Conventional Commits (`feat(view): …`, `test(view): …`), terminés par la ligne
  `Co-Authored-By` demandée. Chaque tâche finit avec `pnpm test` vert sur les fichiers
  touchés ; la dernière avec `pnpm lint`, `pnpm typecheck`, `pnpm test` verts.

## Review Focus

1. **Le shell d'une session de la vue se termine** (exit, Ctrl+D) : la session se ferme, la
   vue se resserre, la session active reste dans la vue. Test : tâche 4.
2. **`workspace.json` dont `activeTabId` est hors d'une vue `shown: true`** : la vue est mise
   de côté, jamais affichée avec le focus ailleurs. Test : tâche 4.
3. **Glisser une ligne puis la lâcher dans le Rail** : le réordonnancement marche comme
   avant et aucun aperçu ne reste affiché. Test : tâche 9.
4. **Supprimer l'espace qui contient une vue** : ses sessions rejoignent le premier espace,
   la vue de l'espace supprimé disparaît, rien n'est fermé. Test : tâche 4.
5. **Ctrl+Tab quand toutes les sessions de l'espace sont dans la vue** : la vue reste
   affichée à chaque pas. Test : tâche 3.

---

### Task 1 : modèle pur de la vue

**Files:**
- Create: `src/workspace/view.ts`
- Modify: `src/workspace/tree.ts` (exporter `childRects` et extraire `neighborIn`)
- Test: `src/workspace/view.test.ts`, `src/workspace/tree.test.ts` (inchangé, doit rester vert)

**Interfaces:**
- Consumes: `Rect`, `SplitHandle`, `resizeAt` de `tree.ts`.
- Produces :

```ts
// tree.ts
export function childRects(
  node: { direction: Direction; sizes: number[]; children: readonly unknown[] },
  r: Rect,
): Rect[];
export function neighborIn(all: ReadonlyMap<string, Rect>, id: string, dir: FocusDirection): string | null;
// neighbor(root, leafId, dir) devient neighborIn(layoutRects(root), leafId, dir)

// view.ts
export type ViewNode =
  | { type: 'leaf'; tabId: string }
  | { type: 'split'; id: string; direction: Direction; children: ViewNode[]; sizes: number[] };
export interface SpaceView { root: ViewNode; shown: boolean }
export type Edge = 'left' | 'right' | 'top' | 'bottom';
export type DropZone = Edge | 'center';
export const MAX_VIEW_SESSIONS = 4;
export function viewTabs(root: ViewNode): string[];            // ordre visuel
export function viewHas(root: ViewNode, tabId: string): boolean;
export function viewPlace(root: ViewNode, targetTabId: string, tabId: string, edge: Edge): ViewNode;
export function viewReplace(root: ViewNode, targetTabId: string, tabId: string): ViewNode;
export function viewRemove(root: ViewNode, tabId: string): ViewNode | null;
export function viewKeep(root: ViewNode, keep: (tabId: string) => boolean): ViewNode | null;
export function viewRects(root: ViewNode): Map<string, Rect>;  // clé : tabId
export function viewHandles(root: ViewNode): SplitHandle[];
export function viewSetSizes(root: ViewNode, splitId: string, sizes: number[]): ViewNode;
export function dropZoneAt(slot: Rect, x: number, y: number): DropZone;
export function dropPreview(slot: Rect, zone: DropZone): Rect;
```

- [ ] **Step 1 : écrire les tests qui échouent** (`view.test.ts`)

```ts
const L = (tabId: string): ViewNode => ({ type: 'leaf', tabId });
const row = (...tabs: string[]) => /* split row, tailles égales */;
test('placing to the right of a lone session makes a 50/50 row', () => {
  expect(viewPlace(L('a'), 'a', 'b', 'right')).toMatchObject({ type: 'split', direction: 'row', children: [L('a'), L('b')], sizes: [50, 50] });
});
test('placing to the left puts the session first', /* children [b, a] */);
test('placing beside a member of a row of the same direction adds a sibling, equal sizes', /* row(a,b) + c right of a → [a,c,b], sizes ≈ 33.33 */);
test('placing below a member of a row nests a column in its place', /* row(a,b) + c bottom of b → [a, column(b,c)] */);
test('placing a session already in the view moves it', /* row(a,b,c), place a right of c → viewTabs [b,c,a] */);
test('placing a session beside itself changes nothing', /* same reference */);
test('replacing puts an outsider in the target place', /* row(a,b), replace b by c → [a,c] */);
test('replacing with a member swaps them', /* row(a,b), replace a by b → [b,a] */);
test('removing collapses one-child splits and rescales', /* sizes [20,30,50] remove middle → ≈ [28.57, 71.43]; row(a,b) remove a → L('b'); L('a') remove a → null */);
test('keeping every session returns the same tree', /* viewKeep(root, () => true) === root */);
test('rects follow the sizes', /* row [60,40] → a {x:0,w:0.6}, b {x:0.6,w:0.4}, h 1 */);
test('a drop zone is the nearest edge within a quarter, else the centre', () => {
  const full = { x: 0, y: 0, w: 1, h: 1 };
  expect(dropZoneAt(full, 0.9, 0.5)).toBe('right');
  expect(dropZoneAt(full, 0.1, 0.5)).toBe('left');
  expect(dropZoneAt(full, 0.5, 0.05)).toBe('top');
  expect(dropZoneAt(full, 0.5, 0.95)).toBe('bottom');
  expect(dropZoneAt(full, 0.5, 0.5)).toBe('center');
  expect(dropZoneAt({ x: 0.5, y: 0, w: 0.5, h: 1 }, 0.55, 0.5)).toBe('left');
});
test('the preview is the half the session will take', /* dropPreview(full,'right') → {x:.5,y:0,w:.5,h:1}; 'center' → full */);
```

- [ ] **Step 2 : lancer `pnpm vitest run src/workspace/view.test.ts`** — attendu : FAIL (module absent).
- [ ] **Step 3 : écrire `view.ts`** et le refactor de `tree.ts`. `viewPlace` suit la même
  règle que `splitLeaf` (parent de même direction → frère, tailles égales ; sinon division
  50/50), avec `before` pour `left`/`top`. Les `id` de division viennent de
  `crypto.randomUUID()`. `viewRemove` et `viewKeep` renormalisent comme `removeLeaf`.
  `dropZoneAt` : coordonnées relatives à l'emplacement, distances aux quatre bords, la plus
  petite si elle est < 0,25.
- [ ] **Step 4 : lancer `pnpm vitest run src/workspace`** — attendu : PASS (`tree.test.ts` compris).
- [ ] **Step 5 : commit** `feat(view): side-by-side view model`

### Task 2 : sauvegarde de la vue

**Files:**
- Modify: `src/workspace/types.ts`, `src/workspace/serialize.ts`, `src/workspace/sanitize.ts`
- Test: `src/workspace/viewPersist.test.ts`

**Interfaces:**
- Consumes: `SpaceView`, `viewKeep`, `viewTabs` (tâche 1).
- Produces :

```ts
// types.ts, WorkspaceSnapshot
views?: Record<string, SpaceView>;
// serialize.ts
export function serializeSnapshot(tabs, activeTabId, activeSpaceId?, activeTabBySpace?, views?: Record<string, SpaceView>): WorkspaceSnapshot;
// sanitize.ts
export function sanitizeViews(raw: unknown, tabIds: ReadonlySet<string>): Record<string, SpaceView>;
// sanitizeSnapshot renvoie aussi `views`
```

- [ ] **Step 1 : tests qui échouent**
  - `serialize drops a view member whose session is not saved` : une session qui ne contient
    qu'un éditeur + deux terminaux dans une vue à 3 → la vue sauvegardée a 2 sessions ;
    avec 2 sessions dont l'éditeur → `views` vide.
  - `a saved view comes back as it was` : `sanitizeSnapshot(serializeSnapshot(...))` garde
    `root` (mêmes `tabId`, directions, tailles) et `shown`.
  - `a file without views opens with none` : `views` vaut `{}`.
  - `sanitizeViews repairs what it can` : valeur non objet → `{}` ; feuille vers une session
    inconnue → retirée et arbre réparé ; même session dans deux vues → gardée dans la
    première seulement ; `shown` non booléen → `false` ; tailles invalides → égales ; vue
    réduite à une session → abandonnée ; profondeur > 32 → abandonnée.
- [ ] **Step 2 : lancer le fichier** — FAIL.
- [ ] **Step 3 : implémenter** (réutiliser `isObj`, `str`, `uniqueId`, `sanitizeSizes` de
  `sanitize.ts`).
- [ ] **Step 4 : lancer `pnpm vitest run src/workspace`** — PASS.
- [ ] **Step 5 : commit** `feat(view): save the view in workspace.json`

### Task 3 : la vue dans le store

**Files:**
- Modify: `src/stores/workspace.ts`
- Test: `src/stores/workspace.view.test.ts` (même mise en place que `workspace.spaces.test.ts`)

**Interfaces:**
- Consumes: tâches 1 et 2.
- Produces (dans `WorkspaceState`) :

```ts
views: Record<string, SpaceView>;
placeInView: (tabId: string, targetTabId: string, zone: DropZone) => void;
canPlaceInView: (tabId: string | null, targetTabId: string, zone: DropZone) => boolean;
removeFromView: (tabId: string) => void;
showAlone: (tabId: string) => void;
setViewSizes: (splitId: string, sizes: number[]) => void;
// export hors du store, renvoie la référence stockée (sélecteur stable)
export function shownView(s: Pick<WorkspaceState, 'views' | 'activeSpaceId'>): ViewNode | null;
```

Règles (spec §7.1, §7.3, §7.5, §7.5 bis) :
- `activate(tabId)` : si l'espace de la session a une vue, `shown = viewHas(root, tabId)`.
  C'est toute la règle « clic hors de la vue / retour de la vue », pour toutes les voies.
- `placeInView` : rien si `tabId === targetTabId`, si l'une manque, ou si elles ne sont pas du
  même espace. Base = la vue de l'espace si elle contient la cible (affichée ou non), sinon
  `{ type: 'leaf', tabId: targetTabId }`. Centre → `viewReplace` ; bord → refus si la
  session n'est pas dans la base et que la base a déjà 4 sessions, sinon `viewPlace`.
  Résultat d'au moins 2 sessions → `views[espace] = { root, shown: true }` (remplace une vue
  mise de côté). Résultat d'une session sur une base feuille → seulement `activate(tabId)`.
  Puis `activate(tabId)`.
- `canPlaceInView` : mêmes conditions, sans rien changer (`tabId` `null` = connexion pas
  encore ouverte : seul le maximum compte ; centre → vrai).
- `removeFromView` : seulement pour une session de la vue affichée ; moins de 2 sessions →
  la vue disparaît ; si elle était active, la première session restante (ordre visuel)
  devient active.
- `showAlone` : session de la vue affichée → `shown = false`, elle devient active (sans
  passer par la règle d'`activate`).
- `snapshot` passe `views` ; `hydrate` reprend `snap.views ?? {}`.

- [ ] **Step 1 : tests qui échouent** (`a`, `b`, `c`, `d`, `e` ouvertes par `openTab('cmd')`)
  - `opening a session on the right forms a shown view` : `placeInView(b, a, 'right')` →
    `shownView` = row(a,b), `activeTabId` = b.
  - `a session cannot be placed beside itself nor in a full view` : `canPlaceInView(a, a, 'right')`
    faux ; vue de 4 → `canPlaceInView(e, a, 'right')` faux, `canPlaceInView(b, a, 'bottom')`
    vrai (déjà dedans), `canPlaceInView(e, a, 'center')` vrai.
  - `a centre drop swaps two members`.
  - `showing a session outside the view sets the view aside, a member brings it back` :
    `activateTab(c)` → `shownView` null, `views.main.shown` faux ; `activateTab(b)` → vue
    affichée, `activeTabId` = b.
  - `a new session sets the view aside` : `openTab('cmd')` → `shown` faux.
  - `Ctrl+Tab keeps the view while every session of the space is in it` (Review Focus 5) :
    vue (a,b), aucune autre session → `activateRelative(1)` deux fois → toujours affichée.
  - `Ctrl+Tab through an outsider sets the view aside and brings it back`.
  - `show alone, then the same session again, brings the view back`.
  - `removing the active session from the view focuses the first remaining one` (vue à 3) ;
    `removing from a view of two dissolves it`.
  - `placing beside a lone session while a view is set aside replaces that view`.
  - `a session of another space cannot be placed`.
  - `the view is saved and restored` : `snapshot().views` puis `hydrate` → même `root`, même `shown`.
- [ ] **Step 2 : lancer le fichier** — FAIL.
- [ ] **Step 3 : implémenter.**
- [ ] **Step 4 : lancer `pnpm vitest run src/stores`** — PASS (tests existants compris).
- [ ] **Step 5 : commit** `feat(view): one side-by-side view per space in the workspace store`

### Task 4 : la vue suit les sessions (fermeture, espaces, restauration)

**Files:**
- Modify: `src/workspace/view.ts` (ajout de `fixViews`), `src/stores/workspace.ts`
- Test: `src/workspace/view.test.ts`, `src/stores/workspace.view.test.ts`

**Interfaces:**
- Produces :

```ts
// view.ts
export function fixViews(
  views: Record<string, SpaceView>,
  tabs: readonly Tab[],
  spaceOf: ((tab: Tab) => string) | null, // null : espaces pas encore connus
  activeSpaceId: string,
  activeTabId: string | null,
): Record<string, SpaceView>; // même référence si rien ne change
```

Règles (§7.6) : garder les feuilles dont la session existe et (si `spaceOf`) est dans
l'espace de la vue ; abandonner une vue de moins de 2 sessions ; si la vue de l'espace actif
est affichée et que `activeTabId` n'y est pas, `shown = false`. Dans le store :
`useWorkspace.subscribe` (à côté de celui du zoom) applique `fixViews` avec
`spacesReady() ? spaceOfTab : null`, et `reconcileSpaces` l'applique aussi. `removeTab` et
`moveTabToSpace` choisissent la prochaine session active parmi les sessions restantes de la
vue affichée (ordre visuel) avant `neighbourOf`.

- [ ] **Step 1 : tests qui échouent**
  - `fixViews` : même référence quand tout est valide ; session absente retirée ; session
    d'un autre espace retirée seulement si `spaceOf` est donné ; vue affichée avec
    `activeTabId` dehors → mise de côté.
  - `closing the active session of a view of three keeps the two others shown`.
  - `a shell that exits in a view member closes it and the view tightens` (Review Focus 1) :
    `closeLeaf(b, seulPanneauDeB)` → vue (a,c) affichée, session active dans la vue.
  - `closing one session of a view of two leaves the other alone`.
  - `moving a view member to another space takes it out of the view`.
  - `a pinned session whose connection changes space leaves the view` (nouveau resolver puis
    `reconcileSpaces`).
  - `deleting the space of a view drops it and closes nothing` (Review Focus 4) : resolver
    sans l'espace `pro` puis `reconcileSpaces(['main'])` → `views.pro` absent, sessions
    toujours là.
  - `a restored file with the active session outside a shown view sets it aside` (Review Focus 2).
  - `before spaces are known, a restored view keeps its pinned sessions` (resolver par défaut).
- [ ] **Step 2 : lancer** — FAIL.
- [ ] **Step 3 : implémenter.**
- [ ] **Step 4 : lancer `pnpm vitest run src/stores src/workspace`** — PASS.
- [ ] **Step 5 : commit** `feat(view): keep the view in step with closed and moved sessions`

### Task 5 : passer d'une session à l'autre au clavier

**Files:**
- Modify: `src/stores/workspace.ts` (`focusNeighbor`)
- Test: `src/stores/workspace.view.test.ts`

**Interfaces:** consomme `neighborIn` (tâche 1), `layoutRects`, `viewRects`, `shownView`.

`focusNeighbor(dir)` : sans vue affichée, inchangé. Avec une vue : carte globale
`leafId → Rect` (rectangle du panneau dans sa session, ramené dans l'emplacement de la
session), `neighborIn(carte, activeLeafId de la session active, dir)`, puis `activate` de la
session qui contient ce panneau et `focusLeaf`.

- [ ] **Step 1 : tests qui échouent** : vue (a|b) d'un panneau chacune → `focusNeighbor('right')`
  depuis a rend b active ; depuis b, `'right'` ne change rien ; a divisée (a1|a2), focus sur
  a1 → `'right'` va à a2 (même session), puis `'right'` va à b.
- [ ] **Step 2 : lancer** — FAIL. **Step 3 : implémenter.** **Step 4 : lancer** — PASS.
- [ ] **Step 5 : commit** `feat(view): pane focus moves across the sessions of a view`

### Task 6 : rendu des emplacements

**Files:**
- Modify: `src/app/PaneView.tsx`, `src/app/AppShell.tsx`
- Create: `src/app/content/SlotHeader.tsx`
- Test: `src/app/PaneView.test.tsx`, `src/app/AppShell.test.tsx`

**Interfaces:**
- Consumes: `shownView`, `viewRects`, `removeFromView`, `activateTab`.
- Produces :

```ts
export function PaneView(props: { tab: Tab; visible: boolean; focused?: boolean; slot?: Rect | null }): JSX.Element;
// focused vaut visible par défaut (fenêtre Quake, tests existants)
export function SlotHeader(props: { tab: Tab; focused: boolean }): JSX.Element;
```

- `PaneView` rend toujours `div` extérieur > [`SlotHeader` si `slot`] + `div` intérieur
  (`ref={container}`, `relative`, prend la place restante) > panneaux et séparateurs.
  Sans `slot` : extérieur `absolute inset-0`. Avec `slot` : extérieur positionné (Global
  Constraints), `flex flex-col overflow-hidden rounded-lg border bg-background`, bordure à la
  couleur de `sessionEnv(tab, file)` mélangée à 55 % (comme `main` aujourd'hui), anneau
  d'accent si `focused`. `onMouseDownCapture` sur l'extérieur : `activateTab` si `slot` et
  pas `focused`.
- `Leaf` reçoit `active={visible && focused && active}` (et `PaneHeader` de même).
- `SlotHeader` : icône de la session, `sessionTitle`, `user@hôte` (même calcul que
  `SessionHeader` : `describeTarget` de la connexion, sinon la cible SSH ; rien pour un shell
  local), bouton × `aria-label` « Retirer {name} de la vue » → `removeFromView`. Fond teinté
  d'accent si `focused`. Exporter `useSessionIcon` de `SessionRow.tsx` pour l'icône.
- `AppShell` (fenêtre principale seulement) : `view = useWorkspace(shownView)`,
  `rects = useMemo(() => view && viewRects(view), [view])` ; pour chaque session
  `visible = rects ? rects.has(t.id) : t.id === activeTabId`, `focused = t.id === activeTabId`,
  `slot = rects?.get(t.id) ?? null`. Avec une vue, `main` n'a plus de bordure colorée
  (`border-transparent`) et porte `data-view-area` (sert à la tâche 9 ; le mettre dans tous
  les cas).

- [ ] **Step 1 : tests qui échouent**
  - `PaneView` : `a session entering and leaving a slot keeps its terminal mounted`
    (`mounts.get(leafId)` reste 1 après `rerender` avec puis sans `slot`).
  - `PaneView` : `only the focused session's active pane is active` (`data-active` faux pour
    `focused={false}`, vrai pour `focused`).
  - `AppShell` : `a shown view displays every session in it, each with its strip` (deux
    terminaux non cachés, deux boutons « Retirer … de la vue ») ; `the strip's × takes the
    session out of the view` ; `a mouse down in another slot makes its session active`.
- [ ] **Step 2 : lancer `pnpm vitest run src/app/PaneView.test.tsx src/app/AppShell.test.tsx`** — FAIL.
- [ ] **Step 3 : implémenter** (+ traductions).
- [ ] **Step 4 : lancer** — PASS, ainsi que `src/i18n`.
- [ ] **Step 5 : commit** `feat(view): show the sessions of a view side by side`

### Task 7 : séparateurs, barre du haut, Rail masqué

**Files:**
- Create: `src/app/content/ViewDividers.tsx`
- Modify: `src/app/AppShell.tsx`, `src/app/content/SessionHeader.tsx`
- Test: `src/app/AppShell.test.tsx`, `src/app/content/SessionHeader.test.tsx`

**Interfaces:** consomme `viewHandles`, `setViewSizes`, `resizeAt` (min 15), `shownView`.

- `ViewDividers({ view, area })` : un `role="separator"` par poignée, même apparence et même
  calcul de pointeur que `Divider` dans `PaneView.tsx`, sur le rectangle de `main`.
- `SessionHeader` : étiquette « session active » (infobulle : « Les boutons de cette barre
  agissent sur la session active ») quand `shownView` n'est pas nul.
- `useRailHidden` : le zoom ne masque le Rail que sans vue affichée.

- [ ] **Step 1 : tests qui échouent** : `a view of two has one separator` ; `dragging the
  separator resizes the sessions` (`getBoundingClientRect` simulé, `views.main.root.sizes`
  ≈ [70, 30] après un glisser à 70 %) ; `the header says which session it acts on` (présent
  avec une vue, absent sans) ; `zooming a pane in a view keeps the Rail`.
- [ ] **Step 2 : lancer** — FAIL. **Step 3 : implémenter.** **Step 4 : lancer** — PASS.
- [ ] **Step 5 : commit** `feat(view): resize the view and name the active session`

### Task 8 : Rail : marqueurs et menu contextuel

**Files:**
- Create: `src/app/rail/ViewMenu.tsx`
- Modify: `src/app/rail/SessionRow.tsx` (`RowShell`, `SessionMenuItems`, `SessionRow`),
  `src/app/rail/PinnedSection.tsx` (`PinnedRow`), `src/app/rail/ConnectionMenu.tsx`,
  `src/app/actions.ts`
- Test: `src/app/rail/Rail.test.tsx`

**Interfaces:**
- Produces :

```ts
// ViewMenu.tsx
export function useViewMark(tabId: string | undefined): 'shown' | 'aside' | null;
export function ViewMenuItems(props: { tabId: string | null; connection?: Connection }): JSX.Element | null;
// actions.ts
export function placeConnectionInView(c: Connection, targetTabId: string, zone: DropZone): void;
// RowShell : nouvelle prop
view?: 'shown' | 'aside' | null;
```

- `RowShell` : `data-view={view}` sur le bouton ; icône `Columns2` (accent si `shown`,
  atténuée si `aside`, infobulle « Dans la vue côte à côte : clique pour la retrouver » pour
  `aside`) ; fond d'accent léger si `shown` et pas `active`.
- `ViewMenuItems` (en tête de `SessionMenuItems` et de `ConnectionMenu`, suivi d'un
  séparateur) : « Ouvrir à droite » / « Ouvrir en bas » (`placeInView(tabId, activeTabId,
  'right' | 'bottom')`, ou `placeConnectionInView` si `tabId` est nul) désactivés quand
  `canPlaceInView` est faux, avec la raison en petit texte atténué dans l'élément (un élément
  Radix désactivé ne reçoit pas le survol, donc pas d'infobulle) : « {n} sessions au plus
  dans une vue », ou rien pour la session active elle-même. « Afficher seule » et « Retirer
  de la vue » seulement si la session est dans la vue affichée.
- `placeConnectionInView` : session épinglée existante → `placeInView` ; sinon
  `openPinned(...)` (qui met la vue de côté) puis `placeInView(nouvelle, targetTabId, zone)`
  (la cible est dans la vue mise de côté, qui revient).

- [ ] **Step 1 : tests qui échouent** : `Open on the right from a Today session forms a view` ;
  `the active session cannot be opened beside itself` (élément désactivé) ; `a full view
  disables the items and says why` ; `a member offers Show alone and Remove from view` ;
  `rows of the view are marked` (`data-view="shown"`, puis `"aside"` après un clic hors de
  la vue) ; `Open on the right on an asleep pinned connection opens its session beside the
  active one`.
- [ ] **Step 2 : lancer `pnpm vitest run src/app/rail`** — FAIL. **Step 3 : implémenter.**
  **Step 4 : lancer** — PASS (avec `src/i18n`).
- [ ] **Step 5 : commit** `feat(view): open a session beside the active one from the Rail`

### Task 9 : glisser une session du Rail sur le contenu

**Files:**
- Create: `src/app/viewDrop.ts`, `src/app/content/ViewDropOverlay.tsx`
- Modify: `src/stores/ui.ts`, `src/app/rail/TodaySection.tsx`, `src/app/rail/PinnedSection.tsx`,
  `src/app/AppShell.tsx`
- Test: `src/app/viewDrop.test.ts`, `src/app/rail/viewDrop.dnd.test.tsx`

**Interfaces:**
- Produces :

```ts
// ui.ts
viewDrop: ViewDropPreview | null;
setViewDrop: (p: ViewDropPreview | null) => void;
// viewDrop.ts
export type DragSource = { tabId: string } | { connectionId: string };
export interface ViewDropTarget { targetTabId: string; zone: DropZone; slot: Rect }
export interface ViewDropPreview { rect: Rect; label: string; bad: boolean }
export function viewDropTarget(x: number, y: number): ViewDropTarget | null;
export function previewFor(source: DragSource, target: ViewDropTarget | null, names: LabelNames): ViewDropPreview | null;
export function viewDragHandlers(sourceOf: (active: Active) => DragSource | null, names: LabelNames): {
  onDragMove: (e: DragMoveEvent) => void;
  onDragCancel: () => void;
  /** Vrai si le dépôt était pour la vue (la section ne réordonne pas). */
  onDragEnd: (e: DragEndEvent) => boolean;
};
```

- `viewDropTarget` : rectangle de `[data-view-area]` ; emplacements = `viewRects(shownView)`,
  sinon la session active sur tout le contenu ; `dropZoneAt`. Hors du contenu → `null`.
- Position du pointeur : `activatorEvent` (`PointerEvent`) + `delta`.
- `previewFor` : `null` si la source est la cible ; vue pleine et bord → `bad`, libellé
  « {n} sessions au plus dans une vue » (n = 4) ; sinon `dropPreview` et le libellé de la
  zone (« Échanger avec {name} » si la source est déjà dans la vue).
- `onDragEnd` : aperçu vidé ; dépôt valide → `placeInView` ou `placeConnectionInView` (cible,
  zone) ; renvoie vrai dès que le pointeur était sur le contenu.
- `TodaySection` (`{ tabId: active.id }`) et `PinnedSection` (connexion → sa session si elle
  existe, sinon `{ connectionId }`) branchent ces gestionnaires ; leur `onDragEnd` existant ne
  s'exécute que si `onDragEnd` de la vue renvoie faux. Échap annule déjà un glisser de
  dnd-kit (`onDragCancel`).
- `ViewDropOverlay` dans `main` : boîte en pointillés couleur accent (rouge si `bad`) au
  rectangle de l'aperçu (mêmes `calc` que les emplacements), libellé au centre.

- [ ] **Step 1 : tests qui échouent**
  - `viewDrop.test.ts` : `viewDropTarget` avec `[data-view-area]` simulé à (300, 0, 1000, 600)
    et une session active seule : (1250, 300) → zone `right` ; (800, 300) → `center` ;
    (100, 300) → `null`. `previewFor` : libellés et `bad`.
  - `viewDrop.dnd.test.tsx` (comme `PinnedSection.dnd.test.tsx`) : `dropping a Today session
    on the right edge of the content puts it beside the active one` ; `dropping it in the
    centre shows it in place of the active one` ; `dropping it back on the Rail reorders and
    leaves no preview` (Review Focus 3) ; `Escape cancels the drop`.
- [ ] **Step 2 : lancer** — FAIL. **Step 3 : implémenter** (+ traductions). **Step 4 : lancer
  `pnpm vitest run src/app`** — PASS (`PinnedSection.dnd.test.tsx` compris).
- [ ] **Step 5 : commit** `feat(view): drag a session from the Rail onto the content`

### Task 10 : palette

**Files:**
- Modify: `src/app/CommandPalette.tsx`, `src/commands/builtin.ts`
- Test: `src/app/CommandPalette.test.tsx`

**Interfaces:**
- Produces :

```ts
// CommandPalette.tsx
interface SessionPage { kind: 'session'; tabId: string; label: string }
// page : Target | SessionPage
export function sessionActions(tabId: string): Action[];
// builtin.ts : commandes 'view.removeActive' (« Retirer la session de la vue »)
// et 'view.showAlone' (« Afficher la session seule »), groupe 'Sessions'
```

- → (ou le chevron) sur une entrée du groupe *Sessions* ouvre ses actions : « Afficher »
  (`activateTab`) ; « Ouvrir à droite », « Ouvrir en bas » si `canPlaceInView(tabId,
  activeTabId, zone)` ; « Afficher seule », « Retirer de la vue » si elle est dans la vue
  affichée. Le texte d'invite de la page reste générique (« Que faire avec cette session ? »).
- Mots-clés des deux commandes et des actions : `split`, `side by side`, `côte à côte`,
  `vue`, `view`. Les deux commandes ne font rien sans vue affichée.

- [ ] **Step 1 : tests qui échouent** : `→ on a session lists what can be done with it` ;
  `Open on the right from the palette forms a view` ; `the remove and show-alone commands act
  on the active session`.
- [ ] **Step 2 : lancer** — FAIL. **Step 3 : implémenter** (+ traductions). **Step 4 : lancer**
  — PASS.
- [ ] **Step 5 : commit** `feat(view): side-by-side actions in the palette`

### Task 11 : documentation et vérification finale

**Files:**
- Modify: `CHANGELOG.md` (section `## [Unreleased]` / `### Added`), `README.md` et
  `README.fr.md` (une puce dans *Features* sous celle du Rail).

- [ ] **Step 1 : écrire l'entrée du CHANGELOG et les puces des README** (clic droit, glisser,
  4 sessions, rien ne redémarre, une vue par espace).
- [ ] **Step 2 : lancer `pnpm lint`, `pnpm typecheck`, `pnpm test`** — tout vert.
- [ ] **Step 3 : commit** `docs: side-by-side sessions in the changelog and READMEs`
