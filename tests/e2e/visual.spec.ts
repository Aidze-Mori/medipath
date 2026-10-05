import { expect, test } from './test';
import { mkdir } from 'node:fs/promises';
import { enableDemoWorkspace, openDemoClinic } from './helpers';
const capture = 'docs/release/previews';
test('desktop reference states and mobile complete patient flow', async ({ page }) => {
  await mkdir(capture, { recursive: true });
  await page.setViewportSize({ width: 1536, height: 1024 });
  await page.goto('/patient');
  await page.screenshot({ path: `${capture}/patient-upload-desktop.png`, fullPage: true });
  await page.getByRole('button', { name: 'Демопанель', exact: true }).click();
  const demoPanel = page.getByRole('dialog', { name: 'Демопанель', exact: true });
  await expect(demoPanel).toBeVisible();
  await page.screenshot({ path: `${capture}/demo-panel.png` });
  await demoPanel.getByText('Дополнительные сценарии и настройки', { exact: true }).click();
  await demoPanel.getByRole('button', { name: 'Проверить текст примера', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Проверьте текст исследования' })).toBeVisible();
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.screenshot({ path: `${capture}/patient-review-desktop.png`, fullPage: true });
  await page.getByRole('button', { name: 'Подтвердить текст и создать маршрут' }).click();
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.screenshot({ path: `${capture}/patient-route-desktop.png`, fullPage: true });
  await page.getByRole('button', { name: 'Выбрать врача' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(
    await page.getByRole('dialog').evaluate((el) => el.getBoundingClientRect().width),
  ).toBeLessThanOrEqual(640);
  await page.screenshot({ path: `${capture}/doctor-picker-desktop.png` });
  await page.getByRole('dialog').getByRole('button', { name: '09:00', exact: true }).first().click();
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await page.goBack();
  await expect(page.getByRole('dialog').getByRole('heading', { name: 'Выберите врача' })).toBeVisible();
  await page.getByRole('button', { name: 'Закрыть окно' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Выбрать врача' }).click();
  await expect(
    page.getByRole('dialog').getByRole('button', { name: '09:00', exact: true }).first(),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.screenshot({ path: `${capture}/doctor-picker-mobile.png` });
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await page.getByRole('button', { name: 'Подтвердить демозапись' }).click();
  await expect(page.locator('.route-study.is-booked')).not.toHaveAttribute('open');
  await page.locator('.route-study.is-booked > summary').click();
  await expect(page.getByText('Демозапись создана. Клиника не получала заявку.')).toBeVisible();
  await expect.poll(() => page.evaluate(() => Boolean(history.state?.medipathOverlay))).toBe(false);
  await expect(page.getByRole('heading', { name: 'Ваш маршрут', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Завершить планирование', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Маршрут завершён', exact: true })).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  // Capture from the page origin: fullPage can include offscreen fixed elements at a scrolled offset.
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.screenshot({ path: `${capture}/patient-booked-mobile.png`, fullPage: true });
  await page.setViewportSize({ width: 1536, height: 1024 });
  await page.goto('/clinic');
  await page.screenshot({ path: `${capture}/clinic-work-desktop.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await openDemoClinic(page);
  await page.getByRole('button', { name: /Анна Соколова/ }).click();
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.screenshot({ path: `${capture}/clinic-detail-mobile.png`, fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.setViewportSize({ width: 1536, height: 1024 });
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.screenshot({ path: `${capture}/clinic-desktop.png`, fullPage: true });
});
test('verified file intake, replay, correction and reset during work', async ({ page }) => {
  await page.goto('/patient');
  await enableDemoWorkspace(page, 'replay');
  await page
    .getByLabel('Файл документа', { exact: true })
    .setInputFiles('public/examples/synthetic-chest-referral.pdf');
  await expect(page.getByRole('heading', { name: 'Проверьте распознанный текст' })).toBeVisible();
  // Processing mode belongs to the service panel; selected replay persists into normal review.
  await expect(page.getByLabel('Обработка учебного примера')).toHaveCount(0);
  await page.getByRole('button', { name: 'Подтвердить текст и создать маршрут' }).click();
  await expect(page.getByText('Сохранённый учебный шаблон', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Открыть исследование' }).click();
  await page.getByRole('button', { name: 'Сверить с оригиналом', exact: true }).click();
  await page.getByLabel('Рекомендации', { exact: true }).fill('Консультация пульмонолога не требуется.');
  await expect(page.getByLabel('Обработка учебного примера')).toHaveCount(0);
  await page.getByRole('button', { name: 'Подтвердить текст и создать маршрут' }).click();
  await expect(page.getByRole('heading', { name: 'В документе нет явного направления' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Выбрать врача' })).toHaveCount(0);
});
