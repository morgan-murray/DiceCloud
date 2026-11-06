import { defineConfig } from '@playwright/test';
export default defineConfig({ workers: 1, timeout: 60000, reporter: 'line', use: { ignoreHTTPSErrors: true, launchOptions: { args: ['--ignore-certificate-errors'] }, viewport: { width: 1280, height: 900 }, screenshot: 'only-on-failure' } });
