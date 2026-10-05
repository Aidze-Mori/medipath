import { expect, test } from './test';

test('navigating away cancels pending AI, ignores its late response and allows retry', async ({ page }) => {
  await page.route('**/api/capabilities', route => route.fulfill({ json: { provider: 'codex_cli', configured: true, documentAnalysisAllowed: true, reason: 'ready' } }));
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  let attempts = 0;
  let deliveries = 0;
  await page.route('**/api/analyze-document', async route => {
    const body = route.request().postDataJSON();
    attempts++;
    if (attempts === 1) await pending;
    try {
      await route.fulfill({ json: {
        binding: { requestId: body.requestId, documentRevision: body.documentRevision, contentDigest: body.contentDigest },
        explanation: { summary: 'Пояснение учебного документа.', findings: [{ sectionId: body.sections[0].id, quote: body.sections[0].text, explanation: 'Сохранено описание исследования.' }] },
      } });
    } finally { deliveries++; }
  });
  await page.goto('/patient');
  await page.getByLabel('Файл документа', { exact: true }).setInputFiles({
    name: 'synthetic-navigation-cancel.txt', mimeType: 'text/plain',
    buffer: Buffer.from('Описание: Учебное исследование, очаговых изменений не выявлено.\nЗаключение: Изменения не выявлены.\nРекомендации: Рекомендована консультация терапевта.'),
  });
  await page.getByRole('button', { name: 'Подтвердить текст и создать маршрут', exact: true }).click();
  await expect.poll(() => attempts).toBe(1);
  const nav = page.getByRole('navigation', { name: 'Основная навигация', exact: true });
  await nav.getByRole('button', { name: 'Архив', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Архив документов', exact: true })).toBeVisible();
  release();
  await expect.poll(() => deliveries).toBe(1);
  // Let any mistakenly accepted response complete both the state update and paint.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect(page.getByRole('heading', { name: 'Архив документов', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Ваш маршрут', exact: true })).toHaveCount(0);
  await nav.getByRole('button', { name: 'Мои планы', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Планов пока нет', exact: true })).toBeVisible();
  await nav.getByRole('button', { name: 'Моя медкарта', exact: true }).click();
  await page.getByRole('button', { name: 'Открыть результат: synthetic-navigation-cancel.txt', exact: true }).click();
  await page.getByRole('button', { name: 'Собрать маршрут', exact: true }).click();
  await expect(page.getByRole('region', { name: 'AI-пояснение документа', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Консультация терапевта', exact: true })).toBeVisible();
  expect(attempts).toBe(2);
});

test('opening a patient notification from the clinic header switches to the patient results', async ({ page }) => {
  await page.goto('/patient');
  await page.getByRole('button', { name: 'Демопанель', exact: true }).click();
  await page.getByRole('dialog', { name: 'Демопанель', exact: true }).getByText('Дополнительные сценарии и настройки', { exact: true }).click();
  await page.getByRole('button', { name: 'Получить уведомление', exact: true }).click();
  await page.getByRole('dialog', { name: 'Уведомления', exact: true }).getByRole('button', { name: 'Закрыть окно' }).click();
  await page.getByRole('button', { name: 'Демопанель', exact: true }).click();
  await page.getByRole('link', { name: 'Клинике', exact: true }).click();
  await expect(page).toHaveURL(/\/clinic$/);
  await page.getByRole('button', { name: 'Уведомления', exact: true }).click();
  await page.getByRole('button', { name: 'Посмотреть результат', exact: true }).click();
  await expect(page).toHaveURL(/\/patient$/);
  await expect(page.getByRole('heading', { name: 'Ваши результаты', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Открыть результат: Маммография · BI-RADS 4', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
