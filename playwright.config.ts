import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 30000,
  use: {
    baseURL: 'http://localhost:3010',
    headless: true,
  },
  webServer: {
    // Port 3010: port 3000 sering dipakai project lain di mesin dev ini
    command: 'npx serve -l 3010 -s',
    port: 3010,
    reuseExistingServer: true,
  },
});
