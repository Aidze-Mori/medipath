import { expect, test } from './test';
import { openDemoScenario } from './helpers';
test('review gate, explicit demo booking and neutral calendar', async ({ page }) => {
  await page.goto('/patient');
  await openDemoScenario(page);
  await expect(page.getByRole('heading', { name: 'Проверьте текст исследования' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Выбрать врача' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Подтвердить текст и создать маршрут' }).click();
  await expect(page.getByRole('heading', { name: 'Ваш маршрут' })).toBeVisible();
  await page.getByRole('button', { name: 'Выбрать врача' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(/\/patient$/);
  await dialog
    .getByRole('button', { name: /^09:00$/ })
    .first()
    .click();
  await dialog.getByRole('button', { name: 'Продолжить' }).click();
  await expect(dialog.getByRole('heading', { name: 'Проверьте запись' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Подтвердить демозапись' }).click();
  await expect(page.locator('.study-booked-label')).toContainText('Вы записаны');
  await page.locator('.route-study > summary').click();
  await expect(page.getByText('Демозапись создана. Клиника не получала заявку.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Скачать событие календаря', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Маршрут завершён', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Завершить планирование', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Маршрут завершён', exact: true })).toBeVisible();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Скачать календарь маршрута', exact: true }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('medipath-plan.ics');
});
test('free edit is local and does not transmit personal canary', async ({ page }) => {
  const sent: string[] = [];
  page.on('request', (req) => {
    if (req.method() === 'POST') sent.push(req.postData() ?? '');
  });
  await page.goto('/patient');
  await openDemoScenario(page);
  await page.getByRole('textbox', { name: 'Другой контекст', exact: true }).fill('PRIVATE_CANARY_846398');
  await page.getByRole('button', { name: 'Подтвердить текст и создать маршрут' }).click();
  await expect(page.getByText('Локальная обработка', { exact: true }).first()).toBeVisible();
  expect(sent.every((value) => !value.includes('PRIVATE_CANARY'))).toBe(true);
  expect(await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length }))).toEqual(
    { local: 0, session: 0 },
  );
});

test('corrected second-page quote keeps page provenance and deadline range', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/patient');
  await page
    .getByLabel('Файл документа', { exact: true })
    .setInputFiles('tests/fixtures/document-intake/files/brain-mri-mixed-two-pages.pdf');
  await expect(page.getByRole('heading', { name: 'Проверьте распознанный текст' })).toBeVisible({
    timeout: 30000,
  });
  await page
    .getByLabel('Заключение', { exact: true })
    .fill('Рекомендована консультация пульмонолога через 3–6 месяцев.');
  await page.getByRole('button', { name: 'Подтвердить текст и создать маршрут' }).click();
  await expect(page.getByText('через 3–6 месяцев', { exact: true })).toBeVisible();
  await page.locator('.study-visit-evidence > summary').click();
  await expect(page.getByText('Исправленный текст', { exact: false }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Открыть исходный фрагмент · страница 2' }).click();
  await expect(page.getByRole('tab', { name: 'Исходный файл' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('img', { name: 'Исходный документ, страница 2' })).toBeVisible();
});
