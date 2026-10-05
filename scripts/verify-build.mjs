import { lstat, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assetPlan, digest, readLocalFile, targetArgument } from './prepare-assets.mjs';

async function inventory(root, directory = '') {
  const files = [];
  for (const entry of await readdir(resolve(root, directory), { withFileTypes: true })) {
    const path = directory ? `${directory}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) throw new Error(`Symlink in build output: ${path}`);
    if (entry.isDirectory()) files.push(...await inventory(root, path));
    else if (entry.isFile()) files.push(path);
    else throw new Error(`Unsupported output type: ${path}`);
  }
  return files;
}

export async function verifyBuild(target) {
  if ((await lstat(target)).isSymbolicLink()) throw new Error('Build output root cannot be a symlink.');
  const plan = await assetPlan();
  const manifest = JSON.parse(await readLocalFile(resolve(target, '.vite/manifest.json')));
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest) || manifest['index.html']?.isEntry !== true) throw new Error('Missing Vite entry manifest. Enable build.manifest.');
  const expected = new Set(['index.html', '.vite/manifest.json', ...plan.map(item => item.path)]);
  for (const entry of Object.values(manifest)) {
    if (!entry || typeof entry !== 'object' || typeof entry.file !== 'string') throw new Error('Invalid Vite manifest entry.');
    for (const key of ['css', 'assets', 'imports', 'dynamicImports']) if (entry[key] !== undefined && (!Array.isArray(entry[key]) || !entry[key].every(value => typeof value === 'string'))) throw new Error(`Invalid Vite manifest ${key}.`);
    for (const path of [entry.file, ...(entry.css ?? []), ...(entry.assets ?? [])]) {
      if (!/^assets\/[A-Za-z0-9_.-]+-[A-Za-z0-9_-]{8}\.(?:js|mjs|css|ttf|woff2?|svg|png|webp)$/u.test(path)) throw new Error(`Unexpected emitted asset path: ${path}`);
      expected.add(path);
    }
    for (const key of [...(entry.imports ?? []), ...(entry.dynamicImports ?? [])]) if (!Object.hasOwn(manifest, key)) throw new Error(`Missing Vite manifest dependency: ${key}`);
  }
  const actual = await inventory(target);
  const extras = actual.filter(path => !expected.has(path));
  const missing = [...expected].filter(path => !actual.includes(path));
  // Reject by path before reading unknown bytes, including dataless duplicates.
  if (extras.length || missing.length) throw new Error(`Build allowlist mismatch: ${extras.length} unexpected, ${missing.length} missing. Unexpected: ${extras.slice(0, 12).join(', ') || 'none'}. Missing: ${missing.slice(0, 12).join(', ') || 'none'}.`);
  const staticHashes = new Map(plan.map(item => [item.path, item.sha256]));
  for (const path of actual) {
    const bytes = await readLocalFile(resolve(target, path));
    if (staticHashes.has(path) && digest(bytes) !== staticHashes.get(path)) throw new Error(`Published static asset hash mismatch: ${path}`);
    if (path === 'index.html' && !bytes.toString('utf8').includes(`/${manifest['index.html'].file}`)) throw new Error('HTML does not reference the current Vite entry.');
  }
  return { files: actual.length, staticAssets: plan.length, emittedAssets: expected.size - plan.length - 2 };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const target = targetArgument(process.argv.slice(2), 'dist');
    console.log(`Build allowlist verified: ${JSON.stringify(await verifyBuild(target))}`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
