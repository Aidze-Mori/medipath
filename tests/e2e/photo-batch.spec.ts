import { test, expect } from './test';
import { readFile } from 'node:fs/promises';

test('mobile photo batch reorders, rotates, removes and really reads a corrected page', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/patient');
  const buffer = await readFile('public/examples/synthetic-chest-referral.png');
  await page.getByLabel('Фото документа', { exact: true }).setInputFiles([
    { name: 'page-first.png', mimeType: 'image/png', buffer },
    { name: 'page-second.png', mimeType: 'image/png', buffer },
  ]);
  const batch = page.getByRole('region', { name: 'Страницы документа' });
  await expect(batch.locator('.photo-page')).toHaveCount(2);
  await batch.getByRole('button', { name: 'Поднять страницу 2', exact: true }).click();
  await expect(batch.locator('.photo-filename').first()).toHaveText('page-second.png');
  await batch.getByRole('button', { name: 'Повернуть страницу 1 на 90 градусов', exact: true }).click();
  await expect(batch.locator('.photo-page').first()).toContainText('Поворот: 90°');
  for (let count = 0; count < 3; count++)
    await batch.getByRole('button', { name: 'Повернуть страницу 1 на 90 градусов', exact: true }).click();
  await expect(batch.locator('.photo-page').first()).toContainText('Поворот: 0°');
  await batch.getByRole('button', { name: 'Удалить страницу 2', exact: true }).click();
  await expect(batch.locator('.photo-page')).toHaveCount(1);
  await batch.getByRole('button', { name: 'Прочитать страницы · 1', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Проверьте распознанный текст' })).toBeVisible({
    timeout: 45_000,
  });
  await expect(page.getByLabel('Описание', { exact: true })).toHaveValue(/Плевральный выпот не выявлен/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

test('multiple PDF/TXT selection is rejected explicitly without selecting only the first file', async ({
  page,
}) => {
  await page.goto('/patient');
  await page.getByLabel('Файл документа', { exact: true }).setInputFiles([
    { name: 'first.txt', mimeType: 'text/plain', buffer: Buffer.from('Описание: Первый документ') },
    { name: 'second.txt', mimeType: 'text/plain', buffer: Buffer.from('Заключение: Второй документ') },
  ]);
  await expect(page.getByText(/Несколько файлов принимаются только как фотографии/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Проверьте распознанный текст' })).toHaveCount(0);
});

test('per-page rotation is applied before real OCR and preview rendering', async ({ page }) => {
  await page.goto('/examples/synthetic-chest-referral.txt');
  const result = await page.evaluate(async () => {
    const modulePath = '/src/features/intake/extract.ts';
    const { extractPhotoPages, disposeExtraction } = (await import(
      modulePath
    )) as typeof import('../../src/features/intake/extract');
    const blob = await (await fetch('/examples/synthetic-chest-referral.png')).blob();
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.height;
    canvas.height = bitmap.width;
    const context = canvas.getContext('2d')!;
    context.translate(canvas.width / 2, canvas.height / 2);
    context.rotate(Math.PI / 2);
    context.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);
    bitmap.close();
    const sideways = await new Promise<Blob>((resolve) =>
      canvas.toBlob((blob) => resolve(blob!), 'image/png'),
    );
    canvas.width = 0;
    canvas.height = 0;
    const extracted = await extractPhotoPages([
      { file: new File([sideways], 'sideways.png', { type: 'image/png' }), rotation: 270 },
    ]);
    const result = {
      text: extracted.text,
      unread: extracted.unreadAnchors,
      method: extracted.blocks[0].method,
    };
    disposeExtraction(extracted);
    return result;
  });
  expect(result.method).toBe('ocr');
  expect(result.unread).toEqual([]);
  expect(result.text).toMatch(/Плевральный выпот не выявлен/);
});
