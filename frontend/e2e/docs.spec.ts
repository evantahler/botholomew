import { expect, test } from "@playwright/test";

test.describe("public docs", () => {
  test("signed-out visitors can read docs", async ({ page }) => {
    await page.goto("/docs");

    await expect(page.getByTestId("docs-title")).toBeVisible();
    await expect(page.getByTestId("docs-section-nav")).toBeVisible();
    await expect(page.getByTestId("docs-page-overview")).toBeVisible();
    await expect(page.getByTestId("docs-markdown-overview")).toContainText(
      "What is Botholomew",
    );

    // Still signed out — the public chrome, not a bounce to /sign-in.
    await expect(page.getByTestId("user-menu-toggle")).toContainText(
      "Signed out",
    );
    expect(new URL(page.url()).pathname).toBe("/docs/overview");
  });

  test("the docs and the CLI are reachable from the landing page", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Docs", exact: true }).first().click();
    await expect(page.getByTestId("docs-page-overview")).toBeVisible();

    await page.goto("/");
    await page.getByRole("link", { name: "CLI", exact: true }).first().click();
    await expect(page.getByTestId("docs-page-cli")).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/docs/cli");

    // Every page in the sidebar opens, and the sidebar is exactly the six.
    const slugs = [
      "overview",
      "getting-started",
      "teams",
      "cli",
      "mcp",
      "security",
    ];
    await expect(
      page
        .getByTestId("docs-section-nav")
        .locator('a[data-testid^="section-"]'),
    ).toHaveCount(slugs.length);
    for (const slug of slugs) {
      await page.getByTestId(`section-${slug}`).click();
      await expect(page.getByTestId(`docs-page-${slug}`)).toBeVisible();
    }
    await expect(page.getByTestId("docs-markdown-security")).toContainText(
      "Membership grants read",
    );
  });

  test("the navbar Docs link is present without a session", async ({
    page,
  }) => {
    await page.goto("/status");
    await page.getByTestId("docs-link").click();
    await expect(page.getByTestId("docs-title")).toBeVisible();
  });

  test("an unknown docs slug keeps the sidebar chrome", async ({ page }) => {
    await page.goto("/docs/no-such-page");
    await expect(page.getByTestId("docs-section-nav")).toBeVisible();
    await expect(page.getByTestId("no-such-docs-page")).toBeVisible();
  });
});
