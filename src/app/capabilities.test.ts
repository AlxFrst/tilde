import capabilities from '../../src-tauri/capabilities/default.json';

// onCloseRequested (close confirmation) makes Tauri close the window through
// `destroy()`; without this permission the window can never be closed.
test('the main window may be destroyed after a close request', () => {
  expect(capabilities.permissions).toContain('core:window:allow-destroy');
});

test('a window may send notifications and flash in the taskbar, and nothing more of the plugin', () => {
  expect(capabilities.permissions).toEqual(
    expect.arrayContaining([
      'notification:allow-is-permission-granted',
      'notification:allow-request-permission',
      'notification:allow-notify',
      'core:window:allow-request-user-attention',
    ]),
  );
  expect(capabilities.permissions.filter((p) => p.startsWith('notification:'))).toHaveLength(3);
});

test('the Quake window shares the capability, and the front cannot register global shortcuts', () => {
  expect(capabilities.windows).toEqual(expect.arrayContaining(['main', 'quake']));
  expect(capabilities.permissions).toContain('core:window:allow-hide');
  expect(capabilities.permissions.some((p) => p.startsWith('global-shortcut'))).toBe(false);
});
