import { bindingKeys, resolveKeyLabels } from './keyLabels';

test('bindingKeys splits a binding into displayable parts', () => {
  expect(bindingKeys('Alt+Shift+-')).toEqual(['Alt', 'Maj', '-']);
  expect(bindingKeys('Ctrl+Shift+T')).toEqual(['Ctrl', 'Maj', 'T']);
  expect(bindingKeys('Alt+ArrowLeft')).toEqual(['Alt', '←']);
});

test('labels follow the keyboard layout when the browser exposes it', async () => {
  // AZERTY: the physical "Minus" key prints ")".
  const layout = new Map([
    ['Minus', ')'],
    ['Equal', '='],
    ['KeyT', 't'],
  ]);
  const labels = await resolveKeyLabels(['Alt+Shift+-', 'Alt+Shift+=', 'Ctrl+Shift+T'], {
    getLayoutMap: () => Promise.resolve(layout),
  });
  expect(labels['Alt+Shift+-']).toEqual(['Alt', 'Maj', ')']);
  expect(labels['Alt+Shift+=']).toEqual(['Alt', 'Maj', '=']);
  expect(labels['Ctrl+Shift+T']).toEqual(['Ctrl', 'Maj', 'T']);
});

test('letter keys keep their own label whatever the layout', async () => {
  // AZERTY maps physical KeyW to "z", but the shortcut is matched on the printed "W".
  const labels = await resolveKeyLabels(['Ctrl+Shift+W'], {
    getLayoutMap: () => Promise.resolve(new Map([['KeyW', 'z']])),
  });
  expect(labels['Ctrl+Shift+W']).toEqual(['Ctrl', 'Maj', 'W']);
});

test('labels fall back to the binding text without a layout map', async () => {
  const labels = await resolveKeyLabels(['Alt+Shift+-'], undefined);
  expect(labels['Alt+Shift+-']).toEqual(['Alt', 'Maj', '-']);
});
