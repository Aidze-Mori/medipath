import { test, expect, type Page } from './test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { strToU8, zipSync } from 'fflate';

const fixtureDirectory = resolve('tests/fixtures/document-intake/files');

async function extractInBrowser(page: Page, name: string, mime: string, contents?: Uint8Array) {
  const base64 = Buffer.from(contents ?? (await readFile(resolve(fixtureDirectory, name)))).toString(
    'base64',
  );
  return page.evaluate(
    async ({ fileName, fileType, encoded }) => {
      const modulePath = '/src/features/intake/extract.ts';
      const { extractDocument, disposeExtraction } = (await import(
        modulePath
      )) as typeof import('../../src/features/intake/extract');
      const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
      try {
        const document = await extractDocument(new File([bytes], fileName, { type: fileType }));
        const result = {
          ok: true as const,
          format: document.format,
          text: document.text,
          sections: document.sections,
          blocks: document.blocks.map(({ method, anchor, pageNumber, originalText }) => ({
            method,
            anchor,
            pageNumber,
            originalText,
          })),
          unreadPages: document.unreadPages,
          unreadAnchors: document.unreadAnchors,
          missingSections: document.missingSections,
        };
        disposeExtraction(document);
        return result;
      } catch (error) {
        return {
          ok: false as const,
          code: error instanceof Error && 'code' in error ? String(error.code) : 'unknown',
        };
      }
    },
    { fileName: name, fileType: mime, encoded: base64 },
  );
}

// These are real browser readers and workers on public licensed format fixtures.
// They validate extraction, not a clinical decision or physical-device support.
test.describe('local format extraction', () => {
  test.describe.configure({ mode: 'serial', timeout: 150_000 });

  test.beforeEach(async ({ page }) => {
    // Keep the real Vite origin without loading the changing app/HMR entrypoint.
    await page.goto('/examples/synthetic-chest-referral.txt');
  });

  const positiveCases = [
    { name: 'brain-mri-normal.txt', mime: 'text/plain', methods: ['native'] },
    {
      name: 'brain-mri-normal.docx',
      mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      methods: ['native'],
    },
    { name: 'brain-mri-native.pdf', mime: 'application/pdf', methods: ['native'] },
    { name: 'brain-mri-mixed-two-pages.pdf', mime: 'application/pdf', methods: ['native', 'ocr'] },
    { name: 'brain-mri-image-only.pdf', mime: 'application/pdf', methods: ['ocr'] },
    { name: 'brain-mri-clean-scan.png', mime: 'image/png', methods: ['ocr'] },
    { name: 'brain-mri-clean-scan.jpg', mime: 'image/jpeg', methods: ['ocr'] },
  ];

  for (const fixture of positiveCases) {
    test(`${fixture.name} preserves sections and negative conclusion without upload`, async ({ page }) => {
      const externalRequests: string[] = [];
      const apiRequests: string[] = [];
      const origin = new URL(page.url()).origin;
      page.on('request', (request) => {
        const url = request.url();
        if (/^https?:/.test(url) && new URL(url).origin !== origin) externalRequests.push(url);
        if (new URL(url).pathname.startsWith('/api/')) apiRequests.push(url);
      });

      const result = await extractInBrowser(page, fixture.name, fixture.mime);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.unreadPages).toEqual([]);
      expect(result.unreadAnchors).toEqual([]);
      expect(result.missingSections).toEqual([]);
      expect([...new Set(result.blocks.map((block) => block.method))]).toEqual(fixture.methods);
      expect(result.blocks.every((block) => block.anchor.length > 0)).toBe(true);
      const description = result.sections
        .find((section) => section.kind === 'description')
        ?.text.replace(/\s+/g, ' ');
      const conclusion = result.sections
        .find((section) => section.kind === 'conclusion')
        ?.text.replace(/\s+/g, ' ');
      expect(description).toMatch(/Срединные структуры не смещены/i);
      expect(conclusion).toMatch(/патологии головного мозга не выявлено/i);
      expect(externalRequests).toEqual([]);
      expect(apiRequests).toEqual([]);
    });
  }

  test('missing conclusion stays missing', async ({ page }) => {
    const result = await extractInBrowser(page, 'brain-mri-description-only.txt', 'text/plain');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.missingSections).toContain('conclusion');
    expect(result.sections.find((section) => section.kind === 'conclusion')?.text ?? '').toBe('');
  });

  test('DOCX preserves table text and reads the embedded scan locally', async ({ page }) => {
    const image = await readFile(resolve('public/examples/synthetic-chest-referral.png'));
    const bytes = zipSync({
      '[Content_Types].xml': strToU8(
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
      ),
      'word/document.xml': strToU8(
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body><w:p><w:r><w:t>Учебная таблица</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Ячейка без потери текста</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p><w:r><w:drawing><a:blip r:embed="rId1"/></w:drawing></w:r></w:p></w:body></w:document>',
      ),
      'word/_rels/document.xml.rels': strToU8(
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/scan.png"/></Relationships>',
      ),
      'word/media/scan.png': image,
    });
    const result = await extractInBrowser(
      page,
      'synthetic-table-and-scan.docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      bytes,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(
      result.blocks.some(
        (block) => block.method === 'native' && block.originalText === 'Ячейка без потери текста',
      ),
    ).toBe(true);
    const scan = result.blocks.find((block) => block.method === 'ocr');
    expect(scan?.originalText).toContain('Плевральный выпот не выявлен');
    expect(scan?.pageNumber).toBeUndefined();
    expect(result.unreadAnchors).toEqual([]);
  });

  for (const fixture of [
    { name: 'brain-mri-password.pdf', mime: 'application/pdf', code: 'password' },
    { name: 'corrupted.pdf', mime: 'application/pdf', code: 'corrupt' },
    { name: 'brain-mri-normal.doc', mime: 'application/msword', code: 'unsupported' },
  ]) {
    test(`${fixture.name} returns explicit ${fixture.code} instead of empty success`, async ({ page }) => {
      const result = await extractInBrowser(page, fixture.name, fixture.mime);
      expect(result).toEqual({ ok: false, code: fixture.code });
    });
  }
});
