import { expect, test, type Page } from './test';
import { openDemoScenario } from './helpers';

// Authored synthetic source only: Chromium creates a real two-page PDF in
// memory. No user file, fixture copied from a patient or external AI is used.
const twoPageStudy = `<!doctype html><html lang="ru"><meta charset="utf-8"><style>
body{font:14px Arial,sans-serif;margin:40px;color:#111}h1{font-size:22px}h2{font-size:17px;margin:24px 0 12px}p{line-height:1.6}.page-two{break-before:page}
</style><h1>Синтетическое исследование для проверки интерфейса</h1>
<p>Место проведения: Учебный диагностический центр</p><p>Дата исследования: 05.10.2026</p>
<h2>Описание</h2><p>Срединные структуры мозга не смещены. Ширина третьего желудочка — до 3 мм.</p>
<section class="page-two"><h2>Заключение</h2><p>КТ-признаков кровоизлияния не выявлено.</p>
<h2>Рекомендации</h2><p>Дообследование не требуется.</p></section></html>`;

function observe(page: Page) {
  const errors: string[] = [];
  const analysisCalls: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (request.url().includes('/api/analyze')) analysisCalls.push(request.url()); });
  return { errors, analysisCalls };
}

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
}

async function capture(page: Page, name: string) {
  await page.evaluate(() => { (document.activeElement as HTMLElement | null)?.blur(); window.scrollTo(0, 0); });
  await page.screenshot({ path: `docs/release/previews/${name}.png`, fullPage: true });
}

