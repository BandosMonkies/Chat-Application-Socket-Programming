import { expect, test } from "@playwright/test";

test("TC-07 frontend login, search, conversation selection, and message rendering", async ({ page }) => {
  const suffix = Date.now().toString().slice(-7);
  const alice = `alice${suffix}`;
  const bob = `bob${suffix}`;

  await page.goto("/");
  await page.getByRole("button", { name: "Register" }).click();
  await page.locator("#username").fill(alice);
  await page.locator("#password").fill("correct-horse");
  await page.getByRole("button", { name: /Create account/ }).click();
  await expect(page.locator("#auth-status")).toContainText("Account created");

  await page.getByRole("button", { name: "Register" }).click();
  await page.locator("#username").fill(bob);
  await page.locator("#password").fill("correct-horse");
  await page.getByRole("button", { name: /Create account/ }).click();
  await expect(page.locator("#auth-status")).toContainText("Account created");

  await page.locator(".auth-tabs .tab", { hasText: "Log in" }).click();
  await page.locator("#username").fill(alice);
  await page.locator("#password").fill("correct-horse");
  await page.locator("#auth-form .primary-button").click();
  await expect(page.locator("#chat-view")).toBeVisible();
  await expect(page.locator(".chat-list-item").filter({ hasText: bob })).toBeVisible();

  await page.locator("#user-search").fill(bob);
  await expect(page.locator(".chat-list-item")).toHaveCount(1);
  await page.locator(".chat-list-item").click();
  await expect(page.locator("#active-user")).toHaveText(bob);

  await page.locator("#message-input").fill("Browser message");
  await page.locator(".send-button").click();
  await expect(page.locator(".message-body")).toContainText("Browser message");
});
