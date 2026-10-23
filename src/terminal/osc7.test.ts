import { parseOsc7 } from './osc7';

test('parses unix paths and decodes percent escapes', () => {
  expect(parseOsc7('file://host/home/al%20ex')).toBe('/home/al ex');
});

test('converts windows drive paths', () => {
  expect(parseOsc7('file:///C:/Users/Alex')).toBe('C:\\Users\\Alex');
  expect(parseOsc7('file://PC/c:/temp')).toBe('c:\\temp');
  expect(parseOsc7('file:///D:')).toBe('D:\\');
});

test('rejects anything that is not a file URL', () => {
  expect(parseOsc7('http://x/y')).toBeNull();
  expect(parseOsc7('garbage')).toBeNull();
  expect(parseOsc7('file://host')).toBeNull();
  expect(parseOsc7('file:///%E0%A4%A')).toBeNull();
});
