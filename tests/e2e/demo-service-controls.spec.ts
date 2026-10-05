import { test, expect } from '@playwright/test';

for (const width of [1280, 390]) test(`service controls stay in demo panel at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await page.goto('/patient');
  await expect(page.getByRole('link', { name: 'Клинике', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Текущая сессия', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Демопанель', exact: true }).click();
  await page.getByRole('link', { name: 'Клинике', exact: true }).click();
  await expect(page).toHaveURL(/\/clinic$/);
  await expect(page.getByRole('heading', { name: 'Рабочее место клиники', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Демопанель', exact: true }).click();
  await page.getByRole('link', { name: 'Пациенту', exact: true }).click();
  await expect(page).toHaveURL(/\/patient$/);
  await page.getByRole('button', { name: 'Демопанель', exact: true }).click();
  await page.getByRole('button', { name: 'Текущая сессия', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Текущая сессия', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Начать новую сессию', exact: true })).toBeVisible();
});
