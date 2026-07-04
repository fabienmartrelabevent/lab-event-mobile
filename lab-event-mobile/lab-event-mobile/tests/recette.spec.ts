import { test, expect, devices } from '@playwright/test';

test.use({ ...devices['iPhone 13'] });

test('Vérification de la page d\'accueil Lab Event', async ({ page }) => {
  await page.goto('https://lab-event-mobile.vercel.app/');
  await expect(page).not.toHaveTitle(/404/);
  await page.waitForTimeout(2000); 
});
