import { expect, test } from './test';
import { openDemoClinic } from './helpers';

test('clinic source correction invalidates current route and retains historical booking', async ({
  page,
}) => {
  await page.goto('/clinic');
  await openDemoClinic(page);
  await page.getByRole('button', { name: /Анна Соколова/ }).click();
  await expect(page.getByRole('button', { name: 'Исправить текст документа' })).toBeVisible();
  await page.getByRole('button', { name: 'Подготовить план посещений' }).click();
  await page.getByRole('button', { name: 'Выбрать врача' }).click();
  await page.getByRole('dialog').getByRole('button', { name: '09:00', exact: true }).first().click();
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await page.getByRole('button', { name: 'Подтвердить демозапись' }).click();
  await expect(page.locator('.route-study.is-booked')).not.toHaveAttribute('open');
  await page.locator('.route-study.is-booked > summary').click();
  await expect(page.getByText('Демозапись создана. Клиника не получала заявку.')).toBeVisible();
  await page.getByRole('tab', { name: /Медкарта/ }).click();
  await page.getByRole('button', { name: 'Исправить текст документа' }).click();
  await page.getByLabel('Рекомендации', { exact: true }).fill('Консультация пульмонолога не требуется.');
  await expect(page.getByRole('button', { name: 'Выбрать врача' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Подтвердить текст и создать маршрут' }).click();
  await expect(page.getByRole('button', { name: 'Выбрать врача' })).toHaveCount(0);
  await expect(page.getByText('Маршрут изменён.', { exact: false })).toBeVisible();
  await expect(page.getByText('Демозапись создана. Клиника не получала заявку.')).toBeVisible();
});
