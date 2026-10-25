import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { msg, t, tn } from '@/i18n';
import type { Appearance } from '@/ipc/generated/settings';
import type { WindowEffect } from '@/ipc/window';
import { useSettings } from '@/stores/settings';
import { useThemes } from '@/stores/themes';
import { useWindowEffects } from '@/stores/windowEffects';
import { allThemes, type ThemeKind } from '@/themes';
import { UI_FONT_SUGGESTIONS } from '@/themes/fonts';
import { Choice, NumberField, Row, Section, SelectField, translated } from './fields';
import { FontField } from './FontField';

const SCHEMES = [
  ['system', msg('Système')],
  ['dark', msg('Sombre')],
  ['light', msg('Clair')],
] as const;
const DENSITIES = [
  ['compact', msg('Compacte')],
  ['comfortable', msg('Confortable')],
  ['spacious', msg('Aérée')],
] as const;
const SIDES = [
  ['left', msg('Gauche')],
  ['right', msg('Droite')],
] as const;
const EFFECTS = [
  ['none', msg('Aucun')],
  ['mica', 'Mica'],
  ['acrylic', 'Acrylic'],
  ['vibrancy', 'Vibrancy'],
] as const;
/** Opacity given to an effect chosen while the window is fully opaque (it would not show). */
const EFFECT_OPACITY = 0.85;

/** Commits a slider value once the user pauses, not on every step. */
function OpacitySlider({
  value,
  disabled,
  onChange,
}: {
  value: number;
  disabled: boolean;
  onChange: (v: number) => void;
}) {
  const [local, setLocal] = useState(value);
  const [shown, setShown] = useState(value);
  if (value !== shown) {
    setShown(value);
    setLocal(value);
  }
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(
    () => () => {
      clearTimeout(timer.current);
    },
    [],
  );
  return (
    <span className="flex items-center gap-2">
      <input
        type="range"
        data-setting="appearance.window.opacity"
        aria-label={t('Opacité de la fenêtre')}
        min={0.3}
        max={1}
        step={0.05}
        value={local}
        disabled={disabled}
        className="w-40 accent-[var(--tilde-accent)]"
        onChange={(e) => {
          const v = Number(e.currentTarget.value);
          setLocal(v);
          // The backgrounds follow at once; settings.json is written after a pause.
          document.documentElement.style.setProperty('--tilde-bg-alpha', String(v));
          clearTimeout(timer.current);
          timer.current = setTimeout(() => {
            onChange(v);
          }, 250);
        }}
      />
      <span className="w-10 text-right text-xs text-text-muted">
        {t('{percent} %', { percent: Math.round(local * 100) })}
      </span>
    </span>
  );
}

function ThemeSelect({
  kind,
  value,
  disabled,
  onChange,
}: {
  kind: ThemeKind;
  value: string;
  disabled: boolean;
  onChange: (id: string) => void;
}) {
  const user = useThemes((s) => s.user);
  const options = allThemes(user)
    .filter((theme) => theme.kind === kind)
    .map((theme) => [theme.id, theme.name] as const);
  return (
    <SelectField
      setting={kind === 'dark' ? 'appearance.themeDark' : 'appearance.themeLight'}
      label={kind === 'dark' ? t('Thème sombre') : t('Thème clair')}
      value={value}
      options={options}
      disabled={disabled}
      onChange={onChange}
    />
  );
}

