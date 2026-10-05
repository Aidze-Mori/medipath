import { chooseOption } from './helpers';
import { expect, test, type Page } from './test';

async function clinicResults(page: Page) {
  await page.goto('/patient');
  await page.getByRole('button', { name: 'Демопанель', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Демопанель', exact: true });
  await panel.getByText('Дополнительные сценарии и настройки', { exact: true }).click();
  await chooseOption(panel.getByLabel('Режим обработки примера'), 'local');
  await panel.getByRole('button', { name: 'Результаты из клиники', exact: true }).click();
  await expect(page.getByRole('checkbox')).toHaveCount(3);
}

async function navigate(page: Page, name: string) {
  await page.getByRole('navigation', { name: 'Основная навигация', exact: true }).getByRole('button', { name, exact: true }).click();
}

test('deferred visit restores its own document after another route and respects archive', async ({ page }) => {
  await clinicResults(page);
  await page.getByRole('checkbox', { name: 'Учесть в маршруте: Маммография', exact: true }).check();
  await page.getByRole('button', { name: 'Собрать маршрут', exact: true }).click();
  await page.getByRole('button', { name: 'Выбрать позже', exact: true }).click();
  await navigate(page, 'Моя медкарта');
  await page.getByRole('checkbox', { name: 'Учесть в маршруте: Маммография', exact: true }).uncheck();
  await page.getByRole('checkbox', { name: 'Учесть в маршруте: КТ грудной клетки', exact: true }).check();
  await page.getByRole('button', { name: 'Собрать маршрут', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Консультация пульмонолога', exact: true })).toBeVisible();
  await navigate(page, 'Записи');
  await page.getByRole('button', { name: 'Вернуться к планированию', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Консультация маммолога', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Консультация пульмонолога', exact: true })).toHaveCount(0);
  await navigate(page, 'Моя медкарта');
  await page.getByRole('button', { name: 'В архив: Маммография', exact: true }).click();
  await navigate(page, 'Записи');
  await page.getByRole('button', { name: 'Вернуться к планированию', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Архив документов', exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('Верните документ из архива');
  await expect(page.getByRole('button', { name: 'Выбрать врача', exact: true })).toHaveCount(0);
});

test('booking revision warning stays visible after opening another document', async ({ page }) => {
  await clinicResults(page);
  await page.getByRole('checkbox', { name: 'Учесть в маршруте: КТ грудной клетки', exact: true }).check();
  await page.getByRole('button', { name: 'Собрать маршрут', exact: true }).click();
  await page.getByRole('button', { name: 'Выбрать врача', exact: true }).click();
  const picker = page.getByRole('dialog');
  await picker.getByRole('button', { name: '09:00', exact: true }).first().click();
  await picker.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await picker.getByRole('button', { name: 'Подтвердить демозапись', exact: true }).click();
  await navigate(page, 'Моя медкарта');
  await page.getByRole('button', { name: 'Открыть результат: КТ грудной клетки', exact: true }).click();
  await page.getByRole('button', { name: 'Редактировать текст', exact: true }).click();
  await page.getByRole('textbox', { name: 'Рекомендации', exact: true }).fill('Консультация пульмонолога не требуется.');
  await page.getByRole('button', { name: 'Подтвердить текст и создать маршрут', exact: true }).click();
  await navigate(page, 'Записи');
  await expect(page.getByText('Маршрут изменён. Эта запись сохранена как история прежних редакций документов.', { exact: true })).toBeVisible();
  await navigate(page, 'Моя медкарта');
  await page.getByRole('button', { name: 'Открыть результат: Маммография', exact: true }).click();
  await navigate(page, 'Записи');
  await expect(page.getByText('Маршрут изменён. Эта запись сохранена как история прежних редакций документов.', { exact: true })).toBeVisible();
});
