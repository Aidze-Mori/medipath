import { expect, test } from './test';
import { readFileSync } from 'node:fs';
import type { SyntheticFixture } from '../../src/domain/fixtures';

const fixtures = JSON.parse(readFileSync('data/synthetic/fixtures.json', 'utf8')) as SyntheticFixture[];
const fixture = fixtures.find(item => item.id === 'doctor-report')!;
const normalize = (value: string) => value.normalize('NFC').replace(/\s+/gu, ' ').trim();

test('authored two-page doctor PDF extracts to the exact released live-AI variant', async ({ page }) => {
  await page.goto('/examples/synthetic-doctor-report.txt');
  const result = await page.evaluate(async () => {
    const intakePath = '/src/features/intake/extract.ts';
    const conversionPath = '/src/features/intake/toDocument.ts';
    const policyPath = '/src/privacy/policy.ts';
    const domainPath = '/src/domain/index.ts';
    const { extractDocument, disposeExtraction } = await import(intakePath) as typeof import('../../src/features/intake/extract');
    const { toDocument } = await import(conversionPath) as typeof import('../../src/features/intake/toDocument');
    const { detectSyntheticFixture, canonicalContent, prepareDemoRequest, contentDigest } = await import(policyPath) as typeof import('../../src/privacy/policy');
    const { confirmDocument, SYNTHETIC_FIXTURES } = await import(domainPath) as typeof import('../../src/domain');
    const bytes = await (await fetch('/examples/synthetic-doctor-report.pdf')).arrayBuffer();
    const fixtureId = await detectSyntheticFixture(bytes);
    const extraction = await extractDocument(new File([bytes], 'synthetic-doctor-report.pdf', { type: 'application/pdf' }));
    try {
      const document = toDocument(extraction, 'builtin_fixture', fixtureId!);
      const canonical = SYNTHETIC_FIXTURES.find(item => item.id === fixtureId)!;
      const before = await prepareDemoRequest(document);
      const prepared = await prepareDemoRequest(confirmDocument(document));
      return {
        fixtureId, pageCount: extraction.blocks.length, methods: extraction.blocks.map(block => block.method),
        previewCount: extraction.blocks.filter(block => block.previewUrl).length,
        exact: canonicalContent(document.sections) === canonicalContent(canonical.sections),
        sections: document.sections, expected: canonical.sections,
        digest: await contentDigest(document.sections),
        before, prepared: prepared?.request, anchors: document.sectionAnchors,
      };
    } finally { disposeExtraction(extraction); }
  });
  expect(result.fixtureId).toBe('doctor-report');
  expect(result.pageCount).toBe(2);
  expect(result.methods).toEqual(['native', 'native']);
  expect(result.previewCount).toBe(2);
  expect(result.sections.description.length).toBeGreaterThan(1800);
  for (const key of ['description', 'conclusion', 'recommendations', 'other'] as const) expect(normalize(result.sections[key])).toBe(normalize(result.expected[key]));
  expect(result.exact).toBe(true);
  expect(result.digest).toBe('1621705b289e4661f5068011e166df87fd7d6b70f45ce53df5d923a158b6dbcd');
  expect(result.anchors.description).toEqual(['page-1', 'page-2']);
  expect(result.anchors.recommendations).toEqual(['page-2']);
  expect(result.before).toBeNull();
  expect(result.prepared?.fixtureId).toBe('doctor-report');
  expect(Object.keys(result.prepared!).sort()).toEqual(['fixtureId', 'fixtureRevision', 'operation', 'requestId', 'reviewVariantId']);
});

for (const width of [1440, 390]) {
  test(`doctor PDF uses real review and retains both pages at ${width}px`, async ({ page }) => {
    const errors: string[] = [];
    const outbound: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (request.url().includes('/api/analyze')) outbound.push(request.url()); });
    await page.setViewportSize({ width, height: 960 });
    await page.goto('/patient');
    await page.getByLabel('Файл документа', { exact: true }).setInputFiles('public/examples/synthetic-doctor-report.pdf');
    await expect(page.getByRole('heading', { name: 'Проверьте распознанный текст', exact: true })).toBeVisible();
    await expect(page.getByLabel('Описание', { exact: true })).toHaveValue(/На приёме пациент сообщает/);
    for (const [label, kind] of [['Описание', 'description'], ['Заключение', 'conclusion'], ['Рекомендации', 'recommendations']] as const) {
      expect(normalize(await page.getByLabel(label, { exact: true }).inputValue())).toBe(normalize(fixture.sections[kind]));
    }
    await expect(page.getByRole('heading', { name: 'Ваш маршрут', exact: true })).toHaveCount(0);
    if (width < 768) await page.getByRole('tab', { name: 'Оригинал', exact: true }).click();
    await expect(page.getByRole('img', { name: 'Оригинал, страница 1', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Следующая страница', exact: true }).click();
    await expect(page.getByRole('img', { name: 'Оригинал, страница 2', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `docs/release/previews/doctor-report-review-${width}.png`, fullPage: true });
    if (width < 768) await page.getByRole('tab', { name: 'Распознанный текст', exact: true }).click();
    await page.getByRole('button', { name: 'Подтвердить текст и создать маршрут', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Консультация пульмонолога', exact: true })).toHaveCount(1);
    await expect(page.getByText('в течение 2 недель', { exact: true })).toBeVisible();
    await page.locator('.route-documents-panel').getByRole('button', { name: 'Открыть исследование', exact: true }).click();
    if (width < 768) await page.getByRole('tab', { name: 'Исходный файл', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Полный исходный документ', exact: true }).getByRole('img')).toHaveCount(2);
    expect(outbound).toEqual([]);
    expect(errors).toEqual([]);
  });
}