for (const width of [1440, 390]) {
  test(`route evidence opens page two of the full PDF without an OCR round trip at ${width}px`, async ({ page }) => {
    const observed = observe(page);
    await page.setContent(twoPageStudy.replace('Место проведения:', 'Медицинская организация:').replace('Дообследование не требуется.', 'Рекомендована консультация пульмонолога через 3–6 месяцев.'));
    const pdf = await page.pdf({ format: 'A4' });
    await page.setViewportSize({ width, height: 960 });
    await page.goto('/patient');
    await page.getByLabel('Файл документа', { exact: true }).setInputFiles({ name: 'synthetic-source-page-two.pdf', mimeType: 'application/pdf', buffer: pdf });
    await expect(page.getByLabel('Рекомендации', { exact: true })).toHaveValue('Рекомендована консультация пульмонолога через 3–6 месяцев.');
    await page.getByRole('button', { name: 'Подтвердить текст и создать маршрут', exact: true }).click();
    await page.locator('.study-visit-evidence > summary').click();
    await page.getByRole('button', { name: 'Показать в оригинале', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Проверка документа', exact: true })).toHaveCount(0);
    if (width < 768) await expect(page.getByRole('tab', { name: 'Исходный файл', exact: true })).toHaveAttribute('aria-selected', 'true');
    const source = page.getByRole('region', { name: 'Полный исходный документ', exact: true });
    const viewport = source.locator(':scope > .study-original-viewport');
    await expect(source.getByRole('img')).toHaveCount(2);
    await expect.poll(() => viewport.evaluate(container => {
      const target = container.querySelector('[data-source-page="2"]')!;
      const top = target.getBoundingClientRect().top - container.getBoundingClientRect().top;
      return top >= 0 && top < container.clientHeight / 2;
    })).toBe(true);
    expect(await viewport.evaluate(container => container.scrollTop)).toBeGreaterThan(100);
    await noOverflow(page);
    await source.getByRole('button', { name: 'Развернуть', exact: true }).click();
    const expanded = page.getByRole('dialog', { name: 'Исходный документ', exact: true });
    await expect.poll(() => expanded.locator('.study-original-viewport').evaluate(container => {
      const target = container.querySelector('[data-source-page="2"]')!;
      const top = target.getBoundingClientRect().top - container.getBoundingClientRect().top;
      return top >= 0 && top < container.clientHeight / 2;
    })).toBe(true);
    expect(observed.analysisCalls).toEqual([]);
    expect(observed.errors).toEqual([]);
  });

  test(`saved PDF keeps the complete original beside its source sections at ${width}px`, async ({ page }) => {
    const observed = observe(page);
    await page.setContent(twoPageStudy);
    const pdf = await page.pdf({ format: 'A4' });
    await page.setViewportSize({ width, height: 960 });
    await page.goto('/patient');
    await page.getByLabel('Файл документа', { exact: true }).setInputFiles({ name: 'synthetic-study-two-pages.pdf', mimeType: 'application/pdf', buffer: pdf });
    await expect(page.getByLabel('Описание', { exact: true })).toHaveValue(/Срединные структуры мозга не смещены/);
    await expect(page.getByLabel('Заключение', { exact: true })).toHaveValue('КТ-признаков кровоизлияния не выявлено.');
    await expect(page.getByLabel('Рекомендации', { exact: true })).toHaveValue('Дообследование не требуется.');
    if (width < 768) await page.getByRole('tab', { name: 'Оригинал', exact: true }).click();
    await expect(page.getByRole('img', { name: 'Оригинал, страница 1', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Следующая страница', exact: true }).click();
    await expect(page.getByRole('img', { name: 'Оригинал, страница 2', exact: true })).toBeVisible();
    if (width < 768) await page.getByRole('tab', { name: 'Распознанный текст', exact: true }).click();
    await page.getByRole('button', { name: 'Подтвердить и сохранить', exact: true }).click();
    await page.getByRole('button', { name: 'Открыть результат: synthetic-study-two-pages.pdf', exact: true }).click();

    const source = page.getByRole('region', { name: 'Полный исходный документ', exact: true });
    const text = page.getByRole('region', { name: 'Текст исследования', exact: true });
    await expect(text).toBeVisible();
    const fields = text.getByRole('region', { name: 'Поля исследования', exact: true });
    await expect(fields.locator('.study-source-field[open]')).toHaveCount(0);
    await expect(fields.locator('.is-recommendation')).toContainText('Дообследование не требуется.');
    await fields.locator('.study-source-field > summary').filter({ hasText: /^Описание$/ }).click();
    await fields.locator('.study-source-field > summary').filter({ hasText: /^Заключение$/ }).click();
    await expect(fields.locator('.study-source-field[open]')).toHaveCount(2);
    await noOverflow(page);
    await capture(page, `source-study-pdf-text-${width}`);

    if (width < 768) await page.getByRole('tab', { name: 'Исходный файл', exact: true }).click();
    await expect(source).toBeVisible();
    await expect(source.getByRole('img', { name: /^Исходный документ, страница / })).toHaveCount(2);
    await expect(source).toContainText('Страниц: 2');
    if (width >= 768) {
      const a = await source.boundingBox();
      const b = await text.boundingBox();
      expect(a!.x + a!.width).toBeLessThanOrEqual(b!.x);
    }
    await source.getByRole('button', { name: 'Увеличить исходник', exact: true }).click();
    await expect(source.getByRole('img', { name: 'Исходный документ, страница 1', exact: true })).toHaveAttribute('style', /125%/);
    await noOverflow(page);
    await source.getByRole('button', { name: 'По ширине', exact: true }).click();
    await source.getByRole('img', { name: 'Исходный документ, страница 2', exact: true }).scrollIntoViewIfNeeded();
    await expect(source.getByRole('img', { name: 'Исходный документ, страница 2', exact: true })).toBeVisible();
    await source.getByRole('button', { name: 'Развернуть', exact: true }).click();
    const expanded = page.getByRole('dialog', { name: 'Исходный документ', exact: true });
    await expect(expanded.getByRole('img', { name: /^Исходный документ, страница / })).toHaveCount(2);
    await expanded.getByRole('button', { name: 'Закрыть окно', exact: true }).click();
    await capture(page, `source-study-pdf-original-${width}`);
    expect(observed.analysisCalls).toEqual([]);
    expect(observed.errors).toEqual([]);
  });

  test(`structured clinic result uses canonical metadata and independent source fields at ${width}px`, async ({ page }) => {
    const observed = observe(page);
    await page.setViewportSize({ width, height: 960 });
    await page.goto('/patient');
    await page.getByRole('button', { name: 'Демопанель', exact: true }).click();
    await page.getByRole('dialog', { name: 'Демопанель', exact: true }).getByRole('button', { name: 'Результаты из клиники', exact: true }).click();
    await page.getByRole('button', { name: 'Открыть результат: Маммография', exact: true }).click();
    const study = page.getByRole('region', { name: 'Готовое исследование', exact: true });
    await expect(study).toContainText('Учебная клиника MediPath');
    await expect(study).toContainText('Исследование выполнено');
    await expect(study).toContainText('Номер исследования');
    await expect(study).toContainText('Не указан в источнике');
    await expect(page.getByRole('region', { name: 'Полный исходный документ', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Сверить с оригиналом', exact: true })).toHaveCount(0);
    await expect(page.locator('.study-result-tabs')).toHaveCount(0);
    await expect(study.locator('.study-source-summary')).toBeVisible();
    const fields = study.locator('.study-source-field');
    await expect(fields).toHaveCount(4);
    await expect(fields.locator(':scope > summary').filter({ hasText: /^Сведения из источника$/ })).toBeVisible();
    await expect(study.locator('.study-source-field[open]')).toHaveCount(0);
    await expect(fields.filter({ has: page.locator('summary > strong', { hasText: /^Рекомендации$/ }) })).toHaveClass(/is-recommendation/);
    await fields.locator(':scope > summary').filter({ hasText: /^Описание$/ }).click();
    await fields.locator(':scope > summary').filter({ hasText: /^Заключение$/ }).click();
    await expect(study.locator('.study-source-field[open]')).toHaveCount(2);
    await noOverflow(page);
    await capture(page, `source-study-clinic-${width}`);

    await page.getByRole('button', { name: 'Редактировать текст', exact: true }).click();
    const review = page.getByRole('region', { name: 'Проверка документа', exact: true });
    await expect(review.getByRole('heading', { name: 'Данные исследования', exact: true })).toBeVisible();
    await expect(review.getByLabel('Описание', { exact: true })).toBeVisible();
    await expect(review.getByLabel('Заключение', { exact: true })).toBeVisible();
    await expect(review.getByLabel('Рекомендации', { exact: true })).toBeVisible();
    await expect(review.getByRole('region', { name: 'Оригинал документа', exact: true })).toHaveCount(0);
    await expect(review.getByRole('button', { name: 'Следующая страница', exact: true })).toHaveCount(0);
    await expect(review).not.toContainText('Фрагмент');
    const original = await review.getByLabel('Заключение', { exact: true }).inputValue();
    await review.getByLabel('Заключение', { exact: true }).fill(`${original} Исправление для локальной сверки.`);
    await review.getByText('Исходные поля до правок', { exact: true }).click();
    const preserved = review.locator('.review-preserved-fields .study-source-field').filter({ has: page.locator('summary > strong', { hasText: /^Заключение$/ }) });
    await preserved.locator('summary').click();
    await expect(preserved.locator('div > p')).toHaveText(original);
    await noOverflow(page);
    expect(observed.analysisCalls).toEqual([]);
    expect(observed.errors).toEqual([]);
  });
}

test('prepared text without an attached file does not pretend to be a PDF or OCR result', async ({ page }) => {
  await page.goto('/patient');
  await openDemoScenario(page, 'chest-referral', 'local');
  const review = page.getByRole('region', { name: 'Проверка документа', exact: true });
  await expect(review.getByRole('heading', { name: 'Проверьте текст исследования', exact: true })).toBeVisible();
  await expect(review.getByLabel('Описание', { exact: true })).toBeVisible();
  await expect(review.getByLabel('Заключение', { exact: true })).toBeVisible();
  await expect(review.getByLabel('Рекомендации', { exact: true })).toBeVisible();
  await expect(review.getByRole('region', { name: 'Оригинал документа', exact: true })).toHaveCount(0);
  await expect(review.getByRole('tablist')).toHaveCount(0);
  await expect(review).not.toContainText('Фрагмент');
  await expect(review).not.toContainText('Страница 1');
});
