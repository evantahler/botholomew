import { expect, type Page, test } from "@playwright/test";
import { BACKEND_URL } from "./env.ts";

/**
 * The audit log in a real browser: an admin's changes show up in `/audit` with
 * an expandable before/after diff, the action filter narrows the table, and a
 * plain member of the same project is told they cannot read it.
 *
 * Like the other specs, this shares one backend with every suite and cannot
 * clear its database, so it mints unique addresses and asserts on rows it
 * created rather than on totals.
 */

const PASSWORD = "password123";

/** Generous landing timeout; see `auth.spec.ts` for why signup is four round trips. */
const LANDED = { timeout: 10_000 };

/**
 * A unique-per-run email, so repeat runs never collide on the unique index.
 * @param label - A human-readable prefix.
 * @returns An email address nobody else in this run uses.
 */
function uniqueEmail(label: string): string {
  const nonce = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  return `${label}-${nonce}@botholomew.test`;
}

/**
 * Sign up through the real form and wait for the app to land in settings.
 *
 * The landing signal is the section sidebar rather than any one card: it renders
 * before `project:view` resolves, which is exactly the "we are on the page" moment,
 * and it does not move when the default section changes.
 * @param page - The Playwright page.
 * @param name - The display name.
 * @param email - The email to register.
 */
async function signUp(page: Page, name: string, email: string): Promise<void> {
  await page.goto("/sign-up");
  await page.getByTestId("name").fill(name);
  await page.getByTestId("email").fill(email);
  await page.getByTestId("password").fill(PASSWORD);
  await page.getByTestId("confirm").fill(PASSWORD);
  await page.getByTestId("submit").click();
  await expect(page.getByTestId("project-home")).toBeVisible(LANDED);
  await page.getByTestId("project-menu").getByRole("button").click();
  await page.getByTestId("settings-link").click();
  await expect(page.getByTestId("settings-section-nav")).toBeVisible(LANDED);
  // ...and wait for the index route's redirect to settle. The sidebar renders from
  // the parent route, so it is clickable while the URL is still `/settings` — and a
  // section click that lands in that window is undone by the `<Navigate replace>`
  // arriving a moment later, which reads as the sidebar not working.
  await expect(page).toHaveURL(/\/settings\/[a-z-]+$/, LANDED);
}

/**
 * Open one settings section.
 * @param page - The Playwright page.
 * @param slug - The section's slug, e.g. `"tags"`.
 */
async function openSection(page: Page, slug: string): Promise<void> {
  await page.getByTestId(`section-${slug}`).click();
  await expect(page).toHaveURL(new RegExp(`/${slug}$`), LANDED);
}

