// Tilde's own commands. Titles are what the palette shows.

import { closeActivePane, closeTab, openDefaultTab } from '@/app/actions';
import { exportWithToast, importWithReport } from '@/connections/transfer';
import { openLogsDir, openSettingsFile } from '@/ipc/settings';
import { blankConnection, useConnections } from '@/stores/connections';
import { useSsh } from '@/stores/ssh';
import { useUi } from '@/stores/ui';
import { useWorkspace } from '@/stores/workspace';
import { activeTerminal } from '@/terminal/terminalActions';
import { findLeaf } from '@/workspace/tree';
import { toast } from 'sonner';
import { registerCommands, type Command } from './registry';

const ws = () => useWorkspace.getState();

/** Opens (or focuses) the files of the active SSH pane. */
function openFilesOfActivePane(): void {
  const { tabs, activeTabId } = ws();
  const tab = tabs.find((t) => t.id === activeTabId);
  const leaf = tab ? findLeaf(tab.root, tab.activeLeafId) : null;
  if (leaf?.panel.kind === 'ssh') ws().openSftpBeside(leaf.id);
  else if (leaf?.panel.kind === 'sftp') ws().openSftpBeside(leaf.panel.linkedLeafId);
  else toast.info('Les fichiers s’ouvrent depuis un onglet SSH (Ctrl+Maj+K pour se connecter).');
}
const noop = () => undefined;

export function registerBuiltins(): () => void {
  const commands: Command[] = [
    { id: 'tab.new', title: 'Nouvel onglet', group: 'Onglets', run: openDefaultTab },
    {
      id: 'tab.close',
      title: 'Fermer l’onglet',
      group: 'Onglets',
      run: () => {
        const id = ws().activeTabId;
        if (id) void closeTab(id);
      },
    },
    {
      id: 'tab.next',
      title: 'Onglet suivant',
      group: 'Onglets',
      run: () => {
        ws().activateRelative(1);
      },
    },
    {
      id: 'tab.prev',
      title: 'Onglet précédent',
      group: 'Onglets',
      run: () => {
        ws().activateRelative(-1);
      },
    },
    {
      id: 'pane.splitRight',
      title: 'Diviser à droite',
      group: 'Panneaux',
      run: () => {
        ws().splitActive('row');
      },
    },
    {
      id: 'pane.splitDown',
      title: 'Diviser en bas',
      group: 'Panneaux',
      run: () => {
        ws().splitActive('column');
      },
    },
    {
      id: 'pane.close',
      title: 'Fermer le panneau',
      group: 'Panneaux',
      run: () => void closeActivePane(),
    },
    {
      id: 'pane.focusLeft',
      title: 'Panneau de gauche',
      group: 'Panneaux',
      run: () => {
        ws().focusNeighbor('left');
      },
    },
    {
      id: 'pane.focusRight',
      title: 'Panneau de droite',
      group: 'Panneaux',
      run: () => {
        ws().focusNeighbor('right');
      },
    },
    {
      id: 'pane.focusUp',
      title: 'Panneau du dessus',
      group: 'Panneaux',
      run: () => {
        ws().focusNeighbor('up');
      },
    },
    {
      id: 'pane.focusDown',
      title: 'Panneau du dessous',
      group: 'Panneaux',
      run: () => {
        ws().focusNeighbor('down');
      },
    },
    {
      id: 'terminal.copy',
      title: 'Copier la sélection',
      group: 'Terminal',
      run: () => {
        activeTerminal()?.copy();
      },
    },
    {
      id: 'terminal.paste',
      title: 'Coller',
      group: 'Terminal',
      run: () => {
        activeTerminal()?.paste();
      },
    },
    {
      id: 'terminal.search',
      title: 'Rechercher dans le terminal',
      group: 'Terminal',
      run: () => {
        activeTerminal()?.search();
      },
    },
    {
      id: 'ssh.quickConnect',
      title: 'Connexion SSH rapide…',
      group: 'Connexions',
      run: () => {
        useSsh.getState().setQuickConnectOpen(true);
      },
    },
    {
      id: 'sftp.open',
      title: 'Fichiers (SFTP)',
      group: 'Connexions',
      run: openFilesOfActivePane,
    },
    {
      id: 'connections.new',
      title: 'Nouvelle connexion…',
      group: 'Connexions',
      run: () => {
        useConnections.getState().setEditing(blankConnection());
      },
    },
    {
      id: 'connections.newFolder',
      title: 'Nouveau dossier…',
      group: 'Connexions',
      run: () => {
        useConnections.getState().setEditingFolder('new');
      },
    },
    {
      id: 'connections.import',
      title: 'Importer des connexions…',
      group: 'Connexions',
      run: () => void importWithReport(),
    },
    {
      id: 'connections.export',
      title: 'Exporter les connexions…',
      group: 'Connexions',
      run: () => void exportWithToast(),
    },
    {
      id: 'palette.toggle',
      title: 'Palette de commandes',
      group: 'Application',
      hidden: true,
      run: () => {
        const { paletteOpen, setPaletteOpen } = useUi.getState();
        setPaletteOpen(!paletteOpen);
      },
    },
    {
      id: 'app.settings',
      title: 'Réglages…',
      group: 'Application',
      run: () => {
        useUi.getState().setSettingsOpen(true);
      },
    },
    {
      id: 'app.openSettingsFile',
      title: 'Ouvrir settings.json',
      group: 'Application',
      run: () => void openSettingsFile().catch(noop),
    },
    {
      id: 'app.openLogs',
      title: 'Ouvrir le dossier des logs',
      group: 'Application',
      run: () => void openLogsDir().catch(noop),
    },
  ];
  return registerCommands(commands);
}
