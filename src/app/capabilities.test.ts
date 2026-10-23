import capabilities from '../../src-tauri/capabilities/default.json';

// onCloseRequested (close confirmation) makes Tauri close the window through
// `destroy()`; without this permission the window can never be closed.
test('the main window may be destroyed after a close request', () => {
  expect(capabilities.permissions).toContain('core:window:allow-destroy');
});

test('the Quake window shares the capability, and the front cannot register global shortcuts', () => {
  expect(capabilities.windows).toEqual(expect.arrayContaining(['main', 'quake']));
  expect(capabilities.permissions).toContain('core:window:allow-hide');
  expect(capabilities.permissions.some((p) => p.startsWith('global-shortcut'))).toBe(false);
});
