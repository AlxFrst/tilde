import { languageFor, languageLabel } from './languages';

test.each([
  ['app.ts', 'TypeScript'],
  ['App.tsx', 'TypeScript'],
  ['index.js', 'JavaScript'],
  ['data.json', 'JSON'],
  ['README.md', 'Markdown'],
  ['main.py', 'Python'],
  ['lib.rs', 'Rust'],
  ['index.html', 'HTML'],
  ['style.css', 'CSS'],
  ['docker-compose.yml', 'YAML'],
  ['pom.xml', 'XML'],
  ['query.sql', 'SQL'],
  ['deploy.sh', 'Shell'],
  ['.bashrc', 'Shell'],
  ['Cargo.toml', 'TOML'],
  ['Dockerfile', 'Dockerfile'],
  ['.env', 'Propriétés'],
  ['nginx.conf', 'Nginx'],
  ['README', 'Texte brut'],
])('detects languages by extension and name (%s → %s)', (name, label) => {
  expect(languageLabel(name)).toBe(label);
});

test('loads a language extension on demand, none for plain text', async () => {
  expect(await languageFor('lib.rs')).not.toBeNull();
  expect(await languageFor('.bashrc')).not.toBeNull();
  expect(await languageFor('README')).toBeNull();
});
