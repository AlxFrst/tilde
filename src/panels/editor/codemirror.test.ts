import { createEditorState, detectLineEnding } from './codemirror';

test('detects the line ending a file uses', () => {
  expect(detectLineEnding('a\r\nb\r\nc')).toBe('\r\n');
  expect(detectLineEnding('a\nb\n')).toBe('\n');
  expect(detectLineEnding('one line')).toBe('\n');
  // Mostly CRLF wins.
  expect(detectLineEnding('a\r\nb\r\nc\nd\r\n')).toBe('\r\n');
});

test('a CRLF file is saved with CRLF line endings', () => {
  const doc = 'echo on\r\nset X=1\r\n';
  const state = createEditorState({
    doc,
    language: null,
    theme: [],
    onChange: () => undefined,
    onSave: () => undefined,
  });
  expect(state.sliceDoc()).toBe(doc);
  expect(state.doc.lines).toBe(3);
});
