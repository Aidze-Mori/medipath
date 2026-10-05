import assert from 'node:assert/strict';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, expect } from '@playwright/test';
const bundle = process.env.MEDIPATH_SMOKE_BUNDLE
  ? pathToFileURL(resolve(process.env.MEDIPATH_SMOKE_BUNDLE)).href
  : new URL('../dist-server/server.mjs', import.meta.url).href;
const { createAppServer } = await import(bundle);

// Exercise the built files and production CSP, without credentials or external calls.
const server = createAppServer({ env: {}, host: '127.0.0.1', staticDir: process.env.MEDIPATH_SMOKE_STATIC });
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
const checks = [];
try {
  const response = await fetch(`${origin}/patient`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-security-policy'), /connect-src 'self'/);
  for (const path of ['/docs/plans/final-solution-plan.md', '/.env', '/server/http.ts', '/api/missing']) {
    assert.equal((await fetch(`${origin}${path}`)).status, 404);
  }
  const capabilities = await (await fetch(`${origin}/api/capabilities`)).json();
  assert.equal(capabilities.configured, false);
  assert.equal(capabilities.documentAnalysisAllowed, false);
  checks.push('Built routes, CSP, private-path 404s and disabled live configuration');
  browser = await chromium.launch({ channel: 'chrome' });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.setViewportSize({ width: 1440, height: 1000 });
  const errors = [];
  const externalRequests = [];
  const posts = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(`${message.text()} ${message.location().url}`); });
  context.on('request', (request) => {
    if (/^https?:/u.test(request.url()) && new URL(request.url()).origin !== origin) externalRequests.push(request.url());
    if (request.method() === 'POST') posts.push(request.url());
  });
  for (const file of ['public/examples/synthetic-chest-referral.pdf', 'tests/fixtures/document-intake/files/brain-mri-image-only.pdf']) {
    await page.goto(`${origin}/patient`);
    await page.getByLabel('Файл документа', { exact: true }).setInputFiles(file);
    await expect(page.getByRole('heading', { name: 'Проверьте распознанный текст' })).toBeVisible({ timeout: 60000 });
    assert.ok((await page.getByLabel('Описание', { exact: true }).inputValue()).length > 30);
    assert.ok((await page.getByLabel('Заключение', { exact: true }).inputValue()).length > 10);
    await expect(page.getByRole('button', { name: 'Выбрать врача' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Подтвердить текст и создать маршрут' }).click();
    await expect(page.getByRole('heading', { name: 'Ваш маршрут' })).toBeVisible();
  }
  checks.push('Native PDF and scanned PDF through production workers and review gate');
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await page.goto(`${origin}/patient`);
    await page.getByRole('button', { name: 'Демопанель', exact: true }).click();
    await page.getByRole('dialog').getByText('Дополнительные сценарии и настройки', { exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Проверить текст примера', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Проверьте текст исследования' })).toBeVisible();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    await page.getByRole('button', { name: 'Подтвердить текст и создать маршрут' }).click();
    await page.getByRole('button', { name: 'Выбрать врача' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    await dialog.getByRole('button', { name: '09:00', exact: true }).first().click();
    await dialog.getByRole('button', { name: 'Продолжить' }).click();
    await dialog.getByRole('button', { name: 'Подтвердить демозапись' }).click();
    await expect(page.locator('.study-booked-label')).toContainText('Вы записаны');
    await page.locator('.route-study > summary').click();
    await expect(page.getByText('Демозапись создана. Клиника не получала заявку.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Ваш маршрут', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Скачать событие календаря', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Завершить планирование', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Маршрут завершён', exact: true })).toBeFocused();
    if (width === 390) await expect(page.getByText('Маршрут завершён · 4 из 4 этапов', { exact: false })).toBeVisible();
    else await expect(page.locator('.desktop-stepper li.done')).toHaveCount(4);
    await expect(page.getByRole('button', { name: 'Скачать календарь маршрута', exact: true })).toHaveCount(1);
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Скачать календарь маршрута', exact: true }).click();
    assert.equal((await download).suggestedFilename(), 'medipath-plan.ics');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    checks.push(`${width}px patient review, compact doctor dialog, explicit booking and completed plan with one ICS download`);
    const navigation = width === 390 ? page.getByRole('navigation', { name: 'Навигация на телефоне' }) : page.locator('.sidebar');
    await navigation.getByRole('button', { name: 'Мои планы', exact: true }).click();
    await page.getByRole('button', { name: 'Открыть план', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Маршрут завершён', exact: true })).toBeVisible();
    await navigation.getByRole('button', { name: 'Записи', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Скачать все события календаря', exact: true })).toHaveCount(1);
    checks.push(`${width}px saved plans reopen and bookings expose one combined calendar`);
    await page.goto(`${origin}/clinic`);
    await expect(page.getByRole('button', { name: /Анна Соколова/ })).toHaveCount(0);
    await page.getByRole('button', { name: 'Демопанель', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Открыть учебную очередь', exact: true }).click();
    await page.getByRole('button', { name: /Анна Соколова/ }).click();
    await page.getByRole('button', { name: 'Запланировать звонок' }).click();
    await page.getByRole('dialog').getByLabel('Причина').fill('Проверка собранной версии');
    await page.getByRole('dialog').getByLabel('Срок', { exact: true }).fill('2026-10-10');
    await page.getByRole('button', { name: 'Сохранить задачу звонка' }).click();
    await expect(page.getByText('Проверка собранной версии', { exact: false }).first()).toBeVisible();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    checks.push(`Independent ${width}px clinic and contact task`);
  }
  assert.deepEqual(await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length })), { local: 0, session: 0 });
  assert.deepEqual(externalRequests, []);
  assert.deepEqual(posts, []);
  assert.deepEqual(errors, []);
  checks.push('No external requests, POSTs, persistent storage or runtime/console errors');
  console.log(JSON.stringify({ status: 'PASS', checks }, null, 2));
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
