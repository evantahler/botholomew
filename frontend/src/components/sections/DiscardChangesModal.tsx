import Button from "#ui/Button";
import Modal from "#ui/Modal";

/** See {@link DiscardChangesModal}. */
export interface DiscardChangesModalProps {
  /** The section holding the edits, or `null` when nothing is dirty. */
  dirtySlug: string | null;
  /** Where the swallowed click was headed, or `null` when nothing is pending. */
  pendingNav: string | null;
  /** Stay where we are. */
  onCancel: () => void;
  /** Throw the draft away and follow the click. */
  onConfirm: () => void;
}

/**
 * "Discard unsaved changes?" — the modal half of {@link useDirtyGuard}.
 *
 * Shown when a sidebar click was swallowed, which is the only case a shell can
 * detect; the wording names the section rather than saying "this page", because by
 * the time somebody reads it they have already clicked somewhere else.
 * @param props - See {@link DiscardChangesModalProps}.
 * @returns The rendered modal.
 */
export default function DiscardChangesModal({
  dirtySlug,
  pendingNav,
  onCancel,
  onConfirm,
}: DiscardChangesModalProps) {
  return (
    <Modal
      show={pendingNav !== null}
      onHide={onCancel}
      data-testid="discard-changes-modal"
    >
      <Modal.Header closeButton>
        <Modal.Title>Discard unsaved changes?</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        The <code>{dirtySlug}</code> section has changes that have not been
        saved. Leaving it throws them away.
      </Modal.Body>
      <Modal.Footer>
        <Button
          variant="outline-secondary"
          onClick={onCancel}
          data-testid="discard-cancel"
        >
          Stay
        </Button>
        <Button
          variant="danger"
          onClick={onConfirm}
          data-testid="discard-confirm"
        >
          Discard
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
