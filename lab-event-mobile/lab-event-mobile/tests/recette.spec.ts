import { test, expect, devices } from '@playwright/test';

test.use({ ...devices['iPhone 13'] });

test('Connexion sécurisée réussie et accès à l\'application', async ({ page }) => {
  // Le robot récupère les informations cachées
  const monSousDomaine = process.env.PLAYWRIGHT_SUBDOMAIN || ''; 
  const monToken = process.env.PLAYWRIGHT_TOKEN || '';

  // 1. Il ouvre le site
  await page.goto('https://lab-event-mobile.vercel.app/');

  // 2. Il remplit les deux cases automatiquement
  await page.locator('input').nth(0).fill(monSousDomaine);
  await page.locator('input').nth(1).fill(monToken);

  // 3. Il clique sur "Se connecter"
  await page.click('button:has-text("Se connecter")');

  // 4. On lui laisse 4 secondes pour que l'application valide et charge l'écran suivant
  await page.waitForTimeout(4000); 

  // 5. VÉRIFICATION : Si la connexion a réussi, le bouton "Se connecter" n'existe plus à l'écran
  await expect(page.locator('button:has-text("Se connecter")')).not.toBeVisible();
});
