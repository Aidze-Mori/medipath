import type { Locator } from '@playwright/test';
import { expect, type Page } from './test';

type DemoProcessing = 'local' | 'live' | 'replay';

async function openDemoPanel(page: Page) {
  await page.getByRole('button', { name: 'Демопанель', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Демопанель', exact: true });
  await expect(panel).toBeVisible();
  return panel;
}

export async function showAdvancedDemo(panel: Locator) {
  if (await panel.locator('.demo-advanced').getAttribute('open') === null)
    await panel.getByText('Дополнительные сценарии и настройки', { exact: true }).click();
}

export async function openDemoScenario(
  page: Page,
  fixtureId = 'chest-referral',
  processing: DemoProcessing = 'local',
) {
  const panel = await openDemoPanel(page);
  await panel.getByText('Дополнительные сценарии и настройки', { exact: true }).click();
  await chooseOption(panel.getByRole('combobox', { name: 'Сценарий пациента', exact: true }), fixtureId);
  await chooseOption(panel.getByRole('combobox', { name: 'Режим обработки примера', exact: true }), processing);
  await panel.getByRole('button', { name: 'Проверить текст примера', exact: true }).click();
  await expect(panel).toHaveCount(0);
}

export async function openDemoClinic(page: Page) {
  const panel = await openDemoPanel(page);
  await panel.getByRole('button', { name: 'Открыть учебную очередь', exact: true }).click();
  await expect(panel).toHaveCount(0);
}

export async function enableDemoWorkspace(page: Page, processing: DemoProcessing = 'local') {
  const panel = await openDemoPanel(page);
  await panel.getByText('Дополнительные сценарии и настройки', { exact: true }).click();
  await chooseOption(panel.getByRole('combobox', { name: 'Режим обработки примера', exact: true }), processing);
  await panel.getByRole('button', { name: 'Включить демонстрацию', exact: true }).click();
  await expect(panel).toHaveCount(0);
}

export async function returnToWorkMode(page: Page) {
  const panel = await openDemoPanel(page);
  await panel.getByRole('button', { name: 'Перейти в рабочий режим', exact: true }).click();
  await expect(panel).toHaveCount(0);
}

export async function chooseOption(control: Locator, value: string | { index: number }) {
  await control.click();
  const id = await control.getAttribute('aria-controls');
  const list = control.page().locator(`[id="${id}"]`);
  const options = list.getByRole('option');
  const index = typeof value === 'string' ? await options.evaluateAll((items, expected) => items.findIndex(item => item.getAttribute('data-value') === expected), value) : value.index;
  expect(index).toBeGreaterThanOrEqual(0);
  await options.nth(index).click();
}
