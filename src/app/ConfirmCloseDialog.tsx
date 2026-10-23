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
  const open = useCloseGuard((s) => s.pending !== null);
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
          <DialogDescription>Un programme est en cours dans ce terminal.</DialogDescription>
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
