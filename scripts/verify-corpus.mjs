import { readFile } from 'node:fs/promises';
import { buildManifest } from './build-corpus.mjs';

const actual = await buildManifest();
const released = JSON.parse(await readFile(new URL('../data/corpus-release/manifest.json', import.meta.url), 'utf8'));
if (JSON.stringify(actual) !== JSON.stringify(released)) throw new Error('Corpus or fixture contents differ from the versioned manifest. Review and regenerate the manifest explicitly.');
console.log(`PASS corpus ${actual.corpusVersion}; ${actual.variants.length} known variants; no clinical archive/quarantine admitted.`);
