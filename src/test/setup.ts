import '@testing-library/jest-dom/vitest';
import { setLocale } from '@/i18n';

// The tests read the French interface; a system in another language would switch it.
Object.defineProperty(navigator, 'language', { value: 'fr-FR', configurable: true });
beforeEach(() => {
  setLocale('fr');
});

// jsdom lacks ResizeObserver; react-resizable-panels and the terminal view need one.
if (!('ResizeObserver' in globalThis)) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
