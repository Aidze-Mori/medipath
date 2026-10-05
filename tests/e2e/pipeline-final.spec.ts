import { expect, test } from './test';
import { openDemoScenario } from './helpers';

async function panel(page: import('./test').Page) {
  await page.getByRole('button', { name: 'Демопанель', exact: true }).click();
  return page.getByRole('dialog', { name: 'Демопанель', exact: true });
}

test('prepared PDF uses actual extraction, review gate, route and retained source', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/patient');
  const demo = await panel(page);
  await demo.getByText('Дополнительные сценарии и настройки', { exact: true }).click();
  await demo.getByRole('button', { name: 'Загрузить учебный PDF', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Проверьте распознанный текст' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Ваш маршрут', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Рекомендации', { exact: true })).toHaveValue(/пульмонолога/);
  await page.getByRole('button', { name: 'Подтвердить текст и создать маршрут' }).click();
  await expect(page.getByRole('heading', { name: 'Ваш маршрут', exact: true })).toBeVisible();
  await page.locator('.route-documents-panel').getByRole('button', { name: 'Открыть исследование', exact: true }).click();
  await page.getByRole('tab', { name: 'Исходный файл', exact: true }).click();
  await expect(page.getByRole('img', { name: 'Исходный документ, страница 1' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('clinic loading failure retries and cancellation does not leave permanent progress', async ({ page }) => {
  await page.goto('/patient');
  let failures = 1;
  await page.route('**/api/clinic-demo?**', async route => {
    if (failures-- > 0) await route.fulfill({ status: 503, body: '{}' });
    else await route.continue();
  });
  await (await panel(page)).getByRole('button', { name: 'Результаты из клиники', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Не удалось получить');
  await page.getByRole('button', { name: 'Повторить загрузку результатов' }).click();
  await expect(page.getByRole('button', { name: 'Открыть результат: КТ грудной клетки' })).toBeVisible();
  await page.unroute('**/api/clinic-demo?**');
  await page.route('**/api/clinic-demo?**', async route => { await new Promise(resolve => setTimeout(resolve, 700)); await route.continue().catch(() => {}); });
  await (await panel(page)).getByRole('button', { name: 'Результаты из клиники', exact: true }).click();
  await page.getByRole('button', { name: 'Вернуться к работе', exact: true }).click();
  await (await panel(page)).getByRole('button', { name: 'Включить демонстрацию', exact: true }).click();
  await expect(page.getByText('Получаем результаты · проверяем пациента, источник и версию…')).toHaveCount(0);
});

test('external model error keeps review and permits explicit retry', async ({ page }) => {
  await page.goto('/patient');
  let calls = 0;
  await page.route('**/api/analyze-demo', route => {
    calls++;
    return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'model_unavailable' } }) });
  });
  await openDemoScenario(page, 'chest-referral', 'live');
  await page.getByRole('button', { name: 'Подтвердить текст и создать маршрут' }).click();
  await expect(page.getByRole('alert')).toContainText('Внешняя модель сейчас недоступна');
  await expect(page.getByLabel('Рекомендации', { exact: true })).toHaveValue(/пульмонолога/);
  await page.getByRole('button', { name: 'Подтвердить текст и создать маршрут' }).click();
  await expect.poll(() => calls).toBe(2);
});

test('actual configured CLI: canonical request through UI, validated live response', async ({ page }) => {
  test.skip(process.env.MEDIPATH_LIVE_SMOKE !== '1', 'Opt-in real provider call; backend must use codex_cli.');
  test.setTimeout(90000);
  await page.unroute('**/api/capabilities');
  const outbound: unknown[] = [];
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (request.url().includes('/api/analyze-demo')) outbound.push(request.postDataJSON()); });
  await page.goto('/patient');
  await (await panel(page)).getByRole('button', { name: 'Запустить полную демонстрацию', exact: true }).click();
  await expect(page.getByLabel('Рекомендации', { exact: true })).toHaveValue(/пульмонолога/);
  expect(outbound).toHaveLength(0);
  const reply = page.waitForResponse(response => response.url().includes('/api/analyze-demo') && response.request().method() === 'POST', { timeout: 75000 });
  await page.getByRole('button', { name: 'Подтвердить текст и создать маршрут' }).click();
  expect((await reply).status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'Ваш маршрут', exact: true })).toBeVisible({ timeout: 75000 });
  await expect(page.getByText('Учебный пример · live AI', { exact: true })).toBeVisible();
  await expect(page.locator('.analysis-section-card')).toHaveCount(3);
  await expect(page.locator('.analysis-section-card[open]')).toHaveCount(0);
  await page.locator('.analysis-section-card').filter({ hasText: 'Заключение' }).locator('summary').first().click();
  await expect(page.locator('.analysis-section-card[open]')).toHaveCount(1);
  expect(outbound).toHaveLength(1);
  expect(Object.keys(outbound[0] as object).sort()).toEqual(['fixtureId', 'fixtureRevision', 'operation', 'requestId', 'reviewVariantId']);
  expect(JSON.stringify(outbound)).not.toMatch(/Иван|телефон|Описание|рекомендована/i);
  expect(errors).toEqual([]);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.evaluate(() => { (document.activeElement as HTMLElement)?.blur(); window.scrollTo(0, 0); });
    await page.screenshot({ path: `docs/release/previews/live-cli-round-three-${width}.png`, fullPage: true });
  }
});
