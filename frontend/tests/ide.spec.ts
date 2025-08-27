import { test, expect } from 'playwright/test';

// Basic smoke tests for the Nano Contracts IDE

test.describe('Nano Contracts IDE', () => {
  test('loads default contracts and toolbar buttons', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('SimpleCounter.py')).toBeVisible();
    await expect(page.getByText('LiquidityPool.py')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Compile' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Quick Execute' })).toBeVisible();
  });

  test('switching files updates the editor content', async ({ page }) => {
    await page.goto('/');
    await page.getByText('LiquidityPool.py').click();
    await expect(page.locator('.monaco-editor')).toContainText('class LiquidityPool');
    await page.getByText('SimpleCounter.py').click();
    await expect(page.locator('.monaco-editor')).toContainText('class SimpleCounter');
  });

  test('compiling shows success message in console', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Compile' }).click();
    await expect(page.locator('text=Successfully compiled')).toBeVisible();
  });
});
