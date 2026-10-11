import type { AuditList } from "@backend/actions/audit/audit-list";
import type { MembershipList } from "@backend/actions/membership/membership-list";
import type { ProjectView } from "@backend/actions/project/project-view";
import type { ActionResponse } from "keryx";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import Alert from "#ui/Alert";
import Badge from "#ui/Badge";
import Button from "#ui/Button";
import Card from "#ui/Card";
import Form from "#ui/Form";
import Pagination from "#ui/Pagination";
import Table from "#ui/Table";
import LoadingLabel from "../components/LoadingLabel";
import SkeletonRows from "../components/SkeletonRows";
import { useAuth } from "../context/AuthContext";
import { useFirstLoad } from "../hooks/useFirstLoad";
import { apiFetch } from "../utils/client";
import { can } from "../utils/permissions";

type AuditEntry = ActionResponse<AuditList>["auditLogs"][number];
type PageInfo = ActionResponse<AuditList>["pagination"];
type Standing = ActionResponse<ProjectView>["standing"];
type Member = ActionResponse<MembershipList>["memberships"][number];

/** How many entries a page holds. Matches the backend's `defaultLimit`. */
const PAGE_SIZE = 25;

/** How far back the range starts when the page first loads. */
const DEFAULT_WINDOW_DAYS = 7;

/**
 * Format a `Date` as the `YYYY-MM-DD` an `<input type="date">` expects, in the
 * viewer's own timezone — `toISOString()` would shift the day for anyone west of
 * UTC and quietly drop today's entries out of the default range.
 * @param date - The date to format.
 * @returns The `YYYY-MM-DD` string.
 */
function toDateInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** What changed about one key between an audit row's `before` and `after`. */
type DiffKind = "added" | "removed" | "changed";

interface Diff {
  key: string;
  kind: DiffKind;
  oldVal?: unknown;
  newVal?: unknown;
}

/**
 * Compute a field-level diff between an audit row's two snapshots. Keys whose
 * values match are omitted, so an expanded row shows only what moved.
 * @param before - The pre-mutation snapshot, or null.
 * @param after - The post-mutation snapshot, or null.
 * @returns The added, removed, and changed keys.
 */
function computeDiff(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): Diff[] {
  const diffs: Diff[] = [];
  const keys = new Set([
    ...Object.keys(before ?? {}),
    ...Object.keys(after ?? {}),
  ]);

  for (const key of keys) {
    const inBefore = !!before && key in before;
    const inAfter = !!after && key in after;
    const oldVal = inBefore ? before[key] : undefined;
    const newVal = inAfter ? after[key] : undefined;

    if (!inBefore && inAfter) {
      diffs.push({ key, kind: "added", newVal });
    } else if (inBefore && !inAfter) {
      diffs.push({ key, kind: "removed", oldVal });
    } else if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
      diffs.push({ key, kind: "changed", oldVal, newVal });
    }
  }

  return diffs.sort((a, b) => a.key.localeCompare(b.key));
}

/**
 * The before/after diff for one entry, plus its scrubbed params.
 * @param props.entry - The audit entry to expand.
 * @returns The rendered detail rows.
 */
