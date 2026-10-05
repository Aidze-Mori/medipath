import { expect, test } from './test';
import { openDemoScenario } from './helpers';

test('editing a selected source marks its booking as historical without changing the confirmed visit', async ({ page }) => {
  page.on('dialog', dialog => dialog.accept());
  await page.route('**/api/analyze*', route => route.abort());
  await page.goto('/patient');
  for (let index = 0; index < 2; index++) {
    await openDemoScenario(page, index ? 'breast-referral' : 'chest-referral', 'local');
    await page.getByRole('button', { name: 'Подтвердить текст и создать маршрут', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Ваш маршрут', exact: true })).toBeVisible();
  }
  const nav = page.getByRole('navigation', { name: 'Основная навигация', exact: true });
  await nav.getByRole('button', { name: 'Моя медкарта', exact: true }).click();
  const documents = page.getByRole('checkbox', { name: 'Учесть в маршруте: КТ грудной клетки', exact: true });
  await documents.check();
  await page.getByRole('checkbox', { name: 'Учесть в маршруте: Маммография', exact: true }).check();
  await page.getByRole('button', { name: 'Собрать маршрут', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Консультация пульмонолога', exact: true })).toHaveCount(1);
  await page.getByRole('button', { name: 'Выбрать врача', exact: true }).first().click();
  const picker = page.getByRole('dialog');
  await picker.getByRole('button', { name: '09:00', exact: true }).first().click();
  await picker.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await picker.getByRole('button', { name: 'Подтвердить демозапись', exact: true }).click();
  await page.getByRole('button', { name: 'Завершить планирование', exact: true }).click();
  const booking = page.locator('.booking-card');
  await expect(booking).toHaveCount(1);
  const originalFacts = await booking.locator('dl').innerText();
  const originalDoctor = await booking.locator('h4').innerText();
  const historical = 'Маршрут изменён. Эта запись сохранена как история прежних редакций документов.';
  await expect(page.getByText(historical, { exact: true })).toHaveCount(0);

  await nav.getByRole('button', { name: 'Моя медкарта', exact: true }).click();
  await page.getByRole('button', { name: 'Открыть результат: КТ грудной клетки', exact: true }).click();
  await page.getByRole('button', { name: 'Редактировать текст', exact: true }).click();
  await page.getByRole('textbox', { name: 'Заключение', exact: true }).fill('Синтетическая исправленная редакция заключения.');
  await nav.getByRole('button', { name: 'Записи', exact: true }).click();
  await expect(booking).toHaveCount(1);
  await expect(booking.getByText(historical, { exact: true })).toBeVisible();
  await expect(booking.locator('dl')).toHaveText(originalFacts, { useInnerText: true });
  await expect(booking.locator('h4')).toHaveText(originalDoctor);

  await nav.getByRole('button', { name: 'Мои планы', exact: true }).click();
  await page.getByRole('button', { name: 'Открыть план', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Маршрут завершён', exact: true })).toBeVisible();
  await expect(page.getByText('Один из документов изменён. Этот завершённый план сохранён как история прежней редакции.', { exact: true })).toBeVisible();
  await expect(booking.getByText(historical, { exact: true })).toBeVisible();
  await expect(booking.locator('dl')).toHaveText(originalFacts, { useInnerText: true });
});
