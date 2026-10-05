import { expect, test } from './test';
import { openDemoClinic, openDemoScenario } from './helpers';

for (const route of ['/patient', '/clinic']) {
  test(`rendered health ${route}`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto(route);
    await expect(page).toHaveTitle('MediPath — медицинский навигатор');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.locator('vite-error-overlay')).toHaveCount(0);
    expect((await page.locator('main').innerText()).trim().length).toBeGreaterThan(20);
    if (route === '/patient') {
      await openDemoScenario(page);
      await page.getByRole('button', { name: 'Подтвердить текст и создать маршрут' }).click();
      await page.getByRole('button', { name: 'Выбрать врача' }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Выбрать врача' })).toBeFocused();
    } else {
      await openDemoClinic(page);
      await page.getByRole('button', { name: /Анна Соколова/ }).click();
      await page.getByRole('tab', { name: 'План посещений', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'План посещений пациента' })).toBeVisible();
    }
    expect(errors).toEqual([]);
  });
}
