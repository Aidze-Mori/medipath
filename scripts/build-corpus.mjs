import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export function digest(value) { return createHash('sha256').update(value).digest('hex'); }
export function canonical(sections) { return JSON.stringify(['description', 'conclusion', 'recommendations', 'other'].map(kind => [kind, sections[kind].normalize('NFC').replace(/\s+/gu, ' ').trim()])); }
export async function buildManifest() {
  const corpusBytes = await readFile(new URL('../data/corpus-release/corpus.json', import.meta.url));
  const corpus = JSON.parse(corpusBytes);
  const fixtures = JSON.parse(await readFile(new URL('../data/synthetic/fixtures.json', import.meta.url), 'utf8'));
  const files = JSON.parse(await readFile(new URL('../public/examples/manifest.json', import.meta.url), 'utf8'));
  const clinicalDemoBytes = await readFile(new URL('../data/synthetic/clinical-scenarios.json', import.meta.url));
  const clinicalDemo = JSON.parse(clinicalDemoBytes);
  if (corpus.clinicalSources.length || corpus.clinicalRules.length || corpus.sources.some(source => source.releaseStatus !== 'released' || source.rights !== 'project_authored' || source.clinicalReviewed !== false) || corpus.chunks.some(chunk => chunk.releaseStatus !== 'released' || chunk.rights !== 'project_authored' || chunk.task !== 'workflow' || !corpus.sources.some(source => source.id === chunk.sourceId))) throw new Error('Only project-authored nonclinical workflow material is admitted.');
  if (new Set(fixtures.map(fixture => fixture.id)).size !== fixtures.length || fixtures.some(fixture => fixture.provenance !== 'authored_synthetic' || fixture.clinicalReviewed !== false)) throw new Error('Invalid synthetic fixture provenance.');
  if (clinicalDemo.scope !== 'canonical_synthetic_only' || clinicalDemo.clinicalReviewed !== false || !Array.isArray(clinicalDemo.sources) || !Array.isArray(clinicalDemo.scenarios) ||
    new Set(clinicalDemo.sources.map(source => source.id)).size !== clinicalDemo.sources.length ||
    clinicalDemo.sources.some(source => source.review !== 'technical_only' || source.clinicalReviewed !== false || !/^https:\/\/cr\.minzdrav\.gov\.ru\/view-cr\/\d+_\d+$/u.test(source.url) || !source.version || !source.section || typeof source.quote !== 'string' || !source.quote || source.quote.length > 200) ||
    clinicalDemo.scenarios.some(scenario => !fixtures.some(fixture => fixture.id === scenario.fixtureId && fixture.inputAdapter === 'third_opinion_demo') || !scenario.proposals.length || scenario.proposals.some(proposal => !['specialist', 'additional_exam', 'no_additional_exam'].includes(proposal.kind) || !proposal.sourceIds.length || proposal.sourceIds.some(id => !clinicalDemo.sources.some(source => source.id === id)) || !['description', 'conclusion', 'recommendations'].includes(proposal.evidenceSection)))
  ) throw new Error('Invalid bounded clinical demonstration registry.');
  for (const file of files.records) {
    if (!/^\/examples\/synthetic-[a-z0-9-]+\.(txt|pdf|png)$/u.test(file.path) || !fixtures.some(fixture => fixture.id === file.fixtureId && fixture.revision === file.fixtureRevision) || file.reviewVariant !== 'canonical') throw new Error('Invalid synthetic file registration.');
    if (digest(await readFile(new URL(`../public${file.path}`, import.meta.url))) !== file.sha256) throw new Error(`Synthetic file hash mismatch: ${file.path}`);
  }
  return { version: 1, corpusVersion: corpus.corpusVersion, corpusSha256: digest(corpusBytes), clinicalSourcesAdmitted: 0, clinicalDemo: { version: clinicalDemo.version, sha256: digest(clinicalDemoBytes), scope: clinicalDemo.scope, clinicalReviewed: false }, trustedFiles: files.records, variants: fixtures.map(fixture => ({ fixtureId: fixture.id, fixtureRevision: fixture.revision, reviewVariantId: 'canonical', contentDigest: digest(canonical(fixture.sections)), allowedOperations: ['explain'] })) };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const manifest = await buildManifest();
  await writeFile(new URL('../data/corpus-release/manifest.json', import.meta.url), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Corpus manifest: ${manifest.variants.length} synthetic variants, ${manifest.clinicalSourcesAdmitted} clinical sources.`);
}
