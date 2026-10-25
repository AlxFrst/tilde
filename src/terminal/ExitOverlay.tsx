import { RotateCcw, X } from 'lucide-react';
import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { t } from '@/i18n';

/** Shown over a pane whose process has ended (non-zero code; code 0 closes the pane). */
export function ExitOverlay({
  code,
  onRestart,
  onClose,
}: {
  code: number | null;
  onRestart: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') onRestart();
      else if (e.key === 'Escape') onClose();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [onRestart, onClose]);

  return (
    <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-3 border-t bg-surface-1/95 px-4 py-2 backdrop-blur-sm">
      <span className="text-text-muted">
        {t('Processus terminé (code {code})', { code: code ?? t('inconnu') })}
      </span>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={onRestart}>
          <RotateCcw strokeWidth={1.5} />
          {t('Relancer')} <kbd className="text-xs text-text-muted">{t('Entrée')}</kbd>
        </Button>
        <Button size="sm" variant="ghost" onClick={onClose}>
          <X strokeWidth={1.5} />
          {t('Fermer')} <kbd className="text-xs text-text-muted">{t('Échap')}</kbd>
        </Button>
      </div>
    </div>
  );
}
