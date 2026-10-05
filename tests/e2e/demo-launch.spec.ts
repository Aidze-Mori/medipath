import { expect, test, type Page } from './test';

const readyCapabilities = { provider: 'codex_cli', configured: true, documentAnalysisAllowed: false, reason: 'document_opt_in_required' };
async function openPanel(page: Page) {
  await page.getByRole('button', { name: 'Демопанель', exact: true }).click();
  return page.getByRole('dialog', { name: 'Демопанель', exact: true });
}

for (const width of [1440, 390, 320]) test(`full demo launch is clear and review-gated at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: width === 320 ? 740 : 900 });
  await page.route('**/api/capabilities', route => route.fulfill({ json: readyCapabilities }));
  const calls: string[] = [];
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (/\/api\/analyze-(demo|document)/.test(request.url())) calls.push(request.url()); });
  await page.goto('/patient');
  const panel = await openPanel(page);
  await expect(panel.getByText('AI настроен · Codex CLI', { exact: true })).toBeVisible();
  const launch = panel.getByRole('button', { name: 'Запустить полную демонстрацию', exact: true });
  await expect(launch).toBeEnabled();
  await expect(panel.locator('.demo-case-grid > article')).toHaveCount(3);
  await expect(panel.getByRole('button', { name: 'Открыть противоречие', exact: true })).toBeHidden();
  await launch.scrollIntoViewIfNeeded();
  await expect(launch).toBeInViewport();
  await expect(panel.locator('.demo-advanced')).not.toHaveAttribute('open');
  await expect(panel.getByRole('list', { name: 'Этапы демонстрации' })).toContainText('Обезличивание');
  expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: `docs/release/previews/demo-launch-${width}.png`, animations: 'disabled' });
  const file = page.waitForResponse(response => response.url().endsWith('/examples/synthetic-doctor-report.pdf'));
  await launch.click();
  expect((await file).ok()).toBe(true);
  await expect(page.getByRole('heading', { name: 'Проверьте распознанный текст', exact: true })).toBeVisible();
  await expect(page.getByLabel('Рекомендации', { exact: true })).toHaveValue(/пульмонолога/);
  expect(calls).toEqual([]);
  const reopened = await openPanel(page);
  await expect(reopened.getByText('Вы в демонстрации', { exact: true })).toBeVisible();
  await expect(reopened.getByRole('button', { name: 'Пройти заново', exact: true })).toBeEnabled();
  await reopened.getByText('Дополнительные сценарии и настройки', { exact: true }).click();
  await expect(reopened.getByLabel('Режим обработки примера', { exact: true })).toHaveText('Внешний AI · нужен настроенный сервер');
  expect(errors).toEqual([]);
});

test('missing configuration keeps local scenarios available and capability check retries', async ({ page }) => {
  let ready = false;
  await page.route('**/api/capabilities', route => route.fulfill({ json: ready ? readyCapabilities : { provider: 'disabled', configured: false, documentAnalysisAllowed: false, reason: 'disabled' } }));
  await page.goto('/patient');
  const panel = await openPanel(page);
  await expect(panel.getByText('AI-сервер пока не настроен. Локальные сценарии доступны ниже.', { exact: true })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Запустить полную демонстрацию', exact: true })).toBeDisabled();
  await panel.getByText('Дополнительные сценарии и настройки', { exact: true }).click();
  await expect(panel.getByLabel('Режим обработки примера', { exact: true })).toHaveText('Локальный разбор · без внешнего AI');
  await expect(panel.getByRole('button', { name: 'Открыть сценарий', exact: true })).toBeEnabled();
  ready = true;
  await panel.getByRole('button', { name: 'Повторить проверку', exact: true }).click();
  await expect(panel.getByText('AI настроен · Codex CLI', { exact: true })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Запустить полную демонстрацию', exact: true })).toBeEnabled();
  await panel.getByRole('button', { name: 'Открыть сценарий', exact: true }).click();
  await expect(page.getByRole('article', { name: 'КТ грудной клетки', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Подтвердить текст и создать маршрут', exact: true })).toHaveCount(0);
});

test('malformed capability response is not trusted and can be retried', async ({ page }) => {
  let ready = false;
  await page.route('**/api/capabilities', route => route.fulfill({ json: ready ? readyCapabilities : { provider: 'secret-provider', configured: true, secret: 'DO_NOT_RENDER' } }));
  await page.goto('/patient');
  const panel = await openPanel(page);
  await expect(panel.getByText('Не удалось проверить AI-сервер.', { exact: true })).toBeVisible();
  await expect(panel).not.toContainText('DO_NOT_RENDER');
  await expect(panel.getByRole('button', { name: 'Запустить полную демонстрацию', exact: true })).toBeDisabled();
  ready = true;
  await panel.getByRole('button', { name: 'Повторить проверку', exact: true }).click();
  await expect(panel.getByText('AI настроен · Codex CLI', { exact: true })).toBeVisible();
});