function EntryDetail({ entry }: { entry: AuditEntry }) {
  const before = (entry.before ?? null) as Record<string, unknown> | null;
  const after = (entry.after ?? null) as Record<string, unknown> | null;
  const diffs = computeDiff(before, after);

  return (
    <>
      {!before && !after && (
        <p className="bh-muted mb-2">No state was captured for this entry.</p>
      )}
      {(before || after) && diffs.length === 0 && (
        <p className="bh-muted mb-2">Nothing changed.</p>
      )}
      {diffs.length > 0 && (
        <Table size="sm" className="mb-3" data-testid="audit-diff">
          <tbody>
            {diffs.map((d) => (
              <tr key={d.key}>
                <td style={{ width: "12rem" }}>
                  <Badge
                    bg={
                      d.kind === "added"
                        ? "success"
                        : d.kind === "removed"
                          ? "danger"
                          : "warning"
                    }
                    className="me-2"
                  >
                    {d.kind}
                  </Badge>
                  <code>{d.key}</code>
                </td>
                <td>
                  {d.kind !== "added" && (
                    <del className="text-danger">
                      {JSON.stringify(d.oldVal)}
                    </del>
                  )}
                  {d.kind === "changed" && " → "}
                  {d.kind !== "removed" && (
                    <ins className="text-success">
                      {JSON.stringify(d.newVal)}
                    </ins>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <p className="bh-mono-label mb-1">Params</p>
      <pre className="bh-out mb-0">
        {JSON.stringify(entry.metadata, null, 2)}
      </pre>
    </>
  );
}

/**
 * `/audit` — a project's audit log. Every mutating action writes one row inside
 * the transaction that performed the change, so this page is the record of who
 * changed what, and it cannot disagree with what was persisted.
 *
 * Admin-only, gated through {@link can} against the backend's own
 * `actions:permissions` map rather than a restated rule — move `audit:list` off
 * the admin tag on the backend and this page follows with no change here.
 * @returns The rendered page.
 */
export default function AuditLogPage() {
  const { activeProjectId, permissions } = useAuth();

  const [standing, setStanding] = useState<Standing | null>(null);
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [pageInfo, setPageInfo] = useState<PageInfo | null>(null);
  const [actors, setActors] = useState<Map<number, Member["user"]>>(new Map());
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { loading, begin, done } = useFirstLoad();

  const [since, setSince] = useState(() =>
    toDateInput(
      new Date(Date.now() - DEFAULT_WINDOW_DAYS * 24 * 60 * 60 * 1000),
    ),
  );
  const [until, setUntil] = useState("");
  const [actionFilter, setActionFilter] = useState("");
  const filters = JSON.stringify([activeProjectId, since, until, actionFilter]);
  const [previousFilters, setPreviousFilters] = useState(filters);
  // Reset before committing the load effect, including on project switches.
  // Resetting in an effect first fetches the new filters with the old page.
  if (previousFilters !== filters) {
    setPreviousFilters(filters);
    setPage(1);
    setExpandedId(null);
  }

  /**
   * Whether this caller may read the log — `null` until `project:view` says.
   *
   * **Three renderings, not two.** `standing ?? { isMember: false, isAdmin:
   * false }` answers "may they read it?" with "no" before anybody has asked, and
   * this is the page where that costs the most: every admin opening `/audit` was
   * told **"Only project admins can read the audit log."** and then handed the
   * log, in that order, on every load. Hiding a control you have not checked is
   * a silence; printing a refusal you have not checked is a claim.
   *
   * `can()` keeps its non-nullable parameter rather than being widened to accept
   * `null` — that would let every call site pass an unresolved standing and get
   * `false` back silently, which is the same bug wearing a type. The null branch
   * belongs here, spelled out.
   */
  const mayRead =
    standing === null ? null : can(permissions, "audit:list", standing);

  // Every registered action name, straight from the permissions map, so the
  // filter's suggestions cannot drift from what the backend actually has.
  const actionNames = useMemo(
    () => Object.keys(permissions ?? {}).sort(),
    [permissions],
  );

  const load = useCallback(async () => {
    if (!activeProjectId) return;
    begin();
    setError(null);
    try {
      const view = await apiFetch<ActionResponse<ProjectView>>(
        `/project?projectId=${activeProjectId}`,
      );
      setStanding(view.standing);

      if (!view.standing.isAdmin) {
        setEntries([]);
        setPageInfo(null);
        return;
      }

      const params = new URLSearchParams({
        projectId: String(activeProjectId),
        since: new Date(`${since}T00:00:00`).toISOString(),
        page: String(page),
        limit: String(PAGE_SIZE),
      });
      if (until) {
        params.set("until", new Date(`${until}T23:59:59.999`).toISOString());
      }
      if (actionFilter.trim()) params.set("action", actionFilter.trim());

      const [log, members] = await Promise.all([
        apiFetch<ActionResponse<AuditList>>(`/audit-logs?${params}`),
        apiFetch<ActionResponse<MembershipList>>(
          `/memberships?projectId=${activeProjectId}&limit=100`,
        ),
      ]);

      setEntries(log.auditLogs);
      setPageInfo(log.pagination);
      setActors(new Map(members.memberships.map((m) => [m.userId, m.user])));
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not load the audit log.",
      );
    } finally {
      // `finally`, not the success arm — and it also catches the early `return`
      // above for a non-admin, whose read is just as finished. A first load that
      // *failed* has still had its answer, and leaving the skeleton up renders
      // the error Alert over five placeholder rows that never fill in, which
      // reads as the page still trying.
      done();
    }
  }, [activeProjectId, since, until, actionFilter, page, begin, done]);

  useEffect(() => {
    load();
  }, [load]);

  if (!activeProjectId) {
    return (
      <Alert variant="info" className="mt-3" data-testid="no-project">
        Select or create a project to read its audit log.
      </Alert>
    );
  }

  /**
   * A human name for the user who performed an entry's action.
   * @param userId - The actor's id, or null for an unauthenticated action.
   * @returns The display string for the actor column.
   */
  function actorName(userId: number | null): string {
    if (userId === null) return "—";
    // An actor who has since left the project is not in the membership list, and
    // that is exactly the case the log exists for. Name them by id rather than
    // dropping the row's authorship.
    return actors.get(userId)?.name ?? `user #${userId}`;
  }

  const totalPages = pageInfo?.pages ?? 1;

  return (
    <>
      <h1 className="mt-3">Audit Log</h1>
      <span className="bh-rule" aria-hidden="true" />

      {error && (
        <Alert
          variant="danger"
          dismissible
          onClose={() => setError(null)}
          data-testid="audit-error"
        >
          {error}
        </Alert>
      )}

      {/* The two flags are independent and both are needed: `mayRead === null`
          covers the `project:view` round trip, `loading` covers the `audit:list`
          round that only starts after it. Collapsing them would mean a plain
          member sees a skeleton audit table before being refused, which is the
          denial arriving late in the other direction. */}
      {mayRead === null ? (
        <LoadingLabel testId="audit-loading" />
      ) : !mayRead ? (
        <Alert variant="info" data-testid="audit-forbidden">
          Only project admins can read the audit log.
        </Alert>
      ) : (
        <>
          <Card className="mb-4" data-testid="audit-filters">
            <Card.Header as="h2">Filters</Card.Header>
            <Card.Body>
              <Form className="d-flex flex-wrap gap-3 align-items-end bh-filter-bar">
                <Form.Group controlId="audit-since">
                  <Form.Label className="bh-mono-label">From</Form.Label>
                  <Form.Control
                    type="date"
                    size="sm"
                    value={since}
                    max={until || undefined}
                    onChange={(e) => setSince(e.target.value)}
                    data-testid="audit-since"
                  />
                </Form.Group>
                <Form.Group controlId="audit-until">
                  <Form.Label className="bh-mono-label">To</Form.Label>
                  <Form.Control
                    type="date"
                    size="sm"
                    value={until}
                    min={since}
                    onChange={(e) => setUntil(e.target.value)}
                    data-testid="audit-until"
                  />
                </Form.Group>
                <Form.Group controlId="audit-action">
                  <Form.Label className="bh-mono-label">Action</Form.Label>
                  <Form.Control
                    type="text"
                    size="sm"
                    list="audit-action-names"
                    placeholder="any"
                    value={actionFilter}
                    onChange={(e) => setActionFilter(e.target.value)}
                    data-testid="audit-action"
                  />
                  <datalist id="audit-action-names">
                    {actionNames.map((name) => (
                      <option key={name} value={name} />
                    ))}
                  </datalist>
                </Form.Group>
                <Button
                  size="sm"
                  variant="outline-secondary"
                  onClick={() => {
                    setPage(1);
                    setExpandedId(null);
                    setSince(
                      toDateInput(
                        new Date(
                          Date.now() -
                            DEFAULT_WINDOW_DAYS * 24 * 60 * 60 * 1000,
                        ),
                      ),
                    );
                    setUntil("");
                    setActionFilter("");
                  }}
                  data-testid="audit-reset"
                >
                  Reset
                </Button>
              </Form>
            </Card.Body>
          </Card>

          <Card data-testid="audit-card">
            <Card.Header as="h2">
              Changes
              {pageInfo ? (
                <span className="bh-muted"> — {pageInfo.total} total</span>
              ) : null}
            </Card.Header>
            <Card.Body>
              <Table hover responsive size="sm" data-testid="audit-table">
                <thead>
                  <tr>
                    <th scope="col">When</th>
                    <th scope="col">Who</th>
                    <th scope="col">Action</th>
                    <th scope="col">Target</th>
                    <th scope="col" />
                  </tr>
                </thead>
                <tbody>
                  {loading && (
                    <SkeletonRows
                      columns={5}
                      testId="audit-skeleton"
                      label="Loading the audit log"
                    />
                  )}
                  {!loading &&
                    entries.map((entry) => (
                      <Fragment key={entry.id}>
                        <tr data-testid={`audit-row-${entry.id}`}>
                          <td>{new Date(entry.createdAt).toLocaleString()}</td>
                          <td>{actorName(entry.userId)}</td>
                          <td>
                            <code>{entry.action}</code>
                          </td>
                          <td>
                            {entry.targetPath ? (
                              <>
                                {entry.targetType && (
                                  <span className="bh-muted">
                                    {entry.targetType}{" "}
                                  </span>
                                )}
                                {entry.targetPath}
                              </>
                            ) : (
                              <span className="bh-muted">—</span>
                            )}
                          </td>
                          <td className="text-end">
                            <Button
                              size="sm"
                              variant="link"
                              className="p-0"
                              aria-expanded={expandedId === entry.id}
                              onClick={() =>
                                setExpandedId(
                                  expandedId === entry.id ? null : entry.id,
                                )
                              }
                              data-testid={`audit-expand-${entry.id}`}
                            >
                              {expandedId === entry.id ? "hide" : "details"}
                            </Button>
                          </td>
                        </tr>
                        {expandedId === entry.id && (
                          <tr>
                            <td colSpan={5}>
                              <EntryDetail entry={entry} />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    ))}
                  {!loading && entries.length === 0 && (
                    <tr>
                      <td
                        colSpan={5}
                        className="bh-muted"
                        data-testid="no-audit-entries"
                      >
                        Nothing recorded in this range.
                      </td>
                    </tr>
                  )}
                </tbody>
              </Table>

              {totalPages > 1 && (
                <Pagination
                  size="sm"
                  className="mb-0"
                  data-testid="audit-pages"
                >
                  <Pagination.Prev
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  />
                  <Pagination.Item disabled>
                    {page} / {totalPages}
                  </Pagination.Item>
                  <Pagination.Next
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  />
                </Pagination>
              )}
            </Card.Body>
          </Card>
        </>
      )}
    </>
  );
}
