import { expect, test } from './test';
import { openDemoScenario, returnToWorkMode } from './helpers';

test('demo panel preserves the working document and limits mock booking to demo mode', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/patient');
  await expect(page.getByRole('button', { name: 'Открыть пример' })).toHaveCount(0);
  await page.getByText('Вставить текст документа', { exact: true }).click();
  await page.getByLabel('Текст документа', { exact: true }).fill(
    'Описание: Проверка сохранения рабочего документа WORKSPACE_ALPHA.\nЗаключение: Требуется сопоставление с прежним исследованием.\nРекомендации: Рекомендована консультация пульмонолога в течение 2 недель.',
  );
  await page.getByRole('button', { name: 'Перейти к проверке', exact: true }).click();
  await expect(page.getByLabel('Описание', { exact: true })).toHaveValue(/WORKSPACE_ALPHA/);
  await page.getByLabel('Описание', { exact: true }).fill('Рабочая правка WORKSPACE_BETA.');

  await openDemoScenario(page);
  await expect(page.getByLabel('Описание', { exact: true })).not.toHaveValue(/WORKSPACE_BETA/);
  await page.getByRole('button', { name: 'Подтвердить текст и создать маршрут' }).click();
  await expect(page.getByRole('button', { name: 'Выбрать врача' })).toBeVisible();

  await returnToWorkMode(page);
  await expect(page.getByLabel('Описание', { exact: true })).toHaveValue('Рабочая правка WORKSPACE_BETA.');
  await page.getByRole('button', { name: 'Подтвердить текст и создать маршрут' }).click();
  await expect(page.getByRole('heading', { name: 'Ваш маршрут', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Консультация пульмонолога', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Выбрать врача' })).toHaveCount(0);
  await expect(page.getByText('Демозапись создана. Клиника не получала заявку.')).toHaveCount(0);
  expect(await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length }))).toEqual({
    local: 0,
    session: 0,
  });
  await expect(page).toHaveURL(/\/patient$/);
});
