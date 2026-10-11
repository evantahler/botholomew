import { expect, test } from "@playwright/test";

test.describe("smoke", () => {
  test("renders the landing page", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "Botholomew" }),
    ).toBeVisible();
    await expect(page.getByTestId("navbar")).toBeVisible();
  });

  test("the landing page says it is in development and links v1", async ({
    page,
  }) => {
    await page.goto("/");

    // The marketing page's one non-negotiable: it never claims a bot exists.
    await expect(page.getByTestId("in-development")).toContainText(
      "in development",
    );
    await expect(page.getByTestId("design-cards")).toBeVisible();
    await expect(page.getByTestId("built-cards")).toBeVisible();
    await expect(page.getByTestId("v1-link")).toHaveAttribute(
      "href",
      "https://github.com/evantahler/botholomew/tree/v1",
    );
    // The footer says so on every page, signed in or out.
    await expect(page.getByTestId("footer")).toContainText("in development");
  });

  test("reaches the backend across origins", async ({ page }) => {
    // The health readout lives on its own route. It is still the page
    // that proves CORS and `VITE_API_URL` are wired correctly, because the table
    // only populates if the cross-origin `apiFetch` succeeded.
    await page.goto("/status");

    await expect(page.getByTestId("status-loading")).toBeHidden();
    await expect(page.getByTestId("status-table")).toBeVisible();

    const rows = page.getByTestId("status-table").locator("tbody tr");
    await expect(rows.filter({ hasText: "Database" })).toContainText("up");
    await expect(rows.filter({ hasText: "Redis" })).toContainText("up");
  });

  test("client-side routing resolves the auth shells", async ({ page }) => {
    await page.goto("/");

    await page.getByRole("link", { name: "Get started" }).click();
    await expect(page.getByTestId("sign-up-card")).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/sign-up");

    await page.getByTestId("sign-in-link-from-sign-up").click();
    await expect(page.getByTestId("sign-in-card")).toBeVisible();
  });

  test("serves the owl favicon the document points at", async ({
    page,
    request,
  }) => {
    await page.goto("/");

    const href = await page.locator('link[rel="icon"]').getAttribute("href");
    expect(href).toBe("/favicon.svg");

    const res = await request.get(href as string);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("image/svg+xml");

    const svg = await res.text();
    // The slate accent on the slate ground, and not the purple bolt Vite
    // scaffolds — a favicon is the one asset nothing else in the suite notices
    // going stale.
    expect(svg).toContain("#8b7cff");
    expect(svg).toContain("#06070a");
    expect(svg.toLowerCase()).not.toContain("863bff");
  });
});
