import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

const WHO = [
  ['Propriétaire', 6],
  ['Groupe', 3],
  ['Autres', 0],
] as const;
const WHAT = [
  ['lecture', 4],
  ['écriture', 2],
  ['exécution', 1],
] as const;

/** Permissions as an octal field and nine check boxes kept in sync. setuid/setgid/sticky
 *  bits, not shown, are kept as they are. */
export function ChmodDialog({
  name,
  mode,
  onApply,
  onClose,
}: {
  name: string;
  mode: number;
  onApply: (mode: number) => void;
  onClose: () => void;
}) {
  const special = mode & 0o7000;
  const [bits, setBits] = useState(mode & 0o777);
  const [text, setText] = useState((mode & 0o777).toString(8).padStart(3, '0'));
  const valid = /^[0-7]{3}$/.test(text);

  const toggle = (bit: number) => {
    const next = bits ^ bit;
    setBits(next);
    setText(next.toString(8).padStart(3, '0'));
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-sm">
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) onApply(special | bits);
          }}
        >
          <DialogHeader>
            <DialogTitle>Permissions</DialogTitle>
            <DialogDescription className="truncate">{name}</DialogDescription>
          </DialogHeader>
          <table className="text-sm">
            <thead>
              <tr className="text-text-muted">
                <th />
                {WHAT.map(([label]) => (
                  <th key={label} className="px-2 font-normal">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {WHO.map(([who, shift]) => (
                <tr key={who}>
                  <td className="pr-3">{who}</td>
                  {WHAT.map(([what, value]) => {
                    const bit = value << shift;
                    return (
                      <td key={what} className="text-center">
                        <input
                          type="checkbox"
                          aria-label={`${who} : ${what}`}
                          checked={(bits & bit) !== 0}
                          onChange={() => {
                            toggle(bit);
                          }}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <label className="grid gap-1 text-sm">
            Mode octal
            <Input
              aria-label="Mode octal"
              inputMode="numeric"
              maxLength={3}
              className="w-24 font-mono"
              value={text}
              aria-invalid={!valid}
              onChange={(e) => {
                const value = e.currentTarget.value.trim();
                setText(value);
                if (/^[0-7]{3}$/.test(value)) setBits(parseInt(value, 8));
              }}
            />
          </label>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Annuler
            </Button>
            <Button type="submit" disabled={!valid}>
              Appliquer
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
