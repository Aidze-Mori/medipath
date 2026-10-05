import { expect, test } from './test';
import { readFile } from 'node:fs/promises';
import { openDemoScenario } from './helpers';

for (const width of [1440, 390]) test(`reopening the same study keeps one document and one completed saved plan ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 920 });
  page.on('dialog', dialog => dialog.accept());
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/patient');
  for (let i = 0; i < 2; i++) {
    await openDemoScenario(page, 'chest-referral', 'local');
    await page.getByRole('button', { name: 'Подтвердить текст и создать маршрут', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Ваш маршрут', exact: true })).toBeVisible();
  }
  const nav = page.getByRole('navigation', { name: width < 768 ? 'Навигация на телефоне' : 'Основная навигация', exact: true });
  await nav.getByRole('button', { name: 'Моя медкарта', exact: true }).click();
  const selected = page.getByRole('checkbox', { name: 'Учесть в маршруте: КТ грудной клетки', exact: true });
  await expect(selected).toHaveCount(1);
  await selected.check();
  await page.getByRole('button', { name: 'Собрать маршрут', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Консультация пульмонолога', exact: true })).toHaveCount(1);
  await expect(page.locator('.route-study')).toHaveCount(1);
  await page.getByRole('button', { name: 'Выбрать позже', exact: true }).click();
  await page.getByRole('button', { name: 'Вернуть в план', exact: true }).click();
  await page.getByRole('button', { name: 'Выбрать врача', exact: true }).click();
  const picker = page.getByRole('dialog');
  await picker.getByRole('button', { name: '09:00', exact: true }).first().click();
  await picker.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await picker.getByRole('button', { name: 'Подтвердить демозапись', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Маршрут завершён', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Завершить планирование', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Маршрут завершён', exact: true })).toBeVisible();
  await expect(page.locator('.desktop-stepper li.done')).toHaveCount(4);
  await expect(page.locator('.mobile-stepper li.done')).toHaveCount(4);
  await expect(page.getByRole('button', { name: 'Завершить планирование', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Выбрать врача', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Вернуться к маршруту', exact: true })).toHaveCount(0);
  await expect(nav.getByRole('button', { name: 'Мои планы', exact: true })).toHaveAttribute('aria-current', 'page');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Скачать календарь маршрута', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('medipath-plan.ics');
  const ics = await readFile((await download.path())!, 'utf8');
  expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `docs/release/previews/completed-plan-${width}.png`, fullPage: true });
  await nav.getByRole('button', { name: 'Мои планы', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Мои планы', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Открыть план', exact: true })).toHaveCount(1);
  await page.getByRole('button', { name: 'Открыть план', exact: true }).click();
  await page.getByRole('button', { name: 'Редактировать маршрут', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Ваш маршрут', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Выбрать врача', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Завершить планирование', exact: true }).click();
  await nav.getByRole('button', { name: 'Новый маршрут', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Загрузите медицинское заключение', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  expect(errors).toEqual([]);
});

test('empty referral can be explicitly completed without phantom appointments', async ({ page }) => {
  await page.goto('/patient'); await openDemoScenario(page, 'chest-negative');
  await page.getByRole('button', { name: 'Подтвердить текст и создать маршрут', exact: true }).click();
  await page.getByRole('button', { name: 'Завершить планирование', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Маршрут завершён', exact: true })).toBeVisible();
  await expect(page.locator('.desktop-stepper li.done')).toHaveCount(4);
  await expect(page.getByRole('button', { name: 'Скачать календарь маршрута', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Выбрать врача', exact: true })).toHaveCount(0);
});

test('saved draft keeps a manual visit after selecting documents in the medical record', async ({ page }) => {
  await page.goto('/patient'); await openDemoScenario(page, 'chest-referral', 'local');
  await page.getByRole('button', { name: 'Подтвердить текст и создать маршрут', exact: true }).click();
  await page.getByRole('button', { name: 'Записаться ещё к врачу', exact: false }).click();
  await page.getByRole('button', { name: 'Добавить в план', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Терапевт', exact: true })).toBeVisible();
  const nav = page.getByRole('navigation', { name: 'Основная навигация', exact: true });
  await nav.getByRole('button', { name: 'Моя медкарта', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Учесть в маршруте: КТ грудной клетки', exact: true }).check();
  await nav.getByRole('button', { name: 'Мои планы', exact: true }).click();
  await page.getByRole('button', { name: 'Продолжить планирование', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Терапевт', exact: true })).toBeVisible();
});
