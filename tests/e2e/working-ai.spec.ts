import { expect, test } from './test';

const syntheticText = 'Пациент: Тестов Тест Тестович\nТелефон: +7 900 123-45-67\nОписание исследования: Щитовидная железа обычного расположения. Узловые образования не выявлены.\nЗаключение врача: Ультразвуковых признаков узловых образований не выявлено.\nРекомендации: Дополнительные рекомендации не указаны.';
test('working document is cleaned before request, shows waiting and receives a cited explanation with feedback', async ({ page }) => {
  await page.route('**/api/capabilities', route => route.fulfill({ json: { provider: 'codex_cli', configured: true, documentAnalysisAllowed: true, reason: 'ready' } }));
  let body: { requestId: string; documentRevision: number; contentDigest: string; sections: { id: string; text: string }[] } | undefined;
  let release!: () => void;
  const ready = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/analyze-document', async route => {
    body = route.request().postDataJSON();
    await ready;
    await route.fulfill({ json: { binding: { requestId: body!.requestId, documentRevision: body!.documentRevision, contentDigest: body!.contentDigest }, explanation: { summary: 'Пояснение подготовлено по разделам исходного документа.', findings: body!.sections.map(section => ({ sectionId: section.id, quote: section.text, explanation: 'В этом фрагменте сохранена формулировка исходного исследования.' })) } } });
  });
  await page.goto('/patient');
  await page.getByLabel('Файл документа', { exact: true }).setInputFiles({ name: 'synthetic-ultrasound.txt', mimeType: 'text/plain', buffer: Buffer.from(syntheticText) });
  await expect(page.getByLabel('Описание', { exact: true })).toHaveValue(/Щитовидная/);
  await expect(page.getByLabel('Обработка документа', { exact: true })).toHaveText('AI-разбор после обезличивания');
  expect(body).toBeUndefined();
  await page.getByRole('button', { name: 'Подтвердить текст и создать маршрут', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Анализируем медицинский текст');
  await expect.poll(() => body).toBeTruthy();
  expect(JSON.stringify(body!.sections)).not.toMatch(/Тестов|900|123-45|synthetic-ultrasound/);
  expect(Object.keys(body!).sort()).toEqual(['requestId', 'documentRevision', 'contentDigest', 'sections'].sort());
  release();
  await expect(page.getByRole('region', { name: 'AI-пояснение документа', exact: true })).toBeVisible();
  await expect(page.getByText('AI-разбор · очищенный документ', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Выбрать врача', exact: true })).toHaveCount(0);
  const feedback = page.getByRole('region', { name: 'Оценка маршрута', exact: true });
  await feedback.getByRole('button', { name: 'Полезно', exact: true }).click();
  await expect(feedback.getByRole('button', { name: 'Полезно', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Завершить планирование', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Маршрут завершён', exact: true })).toBeVisible();
});

test('actual working upload uses real configured provider outside the fixture manifest', async ({ page }) => {
  test.skip(process.env.MEDIPATH_DOCUMENT_LIVE_SMOKE !== '1', 'Explicit quota-consuming local provider smoke.');
  test.setTimeout(90000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.unroute('**/api/capabilities');
  await page.goto('/patient');
  await page.getByLabel('Файл документа', { exact: true }).setInputFiles({ name: 'new-synthetic-ultrasound.txt', mimeType: 'text/plain', buffer: Buffer.from(syntheticText) });
  await expect(page.getByLabel('Обработка документа', { exact: true })).toHaveText('AI-разбор после обезличивания');
  const response = page.waitForResponse(response => response.url().includes('/api/analyze-document'));
  await page.getByRole('button', { name: 'Подтвердить текст и создать маршрут', exact: true }).click();
  expect((await response).status()).toBe(200);
  await expect(page.getByText('AI-разбор · очищенный документ', { exact: true })).toBeVisible({ timeout: 70000 });
  await expect(page.getByRole('region', { name: 'AI-пояснение документа', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Выбрать врача', exact: true })).toHaveCount(0);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: 'docs/release/previews/working-ai-live.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('region', { name: 'AI-пояснение документа', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: 'docs/release/previews/working-ai-live-390.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('failed working AI keeps the document and can retry successfully', async ({ page }) => {
  await page.route('**/api/capabilities', route => route.fulfill({ json: { provider: 'codex_cli', configured: true, documentAnalysisAllowed: true, reason: 'ready' } }));
  let attempts = 0;
  await page.route('**/api/analyze-document', async route => {
    attempts++;
    if (attempts === 1) return route.fulfill({ status: 503, json: { error: { code: 'model_unavailable' } } });
    const body = route.request().postDataJSON();
    await route.fulfill({ json: { binding: { requestId: body.requestId, documentRevision: body.documentRevision, contentDigest: body.contentDigest }, explanation: { summary: 'Пояснение по сохранённому документу.', findings: [{ sectionId: body.sections[0].id, quote: body.sections[0].text, explanation: 'Сохранена формулировка исследования.' }] } } });
  });
  await page.goto('/patient');
  await page.getByLabel('Файл документа', { exact: true }).setInputFiles({ name: 'retry-synthetic.txt', mimeType: 'text/plain', buffer: Buffer.from(syntheticText) });
  await expect(page.getByLabel('Обработка документа', { exact: true })).toHaveText('AI-разбор после обезличивания');
  await page.getByRole('button', { name: 'Подтвердить текст и создать маршрут', exact: true }).click();
  await expect(page.getByText('Внешняя модель сейчас недоступна. Можно повторить запрос.', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Описание', { exact: true })).toHaveValue(/Щитовидная/);
  await page.getByRole('button', { name: 'Подтвердить текст и создать маршрут', exact: true }).click();
  await expect(page.getByRole('region', { name: 'AI-пояснение документа', exact: true })).toBeVisible();
  expect(attempts).toBe(2);
});
