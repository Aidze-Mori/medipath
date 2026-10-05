import { expect, test, type Page } from './test';
import { showAdvancedDemo } from './helpers';

const names = {
  suspicious: 'Маммография · BI-RADS 4',
  incomplete: 'Маммография · неполная оценка',
  screening: 'Маммография · плановое наблюдение',
};

async function launchCase(page: Page, action: string) {
  await page.getByRole('button', { name: 'Демопанель', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Демопанель', exact: true });
  // Shared test fixture reports AI as disabled: these case cards must be honest
  // prepared local examples, never quota-consuming provider calls.
  await expect(panel.getByText('AI-сервер пока не настроен. Локальные сценарии доступны ниже.', { exact: true })).toBeVisible();
  if (!await panel.getByRole('button', { name: action, exact: true }).isVisible()) await showAdvancedDemo(panel);
  await panel.getByRole('button', { name: action, exact: true }).click();
  await expect(panel).toHaveCount(0);
}

async function buildCase(page: Page, name: string) {
  const entry = page.getByRole('article', { name, exact: true });
  await expect(entry).toBeVisible();
  await expect(entry).toContainText('Учебный адаптер «Третье Мнение»');
  await expect(entry).toContainText('Источник клиники проверен');
  await page.getByRole('checkbox', { name: `Учесть в маршруте: ${name}`, exact: true }).check();
  await page.getByRole('button', { name: 'Собрать маршрут', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Ваш маршрут', exact: true })).toBeVisible();
}

function forbidAnalysisCalls(page: Page) {
  const requests: string[] = [];
  page.on('request', request => { if (/\/api\/analyze(?:-demo|-document)?(?:\?|$)/.test(request.url())) requests.push(request.url()); });
  return requests;
}

for (const width of [1440, 390]) {
  test(`prepared clinical notification uses normal medical record and cited proposal at ${width}px`, async ({ page }) => {
    const calls = forbidAnalysisCalls(page);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width, height: 960 });
    await page.goto('/patient');
    await launchCase(page, 'Получить уведомление');
    const notification = page.getByRole('dialog', { name: 'Уведомления', exact: true });
    await expect(notification).toContainText('Ваш новый результат готов');
    await expect(notification).toContainText('Настоящее push/SMS не отправлялось');
    await notification.getByRole('button', { name: 'Посмотреть результат', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Ваши результаты', exact: true })).toBeVisible();
    await expect(page.locator('.results-day > h4')).toHaveCount(1);
    await buildCase(page, names.suspicious);
    const proposal = page.getByRole('region', { name: 'Предложение по клиническому источнику', exact: true });
    await expect(proposal).toHaveCount(1);
    await expect(proposal).toContainText('Подготовленный клинический пример');
    await expect(proposal.getByRole('heading', { name: 'Обсудить консультацию онколога', exact: true })).toBeVisible();
    await expect(proposal).toContainText('клиническая проверка не выполнялась');
    await expect(page.getByText('Предложение по клиническому источнику · обсудите с врачом', { exact: true })).toBeVisible();
    await proposal.getByText('На основании чего предложен шаг', { exact: true }).click();
    await expect(proposal).toContainText('В документе нет готового направления к этому специалисту');
    await expect(proposal.getByRole('link')).toHaveAttribute('href', 'https://cr.minzdrav.gov.ru/view-cr/598_3');
    await expect(proposal.locator('.clinical-source')).toContainText('598_3 · 2024');
    await expect(proposal.locator('.clinical-source')).toContainText('не подтверждён клиницистом');
    expect(calls).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `docs/release/previews/demo-clinical-prepared-${width}.png`, fullPage: true });
    expect(errors).toEqual([]);
  });
}

test('BI-RADS 0 shows source-linked clarification and BI-RADS 2 does not invent an extra doctor', async ({ page }) => {
  const calls = forbidAnalysisCalls(page);
  await page.goto('/patient');
  await launchCase(page, 'Открыть случай с уточнением');
  await buildCase(page, names.incomplete);
  const proposals = page.getByRole('region', { name: 'Предложение по клиническому источнику', exact: true });
  await expect(proposals).toHaveCount(2);
  await expect(proposals.filter({ hasText: 'Обсудить рекомендованное обследование' })).toContainText('дополнительные изображения');
  await expect(page.getByRole('button', { name: 'Выбрать врача', exact: true })).toHaveCount(1);
  await launchCase(page, 'Открыть случай без дообследования');
  // Each route must use the chosen result, not a previously selected scenario.
  const first = page.getByRole('checkbox', { name: `Учесть в маршруте: ${names.incomplete}`, exact: true });
  await first.uncheck();
  await buildCase(page, names.screening);
  const noExam = page.getByRole('region', { name: 'Следующий шаг по документу', exact: true });
  await expect(noExam).toContainText('Дополнительное обследование в исходнике не требуется');
  await expect(page.getByRole('button', { name: 'Выбрать врача', exact: true })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Предложение по клиническому источнику', exact: true })).toHaveCount(1);
  await expect(page.getByRole('region', { name: 'Предложение по клиническому источнику', exact: true })).toContainText('рутинный скрининг');
  expect(calls).toEqual([]);
});

test('explicit examination without a specialty is visible without inventing a doctor', async ({ page }) => {
  const calls = forbidAnalysisCalls(page);
  await page.goto('/patient');
  await launchCase(page, 'Открыть рекомендацию обследования');
  const entry = page.getByRole('article', { name: 'УЗИ · контрольное исследование', exact: true });
  await expect(entry).toBeVisible();
  await expect(page.getByRole('button', { name: 'Подтвердить текст и создать маршрут', exact: true })).toHaveCount(0);
  await page.getByRole('checkbox', { name: 'Учесть в маршруте: УЗИ · контрольное исследование', exact: true }).check();
  await page.getByRole('button', { name: 'Собрать маршрут', exact: true }).click();
  const next = page.getByRole('region', { name: 'Следующий шаг по документу', exact: true });
  await expect(next.getByRole('heading', { name: 'Обсудить рекомендованное обследование', exact: true })).toBeVisible();
  await next.getByText('Показать точную формулировку', { exact: true }).click();
  await expect(next.locator('blockquote').filter({ hasText: 'Рекомендовано контрольное УЗИ' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Выбрать врача', exact: true })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Предложение по клиническому источнику', exact: true })).toHaveCount(0);
  expect(calls).toEqual([]);
});

test('reopening clinic scenarios deduplicates records and demo reset clears them before another run', async ({ page }) => {
  const calls = forbidAnalysisCalls(page);
  page.on('dialog', dialog => dialog.accept());
  await page.goto('/patient');
  for (const action of ['Открыть случай с уточнением', 'Открыть случай без дообследования', 'Открыть случай с уточнением']) {
    await launchCase(page, action);
    await expect(page.getByRole('article', { name: names.incomplete, exact: true })).toHaveCount(1);
  }
  await expect(page.getByRole('article', { name: names.screening, exact: true })).toHaveCount(1);
  await expect(page.locator('.results-row')).toHaveCount(2);
  await page.getByRole('button', { name: 'Демопанель', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Демопанель', exact: true });
  await panel.getByRole('button', { name: 'Сбросить демоданные', exact: true }).click();
  await panel.getByRole('button', { name: 'Закрыть окно', exact: true }).click();
  await page.getByRole('navigation', { name: 'Основная навигация', exact: true }).getByRole('button', { name: 'Моя медкарта', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Здесь появятся ваши документы', exact: true })).toBeVisible();
  await launchCase(page, 'Открыть случай с уточнением');
  await expect(page.getByRole('article', { name: names.incomplete, exact: true })).toHaveCount(1);
  await expect(page.locator('.results-row')).toHaveCount(1);
  expect(calls).toEqual([]);
});

test('mock live explanation is grouped into three independently expandable section cards', async ({ page }) => {
  await page.route('**/api/capabilities', route => route.fulfill({ json: { provider: 'codex_cli', configured: true, documentAnalysisAllowed: true, reason: 'ready' } }));
  const sectionText = { description: 'Учебное описание. Структуры не смещены.', conclusion: 'Учебное заключение. Изменений не выявлено.', recommendations: 'Дополнительное обследование не требуется.' };
  await page.route('**/api/analyze-document', async route => {
    const request = route.request().postDataJSON();
    await route.fulfill({ json: {
      binding: { requestId: request.requestId, documentRevision: request.documentRevision, contentDigest: request.contentDigest },
      explanation: { summary: 'В учебном исследовании изменений не выявлено. По тексту дополнительное обследование не требуется.', findings: request.sections.map((section: { id: string; text: string }) => ({ sectionId: section.id, quote: section.text, explanation: section.id === 'description' ? 'Структуры расположены обычно, смещения не описаны.' : section.id === 'conclusion' ? 'В заключении не отмечены изменения.' : 'По тексту дополнительное обследование не требуется.' })) },
    } });
  });
  await page.goto('/patient');
  await page.getByLabel('Файл документа', { exact: true }).setInputFiles({ name: 'synthetic-three-sections.txt', mimeType: 'text/plain', buffer: Buffer.from(`Описание:\n${sectionText.description}\nЗаключение:\n${sectionText.conclusion}\nРекомендации:\n${sectionText.recommendations}`) });
  await page.getByRole('button', { name: 'Подтвердить текст и создать маршрут', exact: true }).click();
  const explanation = page.getByRole('region', { name: 'AI-пояснение документа', exact: true });
  await expect(explanation).toBeVisible();
  const cards = explanation.locator('.analysis-section-card');
  await expect(cards).toHaveCount(3);
  await expect(explanation.locator('.analysis-section-card[open]')).toHaveCount(0);
  await explanation.screenshot({ path: 'docs/release/previews/ai-section-cards.png' });
  const conclusion = cards.filter({ has: page.locator('summary > strong', { hasText: /^Заключение$/ }) });
  await expect(conclusion.locator('.analysis-finding')).toBeHidden();
  await conclusion.locator(':scope > summary').click();
  await expect(conclusion.locator('.analysis-finding')).toBeVisible();
  await expect(explanation.locator('.analysis-section-card[open]')).toHaveCount(1);
  await conclusion.getByText('Сверить с исходным текстом', { exact: true }).click();
  await expect(conclusion.locator('blockquote')).toHaveText(sectionText.conclusion);
});

test('actual clinical notification uses configured AI and validates a source-linked proposal', async ({ page }) => {
  test.skip(process.env.MEDIPATH_CLINICAL_LIVE_SMOKE !== '1', 'Explicit quota-consuming clinical demo provider smoke.');
  test.setTimeout(90000);
  await page.unroute('**/api/capabilities');
  await page.setViewportSize({ width: 1440, height: 960 });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/patient');
  await page.getByRole('button', { name: 'Демопанель', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Демопанель', exact: true });
  await expect(panel.getByText(/^AI настроен · /)).toBeVisible();
  await panel.getByRole('button', { name: 'Открыть результат Третьего Мнения', exact: true }).click();
  await page.getByRole('dialog', { name: 'Уведомления', exact: true }).getByRole('button', { name: 'Посмотреть результат', exact: true }).click();
  await expect(page.getByRole('heading', { name: names.suspicious, exact: true }).first()).toBeVisible();
  const responsePromise = page.waitForResponse(response => response.url().includes('/api/analyze-demo') && response.request().method() === 'POST', { timeout: 75000 });
  await page.getByRole('button', { name: 'Собрать маршрут', exact: true }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(200);
  const payload = await response.json();
  expect(payload.binding.fixtureId).toBe('clinical-birads4');
  expect(payload.analysis.mode).toBe('synthetic_live');
  expect(payload.analysis.llmExplanation.findings.length).toBeGreaterThan(0);
  await expect(page.locator('.analysis-section-card')).toHaveCount(3);
  expect(payload.analysis.clinicalDemo.generation).toBe('validated_live_selection');
  expect(payload.analysis.clinicalDemo.proposals).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'birads4-discuss-oncology', specialtyId: 'oncology', sourceIds: ['kr598-v3-oncology'] })]));
  const proposal = page.getByRole('region', { name: 'Предложение по клиническому источнику', exact: true });
  await expect(proposal).toContainText('Предложение AI · учебный случай');
  await expect(proposal).not.toContainText('Подготовленный клинический пример');
  await expect(proposal.getByRole('heading', { name: 'Обсудить консультацию онколога', exact: true })).toBeVisible();
  await proposal.getByText('На основании чего предложен шаг', { exact: true }).click();
  await expect(proposal.getByRole('link')).toHaveAttribute('href', 'https://cr.minzdrav.gov.ru/view-cr/598_3');
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 960 });
    await expect(proposal).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `docs/release/previews/demo-clinical-live-${width}.png`, fullPage: true });
  }
  expect(errors).toEqual([]);
});
