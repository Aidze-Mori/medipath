import { chooseOption } from './helpers';
import { expect, test } from './test';
import { openDemoScenario } from './helpers';

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 320, height: 740 }]) {
  test(`doctor filters, sort and explicit review work at ${viewport.width}px`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    await page.setViewportSize(viewport);
    await page.goto('/patient');
    await openDemoScenario(page);
    await page.getByRole('button', { name: 'Подтвердить текст и создать маршрут' }).click();
    await page.getByRole('button', { name: 'Выбрать врача', exact: true }).click();
    const dialog = page.getByRole('dialog');
    const doctors = dialog.locator('.booking-doctor');
    await expect(doctors).toHaveCount(4);
    await expect(dialog.getByRole('button', { name: 'Продолжить', exact: true })).toBeDisabled();
    await expect(dialog).toHaveCSS('max-width', '640px');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    const avatar = doctors.first().locator('img');
    await expect.poll(() => avatar.evaluate((image) => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0)).toBe(true);
    if (viewport.width >= 768) {
      const firstSlot = await doctors.first().locator('.booking-slot').first().boundingBox();
      const footer = await dialog.locator('.dialog-footer').boundingBox();
      expect(firstSlot && footer && firstSlot.y + firstSlot.height <= footer.y + 1).toBe(true);
    }
    await page.screenshot({ path: `docs/release/previews/booking-picker-final-${viewport.width}.png` });

    await dialog.getByRole('button', { name: 'Фильтры', exact: true }).click();
    await chooseOption(dialog.getByRole('combobox', { name: 'Пол врача', exact: true }), 'female');
    await chooseOption(dialog.getByRole('combobox', { name: 'Метро', exact: true }), 'Чистые пруды');
    await dialog.getByRole('spinbutton', { name: 'Цена от, ₽', exact: true }).fill('2800');
    await dialog.getByRole('spinbutton', { name: 'Цена до, ₽', exact: true }).fill('3000');
    await expect(doctors).toHaveCount(1);
    await expect(doctors.first()).toContainText('Мария Александровна Соколова');
    await doctors.first().getByText('Образование и информация о враче', { exact: true }).click();
    await expect(doctors.first()).toContainText('лечебное дело, 2012');
    await expect(doctors.first()).toContainText('Врач первой категории');
    await dialog.getByRole('spinbutton', { name: 'Цена от, ₽', exact: true }).fill('4000');
    await expect(dialog.getByRole('alert')).toContainText('Минимальная стоимость');
    await expect(doctors).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Показать всех врачей', exact: true }).click();
    await expect(doctors).toHaveCount(4);
    await chooseOption(dialog.getByRole('combobox', { name: 'Сортировка врачей', exact: true }), 'price_asc');
    await expect(doctors.first()).toContainText('Дмитрий Павлович Орлов');
    await chooseOption(dialog.getByRole('combobox', { name: 'Сортировка врачей', exact: true }), 'price_desc');
    await expect(doctors.first()).toContainText('Елена Сергеевна Миронова');
    await chooseOption(dialog.getByRole('combobox', { name: 'Сортировка врачей', exact: true }), 'distance');
    await expect(doctors.first()).toContainText('Мария Александровна Соколова');
    await expect(doctors.last()).toContainText('Алексей Игоревич Волков');
    await dialog.getByRole('button', { name: 'Фильтры', exact: true }).click();
    await doctors.first().getByRole('button', { name: '09:00', exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'Продолжить', exact: true })).toBeEnabled();
    await chooseOption(dialog.getByRole('combobox', { name: 'Дата приёма', exact: true }), { index: 1 });
    await expect(dialog.getByRole('button', { name: 'Продолжить', exact: true })).toBeDisabled();
    await expect(dialog).toContainText('Условия изменены');
    await doctors.first().getByRole('button', { name: '09:00', exact: true }).click();
    await dialog.getByRole('button', { name: 'Продолжить', exact: true }).click();
    await expect(dialog.getByRole('heading', { name: 'Проверьте запись', exact: true })).toBeVisible();
    await expect(dialog.getByRole('heading', { name: 'Проверьте запись', exact: true })).toBeFocused();
    expect(await dialog.evaluate((element) => element.scrollTop)).toBe(0);
    await expect(dialog.locator('.booking-review-doctor')).toBeInViewport();
    await expect(dialog).toContainText('ул. Учебная, 12');
    await expect(dialog).toContainText('Чистые пруды');
    await expect(page.getByText('Демозапись создана. Клиника не получала заявку.')).toHaveCount(0);
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: `docs/release/previews/booking-review-final-${viewport.width}.png` });
    await dialog.getByRole('button', { name: 'Подтвердить демозапись', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('.study-booked-label')).toContainText('Вы записаны');
  await page.locator('.route-study > summary').click();
  await expect(page.getByText('Демозапись создана. Клиника не получала заявку.')).toBeVisible();
    expect(errors).toEqual([]);
  });
}
