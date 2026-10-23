import capabilities from '../../src-tauri/capabilities/default.json';

// onCloseRequested (close confirmation) makes Tauri close the window through
// `destroy()`; without this permission the window can never be closed.
test('the main window may be destroyed after a close request', () => {
  expect(capabilities.permissions).toContain('core:window:allow-destroy');
});
