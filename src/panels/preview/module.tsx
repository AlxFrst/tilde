import { Eye } from 'lucide-react';
import { lazy, Suspense } from 'react';
import { msg, t } from '@/i18n';
import type { PanelModule, PanelProps } from '@/panels/registry';
import type { PreviewPanel } from '@/workspace/types';

// markdown-it loads with the first preview, not at startup.
const PreviewPane = lazy(() => import('./PreviewPane'));

function PreviewLoader(props: PanelProps<PreviewPanel>) {
  return (
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center text-sm text-text-muted">
          {t('Chargement de l’aperçu…')}
        </div>
      }
    >
      <PreviewPane {...props} />
    </Suspense>
  );
}

const nameOf = (s: PreviewPanel['source']) =>
  s.kind === 'remote' ? (s.path.split('/').pop() ?? s.path) : s.name;

export const previewModule: PanelModule<PreviewPanel> = {
  id: 'core.preview',
  kind: 'preview',
  title: msg('Aperçu'),
  icon: Eye,
  component: PreviewLoader,
  tabTitle: (s) => t('Aperçu — {name}', { name: nameOf(s.source) }),
  // Not restored after a restart (like the editor it may follow).
  serialize: () => null,
  deserialize: () => null,
};
