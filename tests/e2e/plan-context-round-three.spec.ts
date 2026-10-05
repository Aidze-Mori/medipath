import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from './test';
import { openDemoScenario } from './helpers';

async function bookFirstSlot(page: Page) {
  await page.getByRole('button', { name: 'Выбрать врача', exact: true }).click();
  const picker = page.getByRole('dialog');
  await picker.getByRole('button', { name: '09:00', exact: true }).first().click();
  await picker.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await picker.getByRole('button', { name: 'Подтвердить демозапись', exact: true }).click();
}

const bridgeState = (page: Page) => page.evaluate(async () => {
  const modulePath = performance.getEntriesByType('resource').map(entry => entry.name).find(name => /\/src\/features\/demo\/bridge\.ts(?:\?|$)/.test(name));
  if (!modulePath) throw new Error('Loaded demo bridge module not found');
  const bridge = await import(modulePath);
  return {
    active: bridge.getActiveDemoBookings(bridge.getDemoActivities()).map((event: { bookingId: string }) => event.bookingId),
    cancelled: bridge.getDemoActivities().filter((event: { kind: string }) => event.kind === 'booking_cancelled').map((event: { bookingId: string }) => event.bookingId),
  };
});

async function loadClinicResults(page: Page) {
  await page.getByRole('button', { name: 'Демопанель', exact: true }).click();
  await page.getByRole('dialog', { name: 'Демопанель', exact: true }).getByRole('button', { name: 'Результаты из клиники', exact: true }).click();
  await expect(page.locator('.results-row')).toHaveCount(3);
}

test('opening an older plan preserves its analysis mode after another mode analyzed the same study', async ({ page }) => {
  const modelRequests: string[] = [];
  await page.route('**/api/analyze-*', route => { modelRequests.push(route.request().url()); return route.abort(); });
  await page.goto('/patient');
  await openDemoScenario(page, 'chest-referral', 'local');
  await page.getByRole('button', { name: 'Подтвердить текст и создать маршрут', exact: true }).click();
  await expect(page.locator('.visit-route .mode-label')).toHaveText('Локальная обработка');
  await openDemoScenario(page, 'chest-referral', 'replay');
  await page.getByRole('button', { name: 'Подтвердить текст и создать маршрут', exact: true }).click();
  await expect(page.locator('.visit-route .mode-label')).toHaveText('Учебный пример · сохранённый результат');
  const nav = page.getByRole('navigation', { name: 'Основная навигация', exact: true });
  await nav.getByRole('button', { name: 'Мои планы', exact: true }).click();
  await expect(page.locator('.saved-plan')).toHaveCount(2);
  await page.locator('.saved-plan').last().getByRole('button', { name: 'Продолжить планирование', exact: true }).click();
  await expect(page.locator('.visit-route .mode-label')).toHaveText('Локальная обработка');
  await page.getByRole('button', { name: 'Завершить планирование', exact: true }).click();
  await page.getByRole('button', { name: 'Редактировать маршрут', exact: true }).click();
  await expect(page.locator('.visit-route .mode-label')).toHaveText('Локальная обработка');
  await nav.getByRole('button', { name: 'Мои планы', exact: true }).click();
  await expect(page.locator('.saved-plan')).toHaveCount(2);
  expect(modelRequests).toEqual([]);
});

test('deleting a booked study cancels the same appointment in the clinic bridge and releases its slot', async ({ page }) => {
  const modelRequests: string[] = [];
  await page.route('**/api/analyze-*', route => { modelRequests.push(route.request().url()); return route.abort(); });
  await page.goto('/patient');
  await openDemoScenario(page, 'chest-referral', 'local');
  await page.getByRole('button', { name: 'Подтвердить текст и создать маршрут', exact: true }).click();
  await bookFirstSlot(page);
  const before = await bridgeState(page);
  expect(before.active).toHaveLength(1);
  const nav = page.getByRole('navigation', { name: 'Основная навигация', exact: true });
  await nav.getByRole('button', { name: 'Моя медкарта', exact: true }).click();
  await page.getByRole('button', { name: 'Открыть результат: КТ грудной клетки', exact: true }).click();
  await page.getByRole('button', { name: 'Удалить документ', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: 'Удалить документ?', exact: true });
  await confirmation.getByRole('textbox', { name: 'Введите слово УДАЛЕНИЕ', exact: true }).fill('УДАЛЕНИЕ');
  await confirmation.getByRole('button', { name: 'Удалить документ', exact: true }).click();
  const after = await bridgeState(page);
  expect(after.active).toEqual([]);
  expect(after.cancelled).toContain(before.active[0]);
  await nav.getByRole('button', { name: 'Мои планы', exact: true }).click();
  await expect(page.locator('.saved-plan')).toHaveCount(0);
  await openDemoScenario(page, 'chest-referral', 'local');
  await page.getByRole('button', { name: 'Подтвердить текст и создать маршрут', exact: true }).click();
  await bookFirstSlot(page);
  const rebooked = await bridgeState(page);
  expect(rebooked.active).toHaveLength(1);
  expect(rebooked.active[0]).not.toBe(before.active[0]);
  expect(modelRequests).toEqual([]);
});