test.describe("audit log", () => {
  test("date, action, and reset filters request page one before loading", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const projectRequest = page.waitForRequest(
      (request) => new URL(request.url()).pathname === "/api/project",
    );
    await signUp(page, "Paging Pam", uniqueEmail("audit-pages"));
    const projectId = Number(
      new URL((await projectRequest).url()).searchParams.get("projectId"),
    );
    // Each real tag mutation writes a real audit row in the same transaction.
    for (let i = 0; i < 26; i++) {
      const response = await page.request.put(`${BACKEND_URL}/api/tag`, {
        data: { projectId, name: `pagination-${i}` },
      });
      expect(response.ok()).toBe(true);
      expect((await response.json()).error).toBeUndefined();
    }
    await page.getByTestId("project-menu").getByRole("button").click();
    await page.getByTestId("audit-link").click();
    const pages = page.getByTestId("audit-pages");
    await expect(pages).toContainText("1 / 2", LANDED);
    const requests: URL[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.pathname === "/api/audit-logs") requests.push(url);
    });

    for (const change of [
      { testId: "audit-since", value: "2000-01-01" },
      { testId: "audit-until", value: "2099-01-01" },
      { testId: "audit-action", value: "tag:create" },
      { testId: "audit-reset", value: null },
      // Reset must also work when the filters already have their defaults.
      { testId: "audit-reset", value: null },
    ]) {
      const laterPage = page.waitForResponse((response) => {
        const url = new URL(response.url());
        return (
          url.pathname === "/api/audit-logs" &&
          url.searchParams.get("page") === "2"
        );
      });
      await pages.getByRole("button", { name: "Next page" }).click();
      const laterRows = await (await laterPage).json();
      await expect(
        page.getByTestId(`audit-row-${laterRows.auditLogs[0].id}`),
      ).toBeVisible();
      await expect(pages).toContainText("2 / 2");
      const details = page.getByRole("button", {
        name: "details",
        exact: true,
      });
      await details.first().click();
      await expect(page.getByTestId("audit-diff")).toBeVisible();
      requests.length = 0;
      const filtered = page.waitForResponse((response) => {
        const url = new URL(response.url());
        return (
          url.pathname === "/api/audit-logs" &&
          url.searchParams.get("page") === "1"
        );
      });
      if (change.value === null) await page.getByTestId(change.testId).click();
      else await page.getByTestId(change.testId).fill(change.value);
      await filtered;
      await expect(pages).toContainText("1 / 2");
      await expect(page.getByTestId("audit-diff")).toBeHidden();
      expect(requests.length).toBeGreaterThan(0);
      expect(
        requests.every((url) => url.searchParams.get("page") === "1"),
      ).toBe(true);
    }
  });

  test("an admin sees their own changes, with a before/after diff", async ({
    page,
  }) => {
    await signUp(page, "Auditor Anna", uniqueEmail("auditor"));

    // Two mutations to find in the log: a tag created, then renamed.
    await openSection(page, "tags");
    await page.getByTestId("new-tag-name").fill("shipwrights");
    await page.getByTestId("new-tag-submit").click();
    await expect(page.getByTestId("tag-list")).toContainText("shipwrights");

    // Hold `project:view` so the unresolved-standing window is long enough to
    // observe. Without a gate, a fast answer clears `audit-loading` before the
    // assertion runs. A pathname predicate rather than a glob, so a longer path
    // under `/api/project` is never caught with it. StrictMode double-invokes the
    // load effect; the gate holds every match until we release, rather than only
    // the first.
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(
      (url) => url.pathname === "/api/project",
      async (route) => {
        await held;
        await route.continue();
      },
    );

    await page.getByTestId("project-menu").getByRole("button").click();
    await page.getByTestId("audit-link").click();

    // The route transition is the moment under test. `audit-forbidden` is a
    // *claim*, and an admin must never see it — not even for the 200ms before
    // `project:view` answers, which is what `standing ?? { isMember: false,
    // isAdmin: false }` prints on every load of this page. Asserted
    // `toBeHidden` at a moment we chose rather than `toBeVisible` with a retry
    // budget: every other assertion in this file passes whether or not the
    // denial flashed first.
    await expect(page.getByTestId("audit-loading")).toBeVisible();
    await expect(page.getByTestId("audit-forbidden")).toBeHidden();

    release();

    const table = page.getByTestId("audit-table");
    await expect(table).toBeVisible(LANDED);

    // The signup bootstrap's synthetic `project:create` is here too, which is the
    // point of writing it: a project's log opens with its own creation.
    await expect(table).toContainText("project:create");
    await expect(table).toContainText("tag:create");
    await expect(table).toContainText("shipwrights");
    await expect(table).toContainText("Auditor Anna");

    // Expanding the `tag:create` row shows what the mutation produced.
    const row = table.locator("tr", { hasText: "tag:create" }).first();
    await row.getByRole("button", { name: "details" }).click();
    const diff = page.getByTestId("audit-diff");
    await expect(diff).toContainText("added");
    await expect(diff).toContainText("shipwrights");
  });

  test("the action filter narrows the table", async ({ page }) => {
    await signUp(page, "Filter Fred", uniqueEmail("filter"));

    await openSection(page, "tags");
    await page.getByTestId("new-tag-name").fill("carpenters");
    await page.getByTestId("new-tag-submit").click();
    await expect(page.getByTestId("tag-list")).toContainText("carpenters");

    await page.getByTestId("project-menu").getByRole("button").click();
    await page.getByTestId("audit-link").click();
    const table = page.getByTestId("audit-table");
    await expect(table).toContainText("project:create", LANDED);

    await page.getByTestId("audit-action").fill("tag:create");
    await expect(table).toContainText("tag:create");
    await expect(table).not.toContainText("project:create");

    await page.getByTestId("audit-reset").click();
    await expect(table).toContainText("project:create");
  });

  test("a plain member is told they cannot read it", async ({ browser }) => {
    const adminEmail = uniqueEmail("logadmin");
    const guestEmail = uniqueEmail("logguest");

    const adminContext = await browser.newContext();
    const admin = await adminContext.newPage();
    await signUp(admin, "Log Admin", adminEmail);

    const guestContext = await browser.newContext();
    const guest = await guestContext.newPage();
    await signUp(guest, "Log Guest", guestEmail);

    // Add the guest to the admin's project as a plain member, no tags.
    await openSection(admin, "members");
    await admin.getByTestId("new-member-email").fill(guestEmail);
    await admin.getByTestId("new-member-submit").click();
    await expect(admin.getByTestId("members-table")).toContainText(guestEmail);

    await guest.reload();
    await guest.getByTestId("project-switcher-toggle").click();
    await guest
      .getByTestId("project-switcher")
      .locator('[data-testid^="project-option-"]')
      .filter({ hasText: "Log Admin's Project" })
      .click();

    await guest.getByTestId("project-menu").getByRole("button").click();
    await guest.getByTestId("audit-link").click();
    await expect(guest.getByTestId("audit-forbidden")).toBeVisible(LANDED);
    await expect(guest.getByTestId("audit-table")).toHaveCount(0);

    await guestContext.close();
    await adminContext.close();
  });
});
