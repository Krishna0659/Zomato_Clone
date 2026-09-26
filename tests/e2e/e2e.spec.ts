import { test, expect } from '@playwright/test';

test.describe('End-to-End Customer Journey', () => {
  // Using localhost:5173 as frontend URL
  const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
  
  test('Full order journey', async ({ page }) => {
    // 1. Login
    await page.goto(`${FRONTEND_URL}/login`);
    await page.fill('input[type="email"]', 'testuser@example.com');
    await page.fill('input[type="password"]', 'password123');
    await page.click('button[type="submit"]');

    // Assuming successful login redirects to home
    await expect(page).toHaveURL(`${FRONTEND_URL}/`);

    // 2. Browse and Add to Cart
    // Wait for restaurants to load
    await page.waitForSelector('.restaurant-card');
    
    // Click on the first restaurant
    await page.click('.restaurant-card:first-child');
    
    // Wait for menu items
    await page.waitForSelector('.menu-item');
    
    // Click "Add to Cart" on the first item
    await page.click('.menu-item:first-child button:has-text("Add")');

    // 3. Checkout
    await page.click('a:has-text("Cart")');
    await expect(page).toHaveURL(`${FRONTEND_URL}/cart`);
    
    // Click checkout
    await page.click('button:has-text("Checkout")');
    
    // Fill delivery address if needed, or assume it's pre-filled
    // Select Payment Method
    await page.click('text="Razorpay"');
    
    // Click Place Order
    await page.click('button:has-text("Place Order")');

    // 4. Razorpay / Stripe test-mode payment
    // Since Razorpay opens an iframe or a popup, we might mock the payment success
    // or just assume we hit a mock payment endpoint for testing.
    // In a real environment, we would use Stripe/Razorpay test cards.
    // For this smoke test, we'll wait for the order success page
    
    await expect(page).toHaveURL(/\/order\/[a-zA-Z0-9]+$/);
    
    // 5. Order status updates via Socket.IO -> rider assignment -> delivered
    // We expect the page to show "Preparing", then "Rider Assigned", then "Delivered"
    await expect(page.locator('.order-status')).toContainText('Preparing', { timeout: 10000 });
    await expect(page.locator('.order-status')).toContainText('Rider Assigned', { timeout: 30000 });
    await expect(page.locator('.order-status')).toContainText('Delivered', { timeout: 30000 });
  });
});
