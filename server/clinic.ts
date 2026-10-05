import { getClinicStudyMetadata, SYNTHETIC_FIXTURES } from '../src/domain';
import { contentDigest } from '../src/privacy/policy';
import manifest from '../data/corpus-release/manifest.json';
import { THIRD_OPINION_DEMO_LABEL } from '../src/engine/clinicalDemo';

const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
const CLINIC_ID = 'demo-clinic-01';
const PATIENT_ID = 'demo-patient-01';

// This adapter exposes authored synthetic records only. Production ownership
// must come from an authenticated clinic session, never this demo query string.
export async function handleClinicRequest(request: Request): Promise<Response> {
  if (request.method !== 'GET') return Response.json({ error: { code: 'method_not_allowed' } }, { status: 405, headers: { ...headers, Allow: 'GET' } });
  const query = new URL(request.url).searchParams;
  if ([...query.keys()].some(key => !['patientId', 'fixtureId'].includes(key)) || query.getAll('patientId').length !== 1 || query.getAll('fixtureId').length > 1) return Response.json({ error: { code: 'invalid_request' } }, { status: 400, headers });
  if (query.get('patientId') !== PATIENT_ID) return Response.json({ error: { code: 'source_not_found' } }, { status: 404, headers });
  const requested = query.get('fixtureId');
  const fixtures = SYNTHETIC_FIXTURES.filter(fixture => requested ? fixture.id === requested : ['chest-referral', 'breast-referral', 'chest-negative'].includes(fixture.id));
  if (!fixtures.length || requested === '') return Response.json({ error: { code: 'source_not_found' } }, { status: 404, headers });
  for (const fixture of fixtures) {
    const released = manifest.variants.find(variant => variant.fixtureId === fixture.id && variant.fixtureRevision === fixture.revision && variant.reviewVariantId === 'canonical');
    if (!released || released.contentDigest !== await contentDigest(fixture.sections)) return Response.json({ error: { code: 'source_not_ready' } }, { status: 409, headers });
  }
  return Response.json({ source: 'synthetic_clinic_adapter', clinicId: CLINIC_ID, patientId: PATIENT_ID, records: fixtures.map(fixture => ({
    clinicId: CLINIC_ID, patientId: PATIENT_ID, studyId: `study-${fixture.id}`, documentId: `clinic-${fixture.id}`,
    fixtureId: fixture.id, sourceRevision: fixture.revision, status: 'ready', sourceKind: 'structured',
    ...(fixture.inputAdapter ? { studyAdapter: fixture.inputAdapter, studyAdapterLabel: THIRD_OPINION_DEMO_LABEL } : {}),
    performedAt: getClinicStudyMetadata(fixture.id).performedAt, publishedAt: getClinicStudyMetadata(fixture.id).publishedAt,
    studyMetadata: getClinicStudyMetadata(fixture.id),
    title: fixture.title, sections: fixture.sections, originalUrl: null,
  })) }, { headers });
}
