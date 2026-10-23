import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { JsonTree } from './JsonTree';

test('renders nested values and folds', async () => {
  render(
    <JsonTree
      value={{ name: 'tilde', tags: ['ssh', 'sftp'], deep: { n: 3, ok: true, x: null } }}
    />,
  );
  expect(screen.getByText('"tilde"')).toBeInTheDocument();
  expect(screen.getByText('"ssh"')).toBeInTheDocument();
  expect(screen.getByText('true')).toBeInTheDocument();
  expect(screen.getByText('null')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: /deep/ }));
  expect(screen.queryByText('true')).toBeNull();
  expect(screen.getByText(/3 clés/)).toBeInTheDocument();
});

test('large documents start folded below the root', () => {
  const big = Array.from({ length: 6000 }, (_, i) => ({ i }));
  const { container } = render(<JsonTree value={big} />);
  // The root, the first 500 children (folded: none of their values is rendered), and a
  // button for the next ones.
  expect(screen.getAllByRole('button').length).toBe(502);
  expect(container.querySelector('[title="$[0].i"]')).toBeNull();
  expect(
    screen.getByRole('button', { name: /Afficher 500 de plus \(5500 restants\)/ }),
  ).toBeInTheDocument();
});

test('a huge array renders instead of crashing', () => {
  // Spreading 200k values into push() throws a RangeError in V8.
  const huge = Array.from({ length: 200_000 }, (_, i) => i);
  expect(() => render(<JsonTree value={huge} />)).not.toThrow();
  expect(screen.getByRole('button', { name: /199500 restants/ })).toBeInTheDocument();
});
