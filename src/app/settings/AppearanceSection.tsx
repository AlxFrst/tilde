import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { Appearance } from '@/ipc/generated/settings';
import type { WindowEffect } from '@/ipc/window';
import { useSettings } from '@/stores/settings';
import { useThemes } from '@/stores/themes';
import { useWindowEffects } from '@/stores/windowEffects';
import { allThemes, type ThemeKind } from '@/themes';
import { UI_FONT_SUGGESTIONS } from '@/themes/fonts';
import { Choice, NumberField, Row, Section, SelectField } from './fields';
import { FontField } from './FontField';

const SCHEMES = [
  ['system', 'Système'],
  ['dark', 'Sombre'],
  ['light', 'Clair'],
] as const;
const DENSITIES = [
  ['compact', 'Compacte'],
  ['comfortable', 'Confortable'],
  ['spacious', 'Aérée'],
] as const;
const SIDES = [
  ['left', 'Gauche'],
  ['right', 'Droite'],
] as const;
const EFFECTS = [
  ['none', 'Aucun'],
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
        aria-label="Opacité de la fenêtre"
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
      <span className="w-10 text-right text-xs text-text-muted">{Math.round(local * 100)} %</span>
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
    .filter((t) => t.kind === kind)
    .map((t) => [t.id, t.name] as const);
  return (
    <SelectField
      setting={kind === 'dark' ? 'appearance.themeDark' : 'appearance.themeLight'}
      label={`Thème ${kind === 'dark' ? 'sombre' : 'clair'}`}
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
      <Section title="Thème">
        <Row label="Apparence">
          <Choice
            setting="appearance.colorScheme"
            label="Apparence"
            value={a.colorScheme}
            options={SCHEMES}
            disabled={readOnly}
            onChange={(colorScheme) => {
              set({ colorScheme });
            }}
          />
        </Row>
        <Row label="Thème sombre">
          <ThemeSelect
            kind="dark"
            value={a.themeDark}
            disabled={readOnly}
            onChange={(themeDark) => {
              set({ themeDark });
            }}
          />
        </Row>
        <Row label="Thème clair">
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

      <Section title="Interface">
        <FontField
          setting="appearance.uiFontFamily"
          label="Police de l’interface"
          value={a.uiFontFamily}
          suggestions={UI_FONT_SUGGESTIONS}
          disabled={readOnly}
          onChange={(uiFontFamily) => {
            set({ uiFontFamily });
          }}
        />
        <Row label="Taille du texte">
          <NumberField
            setting="appearance.uiFontSize"
            label="Taille du texte de l’interface"
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
        <Row label="Densité">
          <Choice
            setting="appearance.density"
            label="Densité"
            value={a.density}
            options={DENSITIES}
            disabled={readOnly}
            onChange={(density) => {
              set({ density });
            }}
          />
        </Row>
        <Row label="Barre latérale">
          <Choice
            setting="appearance.sidebarPosition"
            label="Position de la barre latérale"
            value={a.sidebarPosition}
            options={SIDES}
            disabled={readOnly}
            onChange={(sidebarPosition) => {
              set({ sidebarPosition });
            }}
          />
          <NumberField
            setting="appearance.sidebarWidth"
            label="Largeur de la barre latérale"
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
          label="Hôtes de ~/.ssh/config masqués"
          hint="Rangés dans « Masqués » en bas de leur section : toujours ouvrables et adoptables."
        >
          <div data-setting="appearance.sshConfigHosts.hidden" className="flex items-center gap-2">
            <span className="text-sm text-text-muted">
              {a.sshConfigHosts.hidden.length === 0
                ? 'Aucun'
                : `${String(a.sshConfigHosts.hidden.length)} masqué(s)`}
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
                Tout réafficher
              </Button>
            )}
          </div>
        </Row>
      </Section>

      <Section title="Fenêtre">
        <Row
          label="Effet"
          hint={
            unavailable.length > 0
              ? `Non pris en charge sur ce système : ${unavailable
                  .map((v) => EFFECTS.find(([e]) => e === v)?.[1])
                  .join(', ')}.`
              : undefined
          }
        >
          <Choice<WindowEffect>
            setting="appearance.window.effect"
            label="Effet de fenêtre"
            value={a.window.effect}
            options={EFFECTS}
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
          label="Opacité"
          hint={
            a.window.effect !== 'none' && applied === 'none'
              ? 'L’effet n’a pas pu être appliqué : seule l’opacité est utilisée.'
              : 'Fonds de la fenêtre et du terminal ; le texte reste opaque.'
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
