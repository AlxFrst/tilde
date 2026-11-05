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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { spaceName } from '@/connections/spaces';
import { t } from '@/i18n';
import { SPACE_ICONS, type Space } from '@/ipc/connections';
import { formatConfigError, isConfigError } from '@/ipc/errors';
import { useConnections } from '@/stores/connections';
import { useSettings } from '@/stores/settings';
import { useThemes } from '@/stores/themes';
import { useUi } from '@/stores/ui';
import { useWorkspace } from '@/stores/workspace';
import { allThemes, type ThemeKind } from '@/themes';
import { ColorPicker } from '../ColorPicker';
import { IconPicker } from '../IconPicker';

/** Radix Select forbids an empty value; this one stands for « the global theme ». */
const GLOBAL_THEME = '__global__';

function SpaceThemeField({
  kind,
  value,
  onChange,
}: {
  kind: ThemeKind;
  value: string | null;
  onChange: (id: string | null) => void;
}) {
  const user = useThemes((s) => s.user);
  const themes = allThemes(user).filter((theme) => theme.kind === kind);
  const label = kind === 'dark' ? t('Thème sombre') : t('Thème clair');
  return (
    <div className="grid gap-1.5">
      <span className="text-sm">{label}</span>
      <Select
        // A deleted theme no longer applies, so it reads as the global one.
        value={themes.some((theme) => theme.id === value) ? (value ?? GLOBAL_THEME) : GLOBAL_THEME}
        onValueChange={(v) => {
          onChange(v === GLOBAL_THEME ? null : v);
        }}
      >
        <SelectTrigger size="sm" className="w-full" aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={GLOBAL_THEME}>{t('Thème global')}</SelectItem>
          {themes.map((theme) => (
            <SelectItem key={theme.id} value={theme.id}>
              {theme.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function SpaceForm({ space, onDone }: { space: Space | 'new'; onDone: () => void }) {
  const saveSpace = useConnections((s) => s.saveSpace);
  const themePerSpace = useSettings((s) => s.settings?.appearance.themePerSpace ?? false);
  const initial: Space =
    space === 'new'
      ? { id: '', name: '', color: null, icon: null, themeDark: null, themeLight: null }
      : space;
  // The main space's default name is shown translated; kept as is, it stays the default.
  const shownName = spaceName(initial);
  const [name, setName] = useState(shownName);
  const [color, setColor] = useState<string | null>(initial.color);
  const [icon, setIcon] = useState<string | null>(initial.icon);
  const [themeDark, setThemeDark] = useState<string | null>(initial.themeDark);
  const [themeLight, setThemeLight] = useState<string | null>(initial.themeLight);
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    if (!name.trim()) {
      setError(t('Le nom est obligatoire'));
      return;
    }
    const newName = name.trim() === shownName ? initial.name : name.trim();
    saveSpace({ ...initial, name: newName, color, icon, themeDark, themeLight }).then(
      (saved) => {
        onDone();
        // A new space is where the user wants to go next.
        if (space === 'new') useWorkspace.getState().switchSpace(saved.id);
      },
      (e: unknown) => {
        setError(isConfigError(e) ? formatConfigError(e, 'connections.json') : String(e));
      },
    );
  };

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <DialogHeader>
        <DialogTitle>{space === 'new' ? t('Nouvel espace') : t('Modifier l’espace')}</DialogTitle>
        <DialogDescription>
          {t('Un espace regroupe ses connexions et ses sessions : Pro, Perso, Homelab…')}
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-1.5">
        <label htmlFor="space-name" className="text-sm">
          {t('Nom de l’espace')}
        </label>
        <Input
          id="space-name"
          autoFocus
          value={name}
          placeholder="Pro"
          aria-invalid={error !== null}
          onChange={(e) => {
            setName(e.currentTarget.value);
            setError(null);
          }}
        />
        {error && <p className="text-xs text-error">{error}</p>}
      </div>
      <div className="grid gap-1.5">
        <span className="text-sm">{t('Couleur')}</span>
        <ColorPicker label={t('Couleur de l’espace')} value={color} onChange={setColor} />
      </div>
      <div className="grid gap-1.5">
        <span className="text-sm">{t('Icône')}</span>
        <IconPicker
          label={t('Icône de l’espace')}
          icons={SPACE_ICONS}
          value={icon ?? 'server'}
          color={color}
          onChange={setIcon}
        />
      </div>
      {themePerSpace && (
        <div className="grid grid-cols-2 gap-3">
          <SpaceThemeField kind="dark" value={themeDark} onChange={setThemeDark} />
          <SpaceThemeField kind="light" value={themeLight} onChange={setThemeLight} />
        </div>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          {t('Annuler')}
        </Button>
        <Button type="submit">{space === 'new' ? t('Créer') : t('Enregistrer')}</Button>
      </DialogFooter>
    </form>
  );
}

/** Creates or edits a space (`useUi.spaceDialog`). */
export function SpaceDialog() {
  const space = useUi((s) => s.spaceDialog);
  const close = () => {
    useUi.getState().setSpaceDialog(null);
  };
  return (
    <Dialog
      open={space !== null}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent className="sm:max-w-md">
        {space !== null && (
          <SpaceForm key={space === 'new' ? 'new' : space.id} space={space} onDone={close} />
        )}
      </DialogContent>
    </Dialog>
  );
}
