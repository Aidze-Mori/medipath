import { expect, test, type Page } from './test';

const syntheticText = 'Описание исследования:\nУчебный пример. Лёгкие расправлены. Очаговых изменений не выявлено.\nЗаключение:\nУчебное исследование без очаговых изменений.\nРекомендации:\nРекомендована консультация пульмонолога.';
const longName = '2026_10_05_Синтетический_результат_лучевой_диагностики_с_длинным_названием_исследования_для_проверки_адаптивности.txt';

function navigation(page: Page, width: number) {
  return page.getByRole('navigation', { name: width < 768 ? 'Навигация на телефоне' : 'Основная навигация', exact: true });
}

async function installSyntheticAnalysis(page: Page) {
  const calls: unknown[] = [];
  await page.route('**/api/capabilities', route => route.fulfill({ json: { provider: 'codex_cli', configured: true, documentAnalysisAllowed: true, reason: 'ready' } }));
  await page.route('**/api/analyze-document', async route => {
    const request = route.request().postDataJSON();
    calls.push(request);
    await route.fulfill({ json: {
      binding: { requestId: request.requestId, documentRevision: request.documentRevision, contentDigest: request.contentDigest },
      explanation: {
        summary: 'Пояснение подготовлено по тексту учебного документа.',
        findings: [{ sectionId: request.sections[0].id, quote: request.sections[0].text, explanation: 'В этом фрагменте сохранено описание исходного исследования.' }],
      },
    } });
  });
  return calls;
}