test('leaving a delayed demo PDF load aborts it and keeps the chosen page', async ({ page }) => {
  const modelRequests: string[] = [];
  await page.route('**/api/analyze-*', route => { modelRequests.push(route.request().url()); return route.abort(); });
  await page.route('**/api/capabilities', route => route.fulfill({ json: {
    provider: 'codex_cli', configured: true, documentAnalysisAllowed: true, reason: 'ready',
  } }));
  const bytes = await readFile('public/examples/synthetic-doctor-report.pdf');
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let requested!: () => void;
  const requestStarted = new Promise<void>(resolve => { requested = resolve; });
  await page.route('**/examples/synthetic-doctor-report.pdf', async route => {
    requested();
    await gate;
    await route.fulfill({ contentType: 'application/pdf', body: bytes });
  });
  await page.goto('/patient');
  await page.getByRole('button', { name: 'Демопанель', exact: true }).click();
  await page.getByRole('dialog', { name: 'Демопанель', exact: true }).getByRole('button', { name: 'Запустить полную демонстрацию', exact: true }).click();
  await requestStarted;
  const aborted = page.waitForEvent('requestfailed', { predicate: request => request.url().endsWith('/examples/synthetic-doctor-report.pdf') });
  try {
    await page.getByRole('navigation', { name: 'Основная навигация', exact: true }).getByRole('button', { name: 'Записи', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Записи и календарь', exact: true })).toBeVisible();
    release();
    await aborted;
    await expect(page.getByRole('heading', { name: 'Записи и календарь', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Подтвердить текст и создать маршрут', exact: true })).toHaveCount(0);
    await page.getByRole('navigation', { name: 'Основная навигация', exact: true }).getByRole('button', { name: 'Моя медкарта', exact: true }).click();
    await expect(page.locator('.results-row')).toHaveCount(0);
    expect(modelRequests).toEqual([]);
  } finally {
    release();
  }
});

test('a canonical unconfirmed draft adopts the validated clinic result without a duplicate or fake OCR confirmation', async ({ page }) => {
  const modelRequests: string[] = [];
  await page.route('**/api/analyze-*', route => { modelRequests.push(route.request().url()); return route.abort(); });
  await page.goto('/patient');
  await openDemoScenario(page, 'chest-referral', 'local');
  const nav = page.getByRole('navigation', { name: 'Основная навигация', exact: true });
  await nav.getByRole('button', { name: 'Моя медкарта', exact: true }).click();
  const chestSelection = page.getByRole('checkbox', { name: 'Учесть в маршруте: КТ грудной клетки', exact: true });
  await expect(chestSelection).toBeDisabled();
  await loadClinicResults(page);
  await expect(chestSelection).toHaveCount(1);
  await expect(chestSelection).toBeEnabled();
  await page.getByRole('button', { name: 'Открыть результат: КТ грудной клетки', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Данные исследования', exact: true })).toBeVisible();
  await expect(page.locator('.study-metadata')).toContainText('КТ органов грудной клетки');
  await expect(page.locator('.study-metadata')).toContainText('Учебная клиника MediPath');
  await expect(page.getByText('Готовые поля из учебной системы клиники. Их не нужно распознавать повторно.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Собрать маршрут', exact: true }).click();
  await expect(page.locator('.visit-route .mode-label')).toHaveText('Локальная обработка');
  await expect(page.getByRole('button', { name: 'Выбрать врача', exact: true })).toBeVisible();
  await nav.getByRole('button', { name: 'Моя медкарта', exact: true }).click();
  await expect(page.locator('.results-row')).toHaveCount(3);
  expect(modelRequests).toEqual([]);
});

test('cancelling a historical booking after editing its clinic source updates the clinic bridge', async ({ page }) => {
  const modelRequests: string[] = [];
  await page.route('**/api/analyze-*', route => { modelRequests.push(route.request().url()); return route.abort(); });
  await page.goto('/patient');
  await loadClinicResults(page);
  await page.getByRole('checkbox', { name: 'Учесть в маршруте: КТ грудной клетки', exact: true }).check();
  await page.getByRole('button', { name: 'Собрать маршрут', exact: true }).click();
  await bookFirstSlot(page);
  const before = await bridgeState(page);
  expect(before.active).toHaveLength(1);
  const nav = page.getByRole('navigation', { name: 'Основная навигация', exact: true });
  await nav.getByRole('button', { name: 'Моя медкарта', exact: true }).click();
  await page.getByRole('button', { name: 'Открыть результат: КТ грудной клетки', exact: true }).click();
  await page.getByRole('button', { name: 'Редактировать текст', exact: true }).click();
  const description = page.getByRole('textbox', { name: 'Описание', exact: true });
  await description.fill(`${await description.inputValue()} Проверено.`);
  await nav.getByRole('button', { name: 'Записи', exact: true }).click();
  await expect(page.locator('.booking-card')).toHaveCount(1);
  await page.getByRole('button', { name: 'Отменить запись', exact: true }).click();
  await page.getByRole('button', { name: 'Да, отменить запись', exact: true }).click();
  await expect(page.locator('.booking-card')).toHaveCount(0);
  const after = await bridgeState(page);
  expect(after.active).toEqual([]);
  expect(after.cancelled).toContain(before.active[0]);
  expect(modelRequests).toEqual([]);
});
