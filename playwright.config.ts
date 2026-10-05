import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e', timeout: 45000, fullyParallel: true,
  use: { baseURL: 'http://127.0.0.1:5173', trace: 'retain-on-failure' },
  webServer: [
    { command: 'npm run dev:api', url: 'http://127.0.0.1:3001/api/clinic-demo?patientId=demo-patient-01', reuseExistingServer: true },
    { command: 'npm run dev', url: 'http://127.0.0.1:5173', reuseExistingServer: true },
  ],
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], channel: 'chrome' } }],
});
