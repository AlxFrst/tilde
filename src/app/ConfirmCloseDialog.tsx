import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
          <DialogTitle>Fermer quand même ?</DialogTitle>
          <DialogDescription>
            {unsaved.length > 0
              ? `Modifications non enregistrées dans ${unsaved.join(', ')} : elles seront perdues.`
              : 'Un programme est en cours dans ce terminal.'}
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
            Annuler
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              answerCloseGuard(true);
            }}
          >
            Fermer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
