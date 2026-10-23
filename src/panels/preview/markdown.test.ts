import { renderMarkdown } from './markdown';

test('renders common Markdown', () => {
  const html = renderMarkdown('# Titre\n\n- **un**\n- `deux`\n\n```sh\nls -la\n```\n');
  expect(html).toContain('<h1>Titre</h1>');
  expect(html).toContain('<strong>un</strong>');
  expect(html).toContain('<code>deux</code>');
  expect(html).toContain('ls -la');
});

test('markdown never renders raw HTML or unsafe links', () => {
  const html = renderMarkdown(
    [
      '<script>alert(1)</script>',
      '<img src=x onerror=alert(1)>',
      '[a](javascript:alert(1))',
      '[b](file:///etc/passwd)',
      '[c](https://x.dev)',
      '![logo](https://x.dev/logo.png)',
      '<a href="javascript:alert(2)">d</a>',
    ].join('\n\n'),
  );
  expect(html).not.toMatch(/<script/i);
  expect(html).not.toMatch(/<img/i);
  expect(html).not.toMatch(/href="javascript:/i);
  expect(html).not.toMatch(/href="file:/i);
  // Escaped as text is fine; as an attribute of a real tag it is not.
  expect(html).not.toMatch(/<[a-z][^>]*\sonerror=/i);
  expect(html).toContain('&lt;script&gt;');
  expect(html).toContain('href="https://x.dev"');
  // Images are not fetched (CSP): their text shows instead.
  expect(html).toContain('logo');
});
