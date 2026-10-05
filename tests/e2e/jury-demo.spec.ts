import { expect, test } from './test';

async function openPanel(page: import('./test').Page) {
  await page.getByRole('button', { name: 'Демопанель', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Демопанель', exact: true });
  await expect(panel.locator('.demo-story')).toHaveCount(3);
  return panel;
}
for (const width of [1440, 390]) test(`three curated jury stories have clear complete outcomes at ${width}`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 });
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/patient');
  let panel = await openPanel(page);
  await expect(panel.getByRole('heading', { name: 'Большой отчёт врача', exact: true })).toBeVisible();
  await expect(panel.getByRole('heading', { name: 'Неполный документ', exact: true })).not.toBeVisible();
  await page.screenshot({ path: `docs/release/previews/jury-panel-${width}.png` });
  await panel.getByRole('button', { name: 'Открыть результат Третьего Мнения', exact: true }).click();
  await page.getByRole('button', { name: 'Посмотреть результат', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Маммография · BI-RADS 4', exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Подтвердить текст и создать маршрут', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Собрать маршрут', exact: true }).click();
  const proposal = page.getByRole('region', { name: 'Предложение по клиническому источнику', exact: true });
  await expect(proposal).toContainText('Обсудить консультацию онколога');
  await proposal.locator('summary').click();
  await expect(proposal.getByRole('link')).toHaveAttribute('href', 'https://cr.minzdrav.gov.ru/view-cr/598_3');
  await page.getByRole('button', { name: 'Выбрать врача', exact: true }).click();
  let picker = page.getByRole('dialog');
  await picker.getByRole('button', { name: '09:00', exact: true }).first().click();
  await picker.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await picker.getByRole('button', { name: 'Подтвердить демозапись', exact: true }).click();
  await expect(page.locator('.study-booked-label')).toContainText('Вы записаны');
  await page.getByRole('button', { name: 'Завершить планирование', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Маршрут завершён', exact: true })).toBeVisible();

  panel = await openPanel(page);
  await panel.getByRole('button', { name: 'Открыть PDF без внешнего AI', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Проверьте распознанный текст', exact: true })).toBeVisible();
  expect((await page.getByLabel('Описание', { exact: true }).inputValue()).length).toBeGreaterThan(800);
  await expect(page.getByLabel('Заключение', { exact: true })).not.toBeEmpty();
  await expect(page.getByLabel('Рекомендации', { exact: true })).toHaveValue(/пульмонолога/);
  await page.getByRole('button', { name: 'Подтвердить текст и создать маршрут', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Консультация пульмонолога', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Выбрать врача', exact: true }).click();
  picker = page.getByRole('dialog');
  await picker.getByRole('button', { name: '12:00', exact: true }).first().click();
  await picker.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await picker.getByRole('button', { name: 'Подтвердить демозапись', exact: true }).click();
  await page.getByRole('button', { name: 'Завершить планирование', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Скачать календарь маршрута', exact: true })).toBeVisible();

  panel = await openPanel(page);
  await panel.getByRole('button', { name: 'Открыть срочный результат', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Срочное указание в документе', exact: true })).toContainText('Немедленно обратиться');
  await page.getByRole('button', { name: 'Собрать маршрут', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Срочное указание в документе', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Выбрать врача', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Записаться ещё/ })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  expect(errors).toEqual([]);
});

test('actual urgent jury result retains its source instruction through configured AI', async ({ page }) => {
  test.skip(process.env.MEDIPATH_URGENT_LIVE_SMOKE !== '1', 'Opt-in synthetic provider call.');
  test.setTimeout(90000);
  await page.unroute('**/api/capabilities');
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/patient');
  await (await openPanel(page)).getByRole('button', { name: 'Открыть срочный результат', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Срочное указание в документе' })).toContainText('Немедленно обратиться');
  const reply = page.waitForResponse(response => response.url().includes('/api/analyze-demo') && response.request().method() === 'POST', { timeout: 75000 });
  await page.getByRole('button', { name: 'Собрать маршрут', exact: true }).click();
  const response = await reply;
  expect(response.status()).toBe(200);
  const payload = await response.json();
  expect(payload.binding.fixtureId).toBe('explicit-urgent');
  expect(payload.analysis.mode).toBe('synthetic_live');
  expect(payload.analysis.llmExplanation.findings.length).toBeGreaterThan(0);
  expect(payload.analysis.clinicalDemo).toBeUndefined();
  await expect(page.getByRole('heading', { name: 'Ваш маршрут', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Срочное указание в документе' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Выбрать врача', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Записаться ещё/ })).toHaveCount(0);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 960 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.evaluate(() => { (document.activeElement as HTMLElement)?.blur(); window.scrollTo(0, 0); });
    await page.screenshot({ path: `docs/release/previews/jury-urgent-live-${width}.png`, fullPage: true });
  }
  expect(errors).toEqual([]);
});
