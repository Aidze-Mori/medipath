import { expect, test, type Page } from './test';
import { openDemoScenario } from './helpers';

async function book(page: Page, time = '09:00') {
  await page.getByRole('button', { name: 'Выбрать врача', exact: true }).click();
  const picker = page.getByRole('dialog');
  await picker.getByRole('button', { name: time, exact: true }).first().click();
  await picker.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await picker.getByRole('button', { name: 'Подтвердить демозапись', exact: true }).click();
}
async function combine(page: Page) {
  await page.getByRole('navigation', { name: 'Основная навигация', exact: true }).getByRole('button', { name: 'Моя медкарта', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Учесть в маршруте: КТ грудной клетки', exact: true }).check();
  await page.getByRole('checkbox', { name: 'Учесть в маршруте: Подробный отчёт врача', exact: true }).check();
  await page.getByRole('button', { name: 'Собрать маршрут', exact: true }).click();
}
async function assertNoNewPicker(page: Page) {
  await expect(page.getByRole('button', { name: 'Выбрать врача', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Подобрать время для/ })).toHaveCount(0);
}
async function cancelPartial(page: Page) {
  await page.getByRole('button', { name: 'Отменить и спланировать общий приём', exact: true }).first().click();
  await page.getByRole('dialog', { name: 'Отменить запись?', exact: true }).getByRole('button', { name: 'Да, отменить запись', exact: true }).click();
}

test('a partial booking is visible and blocks a duplicate until explicit cancellation', async ({ page }) => {
  const modelRequests: string[] = [];
  await page.route('**/api/analyze-*', route => { modelRequests.push(route.request().url()); return route.abort(); });
  await page.goto('/patient');
  await openDemoScenario(page, 'chest-referral', 'local');
  await page.getByRole('button', { name: 'Подтвердить текст и создать маршрут', exact: true }).click();
  await book(page);
  await openDemoScenario(page, 'doctor-report', 'local');
  await page.getByRole('button', { name: 'Подтвердить текст и создать маршрут', exact: true }).click();
  await combine(page);
  const overlap = page.getByRole('region', { name: 'Существующие записи по части исследований', exact: true });
  await expect(overlap).toBeVisible();
  await expect(overlap.locator('.booking-card')).toHaveCount(1);
  await assertNoNewPicker(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(overlap.getByRole('button', { name: 'Отменить и спланировать общий приём', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: 'Завершить планирование', exact: true }).click();
  await expect(page.locator('.completed-plan .booking-card')).toHaveCount(1);
  await expect(page.getByText('Существующая запись учитывает часть исследований. Общий шаг ещё не спланирован. Вернуться к нему можно через редактирование плана.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Редактировать маршрут', exact: true }).click();
  await cancelPartial(page);
  await expect(overlap).toHaveCount(0);
  await book(page);
  await page.getByRole('navigation', { name: 'Основная навигация', exact: true }).getByRole('button', { name: 'Записи', exact: true }).click();
  await expect(page.locator('.booking-card')).toHaveCount(1);
  const events = await page.evaluate(async () => {
    const path = performance.getEntriesByType('resource').map(item => item.name).find(name => /\/src\/features\/demo\/bridge\.ts(?:\?|$)/.test(name));
    if (!path) throw new Error('Demo bridge not loaded');
    const bridge = await import(path);
    return { active: bridge.getActiveDemoBookings(bridge.getDemoActivities()), cancelled: bridge.getDemoActivities().filter((event: { kind: string }) => event.kind === 'booking_cancelled') };
  });
  expect(events.active.map((event: { fixtureId: string }) => event.fixtureId).sort()).toEqual(['chest-referral', 'doctor-report']);
  expect(new Set(events.active.map((event: { bookingId: string }) => event.bookingId)).size).toBe(1);
  expect(events.cancelled).toHaveLength(1);
  expect(modelRequests).toEqual([]);
});

test('two partial appointments remain separate and must both be cancelled before a common slot', async ({ page }) => {
  const modelRequests: string[] = [];
  await page.route('**/api/analyze-*', route => { modelRequests.push(route.request().url()); return route.abort(); });
  await page.goto('/patient');
  await openDemoScenario(page, 'chest-referral', 'local');
  await page.getByRole('button', { name: 'Подтвердить текст и создать маршрут', exact: true }).click();
  await book(page);
  await openDemoScenario(page, 'doctor-report', 'local');
  await page.getByRole('button', { name: 'Подтвердить текст и создать маршрут', exact: true }).click();
  await book(page, '12:00');
  await combine(page);
  const overlap = page.getByRole('region', { name: 'Существующие записи по части исследований', exact: true });
  await expect(overlap.locator('.booking-card')).toHaveCount(2);
  await assertNoNewPicker(page);
  await cancelPartial(page);
  await expect(overlap.locator('.booking-card')).toHaveCount(1);
  await assertNoNewPicker(page);
  await cancelPartial(page);
  await expect(overlap).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Выбрать врача', exact: true })).toBeVisible();
  expect(modelRequests).toEqual([]);
});
