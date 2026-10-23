import '@testing-library/jest-dom/vitest';

// jsdom lacks ResizeObserver; react-resizable-panels and the terminal view need one.
if (!('ResizeObserver' in globalThis)) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
