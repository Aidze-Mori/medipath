import { expect, test } from './test';
import { openDemoScenario } from './helpers';

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/patient');
  await openDemoScenario(page);
  await page.getByRole('button', { name: 'Подтвердить текст и создать маршрут' }).click();
});

test('booking keeps the route editable and completion focuses the summary', async ({ page }) => {
  await page.getByRole('button', { name: 'Выбрать врача' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: '09:00', exact: true }).first().click();
  await dialog.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await page.goBack();
  await expect(dialog.getByRole('heading', { name: 'Выберите врача' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Закрыть окно' }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole('button', { name: 'Выбрать врача' }).click();
  await dialog.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await dialog.getByRole('button', { name: 'Подтвердить демозапись' }).click();
  await expect(page.locator('.study-booked-label')).toContainText('Вы записаны');
  await page.locator('.route-study > summary').click();
  await expect(page.getByText('Демозапись создана. Клиника не получала заявку.')).toBeVisible();
  await expect.poll(() => page.evaluate(() => Boolean(history.state?.medipathOverlay))).toBe(false);
  await expect(page.getByRole('heading', { name: 'Ваш маршрут', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Маршрут завершён', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Завершить планирование', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Маршрут завершён', exact: true })).toBeFocused();
  await expect(page.getByRole('link', { name: 'Перейти к содержимому' })).not.toBeFocused();
  await expect(page).toHaveURL(/\/patient$/);
});

for (const dismissal of ['Escape', 'close'] as const) {
  test(`picker ${dismissal} restores focus to its opening button`, async ({ page }) => {
    const opener = page.getByRole('button', { name: 'Выбрать врача' });
    await opener.click();
    await expect(page.getByRole('dialog')).toBeVisible();
    if (dismissal === 'Escape') await page.keyboard.press('Escape');
    else await page.getByRole('button', { name: 'Закрыть окно' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => Boolean(history.state?.medipathOverlay))).toBe(false);
    await expect(opener).toBeFocused();
    await expect(page.getByText('Демозапись создана. Клиника не получала заявку.')).toHaveCount(0);
  });
}
