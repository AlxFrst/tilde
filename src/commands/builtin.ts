// Tilde's own commands. Titles are what the palette shows.

import { closeActivePane, closeTab, openDefaultTab, splitActivePane } from '@/app/actions';
import { switchSpaceAt, switchSpaceRelative } from '@/app/spaces/spaceActions';
import { checkForUpdates } from '@/app/updates';
import { exportWithToast, importWithReport } from '@/connections/transfer';
import { msg, t } from '@/i18n';
import { openKeybindingsFile } from '@/ipc/keybindings';
import { openLogsDir, openSettingsFile } from '@/ipc/settings';
import { openThemesDir } from '@/ipc/themes';
import { blankConnection, useConnections } from '@/stores/connections';
import { useSsh } from '@/stores/ssh';
import { useUi } from '@/stores/ui';
import { useWorkspace } from '@/stores/workspace';
import { bindingKeys } from '@/terminal/keyLabels';
import { activeTerminal } from '@/terminal/terminalActions';
import { findLeaf } from '@/workspace/tree';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { toast } from 'sonner';
import { registerCommands, type Command } from './registry';

const ws = () => useWorkspace.getState();

/** Shows or hides the files of the active SSH pane. */
function toggleFilesOfActivePane(): void {
  const { tabs, activeTabId } = ws();
  const tab = tabs.find((x) => x.id === activeTabId);
  const leaf = tab ? findLeaf(tab.root, tab.activeLeafId) : null;
  if (leaf?.panel.kind === 'ssh') ws().toggleSftp(leaf.id);
  else if (leaf?.panel.kind === 'sftp') ws().toggleSftp(leaf.panel.linkedLeafId);
  else {
    toast.info(
      t('Les fichiers s’ouvrent depuis un onglet SSH ({keys} pour se connecter).', {
        keys: bindingKeys('Ctrl+Shift+K').join('+'),
      }),
    );
  }
}
const noop = () => undefined;

