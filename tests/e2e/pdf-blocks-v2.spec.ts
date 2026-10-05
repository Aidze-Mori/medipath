import { expect, test } from './test';

// Authored synthetic document, rendered to a real PDF by Chromium in memory.
// No user document, saved fixture or external AI is involved in these tests.
const radiologyForm = `<!doctype html><html lang="ru"><meta charset="utf-8"><style>
body{font:12px Arial,sans-serif;margin:36px;color:#111}h1{font-size:20px}h2{font-size:14px;margin:22px 0 8px}.field{display:grid;grid-template-columns:180px 1fr;margin:10px 0}p{line-height:1.5}
</style><h1>Учебный результат лучевой диагностики</h1>
<div class="field"><b>Место проведения</b><span>Синтетический диагностический центр</span></div>
<div class="field"><b>Дата исследования</b><span>05.10.2026</span></div>
<div class="field"><b>Наименование исследования</b><span>КТ головного мозга</span></div>
<h2>Описание исследования</h2><p>Срединные структуры мозга не смещены. Ширина третьего желудочка — до 3 мм.</p>
<h2>Заключение исследования</h2><p>КТ-признаков кровоизлияния не выявлено.</p>
<h2>Рекомендации по дальнейшему обследованию</h2><p>Дообследование не требуется.</p>
</html>`;

for (const width of [1440, 390]) {
  test(`real synthetic PDF form becomes editable source blocks at ${width}px`, async ({ page }) => {
    const errors: string[] = [];
    const analysisRequests: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (request.url().includes('/api/analyze')) analysisRequests.push(request.url()); });
    await page.setContent(radiologyForm);
    const pdf = await page.pdf({ format: 'A4' });
    await page.setViewportSize({ width, height: 960 });
    await page.goto('/patient');
    await page.getByLabel('Файл документа', { exact: true }).setInputFiles({ name: 'synthetic-radiology-form.pdf', mimeType: 'application/pdf', buffer: pdf });
    await expect(page.getByLabel('Описание', { exact: true })).toHaveValue(/Срединные структуры мозга не смещены/);
    await expect(page.getByLabel('Заключение', { exact: true })).toHaveValue('КТ-признаков кровоизлияния не выявлено.');
    await expect(page.getByLabel('Рекомендации', { exact: true })).toHaveValue('Дообследование не требуется.');
    await expect(page.getByLabel('Место проведения', { exact: true })).toHaveValue('Синтетический диагностический центр');
    await expect(page.getByLabel('Дата исследования', { exact: true })).toHaveValue('05.10.2026');
    await expect(page.getByLabel('Наименование исследования', { exact: true })).toHaveValue('КТ головного мозга');
    await page.getByLabel('Дата исследования', { exact: true }).fill('06.10.2026');
    await expect(page.getByLabel('Место проведения', { exact: true })).toHaveValue('Синтетический диагностический центр');
    await expect(page.getByLabel('Заключение', { exact: true })).toHaveValue('КТ-признаков кровоизлияния не выявлено.');
    await expect(page.getByText('Редакция 2', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `docs/release/previews/pdf-blocks-v2-${width}.png`, fullPage: true });
    expect(analysisRequests).toEqual([]);
    expect(errors).toEqual([]);
  });
}
