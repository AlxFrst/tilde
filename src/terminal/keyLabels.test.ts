import { bindingKeys, resolveKeyLabels } from './keyLabels';

test('bindingKeys splits a binding into displayable parts', () => {
  expect(bindingKeys('pane.splitDown')).toEqual(['Alt', 'Maj', '-']);
  expect(bindingKeys('tab.new')).toEqual(['Ctrl', 'Maj', 'T']);
  expect(bindingKeys('pane.focusLeft')).toEqual(['Alt', '←']);
});

test('labels follow the keyboard layout when the browser exposes it', async () => {
  // AZERTY: the physical "Minus" key prints ")".
  const layout = new Map([
    ['Minus', ')'],
    ['Equal', '='],
    ['KeyT', 't'],
  ]);
  const labels = await resolveKeyLabels(['pane.splitDown', 'pane.splitRight', 'tab.new'], {
    getLayoutMap: () => Promise.resolve(layout),
  });
  expect(labels['pane.splitDown']).toEqual(['Alt', 'Maj', ')']);
  expect(labels['pane.splitRight']).toEqual(['Alt', 'Maj', '=']);
  expect(labels['tab.new']).toEqual(['Ctrl', 'Maj', 'T']);
});

test('letter keys keep their own label whatever the layout', async () => {
  // AZERTY maps physical KeyW to "z", but the shortcut is matched on the printed "W".
  const labels = await resolveKeyLabels(['tab.close'], {
    getLayoutMap: () => Promise.resolve(new Map([['KeyW', 'z']])),
  });
  expect(labels['tab.close']).toEqual(['Ctrl', 'Maj', 'W']);
});

test('labels fall back to the binding text without a layout map', async () => {
  const labels = await resolveKeyLabels(['pane.splitDown'], undefined);
  expect(labels['pane.splitDown']).toEqual(['Alt', 'Maj', '-']);
});
