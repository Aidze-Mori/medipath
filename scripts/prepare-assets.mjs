import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');

// Inspect metadata before reading: cloud placeholders must not trigger implicit hydration.
export async function readLocalFile(path) {
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error(`Not a regular local file: ${path}`);
  if (metadata.size && metadata.blocks === 0) throw new Error(`Nonresident or sparse file; not read: ${path}`);
  return readFile(path);
}

export function targetArgument(args, fallback) {
  if (args.length === 0) return resolve(projectRoot, fallback);
  if (args.length !== 2 || args[0] !== '--target' || !args[1]) throw new Error('Usage: --target <generated-directory>');
  const target = resolve(projectRoot, args[1]);
  const projectFromTarget = relative(target, projectRoot);
  if (target === projectRoot || projectFromTarget.split(sep)[0] !== '..' && !isAbsolute(projectFromTarget)) throw new Error('Target cannot contain the project root.');
  return target;
}

export async function assetPlan() {
  const release = JSON.parse(await readLocalFile(resolve(projectRoot, 'data/corpus-release/manifest.json')));
  const examples = JSON.parse(await readLocalFile(resolve(projectRoot, 'public/examples/manifest.json')));
  if (examples.origin !== 'authored_synthetic' || examples.containsRealPatientData !== false || JSON.stringify(examples.records) !== JSON.stringify(release.trustedFiles)) throw new Error('Public examples must exactly match the approved synthetic release manifest.');
  const plan = [];
  const add = async (path, source, expectedDigest) => {
    const absolute = resolve(projectRoot, source);
    const actual = await realpath(absolute);
    if (!actual.startsWith(`${projectRoot}${sep}`)) throw new Error(`Asset source escapes the project: ${source}`);
    const bytes = await readLocalFile(absolute);
    const sha256 = digest(bytes);
    if (expectedDigest && sha256 !== expectedDigest) throw new Error(`Approved asset hash mismatch: ${path}`);
    plan.push({ path, source: absolute, sha256 });
  };
  await add('OFL-Golos-Text.txt', 'docs/design/assets/OFL-Golos-Text.txt');
  await add('examples/manifest.json', 'public/examples/manifest.json');
  for (const record of release.trustedFiles) {
    if (!/^\/examples\/synthetic-[a-z0-9-]+\.(?:txt|pdf|png)$/u.test(record.path) || !/^[a-f0-9]{64}$/u.test(record.sha256)) throw new Error('Unsupported file in the synthetic release manifest.');
    await add(record.path.slice(1), `public${record.path}`, record.sha256);
  }
  await add('ocr/worker.min.js', 'node_modules/tesseract.js/dist/worker.min.js');
  await add('ocr/worker.LICENSE.txt', 'node_modules/tesseract.js/dist/worker.min.js.LICENSE.txt');
  for (const language of ['rus', 'eng']) await add(`ocr/lang/${language}.traineddata.gz`, `node_modules/@tesseract.js-data/${language}/4.0.0_best_int/${language}.traineddata.gz`);
  const coreFiles = ['LICENSE', 'README.md', 'index.js', 'package.json', ...['', '-lstm', '-simd', '-simd-lstm', '-relaxedsimd', '-relaxedsimd-lstm'].flatMap(variant => ['js', 'wasm', 'wasm.js'].map(extension => `tesseract-core${variant}.${extension}`))];
  for (const name of coreFiles) await add(`ocr/core/${name}`, `node_modules/tesseract.js-core/${name}`);
  await add('pdfjs/LICENSE', 'node_modules/pdfjs-dist/LICENSE');
  const packageDirectories = {
    cmaps: /^(?:[A-Za-z0-9_-]+\.bcmap|LICENSE)$/u,
    standard_fonts: /^(?:Foxit[A-Za-z]+\.pfb|LiberationSans-(?:Bold|BoldItalic|Italic|Regular)\.ttf|LICENSE_(?:FOXIT|LIBERATION))$/u,
    wasm: /^(?:(?:jbig2|openjpeg|qcms_bg|quickjs-eval)\.wasm|(?:jbig2_nowasm_fallback|openjpeg_nowasm_fallback|quickjs-eval)\.js|LICENSE_(?:JBIG2|OPENJPEG|PDFJS_JBIG2|PDFJS_OPENJPEG|PDFJS_QCMS|QCMS))$/u,
  };
  for (const [directory, allowedName] of Object.entries(packageDirectories)) {
    const source = `node_modules/pdfjs-dist/${directory}`;
    for (const entry of await readdir(resolve(projectRoot, source), { withFileTypes: true })) {
      if (!entry.isFile() || !allowedName.test(entry.name)) throw new Error(`Unexpected file in pinned PDF package: ${directory}/${entry.name}`);
      await add(`pdfjs/${directory}/${entry.name}`, `${source}/${entry.name}`);
    }
  }
  if (new Set(plan.map(item => item.path)).size !== plan.length) throw new Error('Duplicate path in the asset allowlist.');
  return plan;
}

export async function prepareAssets(target) {
  const plan = await assetPlan();
  await mkdir(target, { recursive: true });
  if ((await lstat(target)).isSymbolicLink()) throw new Error('Asset output root cannot be a symlink.');
  const root = await realpath(target);
  for (const item of plan) {
    const destination = resolve(root, item.path);
    await mkdir(dirname(destination), { recursive: true });
    if (!(await realpath(dirname(destination))).startsWith(`${root}${sep}`) && dirname(destination) !== root) throw new Error(`Output directory escapes target: ${item.path}`);
    try {
      const existing = await lstat(destination);
      if (!existing.isFile() || existing.isSymbolicLink() || existing.size && existing.blocks === 0) throw new Error(`Refusing to overwrite a nonregular or nonresident output: ${item.path}`);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const bytes = await readLocalFile(item.source);
    if (digest(bytes) !== item.sha256) throw new Error(`Asset changed during copying: ${item.path}`);
    await writeFile(destination, bytes);
  }
  return plan.length;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const target = targetArgument(process.argv.slice(2), 'public');
    console.log(`Prepared ${await prepareAssets(target)} allowlisted local assets in ${target}.`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
