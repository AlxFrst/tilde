import { spaceName } from '@/connections/spaces';
import { t } from '@/i18n';
import { useSettings } from '@/stores/settings';
import { useThemes } from '@/stores/themes';
import { spaceThemeChoice, useActiveSpace } from '@/themes/useActiveTheme';

/** Says why changing the global theme shows nothing while this space has its own. */
export function SpaceThemeNote() {
  const appearance = useSettings((s) => s.settings?.appearance);
  const user = useThemes((s) => s.user);
  const space = useActiveSpace();
  if (!appearance?.themePerSpace || !space) return null;
  const choice = spaceThemeChoice(appearance, space, user);
  if (choice.themeDark === appearance.themeDark && choice.themeLight === appearance.themeLight) {
    return null;
  }
  return (
    <p className="text-xs text-text-muted">
      {t(
        'L’espace « {name} » a son propre thème : le thème global s’applique aux autres espaces.',
        {
          name: spaceName(space),
        },
      )}
    </p>
  );
}
