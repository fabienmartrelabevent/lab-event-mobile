import { test, expect, devices } from '@playwright/test';

// Le robot utilise un écran d'iPhone 13
test.use({ ...devices['iPhone 13'] });

test('Vérifier que l\'application bloque les connexions vides', async ({ page }) => {
  // 1. Le robot ouvre ton application mobile
  await page.goto('https://lab-event-mobile.vercel.app/');

  // 2. Il clique directement sur le bouton "Se connecter"
  await page.click('button:has-text("Se connecter")');

  // 3. Le QA vérifie que le message d'erreur attendu est bien visible à l'écran
  const messageErreur = page.locator('text=Sous-domaine et token requis.');
  await expect(messageErreur).toBeVisible();
});
