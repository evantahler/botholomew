import React, { useState } from "react";
import { Button, Form, ListGroup, Modal, Spinner } from "react-bootstrap";

interface Toolkit {
  name: string;
  description: string;
  tools: string[];
}

interface ToolkitSelectorProps {
  availableToolkits: Toolkit[];
  selectedToolkits: string[];
  onToolkitChange: (toolkitName: string, checked: boolean) => void;
  loading?: boolean;
  disabled?: boolean;
  size?: "sm" | "lg";
}

export default function ToolkitSelector({
  availableToolkits,
  selectedToolkits,
  onToolkitChange,
  loading = false,
  disabled = false,
  size = "sm",
}: ToolkitSelectorProps) {
  const [showModal, setShowModal] = useState(false);
  const [selectedToolkit, setSelectedToolkit] = useState<Toolkit | null>(null);

  const handleBadgeClick = (toolkit: Toolkit, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setSelectedToolkit(toolkit);
    setShowModal(true);
  };

  const handleCloseModal = () => {
    setShowModal(false);
    setSelectedToolkit(null);
  };
  if (loading) {
    return (
      <div className={size === "sm" ? "small text-muted" : "text-muted"}>
        <Spinner
          as="span"
          animation="border"
          size="sm"
          role="status"
          aria-hidden="true"
          className="me-2"
        />
        Loading toolkits...
      </div>
    );
  }

  if (availableToolkits.length === 0) {
    return (
      <div className={size === "sm" ? "small text-muted" : "text-muted"}>
        No toolkits available
      </div>
    );
  }

  return (
    <>
      <div
        style={{
          maxHeight: "300px",
          overflowY: "auto",
          border: "1px solid #dee2e6",
          borderRadius: "0.375rem",
        }}
      >
        <table className="table table-sm table-hover mb-0">
          <thead
            className="table-light"
            style={{ position: "sticky", top: 0, zIndex: 1 }}
          >
            <tr>
              <th style={{ width: "40px" }}></th>
              <th>Toolkit</th>
              <th>Description</th>
              <th>Tools</th>
            </tr>
          </thead>
          <tbody>
            {availableToolkits.map((toolkit) => (
              <tr key={toolkit.name}>
                <td>
                  <Form.Check
                    type="checkbox"
                    id={`toolkit-${toolkit.name}`}
                    checked={selectedToolkits.includes(toolkit.name)}
                    onChange={(e) =>
                      onToolkitChange(toolkit.name, e.target.checked)
                    }
                    disabled={disabled}
                    className="mb-0"
                  />
                </td>
                <td>
                  <div className="fw-medium">{toolkit.name}</div>
                </td>
                <td>
                  <div className="small text-muted">
                    {toolkit.description || "No description"}
                  </div>
                </td>
                <td>
                  <div className="small text-muted">
                    {toolkit.tools && toolkit.tools.length > 0 ? (
                      <span
                        className="badge bg-warning me-1"
                        style={{ cursor: "pointer" }}
                        onClick={(e) => handleBadgeClick(toolkit, e)}
                        title="Click to view tools"
                      >
                        {toolkit.tools.length} tools
                      </span>
                    ) : (
                      "No tools"
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Tools Modal */}
      <Modal show={showModal} onHide={handleCloseModal} size="lg">
        <Modal.Header closeButton>
          <Modal.Title>
            Tools in {selectedToolkit?.name || "Toolkit"}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {selectedToolkit && (
            <>
              {selectedToolkit.description && (
                <div className="mb-3">
                  <strong>Description:</strong>
                  <p className="text-muted mb-0">
                    {selectedToolkit.description}
                  </p>
                </div>
              )}

              {selectedToolkit.tools && selectedToolkit.tools.length > 0 ? (
                <div>
                  <strong>
                    Available Tools ({selectedToolkit.tools.length}):
                  </strong>
                  <ListGroup className="mt-2">
                    {selectedToolkit.tools.map((tool, index) => (
                      <ListGroup.Item
                        key={index}
                        className="d-flex align-items-center"
                      >
                        <span className="badge bg-primary me-2">Tool</span>
                        {tool}
                      </ListGroup.Item>
                    ))}
                  </ListGroup>
                </div>
              ) : (
                <div className="text-muted">
                  No tools available in this toolkit.
                </div>
              )}
            </>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={handleCloseModal}>
            Close
          </Button>
        </Modal.Footer>
      </Modal>
    </>
  );
}
