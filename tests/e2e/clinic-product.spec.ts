import { expect, test } from './test';
import { openDemoClinic, returnToWorkMode } from './helpers';

test('clinic starts empty and processes a local document through review and coordinator actions', async ({ page }) => {
  const transmitted: string[] = [];
  page.on('request', (request) => {
    if (request.method() !== 'GET' || new URL(request.url()).hostname !== '127.0.0.1')
      transmitted.push(request.url());
  });
  await page.goto('/clinic');
  await expect(page.getByText('В очереди пока нет документов')).toBeVisible();
  await expect(page.getByRole('button', { name: /Учебный случай/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Добавить документ', exact: true }).click();
  await page.getByLabel('Файл документа', { exact: true }).setInputFiles({
    name: 'local-intake.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Описание: Исследование органов грудной клетки.\nЗаключение: Требуется уточнение у специалиста.\nРекомендации: Рекомендована консультация пульмонолога.\n'),
  });
  await expect(page.getByRole('heading', { name: 'Проверьте распознанный текст' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'План посещений пациента' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Выбрать врача' })).toHaveCount(0);
  await expect(page.getByLabel('Обработка учебного примера')).toHaveCount(0);
  await page.getByRole('button', { name: 'Подтвердить текст и создать маршрут' }).click();
  await expect(page.getByRole('heading', { name: 'План посещений пациента' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Консультация пульмонолога' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Выбрать врача' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Запланировать звонок' }).click();
  await expect(page.getByRole('dialog').getByText('Демонстрационная запись')).toHaveCount(0);
  await page.getByLabel('Причина', { exact: true }).fill('Уточнить удобное время связи');
  await page.getByLabel('Срок', { exact: true }).fill('2026-10-12');
  await page.getByRole('button', { name: 'Сохранить задачу звонка', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'История действий' })).toBeVisible();
  await expect(page.getByText('Уточнить удобное время связи', { exact: false })).toBeVisible();
  await expect(page.getByText('Сообщение не отправлялось.', { exact: false })).toBeVisible();
  expect(transmitted).toEqual([]);
  expect(await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length }))).toEqual({ local: 0, session: 0 });
  await page.reload();
  await expect(page.getByText('В очереди пока нет документов')).toBeVisible();
});

test('mobile clinic keeps its local case and corrected revision across demo and role switches', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/clinic');
  await page.getByRole('button', { name: 'Добавить документ', exact: true }).click();
  await page.getByLabel('Файл документа', { exact: true }).setInputFiles({
    name: 'mobile-case.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Описание: Контрольное исследование.\nЗаключение: Требуется уточнение.\nРекомендации: Рекомендована консультация терапевта.\n'),
  });
  await page.getByRole('button', { name: 'Подтвердить текст и создать маршрут' }).click();
  await expect(page.getByRole('heading', { name: 'Консультация терапевта' })).toBeVisible();
  await page.getByRole('tab', { name: /Медкарта/ }).click();
  await page.getByRole('button', { name: 'Исправить текст документа' }).click();
  await page.getByLabel('Рекомендации', { exact: true }).fill('Рекомендована консультация терапевта через 3 месяца.');
  await expect(page.getByRole('heading', { name: 'План посещений пациента' })).toHaveCount(0);
  await openDemoClinic(page);
  await expect(page.getByRole('button', { name: /Анна Соколова/ })).toBeVisible();
  await expect(page.getByText('mobile-case.txt', { exact: true })).toHaveCount(0);
  await returnToWorkMode(page);
  await expect(page.getByLabel('Рекомендации', { exact: true })).toHaveValue('Рекомендована консультация терапевта через 3 месяца.');
  await expect(page.getByRole('heading', { name: 'План посещений пациента' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Подтвердить текст и создать маршрут' }).click();
  await expect(page.getByRole('heading', { name: 'Консультация терапевта' })).toBeVisible();
  await expect(page.getByRole('article').getByText('через 3 месяца', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Демопанель', exact: true }).click();
  await page.getByRole('link', { name: 'Пациенту', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Загрузите медицинское заключение' })).toBeVisible();
  await page.getByRole('button', { name: 'Демопанель', exact: true }).click();
  await page.getByRole('link', { name: 'Клинике', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Консультация терапевта' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Выбрать врача' })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
