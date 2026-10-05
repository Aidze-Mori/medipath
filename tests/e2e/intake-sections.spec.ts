import { expect, test } from './test';

test('unclassified text is directly reviewable without creating clinical sections', async ({ page }) => {
  await page.goto('/patient');
  await page.getByLabel('Файл документа', { exact: true }).setInputFiles({
    name: 'synthetic-unclassified.txt', mimeType: 'text/plain',
    buffer: Buffer.from('Учебный текст неизвестного формата.\nНикакое медицинское заключение не добавлено.'),
  });
  const text = page.getByRole('textbox', { name: 'Текст документа', exact: true });
  await expect(text).toBeVisible();
  await expect(text).toHaveValue(/Учебный текст неизвестного формата/);
  await expect(text).toHaveAttribute('rows', '16');
  await expect(page.getByText('Добавить отсутствующий раздел', { exact: true })).toHaveCount(0);
  await expect(page.getByText(/Не нужно распределять текст по разделам вручную/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Подтвердить текст и создать маршрут' })).toBeEnabled();
});

for (const width of [1440, 390]) test(`PDF original expands and remains scrollable when zoomed at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 });
  await page.goto('/patient');
  await page.getByLabel('Файл документа', { exact: true }).setInputFiles('tests/fixtures/document-intake/files/brain-mri-native.pdf');
  await expect(page.getByRole('heading', { name: 'Проверьте распознанный текст' })).toBeVisible();
  if (width < 700) await page.getByRole('tab', { name: 'Оригинал', exact: true }).click();
  await page.getByRole('button', { name: 'Развернуть оригинал', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Оригинал документа', exact: true });
  await expect(dialog).toBeVisible();
  const image = dialog.getByRole('img', { name: 'Оригинал, страница 1', exact: true });
  expect((await image.boundingBox())!.width).toBeGreaterThan(width > 700 ? 800 : 250);
  await dialog.getByRole('button', { name: 'Увеличить оригинал', exact: true }).click();
  expect(await dialog.locator('.review-original-viewport').evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
  await dialog.getByRole('button', { name: 'По ширине', exact: true }).click();
  await page.screenshot({ path: test.info().outputPath('expanded-original.png') });
  await dialog.getByRole('button', { name: 'Закрыть окно', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Подтвердить текст и создать маршрут' })).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});
