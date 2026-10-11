import { describe, expect, test } from "bun:test";
import {
  canReadSection,
  DEFAULT_SETTINGS_SECTION,
  SETTINGS_SECTIONS,
} from "../components/settings/sections";

// `sections.ts` is deliberately pure — no JSX, no router — so what goes quietly
// wrong in it can be asserted without a render harness. There is no
// component-render setup in this suite and this test does not invent one.

const ADMIN = { isMember: true, isAdmin: true };
const MEMBER = { isMember: true, isAdmin: false };
const OUTSIDER = { isMember: false, isAdmin: false };

/** The `actions:permissions` map, as far as these sections care about it. */
const PERMISSIONS = {
  "invite:list": { type: "admin" },
  "audit:list": { type: "admin" },
} as unknown as Parameters<typeof canReadSection>[1];

describe("the settings section table", () => {
  test("lists exactly the five sections the shell has", () => {
    expect(SETTINGS_SECTIONS.map((s) => s.slug)).toEqual([
      "general",
      "mcp",
      "members",
      "tags",
      "danger",
    ]);
  });

  test("every slug is unique and URL-safe", () => {
    const slugs = SETTINGS_SECTIONS.map((s) => s.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const slug of slugs) expect(slug).toMatch(/^[a-z][a-z-]*$/);
  });

  test("the default section exists and every member can read it", () => {
    // Signup, sign-in, the project switcher, and the homepage CTA all land on
    // `/settings`, which redirects here. A default whose data is admin-gated
    // would make every plain member's landing page a dead end.
    const fallback = SETTINGS_SECTIONS.find(
      (s) => s.slug === DEFAULT_SETTINGS_SECTION,
    );
    expect(fallback).toBeDefined();
    expect(fallback?.readAction).toBeNull();
  });

  test("each group's sections are contiguous in the table", () => {
    // `SectionNav` derives its headings with `new Set` over the items in table
    // order and then filters, so a group whose entries are split across the table
    // still renders under one heading — correctly, but nothing like the way the
    // table reads. This keeps the source of truth honest about the output.
    const seen = new Set<string>();
    let previous = "";
    for (const section of SETTINGS_SECTIONS) {
      if (section.group !== previous) {
        expect(seen.has(section.group)).toBe(false);
        seen.add(section.group);
        previous = section.group;
      }
    }
  });

  test("no section reads an admin-gated endpoint", () => {
    // Pinned, and kept in step with the backend's middleware by hand. Every
    // section reads `project:view`, `membership:list`, or `tag:list`, all of
    // which any member may call; the admin-only controls inside a section are
    // gated with `may()` instead. A new section that fetches from an
    // `AdminMiddleware` route without declaring it 403s for every plain member
    // who opens it, and this is what fails instead.
    const gated = SETTINGS_SECTIONS.filter((s) => s.readAction !== null).map(
      (s) => s.slug,
    );
    expect(gated).toEqual([]);
  });

  test("a read requirement is an action name, never an RBAC level", () => {
    // `"admin"` would type-check and read fine, and `can()` would answer `false`
    // for it forever — an admin-only section nobody, including an admin, could
    // read.
    for (const section of SETTINGS_SECTIONS) {
      if (section.readAction === null) continue;
      expect(section.readAction).toMatch(/^[a-z-]+:[a-z-]+$/);
    }
  });
});

describe("deciding whether a section may fetch", () => {
  test("a gated section stays shut until the permission map arrives", () => {
    // `can()`'s own rule: an unknown action is assumed gated. A section that
    // fetched on the strength of a not-yet-loaded map would 403 on first paint,
    // and the reader would be told they are not an admin when they are.
    for (const section of SETTINGS_SECTIONS) {
      expect(canReadSection(section, null, ADMIN)).toBe(
        section.readAction === null,
      );
    }
  });

  test("an outsider reads nothing, even where no action is named", () => {
    for (const section of SETTINGS_SECTIONS) {
      expect(canReadSection(section, PERMISSIONS, OUTSIDER)).toBe(false);
    }
  });

  test("a member reads the ungated sections and none of the gated ones", () => {
    for (const section of SETTINGS_SECTIONS) {
      expect(canReadSection(section, PERMISSIONS, MEMBER)).toBe(
        section.readAction === null,
      );
    }
  });

  test("an admin reads all of them", () => {
    for (const section of SETTINGS_SECTIONS) {
      expect(canReadSection(section, PERMISSIONS, ADMIN)).toBe(true);
    }
  });
});