test('custom menu supports keyboard choice and Escape without closing its parent dialog', async ({ page }) => {
  await page.goto('/patient');
  await page.getByRole('button', { name: 'Демопанель', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Демопанель', exact: true });
  await panel.getByText('Дополнительные сценарии и настройки', { exact: true }).click();
  const control = panel.getByRole('combobox', { name: 'Режим обработки примера', exact: true });
  const initialText = await control.innerText();
  await control.focus();
  await control.press('Enter');
  await expect(control).toHaveAttribute('aria-expanded', 'true');
  const listId = await control.getAttribute('aria-controls');
  await expect(panel.locator(`[id="${listId}"]`)).toBeVisible();
  await control.press('ArrowDown');
  await control.press('Escape');
  await expect(control).toHaveAttribute('aria-expanded', 'false');
  await expect(panel).toBeVisible();
  await expect(control).toBeFocused();
  await expect(control).toHaveText(initialText);
  await control.press('End');
  await control.press('Enter');
  await expect(control).toContainText('Сохранённый');
  await expect(control).toHaveAttribute('aria-expanded', 'false');
  await expect(panel).toBeVisible();
  await control.press('Home');
  await control.press('Enter');
  await expect(control).toContainText('Локальный');
  await control.press('Escape');
  await expect(panel).toHaveCount(0);
});

for (const width of [1440, 390]) {
  test(`saving does not analyze or build; later route and long file name stay usable at ${width}px`, async ({ page }) => {
    const calls = await installSyntheticAnalysis(page);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width, height: 960 });
    await page.goto('/patient');
    const nav = navigation(page, width);
    await page.getByLabel('Файл документа', { exact: true }).setInputFiles({ name: longName, mimeType: 'text/plain', buffer: Buffer.from(syntheticText) });
    await expect(page.getByLabel('Описание', { exact: true })).toHaveValue(/Лёгкие расправлены/);
    await page.getByRole('button', { name: 'Подтвердить и сохранить', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Ваши результаты', exact: true })).toBeVisible();
    const entry = page.getByRole('article', { name: longName, exact: true });
    await expect(entry).toContainText('Текст подтверждён');
    expect(calls).toEqual([]);
    await expect(page.getByRole('region', { name: 'AI-пояснение документа', exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await nav.getByRole('button', { name: 'Мои планы', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Планов пока нет', exact: true })).toBeVisible();
    expect(calls).toEqual([]);
    await nav.getByRole('button', { name: 'Моя медкарта', exact: true }).click();
    await page.getByRole('checkbox', { name: `Учесть в маршруте: ${longName}`, exact: true }).check();
    await page.getByRole('button', { name: 'Собрать маршрут', exact: true }).click();
    await expect(page.getByRole('region', { name: 'AI-пояснение документа', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Консультация пульмонолога', exact: true })).toBeVisible();
    expect(calls).toHaveLength(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    // The source action must not overlap the long filename, even where wrapping occurs.
    const sourceRow = page.locator('.route-document-row').filter({ hasText: longName });
    await expect(sourceRow).toHaveCount(1);
    const boxes = await sourceRow.evaluate(element => [...element.querySelectorAll('strong, button')].map(node => {
      const rect = node.getBoundingClientRect();
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
    }));
    expect(boxes).toHaveLength(2);
    expect(boxes[0].right <= boxes[1].left || boxes[0].bottom <= boxes[1].top || boxes[1].bottom <= boxes[0].top).toBe(true);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `docs/release/previews/patient-round-two-${width}.png`, fullPage: true });
    await page.getByRole('button', { name: 'Завершить планирование', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Маршрут завершён', exact: true })).toBeVisible();
    await nav.getByRole('button', { name: 'Мои планы', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Открыть план', exact: true })).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    expect(errors).toEqual([]);
  });
}

test('typed document deletion can be cancelled and removes linked plans while keeping another document', async ({ page }) => {
  const calls = await installSyntheticAnalysis(page);
  await page.goto('/patient');
  const nav = navigation(page, 1440);
  const firstName = 'synthetic-delete-with-plan.txt';
  const secondName = 'synthetic-keep.txt';
  await page.getByLabel('Файл документа', { exact: true }).setInputFiles({ name: firstName, mimeType: 'text/plain', buffer: Buffer.from(syntheticText) });
  await page.getByRole('button', { name: 'Подтвердить текст и создать маршрут', exact: true }).click();
  await page.getByRole('button', { name: 'Завершить планирование', exact: true }).click();
  await nav.getByRole('button', { name: 'Моя медкарта', exact: true }).click();
  await page.getByRole('button', { name: 'Добавить документ', exact: true }).click();
  await page.getByLabel('Файл документа', { exact: true }).setInputFiles({ name: secondName, mimeType: 'text/plain', buffer: Buffer.from(syntheticText.replace('пульмонолога', 'терапевта')) });
  await page.getByRole('button', { name: 'Подтвердить и сохранить', exact: true }).click();
  expect(calls).toHaveLength(1);
  await page.getByRole('button', { name: `Открыть результат: ${firstName}`, exact: true }).click();
  await page.getByRole('button', { name: 'Удалить документ', exact: true }).click();
  let confirmation = page.getByRole('dialog', { name: 'Удалить документ?', exact: true });
  await expect(confirmation.getByRole('button', { name: 'Удалить документ', exact: true })).toBeDisabled();
  await confirmation.getByRole('textbox', { name: 'Введите слово УДАЛЕНИЕ', exact: true }).fill('удалить');
  await expect(confirmation.getByRole('button', { name: 'Удалить документ', exact: true })).toBeDisabled();
  await confirmation.getByRole('button', { name: 'Отмена', exact: true }).click();
  await nav.getByRole('button', { name: 'Мои планы', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Открыть план', exact: true })).toHaveCount(1);
  await nav.getByRole('button', { name: 'Моя медкарта', exact: true }).click();
  await expect(page.getByRole('article', { name: firstName, exact: true })).toBeVisible();
  await page.getByRole('button', { name: `Открыть результат: ${firstName}`, exact: true }).click();
  await page.getByRole('button', { name: 'Удалить документ', exact: true }).click();
  confirmation = page.getByRole('dialog', { name: 'Удалить документ?', exact: true });
  await expect(confirmation.getByRole('textbox', { name: 'Введите слово УДАЛЕНИЕ', exact: true })).toHaveValue('');
  await confirmation.getByRole('textbox', { name: 'Введите слово УДАЛЕНИЕ', exact: true }).fill('УДАЛЕНИЕ');
  await confirmation.getByRole('button', { name: 'Удалить документ', exact: true }).click();
  await expect(confirmation).toHaveCount(0);
  await expect(page.getByRole('article', { name: firstName, exact: true })).toHaveCount(0);
  await expect(page.getByRole('article', { name: secondName, exact: true })).toBeVisible();
  await nav.getByRole('button', { name: 'Мои планы', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Планов пока нет', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Открыть план', exact: true })).toHaveCount(0);
  expect(calls).toHaveLength(1);
});
