import { defineConfig } from '@playwright/test';
import config from './playwright.config.mjs';

export default defineConfig({
  ...config,
  use: { ...config.use, browserName: 'firefox', launchOptions: {} },
});
