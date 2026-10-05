import { expect, test } from './test';
import { chooseOption, openDemoScenario } from './helpers';
import { readFile } from 'node:fs/promises';

for (const width of [1440, 390]) test(`study grouping, stable drafts, cancellation and day calendar ${width}`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/patient');
  await openDemoScenario(page);
  await page.getByRole('button', { name: 'Подтвердить текст и создать маршрут', exact: true }).click();
  await page.getByRole('button', { name: /Записаться ещё к врачу/ }).click();
  await page.getByRole('button', { name: 'Добавить в план', exact: true }).click();
  const nav = page.getByRole('navigation', { name: width < 768 ? 'Навигация на телефоне' : 'Основная навигация', exact: true });
  for (let i = 0; i < 2; i++) {
    await nav.getByRole('button', { name: 'Моя медкарта', exact: true }).click();
    if (await page.getByRole('button', { name: 'Снять выделение', exact: true }).count()) await page.getByRole('button', { name: 'Снять выделение', exact: true }).click();
    await page.getByRole('button', { name: 'Выбрать все', exact: true }).click();
    await page.getByRole('button', { name: 'Собрать маршрут', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Терапевт', exact: true })).toBeVisible();
  }
  await nav.getByRole('button', { name: 'Мои планы', exact: true }).click();
  await expect(page.locator('.saved-plan')).toHaveCount(1);
  await page.getByRole('button', { name: 'Продолжить планирование', exact: true }).click();
  for (let i = 0; i < 2; i++) {
    await page.getByRole('button', { name: 'Выбрать врача', exact: true }).first().click();
    const picker = page.getByRole('dialog');
    if (i) await chooseOption(picker.getByRole('combobox', { name: 'Дата приёма' }), { index: 1 });
    await picker.getByRole('button', { name: '09:00', exact: true }).first().click();
    await picker.getByRole('button', { name: 'Продолжить', exact: true }).click();
    await picker.getByRole('button', { name: 'Подтвердить демозапись', exact: true }).click();
  }
  await expect(page.locator('.route-study')).not.toHaveAttribute('open');
  await expect(page.locator('.study-booked-label')).toContainText('Вы записаны');
  await page.getByRole('button', { name: 'Завершить планирование', exact: true }).click();
  await expect(page.locator('.booking-day')).toHaveCount(2);
  await page.getByRole('button', { name: 'Отменить запись', exact: true }).first().click();
  await page.getByRole('button', { name: 'Да, отменить запись', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Ваш маршрут', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Выбрать врача', exact: true })).toHaveCount(1);
  await page.getByRole('button', { name: 'Завершить планирование', exact: true }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Скачать календарь маршрута', exact: true }).click();
  const ics = await readFile((await (await downloadPromise).path())!, 'utf8');
  expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1);
  await page.evaluate(() => { (document.activeElement as HTMLElement)?.blur(); window.scrollTo(0, 0); });
  await page.screenshot({ path: `docs/release/previews/study-plan-round-three-${width}.png`, fullPage: true });
  await page.getByRole('button', { name: 'Удалить план', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Также отменить связанные записи', exact: true }).check();
  await page.getByRole('dialog').getByRole('button', { name: 'Удалить план', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Планов пока нет', exact: true })).toBeVisible();
  await nav.getByRole('button', { name: 'Записи', exact: true }).click();
  await expect(page.locator('.booking-card')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  expect(errors).toEqual([]);
});

test('same canonical study opened twice and then from clinic is not duplicated; multi-study route stays grouped', async ({ page }) => {
  await page.goto('/patient');
  for (let i = 0; i < 2; i++) {
    await openDemoScenario(page);
    await page.getByRole('button', { name: 'Подтвердить текст и создать маршрут', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Демопанель', exact: true }).click();
  await page.getByRole('button', { name: 'Результаты из клиники', exact: true }).click();
  await expect(page.locator('.results-row')).toHaveCount(3);
  await expect(page.getByRole('checkbox', { name: 'Учесть в маршруте: КТ грудной клетки', exact: true })).toHaveCount(1);
  await page.getByRole('button', { name: 'Выбрать все', exact: true }).click();
  await expect(page.getByRole('checkbox', { checked: true })).toHaveCount(3);
  await page.getByRole('button', { name: 'Снять выделение', exact: true }).click();
  await expect(page.getByRole('checkbox', { checked: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Выбрать все', exact: true }).click();
  await page.getByRole('button', { name: 'Собрать маршрут', exact: true }).click();
  await expect(page.locator('.route-study')).toHaveCount(3);
  await expect(page.locator('.route-study').filter({ hasText: 'КТ грудной клетки' }).getByRole('heading', { name: 'Консультация пульмонолога', exact: true })).toBeVisible();
  await expect(page.locator('.route-study').filter({ hasText: 'Маммография' }).getByRole('heading', { name: 'Консультация маммолога', exact: true })).toBeVisible();
});
