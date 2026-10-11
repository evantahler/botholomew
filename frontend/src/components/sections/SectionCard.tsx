import type { ReactNode } from "react";
import Alert from "#ui/Alert";
import Button from "#ui/Button";
import Card from "#ui/Card";
import SkeletonBlocks from "../SkeletonBlocks";

/** See {@link SectionCard}. */
export interface SectionCardProps {
  /** The heading, e.g. `"Members"`. */
  title: string;
  /** The slug, which keys every `data-testid` this renders. */
  testId: string;
  /**
   * Which family of sections this card belongs to — `"settings"` for the
   * project settings area — prefixing the card's own `data-testid`.
   *
   * **Required, with no default.** A default is exactly how a card in a second
   * sectioned area ends up announcing itself under the first area's prefix, and
   * `tsc` is the only thing that catches that reliably: nothing about the
   * rendered page looks wrong, and the failure arrives as a Playwright locator
   * that resolves to something from the wrong area.
   */
  idPrefix: string;
  /**
   * The card's own `data-testid`, when `<idPrefix>-<testId>` would collide with
   * something already on the page or with a name the specs hang off.
   *
   * Two elements sharing a test id is not a cosmetic problem; Playwright's
   * strict mode refuses the locator outright, so the failure is every spec that
   * touches the page rather than one assertion about a card. The settings area
   * uses it for its established names: `members-card`, `tags-card`, and the
   * rest.
   */
  cardTestId?: string;
  /** The section's controls. */
  children: ReactNode;
  /** An explanatory paragraph above the controls. */
  intro?: ReactNode;
  /** The last failure, rendered here rather than at the top of the page. */
  error?: string | null;
  /** The last success. */
  notice?: string | null;
  /** Dismiss the error. */
  onDismissError?: () => void;
  /** Dismiss the notice. */
  onDismissNotice?: () => void;
  /** A save button in the card's footer, when the section has one. */
  onSave?: () => void;
  /** The save button's label. Defaults to `"Save"`. */
  saveLabel?: string;
  /** Whether the save button is available. */
  canSave?: boolean;
  /**
   * Whether a **mutation** is in flight — the save this card started, still
   * running. It disables the save button and nothing else, because everything
   * else on the card is still true: the fields hold what somebody typed, and
   * they are about to hold what the server confirmed.
   *
   * Not to be confused with {@link SectionCardProps.loading}, which is the other
   * direction entirely. `busy` means "we sent something and are waiting";
   * `loading` means "we have not been told anything yet". A card can be neither,
   * either, or — on a save that triggers a refetch — briefly both.
   */
  busy?: boolean;
  /**
   * Whether the section's **initial read** is in flight, so there is no content
   * to show yet.
   *
   * The children are replaced by a skeleton for as long as this is true. It is
   * the opposite fact from {@link SectionCardProps.busy}: "a request is in
   * flight" is true of a read as well as a write, which is why this prop is
   * named separately rather than folded into that one.
   *
   * **Sections whose content is a table do not use this.** They render their own
   * `SkeletonRows` inside their own `<Table>`, because a table's header is real
   * content that can be drawn immediately and a card-shaped ghost over the top
   * of it would hide the one part of the answer we already have. `loading` here
   * is for the case where there is not even a header yet.
   *
   * The caller clears it when its read **settles, failure included** — the
   * skeleton covers the in-flight window only, and a card left `loading` after a
   * 403 is a ghost that never resolves with the explanation sitting right above
   * it.
   */
  loading?: boolean;
  /**
   * How many ghost blocks to draw while `loading`. Three is the median section;
   * the prop exists so a two-field card is not obliged to claim it is a list.
   */
  loadingBlocks?: number;
}

/**
 * One section of a sidebar editor: a card, its own alerts, and its own save.
 *
 * The alerts being **inside** `Card.Body` is the whole reason this component
 * exists. A page that reports everything through one Alert at the top shows a
 * section's failure hundreds of lines away from the control that caused it —
 * see `useSectionSave` for what that looks like to the person clicking.
 *
 * It belongs to no one area, which is why it lives here rather than under
 * `settings/` and why `idPrefix` is a parameter rather than a constant.
 * @param props - See {@link SectionCardProps}.
 * @returns The rendered section.
 */
export default function SectionCard({
  title,
  testId,
  idPrefix,
  cardTestId,
  children,
  intro,
  error,
  notice,
  onDismissError,
  onDismissNotice,
  onSave,
  saveLabel = "Save",
  canSave = true,
  busy = false,
  loading = false,
  loadingBlocks = 3,
}: SectionCardProps) {
  return (
    <Card className="mb-4" data-testid={cardTestId ?? `${idPrefix}-${testId}`}>
      <Card.Header as="h2">{title}</Card.Header>
      <Card.Body>
        {intro && <div className="bh-muted mb-3">{intro}</div>}

        {error && (
          <Alert
            variant="danger"
            dismissible={Boolean(onDismissError)}
            onClose={onDismissError}
            data-testid={`${testId}-error`}
          >
            {error}
          </Alert>
        )}
        {notice && (
          <Alert
            variant="success"
            dismissible={Boolean(onDismissNotice)}
            onClose={onDismissNotice}
            data-testid={`${testId}-notice`}
          >
            {notice}
          </Alert>
        )}

        {/* The alerts above render while loading, and that is deliberate: the
            failure a section shows during its first read is that read's own —
            "could not load members" — so a card that suppressed its alerts while
            loading would swallow exactly the message explaining why the skeleton
            is still there. */}
        {loading ? (
          <SkeletonBlocks
            count={loadingBlocks}
            testId={`${testId}-skeleton`}
            label={`Loading ${title.toLowerCase()}`}
          />
        ) : (
          children
        )}

        {/* Disabled, never absent — the same rule `Layout` follows for
            session-gated menu items. A Save that vanishes for the duration of a
            fetch is a selector that resolves in one state only, which is the
            failure that rule exists to prevent. The three reasons a save is
            unavailable collapse into one control state rather than three
            branches. */}
        {onSave && (
          <div className="mt-3">
            <Button
              type="button"
              variant="primary"
              disabled={busy || loading || !canSave}
              onClick={onSave}
              data-testid={`save-${testId}`}
            >
              {saveLabel}
            </Button>
          </div>
        )}
      </Card.Body>
    </Card>
  );
}
