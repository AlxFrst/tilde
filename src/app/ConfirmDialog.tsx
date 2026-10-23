import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { answerConfirm, useConfirm } from './confirm';

/** The single dialog behind `confirmAction`. Cancel has the focus. */
export function ConfirmDialog() {
  const pending = useConfirm((s) => s.pending);
  return (
    <Dialog
      open={pending !== null}
      onOpenChange={(open) => {
        if (!open) answerConfirm(false);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{pending?.title}</DialogTitle>
          <DialogDescription>{pending?.description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            autoFocus
            onClick={() => {
              answerConfirm(false);
            }}
          >
            Annuler
          </Button>
          <Button
            variant={pending?.destructive ? 'destructive' : 'default'}
            onClick={() => {
              answerConfirm(true);
            }}
          >
            {pending?.confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