export function registerBuiltins(): () => void {
  const commands: Command[] = [
    {
      id: 'tab.new',
      title: msg('Nouvelle session'),
      group: 'Sessions',
      keywords: ['new tab', 'onglet', 'terminal', 'shell'],
      run: openDefaultTab,
    },
    {
      id: 'tab.close',
      keywords: ['close tab', 'onglet'],
      title: msg('Fermer la session'),
      group: 'Sessions',
      run: () => {
        const id = ws().activeTabId;
        if (id) void closeTab(id);
      },
    },
    {
      id: 'tab.next',
      keywords: ['next tab', 'onglet'],
      title: msg('Session suivante'),
      group: 'Sessions',
      run: () => {
        ws().activateRelative(1);
      },
    },
    {
      id: 'tab.prev',
      keywords: ['previous tab', 'onglet'],
      title: msg('Session précédente'),
      group: 'Sessions',
      run: () => {
        ws().activateRelative(-1);
      },
    },
    {
      id: 'sidebar.toggle',
      keywords: ['sidebar', 'rail', 'hide', 'zen', 'focus'],
      title: msg('Masquer / afficher la barre latérale'),
      group: 'Application',
      run: () => {
        const { railHidden, setRailHidden } = useUi.getState();
        setRailHidden(!railHidden);
      },
    },
    {
      id: 'window.fullscreen',
      keywords: ['fullscreen', 'plein écran', 'zen'],
      title: msg('Plein écran'),
      group: 'Application',
      run: () => {
        const win = getCurrentWindow();
        void win.isFullscreen().then((on) => win.setFullscreen(!on));
      },
    },
    {
      id: 'library.open',
      keywords: ['library', 'hosts', 'ssh config', 'connexions'],
      title: msg('Bibliothèque'),
      group: 'Connexions',
      run: () => {
        useUi.getState().setLibraryOpen(true);
      },
    },
    {
      id: 'space.next',
      keywords: ['next space', 'profile'],
      title: msg('Espace suivant'),
      group: 'Espaces',
      run: () => {
        switchSpaceRelative(1);
      },
    },
    {
      id: 'space.prev',
      keywords: ['previous space', 'profile'],
      title: msg('Espace précédent'),
      group: 'Espaces',
      run: () => {
        switchSpaceRelative(-1);
      },
    },
    {
      id: 'space.new',
      keywords: ['new space', 'profile', 'profil'],
      title: msg('Nouvel espace…'),
      group: 'Espaces',
      run: () => {
        useUi.getState().setSpaceDialog('new');
      },
    },
    ...Array.from({ length: 9 }, (_, i): Command => ({
      id: `space.${String(i + 1)}`,
      title: msg('Aller à l’espace {n}'),
      titleVars: { n: i + 1 },
      group: 'Espaces',
      hidden: true,
      run: () => {
        switchSpaceAt(i);
      },
    })),
    {
      id: 'pane.splitRight',
      keywords: ['split', 'right', 'côte à côte', 'vertical'],
      title: msg('Diviser à droite'),
      group: 'Panneaux',
      run: () => {
        splitActivePane('row');
      },
    },
    {
      id: 'pane.splitDown',
      keywords: ['split', 'down', 'horizontal'],
      title: msg('Diviser en bas'),
      group: 'Panneaux',
      run: () => {
        splitActivePane('column');
      },
    },
    {
      id: 'pane.close',
      keywords: ['close pane'],
      title: msg('Fermer le panneau'),
      group: 'Panneaux',
      run: () => void closeActivePane(),
    },
    {
      id: 'pane.maximize',
      keywords: ['zoom', 'maximize', 'fullscreen', 'plein écran', 'agrandir'],
      title: msg('Agrandir / réduire le panneau'),
      group: 'Panneaux',
      run: () => {
        const { tabs, activeTabId } = ws();
        const tab = tabs.find((x) => x.id === activeTabId);
        if (tab) ws().toggleZoom(tab.id, tab.activeLeafId);
      },
    },
    {
      id: 'pane.focusLeft',
      title: msg('Panneau de gauche'),
      group: 'Panneaux',
      run: () => {
        ws().focusNeighbor('left');
      },
    },
    {
      id: 'pane.focusRight',
      title: msg('Panneau de droite'),
      group: 'Panneaux',
      run: () => {
        ws().focusNeighbor('right');
      },
    },
    {
      id: 'pane.focusUp',
      title: msg('Panneau du dessus'),
      group: 'Panneaux',
      run: () => {
        ws().focusNeighbor('up');
      },
    },
    {
      id: 'pane.focusDown',
      title: msg('Panneau du dessous'),
      group: 'Panneaux',
      run: () => {
        ws().focusNeighbor('down');
      },
    },
    {
      id: 'terminal.copy',
      title: msg('Copier la sélection'),
      group: 'Terminal',
      run: () => {
        activeTerminal()?.copy();
      },
    },
    {
      id: 'terminal.paste',
      title: msg('Coller'),
      group: 'Terminal',
      run: () => {
        activeTerminal()?.paste();
      },
    },
    {
      id: 'terminal.search',
      title: msg('Rechercher dans le terminal'),
      group: 'Terminal',
      run: () => {
        activeTerminal()?.search();
      },
    },
    {
      id: 'ssh.quickConnect',
      keywords: ['connect', 'ssh', 'host'],
      title: msg('Connexion SSH rapide…'),
      group: 'Connexions',
      run: () => {
        useSsh.getState().setQuickConnectOpen(true);
      },
    },
    {
      id: 'sftp.open',
      keywords: ['files', 'sftp', 'explorer', 'transfer'],
      title: msg('Afficher / masquer les fichiers (SFTP)'),
      group: 'Connexions',
      run: toggleFilesOfActivePane,
    },
    {
      id: 'connections.new',
      keywords: ['new connection', 'host', 'server'],
      title: msg('Nouvelle connexion…'),
      group: 'Connexions',
      run: () => {
        useConnections.getState().setEditing(blankConnection());
      },
    },
    {
      id: 'connections.newFolder',
      title: msg('Nouveau dossier…'),
      group: 'Connexions',
      run: () => {
        useConnections.getState().setEditingFolder('new');
      },
    },
    {
      id: 'connections.import',
      keywords: ['import'],
      title: msg('Importer des connexions…'),
      group: 'Connexions',
      run: () => void importWithReport(),
    },
    {
      id: 'connections.export',
      keywords: ['export'],
      title: msg('Exporter les connexions…'),
      group: 'Connexions',
      run: () => void exportWithToast(),
    },
    {
      id: 'palette.toggle',
      title: msg('Palette de commandes'),
      group: 'Application',
      hidden: true,
      run: () => {
        const { paletteOpen, setPaletteOpen } = useUi.getState();
        setPaletteOpen(!paletteOpen);
      },
    },
    {
      id: 'app.settings',
      keywords: ['settings', 'preferences', 'options', 'paramètres'],
      title: msg('Réglages…'),
      group: 'Application',
      run: () => {
        useUi.getState().setSettingsOpen(true);
      },
    },
    {
      id: 'app.openSettingsFile',
      title: msg('Ouvrir settings.json'),
      group: 'Application',
      run: () => void openSettingsFile().catch(noop),
    },
    {
      id: 'app.openKeybindingsFile',
      title: msg('Ouvrir keybindings.json'),
      group: 'Application',
      run: () => void openKeybindingsFile().catch(noop),
    },
    {
      id: 'app.openThemesDir',
      title: msg('Ouvrir le dossier des thèmes'),
      group: 'Application',
      run: () => void openThemesDir().catch(noop),
    },
    {
      id: 'app.checkUpdates',
      keywords: ['update', 'version'],
      title: msg('Rechercher des mises à jour'),
      group: 'Application',
      run: () => void checkForUpdates({ manual: true }),
    },
    {
      id: 'app.openLogs',
      title: msg('Ouvrir le dossier des logs'),
      group: 'Application',
      run: () => void openLogsDir().catch(noop),
    },
  ];
  return registerCommands(commands);
}
