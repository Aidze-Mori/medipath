import { expect, test } from './test';

for (const width of [390, 768, 1440]) test(`three curated stories remain clear and keyboard accessible at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 960 });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/patient');
  await page.getByRole('button', { name: 'Демопанель', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Демопанель', exact: true });
  await expect(panel.locator('.demo-case-grid > article')).toHaveCount(3);
  await expect(panel.getByRole('heading', { name: 'Результат из «Третьего Мнения»', exact: true })).toBeVisible();
  await expect(panel.getByRole('heading', { name: 'Большой отчёт врача', exact: true })).toBeVisible();
  await expect(panel.getByRole('heading', { name: 'Срочный результат', exact: true })).toBeVisible();
  await expect(panel.locator('.demo-story-outcome')).toHaveCount(3);
  await expect(panel.locator('.demo-case-grid .demo-journey')).toHaveCount(3);
  await expect(panel.locator('.demo-advanced')).not.toHaveAttribute('open');
  await expect(panel.getByRole('button', { name: 'Открыть противоречие', exact: true })).toBeHidden();
  await expect(panel.getByRole('button', { name: 'Запустить полную демонстрацию', exact: true })).toBeDisabled();
  await expect(panel.getByRole('button', { name: 'Открыть PDF без внешнего AI', exact: true })).toBeEnabled();
  await expect(panel.locator('.demo-case-grid')).toContainText('Подготовленный пример · без внешнего AI');
  expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await page.screenshot({ path: `docs/release/previews/demo-curated-${width}.png` });
  const advanced = panel.getByText('Дополнительные сценарии и настройки', { exact: true });
  await advanced.focus();
  await page.keyboard.press('Enter');
  await expect(panel.getByRole('button', { name: 'Открыть противоречие', exact: true })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Получить уведомление', exact: true })).toBeVisible();
  await expect(panel.getByRole('combobox', { name: 'Сценарий пациента', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Демопанель', exact: true })).toBeFocused();
  await expect(page.getByRole('heading', { name: 'Загрузите медицинское заключение', exact: true })).toBeVisible();
  await expect(page.getByLabel('Файл документа', { exact: true })).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  expect(errors).toEqual([]);
});

for (const [width, height] of [[1280, 720], [1440, 800]]) test(`all three starting actions fit above the fold at ${width}x${height}`, async ({ page }) => {
  await page.setViewportSize({ width, height });
  await page.goto('/patient');
  await page.getByRole('button', { name: 'Демопанель', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Демопанель', exact: true });
  await expect(panel.getByRole('button', { name: 'Открыть результат Третьего Мнения', exact: true })).toBeInViewport({ ratio: 1 });
  await expect(panel.getByRole('button', { name: 'Открыть PDF без внешнего AI', exact: true })).toBeInViewport({ ratio: 1 });
  await expect(panel.getByRole('button', { name: 'Открыть срочный результат', exact: true })).toBeInViewport({ ratio: 1 });
  await page.screenshot({ path: `docs/release/previews/demo-curated-${width}x${height}.png` });
});
