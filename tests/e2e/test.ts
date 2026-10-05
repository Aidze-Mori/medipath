import { test as base, expect } from '@playwright/test';
export type { Page } from '@playwright/test';

// Most E2E tests exercise local rules. Each explicit AI test registers its own
// later route, so ordinary runs cannot opt uploaded documents into a live provider.
export const test = base.extend({
  page: async ({ page }, use) => {
    await page.route('**/api/capabilities', route => route.fulfill({
      json: { provider: 'disabled', configured: false, documentAnalysisAllowed: false, reason: 'disabled' },
    }));
    await use(page);
  },
});
export { expect };
