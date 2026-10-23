# Panneaux : le contrat `PanelModule`

Chaque type de panneau de Tilde est un **module** enregistré dans `src/panels/registry.ts` :
terminal local, SSH, fichiers, éditeur, aperçu, moniteur. Le layout (onglets et splits) ne
connaît aucun panneau. Il garde dans son arbre une feuille `{ kind, …état }` et demande au
registre qui sait l'afficher. Les plugins tiers utiliseront plus tard ce même contrat ; au MVP,
seuls les modules internes s'enregistrent (`src/panels/core.tsx`), et aucun code extérieur
n'est chargé.

## Le contrat

```ts
interface PanelModule<S> {
  id: string; // unique, ex. "core.editor"
  kind: string; // clé stockée dans le layout et dans workspace.json
  title: string; // nom affiché (libellé d'onglet par défaut)
  icon: LucideIcon;
  component: ComponentType<PanelProps<S>>;
  tabTitle?(state: S): string;
  commands?: Command[]; // palette et raccourcis, actifs tant que le module l'est
  settings?: SettingsContribution; // réservé
  serialize?(state: S): unknown; // null : le panneau n'est pas sauvegardé
  deserialize?(raw: Record<string, unknown>): S | null; // null : panneau retiré
}

interface PanelProps<S> {
  tabId: string;
  leafId: string;
  state: S; // l'état stocké dans le layout
  active: boolean; // onglet visible et panneau focalisé
  visible: boolean; // onglet visible (focalisé ou non)
  update(patch: Partial<S>): void;
  close(): void;
}
```

- `registerPanel(module)` ajoute le module, ou remplace celui de même `kind`, et enregistre
  ses `commands`. La fonction renvoyée le retire, commandes comprises.
- `getPanelModule(kind)` et `listPanelModules()` servent au layout, à la restauration et à la
  barre d'onglets.

## Cycle de vie

1. **Ouverture** : une action du store (`openTab`, `openSftpBeside`, `openEditor`…) insère
   une feuille `{ kind, … }` dans l'arbre.
2. **Rendu** : `PaneView` trouve le module par `kind` et rend `component`. Les panneaux
   d'un onglet forment une liste à plat indexée par id : diviser ou fermer un panneau ne
   remonte jamais les autres. Les onglets cachés restent montés.
3. **Mise à jour** : le panneau appelle `update({ … })`. Seuls les champs que l'état possède
   déjà sont pris en compte.
4. **Sauvegarde** : à chaque changement, `workspace.json` reçoit `serialize(state)`, ou
   l'état tel quel si `serialize` est absent. `null` retire le panneau du fichier ;
   l'éditeur et l'aperçu l'utilisent, car ils ne sont pas restaurés.
5. **Restauration** : `workspace.json` est un fichier que l'utilisateur peut modifier.
   `deserialize` reçoit un objet non vérifié et doit valider chaque champ. Un `kind` inconnu,
   ou un `null` renvoyé, retire la feuille, et l'arbre est réparé.
6. **Fermeture** : `close()` retire la feuille ; le composant est démonté et libère ses
   ressources (sessions, minuteries).

## Modules internes

| `kind` | Module | Sauvegardé | Notes |
|---|---|---|---|
| `terminal` | `core.terminal` | oui | shell local, relancé dans son dernier dossier |
| `ssh` | `core.ssh` | oui | restauré « déconnecté », Entrée pour reconnecter |
| `sftp` | `core.sftp` | oui | lié à un panneau SSH (`linkedLeafId`) |
| `editor` | `core.editor` | non | CodeMirror chargé à la demande ; commande `editor.openFile` |
| `preview` | `core.preview` | non | Markdown, JSON, images ; peut suivre un éditeur en direct |
| `monitor` | `core.monitor` | oui | local, ou serveur d'un panneau SSH ; commande `monitor.open` |

## Exemple minimal

```tsx
import { Clock } from 'lucide-react';
import { registerPanel, type PanelProps } from '@/panels/registry';

interface ClockPanel {
  kind: 'clock';
  zone: string;
}

function ClockPane({ state }: PanelProps<ClockPanel>) {
  return <div>{new Date().toLocaleTimeString('fr-FR', { timeZone: state.zone })}</div>;
}

registerPanel<ClockPanel>({
  id: 'example.clock',
  kind: 'clock',
  title: 'Horloge',
  icon: Clock,
  component: ClockPane,
  deserialize: (raw) => (typeof raw.zone === 'string' ? { kind: 'clock', zone: raw.zone } : null),
});
```

## Règles

- **Pas d'accès direct au système** : un panneau passe par les commandes Tauri exposées
  (`src/ipc/*`). Le front n'a ni `fs` ni `shell`.
- **Chargement à la demande** : un panneau lourd (éditeur, aperçu) charge son code avec
  `React.lazy`, pour que le démarrage reste sous la seconde.
- **Panneaux liés** : un panneau qui dépend d'une session SSH (fichiers, moniteur distant,
  éditeur distant) garde `linkedLeafId`, l'id du panneau SSH. Il retrouve la session avec
  `useSessionId(linkedLeafId)` et suit ses reconnexions.