export function AppearanceSection() {
  const settings = useSettings((s) => s.settings);
  const readOnly = useSettings((s) => s.readOnly);
  const update = useSettings((s) => s.update);
  const supported = useWindowEffects((s) => s.supported);
  const applied = useWindowEffects((s) => s.applied);
  if (!settings) return null;
  const a = settings.appearance;
  const set = (patch: Partial<Appearance>) => void update({ appearance: patch });
  const setWindow = (patch: Partial<Appearance['window']>) =>
    void update({ appearance: { window: patch } });
  const unavailable = EFFECTS.map(([v]) => v).filter((v) => !supported.includes(v));

  return (
    <div className="grid gap-6">
      <Section title={t('Thème')}>
        <Row label={t('Apparence')}>
          <Choice
            setting="appearance.colorScheme"
            label={t('Apparence')}
            value={a.colorScheme}
            options={translated(SCHEMES)}
            disabled={readOnly}
            onChange={(colorScheme) => {
              set({ colorScheme });
            }}
          />
        </Row>
        <Row label={t('Thème sombre')}>
          <ThemeSelect
            kind="dark"
            value={a.themeDark}
            disabled={readOnly}
            onChange={(themeDark) => {
              set({ themeDark });
            }}
          />
        </Row>
        <Row label={t('Thème clair')}>
          <ThemeSelect
            kind="light"
            value={a.themeLight}
            disabled={readOnly}
            onChange={(themeLight) => {
              set({ themeLight });
            }}
          />
        </Row>
      </Section>

      <Section title={t('Interface')}>
        <FontField
          setting="appearance.uiFontFamily"
          label={t('Police de l’interface')}
          value={a.uiFontFamily}
          suggestions={UI_FONT_SUGGESTIONS}
          disabled={readOnly}
          onChange={(uiFontFamily) => {
            set({ uiFontFamily });
          }}
        />
        <Row label={t('Taille du texte')}>
          <NumberField
            setting="appearance.uiFontSize"
            label={t('Taille du texte de l’interface')}
            value={a.uiFontSize}
            min={10}
            max={20}
            unit="px"
            disabled={readOnly}
            onChange={(uiFontSize) => {
              set({ uiFontSize });
            }}
          />
        </Row>
        <Row label={t('Densité')}>
          <Choice
            setting="appearance.density"
            label={t('Densité')}
            value={a.density}
            options={translated(DENSITIES)}
            disabled={readOnly}
            onChange={(density) => {
              set({ density });
            }}
          />
        </Row>
        <Row label={t('Barre latérale')}>
          <Choice
            setting="appearance.sidebarPosition"
            label={t('Position de la barre latérale')}
            value={a.sidebarPosition}
            options={translated(SIDES)}
            disabled={readOnly}
            onChange={(sidebarPosition) => {
              set({ sidebarPosition });
            }}
          />
          <NumberField
            setting="appearance.sidebarWidth"
            label={t('Largeur de la barre latérale')}
            value={a.sidebarWidth}
            min={180}
            max={480}
            unit="px"
            disabled={readOnly}
            onChange={(sidebarWidth) => {
              set({ sidebarWidth });
            }}
          />
        </Row>
        <Row
          label={t('Hôtes de ~/.ssh/config masqués')}
          hint={t(
            'Rangés dans « Masqués » en bas de leur section : toujours ouvrables et adoptables.',
          )}
        >
          <div data-setting="appearance.sshConfigHosts.hidden" className="flex items-center gap-2">
            <span className="text-sm text-text-muted">
              {a.sshConfigHosts.hidden.length === 0
                ? t('Aucun')
                : tn(a.sshConfigHosts.hidden.length, '{count} masqué', '{count} masqués')}
            </span>
            {a.sshConfigHosts.hidden.length > 0 && (
              <Button
                size="sm"
                variant="outline"
                disabled={readOnly}
                onClick={() => {
                  set({ sshConfigHosts: { hidden: [] } });
                }}
              >
                {t('Tout réafficher')}
              </Button>
            )}
          </div>
        </Row>
      </Section>

      <Section title={t('Fenêtre')}>
        <Row
          label={t('Effet')}
          hint={
            unavailable.length > 0
              ? t('Non pris en charge sur ce système : {effects}.', {
                  effects: unavailable
                    .map((v) => t(EFFECTS.find(([e]) => e === v)?.[1] ?? v))
                    .join(', '),
                })
              : undefined
          }
        >
          <Choice<WindowEffect>
            setting="appearance.window.effect"
            label={t('Effet de fenêtre')}
            value={a.window.effect}
            options={translated(EFFECTS)}
            unavailable={unavailable}
            disabled={readOnly}
            onChange={(effect) => {
              // An effect behind fully opaque backgrounds would not show at all.
              const opacity =
                effect !== 'none' && a.window.opacity >= 1 ? EFFECT_OPACITY : undefined;
              setWindow(opacity ? { effect, opacity } : { effect });
            }}
          />
        </Row>
        <Row
          label={t('Opacité')}
          hint={
            a.window.effect !== 'none' && applied === 'none'
              ? t('L’effet n’a pas pu être appliqué : seule l’opacité est utilisée.')
              : t('Fonds de la fenêtre et du terminal ; le texte reste opaque.')
          }
        >
          <OpacitySlider
            value={a.window.opacity}
            disabled={readOnly}
            onChange={(opacity) => {
              setWindow({ opacity });
            }}
          />
        </Row>
      </Section>
    </div>
  );
}
