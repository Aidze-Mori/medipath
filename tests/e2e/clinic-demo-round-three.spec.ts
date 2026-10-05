import { expect, test } from './test';
import { chooseOption, openDemoClinic, showAdvancedDemo } from './helpers';

for (const width of [390, 1440]) test(`clinic breadcrumbs preserve patient filters at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 960 });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/clinic');
  await openDemoClinic(page);
  await page.getByRole('textbox', { name: 'Поиск пациента' }).fill('Соколова');
  await page.locator('.clinic-status-filters').getByRole('button', { name: 'Новый результат', exact: true }).click();
  await expect(page.locator('.clinic-patient-row')).toHaveCount(1);
  await page.getByRole('button', { name: /Анна Соколова/ }).click();
  const crumbs = page.getByRole('navigation', { name: 'Хлебные крошки клиники', exact: true });
  await expect(crumbs.locator('[aria-current="page"]')).toHaveText('Анна Соколова');
  await page.screenshot({ path: `docs/release/previews/clinic-breadcrumbs-${width}.png`, fullPage: true });
  await crumbs.getByRole('button', { name: 'Рабочее место клиники', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('textbox', { name: 'Поиск пациента' })).toHaveValue('Соколова');
  await expect(page.locator('.clinic-status-filters').getByRole('button', { name: 'Новый результат', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: /Анна Соколова/ }).click();
  if (width < 768) {
    await page.getByRole('button', { name: 'Открыть меню', exact: true }).click();
    await page.getByRole('dialog', { name: 'Меню', exact: true }).getByRole('button', { name: 'Пациенты', exact: true }).click();
  } else await page.getByRole('navigation', { name: 'Основная навигация', exact: true }).getByRole('button', { name: 'Пациенты', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Поиск пациента' })).toHaveValue('Соколова');
  await expect(page.locator('.clinic-patient-row')).toHaveCount(1);
  await crumbs.getByRole('button', { name: 'MediPath', exact: true }).click();
  await expect(page).toHaveURL(/\/patient$/);
  await expect(page.getByRole('heading', { name: 'Здесь появятся ваши документы', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Демопанель', exact: true }).click();
  await page.getByRole('link', { name: 'Клинике', exact: true }).first().click();
  await expect(page.getByRole('textbox', { name: 'Поиск пациента' })).toHaveValue('Соколова');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  expect(errors).toEqual([]);
});

test('clinic cancellation bridge updates status, history and permits a fresh appointment', async ({ page }) => {
  await page.goto('/clinic');
  await openDemoClinic(page);
  await page.getByRole('button', { name: /Анна Соколова/ }).click();
  await page.getByRole('button', { name: 'Подготовить план посещений', exact: true }).click();
  const book = async () => {
    await page.getByRole('button', { name: 'Выбрать врача', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: '09:00', exact: true }).first().click();
    await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
    await page.getByRole('button', { name: 'Подтвердить демозапись', exact: true }).click();
  };
  await book();
  await expect(page.locator('.clinic-case-heading').getByText('Записан', { exact: true })).toBeVisible();
  // Patient and clinic have separate document instances. Exercise the exact public
  // same-tab bridge contract without depending on the patient's booking UI here.
  const cancelledId = await page.evaluate(async () => {
    const modulePath = performance.getEntriesByType('resource').map(entry => entry.name).find(name => /\/src\/features\/demo\/bridge\.ts(?:\?|$)/.test(name));
    if (!modulePath) throw new Error('Loaded demo bridge module not found');
    const bridge = await import(modulePath);
    const booking = bridge.getActiveDemoBookings(bridge.getDemoActivities())[0];
    bridge.publishDemoActivity({ fixtureId: booking.fixtureId, documentRevision: booking.documentRevision, bookingId: booking.bookingId, stepId: booking.stepId, contextRevision: 2, kind: 'booking_cancelled' });
    return booking.bookingId;
  });
  await expect(page.locator('.clinic-case-heading').getByText('Запись отменена', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Предложить план посещений', exact: true })).toBeEnabled();
  await page.getByRole('tab', { name: 'История действий', exact: true }).click();
  await expect(page.getByText('Запись отменена пациентом', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'План посещений', exact: true }).click();
  await book();
  await expect(page.locator('.clinic-case-heading').getByText('Записан', { exact: true })).toBeVisible();
  const activeIds = await page.evaluate(async () => {
    const modulePath = performance.getEntriesByType('resource').map(entry => entry.name).find(name => /\/src\/features\/demo\/bridge\.ts(?:\?|$)/.test(name));
    if (!modulePath) throw new Error('Loaded demo bridge module not found');
    const bridge = await import(modulePath);
    return bridge.getActiveDemoBookings(bridge.getDemoActivities()).map((event: { bookingId: string }) => event.bookingId);
  });
  expect(activeIds).toHaveLength(1);
  expect(activeIds[0]).not.toBe(cancelledId);
});

const preparedCases = [
  { action: 'Открыть явное направление', title: 'КТ грудной клетки', doctors: 1 },
  { action: 'Открыть неполный результат', title: 'Неполный документ', doctors: 0 },
  { action: 'Открыть противоречие', title: 'Несогласованные разделы', doctors: 0 },
  { action: 'Открыть результат без направления', title: 'Рентген без направления', doctors: 0 },
  { action: 'Открыть отрицательную рекомендацию', title: 'Направление отрицается', doctors: 0 },
];
for (const item of preparedCases) test(`prepared model case uses the clinic intake: ${item.title}`, async ({ page }) => {
  const externalCalls: string[] = [];
  page.on('request', request => { if (/\/api\/analyze(?:-demo|-document)?(?:\?|$)/.test(request.url())) externalCalls.push(request.url()); });
  await page.goto('/patient');
  await page.getByRole('button', { name: 'Демопанель', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Демопанель', exact: true });
  await expect(panel.locator('.demo-case-grid > article')).toHaveCount(3);
  if (item.action === 'Открыть явное направление') {
    await panel.getByRole('heading', { name: 'Три истории пациента', exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: 'docs/release/previews/demo-case-cards-round-three.png' });
  }
  await expect(panel.getByText('AI-сервер пока не настроен. Локальные сценарии доступны ниже.', { exact: true })).toBeVisible();
  await showAdvancedDemo(panel);
  await panel.getByRole('button', { name: item.action, exact: true }).click();
  const result = page.getByRole('article', { name: item.title, exact: true });
  await expect(result).toBeVisible();
  await expect(result).toContainText('Источник клиники проверен');
  await expect(page.getByRole('button', { name: 'Подтвердить текст и создать маршрут', exact: true })).toHaveCount(0);
  await page.getByRole('checkbox', { name: `Учесть в маршруте: ${item.title}`, exact: true }).check();
  await page.getByRole('button', { name: 'Собрать маршрут', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Ваш маршрут', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Выбрать врача', exact: true })).toHaveCount(item.doctors);
  expect(externalCalls).toEqual([]);
});

test('advanced scenario defaults to a clinic result while text review remains explicit', async ({ page }) => {
  await page.goto('/patient');
  await page.getByRole('button', { name: 'Демопанель', exact: true }).click();
  let panel = page.getByRole('dialog', { name: 'Демопанель', exact: true });
  await panel.getByText('Дополнительные сценарии и настройки', { exact: true }).click();
  await chooseOption(panel.getByRole('combobox', { name: 'Сценарий пациента', exact: true }), 'unsupported-text');
  await panel.getByRole('button', { name: 'Открыть сценарий', exact: true }).click();
  await expect(page.getByRole('article', { name: 'Нет медицинского основания', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Подтвердить текст и создать маршрут', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Демопанель', exact: true }).click();
  panel = page.getByRole('dialog', { name: 'Демопанель', exact: true });
  await panel.getByText('Дополнительные сценарии и настройки', { exact: true }).click();
  await panel.getByRole('button', { name: 'Проверить текст примера', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Подтвердить текст и создать маршрут', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Проверьте текст исследования', exact: true })).toBeVisible();
});
