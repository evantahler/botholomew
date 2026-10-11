import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_DOCS_SECTION,
  DOCS_SECTIONS,
  findDocsSection,
} from "../content/docs/sections";

// `sections.ts` is deliberately pure aside from the `?raw` markdown imports —
// no JSX, no router — so the table can be asserted without a render harness.

const CONTENT_DIR = join(import.meta.dir, "..", "content", "docs");

describe("the docs section table", () => {
  test("every slug is unique and URL-safe", () => {
    const slugs = DOCS_SECTIONS.map((s) => s.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const slug of slugs) expect(slug).toMatch(/^[a-z][a-z0-9-]*$/);
  });

  test("lists exactly the six pages the shell documents, in order", () => {
    expect(DOCS_SECTIONS.map((s) => s.slug)).toEqual([
      "overview",
      "getting-started",
      "teams",
      "cli",
      "mcp",
      "security",
    ]);
  });

  test("the default section exists and is the overview", () => {
    // `/docs` redirects here: a first visit should answer "what is this"
    // before anything else.
    const fallback = DOCS_SECTIONS.find((s) => s.slug === DEFAULT_DOCS_SECTION);
    expect(fallback).toBeDefined();
    expect(DEFAULT_DOCS_SECTION).toBe("overview");
  });

  test("each group's sections are contiguous in the table", () => {
    // `SectionNav` derives headings with `new Set` over table order, so a split
    // group still renders under one heading — correctly, but nothing like the
    // way the table reads. Keep the source of truth honest about the output.
    const seen = new Set<string>();
    let previous = "";
    for (const section of DOCS_SECTIONS) {
      if (section.group !== previous) {
        expect(seen.has(section.group)).toBe(false);
        seen.add(section.group);
        previous = section.group;
      }
    }
  });

  test("every section has non-empty markdown with a top-level heading", () => {
    for (const section of DOCS_SECTIONS) {
      expect(section.source.trim().length).toBeGreaterThan(0);
      expect(section.source).toMatch(/^# /m);
    }
  });

  test("every markdown file in content/docs is registered", () => {
    // A stray `.md` that never lands in `DOCS_SECTIONS` is an unpublished page;
    // a registered slug without a file fails the `?raw` import at load time.
    const onDisk = readdirSync(CONTENT_DIR)
      .filter((name) => name.endsWith(".md"))
      .map((name) => name.replace(/\.md$/, ""))
      .sort();
    const registered = DOCS_SECTIONS.map((s) => s.slug).sort();
    expect(registered).toEqual(onDisk);
  });

  test("no page names a plan phase", () => {
    // User docs describe the product, not the schedule it is built on.
    for (const section of DOCS_SECTIONS) {
      expect(section.source).not.toMatch(/\bphase\s*\d/i);
      expect(section.source).not.toContain("docs/plans");
    }
  });

  test("the overview says the bots are in development and links v1", () => {
    // The one claim a shell must never make is that a bot exists.
    const overview = findDocsSection("overview");
    expect(overview?.source).toContain("in development");
    expect(overview?.source).toContain(
      "https://github.com/evantahler/botholomew/tree/v1",
    );
  });

  test("security states the boundary the shell enforces", () => {
    const security = findDocsSection("security");
    expect(security?.source).toContain("Membership grants read");
    expect(security?.source).toContain("grants administration");
    expect(security?.source).toContain("no foreign key");
    expect(security?.source).toContain("SECRETS_ENCRYPTION_KEY");
    expect(security?.source).toContain("refuses to boot");
  });

  test("the CLI page documents every command group the CLI has", () => {
    const cli = findDocsSection("cli");
    for (const command of [
      "login",
      "logout",
      "whoami",
      "project list",
      "project use",
      "tag assign",
      "tag unassign",
      "member add",
      "member remove",
      "invite pending",
      "invite accept",
      "invite reject",
      "audit list",
    ]) {
      expect(cli?.source).toContain(command);
    }
    expect(cli?.source).toContain("bun run --cwd cli botholomew");
    expect(cli?.source).toContain("https://api.botholomew.com");
  });

  test("findDocsSection returns undefined for an unknown slug", () => {
    expect(findDocsSection("no-such-page")).toBeUndefined();
  });
});
