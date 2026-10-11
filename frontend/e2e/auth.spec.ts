import { expect, type Page, test } from "@playwright/test";
import { BACKEND_URL } from "./env.ts";

/**
 * The whole tenancy walkthrough, in a real browser: sign up → land
 * in your own project as its admin → create a tag → invite a second address → sign
 * up as that address → see the invite → accept → appear in the members list with
 * the tag.
 *
 * These specs share one backend with every other suite and cannot clear its
 * database, so each run mints unique email addresses rather than assuming an empty
 * world.
 */

const PASSWORD = "password123";

/**
 * Timeout for the "did we land?" assertions. Signing in or up is a chain of four
 * sequential round trips (`user:create` → `session:create` → `me:view` →
 * `project:list`) before the page even mounts and fetches its own data, so the
 * default 5s expectation is tight once several specs run in parallel against one
 * dev-mode backend. Everything else keeps the default.
 */
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
 * Sign up through the real form and wait for the project home.
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
  await expect(page).toHaveURL(/\/home$/, LANDED);
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

test.describe("tenancy", () => {
  test("signup lands the user in their own project as its admin", async ({
    page,
  }) => {
    const email = uniqueEmail("owner");
    await signUp(page, "Owner One", email);

    await expect(page).toHaveURL(/\/home$/, LANDED);
    // The signup bootstrap named the project after them…
    await expect(page.getByTestId("project-switcher-toggle")).toContainText(
      "Owner One's Project",
    );
    // …made them its admin, so the admin-only rename control is present…
    await page.getByTestId("project-menu").getByRole("button").click();
    await page.getByTestId("settings-link").click();
    await expect(page).toHaveURL(/\/settings\/general$/, LANDED);
    await expect(page.getByTestId("project-name")).toBeVisible();
    // …and gave them the reserved tag, which has no delete affordance.
    await openSection(page, "tags");
    await expect(page.getByTestId("tag-list")).toContainText("admin");
    await expect(
      page.getByRole("button", { name: "Delete the admin tag" }),
    ).toHaveCount(0);
    // The navbar knows who they are.
    await expect(page.getByTestId("user-menu-toggle")).toContainText(
      "Owner One",
    );
  });

  test("the landing page sends a signed-in visitor to their project", async ({
    page,
  }) => {
    const email = uniqueEmail("lander");
    await signUp(page, "Lander One", email);

    // Read the project's name off the switcher rather than re-deriving the
    // string the signup bootstrap chose.
    const projectName = (
      await page.getByTestId("project-switcher-toggle").innerText()
    ).trim();

    await page.goto("/");

    // Scoped to the hero: the navbar carries its own "Settings" link and its own
    // "Sign in" item, so an unscoped role query would be asserting the chrome.
    const cta = page.getByTestId("hero-cta");

    // The signed-out pair must be gone — asking a signed-in user to sign in is
    // the whole bug.
    await expect(cta.getByRole("link", { name: "Get started" })).toHaveCount(0);
    await expect(cta.getByRole("link", { name: "Sign in" })).toHaveCount(0);

    await expect(
      cta.getByRole("link", { name: `Go to ${projectName}` }),
    ).toBeVisible(LANDED);
    await expect(cta.getByRole("link", { name: "Settings" })).toBeVisible();

    await page.getByTestId("brand").click();
    await expect(page.getByTestId("project-home")).toBeVisible(LANDED);
    await expect(page).toHaveURL(/\/home$/, LANDED);

    await page.goto("/");
    await cta.getByRole("link", { name: `Go to ${projectName}` }).click();
    await expect(page.getByTestId("project-home")).toBeVisible(LANDED);
    await expect(page).toHaveURL(/\/home$/, LANDED);
  });

  test("the signed-in user menu opens the live style guide", async ({
    page,
  }) => {
    await signUp(page, "Stylist Sky", uniqueEmail("stylist"));

    await page.getByTestId("user-menu-toggle").click();
    await page.getByTestId("style-guide-link").click();

    await expect(page).toHaveURL(/\/style-guide$/, LANDED);
    await expect(
      page.getByRole("heading", { name: "Style guide", exact: true }),
    ).toBeVisible(LANDED);
  });

  test("the signed-in user menu opens the backend's API reference", async ({
    page,
  }) => {
    await signUp(page, "Reader Rex", uniqueEmail("reader"));

    await page.getByTestId("user-menu-toggle").click();
    const link = page.getByTestId("api-reference-link");
    await expect(link).toHaveAttribute("href", `${BACKEND_URL}/api/swagger`);

    // Clicking it opens a tab this spec then has to manage, and the thing worth
    // asserting is that the address answers and is not a 404: the backend
    // serves the OpenAPI document itself, with no session.
    const reference = await page.request.get(`${BACKEND_URL}/api/swagger`);
    expect(reference.status()).toBe(200);
    expect((await reference.json()).openapi).toMatch(/^3\./);
  });

  test("the full invite lifecycle, admin to invitee", async ({ browser }) => {
    const adminEmail = uniqueEmail("admin");
    const guestEmail = uniqueEmail("guest");

    const adminContext = await browser.newContext();
    const admin = await adminContext.newPage();
    await signUp(admin, "Admin Ada", adminEmail);

    // Create a tag to grant with the invite.
    await admin.getByTestId("project-menu").getByRole("button").click();
    await admin.getByTestId("settings-link").click();
    await expect(admin).toHaveURL(/\/settings\/general$/, LANDED);
    await openSection(admin, "tags");
    await admin.getByTestId("new-tag-name").fill("operators");
    await admin.getByTestId("new-tag-submit").click();
    await expect(admin.getByTestId("tag-list")).toContainText("operators");

    // Invite the guest, granting that tag.
    await admin.getByTestId("project-menu").getByRole("button").click();
    await admin.getByTestId("invites-link").click();
    await admin.getByTestId("invite-email").fill(guestEmail);
    await admin.getByLabel("operators").check();
    await admin.getByTestId("invite-submit").click();
    await expect(admin.getByTestId("invites-notice")).toContainText(
      "No email is sent",
      LANDED,
    );
    await expect(admin.getByTestId("sent-invites")).toContainText(guestEmail);
    await expect(admin.getByTestId("sent-invites")).toContainText("pending");

    // A separate browser context: the guest is a different session, not a tab.
    const guestContext = await browser.newContext();
    const guest = await guestContext.newPage();
    await signUp(guest, "Guest Gus", guestEmail);

    // The invite is waiting for them, keyed on their email, on their first visit.
    await guest.getByTestId("project-menu").getByRole("button").click();
    await guest.getByTestId("invites-link").click();
    const pending = guest.getByTestId("pending-invites");
    await expect(pending).toContainText("Admin Ada's Project", LANDED);
    await expect(pending).toContainText(adminEmail);

    await pending.getByRole("button", { name: "Accept" }).click();
    await expect(pending).toContainText("No pending invitations.");

    // Accepting joined them to the project, so the switcher now offers both their
    // own bootstrap project and the one they just joined.
    await guest.getByTestId("project-switcher-toggle").click();
    const options = guest
      .getByTestId("project-switcher")
      .locator('[data-testid^="project-option-"]');
    await expect(options).toHaveCount(2);
    await options.filter({ hasText: "Admin Ada's Project" }).click();
    await expect(guest.getByTestId("project-home")).toBeVisible(LANDED);
    await expect(guest).toHaveURL(/\/home$/, LANDED);
    await guest.getByTestId("project-menu").getByRole("button").click();
    await guest.getByTestId("settings-link").click();
    await expect(guest).toHaveURL(/\/settings\/general$/, LANDED);

    // They are a plain member of it: every section is still *listed* — the rule
    // `Layout` follows for session-gated menu items, and the reason is the same,
    // that one selector resolves in both states — and each one says for itself what
    // a member may do there.
    await expect(guest.getByTestId("project-name-readonly")).toBeVisible(
      LANDED,
    );

    await openSection(guest, "members");
    await expect(guest.getByTestId("members-table")).toContainText(guestEmail);

    // The tag list is readable and the add control is not. Asserting the list is
    // *visible* is what keeps the count-0 honest: with sections mounted one at a
    // time, "no add-tag field" would otherwise pass on any page that simply is not
    // the tags section.
    await openSection(guest, "tags");
    await expect(guest.getByTestId("tag-list")).toBeVisible();
    await expect(guest.getByTestId("new-tag-name")).toHaveCount(0);

    await openSection(guest, "danger");
    await expect(guest.getByTestId("danger-card")).toHaveCount(0);
    await expect(guest.getByTestId("danger-admin-only")).toBeVisible();

    // And from the admin's side, they show up with the tag the invite granted.
    await admin.getByTestId("project-menu").getByRole("button").click();
    await admin.getByTestId("settings-link").click();
    await openSection(admin, "members");
    const guestRow = admin
      .getByTestId("members-table")
      .locator("tr", { hasText: guestEmail });
    await expect(guestRow).toContainText("operators");

    await guestContext.close();
    await adminContext.close();
  });

  test("signing out closes the app and signing in reopens it", async ({
    page,
  }) => {
    const email = uniqueEmail("returning");
    await signUp(page, "Returning Rita", email);

    await page.getByTestId("user-menu-toggle").click();
    await page.getByTestId("sign-out").click();
    await expect(page.getByTestId("user-menu-toggle")).toContainText(
      "Signed out",
    );

    // A protected route now bounces to the sign-in form.
    await page.goto("/settings");
    await expect(page.getByTestId("sign-in-card")).toBeVisible(LANDED);

    await page.getByTestId("email").fill(email);
    await page.getByTestId("password").fill(PASSWORD);
    await page.getByTestId("submit").click();
    await expect(page.getByTestId("project-home")).toBeVisible(LANDED);
    await expect(page).toHaveURL(/\/home$/, LANDED);
    await expect(page.getByTestId("user-menu-toggle")).toContainText(
      "Returning Rita",
    );

    // ...and signed in, that same address opens the settings area on its default
    // section.
    await page.goto("/settings");
    await expect(page.getByTestId("project-name-card")).toBeVisible(LANDED);
    await expect(page).toHaveURL(/\/settings\/general$/, LANDED);
  });

  test("menus dismiss safely and a disabled item goes nowhere", async ({
    page,
  }) => {
    await signUp(page, "Keyboard Kira", uniqueEmail("keyboard"));

    const userMenu = page.getByTestId("user-menu");
    await page.getByTestId("user-menu-toggle").click();
    await expect(userMenu.getByTestId("sign-out")).toBeVisible();
    await page.getByTestId("project-home").getByRole("heading").first().click();
    await expect(userMenu.getByTestId("sign-out")).toHaveCount(0);

    await page.getByTestId("user-menu-toggle").click();
    const disabledSignIn = userMenu.getByTestId("sign-in");
    await disabledSignIn.focus();
    await disabledSignIn.press("Enter");
    await expect(page).toHaveURL(/\/home$/);
  });

  test("a wrong password is refused with the backend's own wording", async ({
    page,
  }) => {
    const email = uniqueEmail("careful");
    await signUp(page, "Careful Carl", email);
    await page.getByTestId("user-menu-toggle").click();
    await page.getByTestId("sign-out").click();

    await page.goto("/sign-in");
    await page.getByTestId("email").fill(email);
    await page.getByTestId("password").fill("not-the-password");
    await page.getByTestId("submit").click();

    // The same message the backend gives for an unknown email — the page does not
    // editorialize about which half was wrong.
    await expect(page.getByTestId("form-error")).toContainText(
      "Invalid email or password",
      LANDED,
    );
  });

  test("the account form never renders empty", async ({ page }) => {
    await signUp(page, "Account Ann", uniqueEmail("account"));

    await page.getByTestId("user-menu-toggle").click();
    await page.getByTestId("account-link").click();

    // Two empty boxes labelled Name and Email are not a loading state — they are
    // an account with no name, which is a different and wrong claim, and a fast
    // typist could have submitted one. The field either holds the session's own
    // name or does not exist yet, so this asserts the *absence* of the wrong
    // thing before waiting for the right one.
    await expect(page.getByTestId("account-name")).not.toHaveValue("");
    await expect(page.getByTestId("account-name")).toHaveValue(
      "Account Ann",
      LANDED,
    );
  });
});
