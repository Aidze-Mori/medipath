import { expect, test } from './test';
import { openDemoClinic } from './helpers';
test('clinic is independent; explicit contact task changes metrics', async ({ page }) => {
  await page.goto('/clinic');
  await openDemoClinic(page);
  await expect(page.getByRole('heading', { name: 'Рабочее место клиники' })).toBeVisible();
  await page.getByRole('button', { name: /Анна Соколова/ }).click();
  await page.getByRole('button', { name: 'Запланировать звонок' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Причина').fill('Уточнить удобное время приёма');
  await dialog.getByLabel('Срок', { exact: true }).fill('2026-10-10');
  await dialog.getByRole('button', { name: 'Сохранить задачу звонка' }).click();
  await expect(page.getByText('Уточнить удобное время приёма', { exact: false }).first()).toBeVisible();
  await expect(page.getByText('Сообщение не отправлялось.', { exact: false }).first()).toBeVisible();
});
for (const width of [320, 360, 390, 430, 768, 1024, 1440, 1536])
  test(`responsive ${width}px both roles`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    for (const path of ['/patient', '/clinic']) {
      await page.goto(path);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(
        true,
      );
    }
  });
