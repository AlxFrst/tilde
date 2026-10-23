// Generates src/ipc/generated/settings.ts from schemas/settings.schema.json.
// Run via `pnpm gen:types`; CI fails if the committed output is stale.
import { readFile, writeFile } from 'node:fs/promises';
import { compile } from 'json-schema-to-typescript';

const schema = JSON.parse(await readFile('schemas/settings.schema.json', 'utf8'));
// `$schema` is an editor hint, not a setting the UI deals with.
delete schema.properties.$schema;

// On disk every key is optional (serde fills defaults), but Rust always sends the
// complete object to the front-end, so the TS view marks every property required.
function requireAll(node) {
  if (Array.isArray(node)) return node.forEach(requireAll);
  if (!node || typeof node !== 'object') return;
  if (node.properties) node.required = Object.keys(node.properties);
  Object.values(node).forEach(requireAll);
}
requireAll(schema);

const ts = await compile(schema, 'Settings', {
  bannerComment:
    '/* Généré par scripts/gen-types.mjs depuis schemas/settings.schema.json — ne pas éditer. */',
  additionalProperties: false,
  strictIndexSignatures: true,
  style: { singleQuote: true, printWidth: 100 },
});
await writeFile('src/ipc/generated/settings.ts', ts);
console.log('wrote src/ipc/generated/settings.ts');
