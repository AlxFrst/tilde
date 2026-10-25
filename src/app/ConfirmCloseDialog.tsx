import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { t } from '@/i18n';
import { answerCloseGuard, useCloseGuard } from './closeGuard';

export function ConfirmCloseDialog() {
  const pending = useCloseGuard((s) => s.pending);
  const open = pending !== null;
  const unsaved = pending?.unsaved ?? [];
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) answerCloseGuard(false);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('Fermer quand même ?')}</DialogTitle>
          <DialogDescription>
            {unsaved.length > 0
              ? t('Modifications non enregistrées dans {files} : elles seront perdues.', {
                  files: unsaved.join(', '),
                })
              : t('Un programme est en cours dans ce terminal.')}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            autoFocus
            onClick={() => {
              answerCloseGuard(false);
            }}
          >
            {t('Annuler')}
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              answerCloseGuard(true);
            }}
          >
            {t('Fermer')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
