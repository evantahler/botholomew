import { type ReactNode, useId, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import Button from "#ui/Button";
import Card from "#ui/Card";
import Nav from "#ui/Nav";

/** One item in a {@link SectionNav}. */
export interface SectionNavItem {
  /** The URL segment, which keys this item's `data-testid`. */
  slug: string;
  /** What the sidebar calls it. */
  label: string;
  /** The heading it sits under. Groups are rendered in first-seen order. */
  group: string;
  /**
   * Where it points, or `null` when there is nowhere to go.
   *
   * A `null` renders a real `<span>` rather than a link with
   * `pointer-events: none`: a disabled control must not be focusable or announced
   * as a link, and `aria-disabled` is what the e2e suite asserts on.
   */
  to: string | null;
  /** Rendered as the current section rather than as disabled, while `to` is null. */
  current?: boolean;
  /** Why it is not a link, for the `title` attribute. */
  disabledReason?: string;
}

/** See {@link SectionNav}. */
export interface SectionNavProps {
  /** The root card's `data-testid`. */
  testId: string;
  /** The items, in the order they should appear within their groups. */
  items: readonly SectionNavItem[];
  /** Problems per slug, for the sidebar markers. Unused where there is no validator. */
  problemCounts?: Record<string, { errors: number; warnings: number }>;
  /** Which section is holding unsaved edits, if any. */
  dirtySlug?: string | null;
  /**
   * Intercept a navigation.
   *
   * A shell uses it to ask before discarding a dirty draft. It returns whether the
   * navigation was handled — `true` means this component must not let the link
   * proceed.
   *
   * **This is why there is no `useBlocker`.** React Router 7's blocker requires a
   * data router (`createBrowserRouter` + `RouterProvider`) and throws outside one;
   * the app is built on `<BrowserRouter>`, and migrating restructures how
   * `AuthProvider` and `LiveSocketProvider` nest. Do not "fix" this without doing
   * that migration deliberately. See `useDirtyGuard` for the other half.
   */
  onNavigate?: (slug: string) => boolean;
  /** A note under the list, e.g. why half the items are disabled. */
  footer?: ReactNode;
}

/**
 * A sidebar of sections, shared by the project settings area and the docs.
 *
 * `Nav.Link as={NavLink}` rather than a comparison in JSX, so `.active` comes from
 * the router and cannot disagree with the URL. Deliberately **not**
 * `<Tab.Container>` or `Nav variant="tabs"`: `Tab` owns its own active key and
 * would fight the router, and tabs imply the URL does not change — which is the
 * opposite of the point, since every section is a deep link.
 *
 * It takes **items rather than a registry**, so each area keeps its own table with
 * its own extra fields — `readAction` for settings, `source` for docs — and maps
 * it here. The per-item testids (`section-<slug>`, `section-dirty`,
 * `section-problems-<slug>`) are identical across every nav, which is what lets
 * one `openSection(page, slug)` e2e helper drive any area.
 *
 * **Below `md` the list is a disclosure, closed until asked for.** It is a sidebar
 * only where there is a side: in one column it is however many sections tall,
 * above the thing the reader came for. Do not restyle it as a horizontally
 * scrolling strip at that width: `Nav`'s own `flex-column` carries `!important`
 * and wins, and the groups are block elements, so a row of them is as tall as
 * the longest one anyway.
 *
 * The list itself is always **rendered**, and only hidden — `d-none d-md-block`
 * rather than a mount — so one `getByTestId("section-…")` resolves at either width
 * and the desktop layout owes nothing to state.
 * @param props - See {@link SectionNavProps}.
 * @returns The rendered sidebar.
 */
export default function SectionNav({
  testId,
  items,
  problemCounts = {},
  dirtySlug = null,
  onNavigate,
  footer,
}: SectionNavProps) {
  // Derived from the items rather than passed in, so a group list cannot drift
  // from the sections that claim to be in it.
  const groups = [...new Set(items.map((item) => item.group))];

  const [open, setOpen] = useState(false);
  const listId = useId();
  const { pathname } = useLocation();

  // What the closed disclosure is named. The URL rather than `.active`, because
  // `.active` is the router's business inside each link and is not readable from
  // out here; `current` covers an item whose section is not a link.
  const here =
    items.find((item) => item.to !== null && item.to === pathname) ??
    items.find((item) => item.current);

  return (
    <Card data-testid={testId}>
      <Card.Body className="p-2">
        <Button
          variant="outline-secondary"
          size="sm"
          className="d-md-none w-100 bh-sidenav-toggle"
          aria-expanded={open}
          aria-controls={listId}
          onClick={() => setOpen((wasOpen) => !wasOpen)}
          data-testid="section-nav-toggle"
        >
          {here ? here.label : "Sections"}
        </Button>

        <Nav
          id={listId}
          className={`flex-column bh-sidenav ${open ? "" : "d-none d-md-flex"}`}
        >
          {groups.map((group) => (
            <div key={group} className="mb-2">
              <div className="bh-mono-label px-2 pb-1">{group}</div>
              {items
                .filter((item) => item.group === group)
                .map((item) => {
                  const counts = problemCounts[item.slug];
                  const dirty = dirtySlug === item.slug;

                  if (item.to === null) {
                    return (
                      <span
                        key={item.slug}
                        className={
                          item.current ? "nav-link active" : "nav-link disabled"
                        }
                        aria-current={item.current ? "page" : undefined}
                        aria-disabled={item.current ? undefined : "true"}
                        title={item.current ? undefined : item.disabledReason}
                        data-testid={`section-${item.slug}`}
                      >
                        {item.label}
                      </span>
                    );
                  }

                  return (
                    <Nav.Link
                      key={item.slug}
                      as={NavLink}
                      to={item.to}
                      data-testid={`section-${item.slug}`}
                      onClick={(event: React.MouseEvent) => {
                        if (onNavigate?.(item.slug)) event.preventDefault();
                        // A disclosure that stays open after a choice leaves the
                        // reader exactly where they started: looking at the list.
                        // Closed on every click, including an intercepted one —
                        // the dirty guard answers in a modal and then navigates
                        // itself, so a close that only ran on the immediate path
                        // leaves the list covering the section it just opened.
                        setOpen(false);
                      }}
                    >
                      {item.label}
                      {dirty && (
                        <>
                          <span
                            className="bh-nav-dirty"
                            aria-hidden="true"
                            data-testid="section-dirty"
                          />
                          <span className="visually-hidden">
                            {" "}
                            unsaved changes
                          </span>
                        </>
                      )}
                      {counts && (counts.errors > 0 || counts.warnings > 0) && (
                        <span
                          className={
                            counts.errors > 0
                              ? "bh-nav-count bh-danger"
                              : "bh-nav-count bh-warning"
                          }
                          data-testid={`section-problems-${item.slug}`}
                        >
                          {counts.errors + counts.warnings}
                        </span>
                      )}
                    </Nav.Link>
                  );
                })}
            </div>
          ))}
        </Nav>

        {/* Under the list because it explains the list — a note about why half the
            sections are disabled is noise beside a closed disclosure. */}
        {footer && (
          <div className={open ? undefined : "d-none d-md-block"}>{footer}</div>
        )}
      </Card.Body>
    </Card>
  );
}
