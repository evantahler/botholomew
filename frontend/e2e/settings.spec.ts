import { expect, type Page, test } from "@playwright/test";

/**
 * The project settings area in a real browser: the five sections are listed and
 * one is mounted at a time, renaming the project moves the navbar's switcher,
 * and leaving a section with an unsaved edit asks first — beside a sidebar and
 * behind a phone's disclosure alike.
 *
 * `/settings` is a sidebar of sections at `/settings/<slug>`, so every test here
 * opens the section it is about — and a failure appears inside that section's
 * own card rather than in a page-level alert above all of them.
 *
 * Like the other specs, this shares one backend with every suite and cannot clear
 * its database, so it mints unique addresses and asserts on rows it created.
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
 * The landing signal is the sidebar rather than any one card: it renders before
 * `project:view` resolves, which is exactly the "we are on the page" moment, and it
 * does not move when the default section changes.
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
 * @param slug - The section's slug, e.g. `"members"`.
 */
async function openSection(page: Page, slug: string): Promise<void> {
  await page.getByTestId(`section-${slug}`).click();
  await expect(page).toHaveURL(new RegExp(`/${slug}$`), LANDED);
}

test.describe("project settings", () => {
  test("every section is listed, and one is mounted at a time", async ({
    page,
  }) => {
    await signUp(page, "Navvy Nadia", uniqueEmail("nav"));

    // Listed rather than gated on standing, admin-only sections included: a deep
    // link mounts the section whatever the sidebar says, so the notice has to be
    // inside the card anyway, and gating the list would flash it disabled→enabled
    // for every admin on every load.
    const slugs = ["general", "mcp", "members", "tags", "danger"];
    for (const slug of slugs) {
      await expect(page.getByTestId(`section-${slug}`)).toBeVisible();
    }
    // Exactly these five: a section the shell does not have must not be listed.
    await expect(
      page
        .getByTestId("settings-section-nav")
        .locator('a[data-testid^="section-"]'),
    ).toHaveCount(slugs.length);

    // `/settings` redirects to the default section rather than rendering all five.
    await expect(page).toHaveURL(/\/settings\/general$/);
    await expect(page.getByTestId("project-name-card")).toBeVisible(LANDED);
    await expect(page.getByTestId("members-card")).toHaveCount(0);

    // Opening another section unmounts the first.
    await openSection(page, "members");
    await expect(page.getByTestId("members-card")).toBeVisible(LANDED);
    await expect(page.getByTestId("project-name-card")).toHaveCount(0);

    await openSection(page, "mcp");
    await expect(page.getByTestId("mcp-card")).toBeVisible(LANDED);
    await expect(page.getByTestId("mcp-url")).toHaveValue(/\/mcp$/);
    await expect(page.getByTestId("members-card")).toHaveCount(0);

    // A typo'd bookmark says so, inside the settings chrome, rather than falling
    // through to the app-level catch-all.
    await page.goto("/settings/nonsense");
    await expect(page.getByTestId("no-such-section")).toBeVisible(LANDED);
    await expect(page.getByTestId("settings-section-nav")).toBeVisible();
  });

  test("renaming the project moves the navbar's switcher with it", async ({
    page,
  }) => {
    // The only thing that catches a dropped `refresh()`: the switcher reads
    // `AuthContext`, not this page, so a rename that skips it succeeds everywhere
    // except the one place the user is looking.
    await signUp(page, "Rena Namer", uniqueEmail("rename"));

    await expect(page.getByTestId("project-name")).toBeVisible(LANDED);
    await page.getByTestId("project-name").fill("Renamed by e2e");
    await page.getByTestId("save-general").click();
    await expect(page.getByTestId("general-notice")).toBeVisible(LANDED);

    await expect(page.getByTestId("project-switcher-toggle")).toHaveText(
      "Renamed by e2e",
      LANDED,
    );
  });

  test("leaving a section with unsaved edits asks first", async ({ page }) => {
    // The one way out of a dirty section the sidebar can actually see, since
    // browser Back needs a data router this app does not use.
    await signUp(page, "Dirty Dora", uniqueEmail("dirty"));

    await expect(page.getByTestId("project-name")).toBeVisible(LANDED);
    await page.getByTestId("project-name").fill("Half-typed name");
    await expect(page.getByTestId("section-dirty")).toBeVisible();

    await page.getByTestId("section-members").click();
    await expect(page.getByTestId("discard-changes-modal")).toBeVisible();

    // Staying keeps both the URL and the draft.
    await page.getByTestId("discard-cancel").click();
    await expect(page).toHaveURL(/\/settings\/general$/);
    await expect(page.getByTestId("project-name")).toHaveValue(
      "Half-typed name",
    );

    await page.getByTestId("section-members").click();
    await page.getByTestId("discard-confirm").click();
    await expect(page).toHaveURL(/\/settings\/members$/, LANDED);
    await expect(page.getByTestId("members-table")).toBeVisible(LANDED);

    // ...and the draft is gone, rather than waiting to be posted by the next save.
    await page.getByTestId("section-general").click();
    await expect(page.getByTestId("project-name")).not.toHaveValue(
      "Half-typed name",
      LANDED,
    );
  });

  test("the narrow disclosure closes even when the guard answers first", async ({
    page,
  }) => {
    // On a phone the section list is a disclosure over the section, not a sidebar
    // beside it, so leaving it open hides the thing the reader just chose. A list
    // that closes only on the *immediate* path stays open when the guard
    // intercepts the click, because the navigation the modal performs afterwards
    // is nothing the list is watching — and the guard is the one case where a
    // reader is most likely to lose their place.
    await signUp(page, "Narrow Nadia", uniqueEmail("narrow"));
    await page.setViewportSize({ width: 390, height: 844 });

    const list = page.locator(".bh-sidenav");
    const toggle = page.getByTestId("section-nav-toggle");

    await expect(page.getByTestId("project-name")).toBeVisible(LANDED);
    await page.getByTestId("project-name").fill("Half-typed name");

    // The dirty marker is *inside* the list, so a closed disclosure is also the
    // only place it cannot be read — one more reason this path is worth a test.
    await toggle.click();
    await expect(list).toBeVisible();
    await expect(page.getByTestId("section-dirty")).toBeVisible();

    await page.getByTestId("section-members").click();
    await expect(page.getByTestId("discard-changes-modal")).toBeVisible();
    await page.getByTestId("discard-confirm").click();

    await expect(page).toHaveURL(/\/settings\/members$/, LANDED);
    await expect(page.getByTestId("members-table")).toBeVisible(LANDED);
    await expect(list).toBeHidden();
    await expect(toggle).toHaveText("Members");
  });
});
