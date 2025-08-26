"use client";

import { useRouter } from "next/router";
import React, { useEffect, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  Col,
  Container,
  Form,
  Modal,
  Row,
  Spinner,
  Table,
} from "react-bootstrap";
import type { AgentList } from "../../../../backend/actions/agent";
import type {
  WorkflowEdit,
  WorkflowStepCreate,
  WorkflowStepDelete,
  WorkflowStepEdit,
  WorkflowStepList,
  WorkflowView,
} from "../../../../backend/actions/workflow";
import type { ActionResponse } from "../../../../backend/api";
import { stepTypes } from "../../../../backend/models/workflow_step";
import Navigation from "../../../components/Navigation";
import ProtectedRoute from "../../../components/ProtectedRoute";
import { APIWrapper } from "../../../lib/api";
import { useAuth } from "../../../lib/auth";
import {
  getStepTypeColor,
  getStepTypeDescription,
} from "../../../lib/workflowUtils";

// Shared types - using backend action input types
type WorkflowStepCreateInput = WorkflowStepCreate["inputs"]["_type"];
type WorkflowStepEditInput = WorkflowStepEdit["inputs"]["_type"];

export default function EditWorkflow() {
  const router = useRouter();
  const { id } = router.query;
  const { user } = useAuth();

  const [workflow, setWorkflow] = useState<
    ActionResponse<WorkflowView>["workflow"] | null
  >(null);
  const [steps, setSteps] = useState<ActionResponse<WorkflowStepList>["steps"]>(
    [],
  );
  const [agents, setAgents] = useState<ActionResponse<AgentList>["agents"]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAddStepModal, setShowAddStepModal] = useState(false);
  const [editingStep, setEditingStep] = useState<any>(null);
  const [formData, setFormData] = useState<{
    name: string;
    description: string;
    enabled: boolean;
  }>({
    name: "",
    description: "",
    enabled: false,
  });

  // Drag and drop state
  const [draggedStep, setDraggedStep] = useState<number | null>(null);

  useEffect(() => {
    if (id) {
      fetchWorkflow();
      fetchAgents();
    }
  }, [id]);

  useEffect(() => {
    if (workflow) {
      setFormData({
        name: workflow.name || "",
        description: workflow.description || "",
        enabled: workflow.enabled || false,
      });
    }
  }, [workflow]);

  const fetchWorkflow = async () => {
    try {
      const response = await APIWrapper.get<WorkflowView>(`/workflow/${id}`);
      setWorkflow(response.workflow);

      // Fetch workflow steps
      const stepsResponse = await APIWrapper.get<WorkflowStepList>(
        `/workflow/${id}/steps`,
      );
      // Sort steps by position
      const sortedSteps = (stepsResponse.steps || []).sort(
        (a, b) => a.position - b.position,
      );
      setSteps(sortedSteps);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch workflow");
    } finally {
      setLoading(false);
    }
  };

  const fetchAgents = async () => {
    try {
      const response = await APIWrapper.get<AgentList>("/agents");
      setAgents(response.agents || []);
    } catch (err) {
      console.error("Failed to fetch agents:", err);
    }
  };

  const handleSaveWorkflow = async () => {
    setSaving(true);
    try {
      await APIWrapper.post<WorkflowEdit>(`/workflow/${id}`, formData);
      setWorkflow((prev) => (prev ? { ...prev, ...formData } : null));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save workflow");
    } finally {
      setSaving(false);
    }
  };

  const handleAddStep = async (stepData: WorkflowStepCreateInput) => {
    try {
      // Calculate the next position
      const nextPosition =
        steps.length > 0 ? Math.max(...steps.map((s) => s.position)) + 1 : 0;

      const response = await APIWrapper.put<WorkflowStepCreate>(
        `/workflow/${id}/step`,
        { ...stepData, position: nextPosition },
      );

      setSteps((prev) =>
        [...prev, response.step].sort((a, b) => a.position - b.position),
      );
      setShowAddStepModal(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add step");
    }
  };

  const handleEditStep = async (stepData: WorkflowStepEditInput) => {
    try {
      const response = await APIWrapper.post<WorkflowStepEdit>(
        `/workflow/${id}/step/${editingStep.id}`,
        stepData,
      );

      setSteps((prev) =>
        prev.map((s) => (s.id === editingStep.id ? response.step : s)),
      );
      // Re-sort steps after editing
      setSteps((prev) => [...prev].sort((a, b) => a.position - b.position));
      setEditingStep(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to edit step");
    }
  };

  const handleDeleteStep = async (stepId: number) => {
    try {
      await APIWrapper.delete<WorkflowStepDelete>(
        `/workflow/${id}/step/${stepId}`,
        { stepId },
      );

      // Remove the step and reorder remaining steps
      const stepToDelete = steps.find((s) => s.id === stepId);
      if (stepToDelete) {
        const updatedSteps = steps
          .filter((s) => s.id !== stepId)
          .map((s) =>
            s.position > stepToDelete.position
              ? { ...s, position: s.position - 1 }
              : s,
          )
          .sort((a, b) => a.position - b.position);

        setSteps(updatedSteps);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete step");
    }
  };

  // Drag and drop handlers
  const handleDragStart = (e: React.DragEvent, stepId: number) => {
    setDraggedStep(stepId);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const handleDrop = async (e: React.DragEvent, targetStepId: number) => {
    e.preventDefault();

    if (!draggedStep || draggedStep === targetStepId) {
      setDraggedStep(null);
      return;
    }

    try {
      const draggedStepData = steps.find((s) => s.id === draggedStep);
      const targetStepData = steps.find((s) => s.id === targetStepId);

      if (!draggedStepData || !targetStepData) return;

      const newSteps = [...steps];
      const draggedPosition = draggedStepData.position;
      const targetPosition = targetStepData.position;

      // Reorder steps
      if (draggedPosition < targetPosition) {
        // Moving down: shift steps up
        newSteps.forEach((step) => {
          if (
            step.position > draggedPosition &&
            step.position <= targetPosition
          ) {
            step.position = step.position - 1;
          }
        });
        draggedStepData.position = targetPosition;
      } else {
        // Moving up: shift steps down
        newSteps.forEach((step) => {
          if (
            step.position >= targetPosition &&
            step.position < draggedPosition
          ) {
            step.position = step.position + 1;
          }
        });
        draggedStepData.position = targetPosition;
      }

      // Sort by new positions
      newSteps.sort((a, b) => a.position - b.position);
      setSteps(newSteps);

      // Update positions in backend
      for (const step of newSteps) {
        await APIWrapper.post<WorkflowStepEdit>(
          `/workflow/${id}/step/${step.id}`,
          {
            id: parseInt(id as string),
            stepId: step.id,
            position: step.position,
          },
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reorder steps");
      // Refresh steps to restore original order
      fetchWorkflow();
    } finally {
      setDraggedStep(null);
    }
  };

  if (!user) {
    return <ProtectedRoute children={undefined} />;
  }

  if (loading) {
    return (
      <>
        <Navigation />
        <Container className="mt-5 pt-4">
          <div className="text-center py-5">
            <Spinner animation="border" role="status">
              <span className="visually-hidden">Loading...</span>
            </Spinner>
          </div>
        </Container>
      </>
    );
  }

  if (!workflow) {
    return (
      <>
        <Navigation />
        <Container className="mt-5 pt-4">
          <Alert variant="danger">Workflow not found</Alert>
        </Container>
      </>
    );
  }

  return (
    <>
      <Navigation />
      <Container fluid className="mt-5 pt-4">
        <Row className="mb-4">
          <Col>
            <div className="d-flex justify-content-between align-items-center">
              <div>
                <h1>Edit Workflow: {workflow.name}</h1>
                <p className="text-muted">
                  Design your workflow by arranging steps in the table below
                </p>
              </div>
              <div className="d-flex gap-2">
                <Button
                  variant="outline-secondary"
                  onClick={() => router.push("/workflows")}
                >
                  Back to Workflows
                </Button>
                <Button
                  variant="primary"
                  onClick={handleSaveWorkflow}
                  disabled={saving}
                >
                  {saving ? "Saving..." : "Save Workflow"}
                </Button>
              </div>
            </div>
          </Col>
        </Row>

        {error && (
          <Alert variant="danger" onClose={() => setError(null)} dismissible>
            {error}
          </Alert>
        )}

        <Row>
          <Col lg={3}>
            <Card>
              <Card.Header>
                <h5 className="mb-0">Workflow Settings</h5>
              </Card.Header>
              <Card.Body>
                <Form.Group className="mb-3">
                  <Form.Label>Name</Form.Label>
                  <Form.Control
                    type="text"
                    value={formData.name}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, name: e.target.value }))
                    }
                    maxLength={256}
                  />
                </Form.Group>

                <Form.Group className="mb-3">
                  <Form.Label>Description</Form.Label>
                  <Form.Control
                    as="textarea"
                    rows={3}
                    value={formData.description}
                    onChange={(e) =>
                      setFormData((prev) => ({
                        ...prev,
                        description: e.target.value,
                      }))
                    }
                  />
                </Form.Group>

                <Form.Group className="mb-3">
                  <Form.Check
                    type="checkbox"
                    id="enabled"
                    label="Enabled"
                    checked={formData.enabled}
                    onChange={(e) =>
                      setFormData((prev) => ({
                        ...prev,
                        enabled: e.target.checked,
                      }))
                    }
                  />
                </Form.Group>
              </Card.Body>
            </Card>

            <Card className="mt-3">
              <Card.Header>
                <h5 className="mb-0">Add Step</h5>
              </Card.Header>
              <Card.Body>
                <Button
                  variant="primary"
                  onClick={() => setShowAddStepModal(true)}
                  className="w-100"
                >
                  + Add Step
                </Button>
              </Card.Body>
            </Card>
          </Col>

          <Col lg={9}>
            <Card>
              <Card.Header>
                <h6 className="mb-0">Workflow Steps ({steps.length})</h6>
              </Card.Header>
              <Card.Body className="p-0">
                {steps.length === 0 ? (
                  <div className="p-4 text-center text-muted">
                    <p>No steps added yet. Click "Add Step" to get started.</p>
                  </div>
                ) : (
                  <Table responsive className="mb-0">
                    <thead className="table-light">
                      <tr>
                        <th style={{ width: "60px" }}>#</th>
                        <th style={{ width: "100px" }}>Type</th>
                        <th>Details</th>
                        <th style={{ width: "120px" }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {steps.map((step, index) => (
                        <tr
                          key={step.id}
                          draggable
                          onDragStart={(e) => handleDragStart(e, step.id)}
                          onDragOver={handleDragOver}
                          onDrop={(e) => handleDrop(e, step.id)}
                          className={`step-row ${draggedStep === step.id ? "dragging" : ""}`}
                          style={{ cursor: "grab" }}
                        >
                          <td className="text-center fw-bold">
                            {step.position + 1}
                          </td>
                          <td>
                            <Badge bg={getStepTypeColor(step.stepType)}>
                              {step.stepType}
                            </Badge>
                          </td>
                          <td>
                            <div>
                              <strong>
                                {getStepTypeDescription(step.stepType)}
                              </strong>
                              {step.stepType === "agent" && step.agentId && (
                                <div className="text-muted small mt-1">
                                  Agent:{" "}
                                  {agents.find((a) => a.id === step.agentId)
                                    ?.name || "Unknown"}
                                </div>
                              )}
                            </div>
                          </td>
                          <td>
                            <div className="btn-group btn-group-sm">
                              <Button
                                variant="outline-primary"
                                size="sm"
                                onClick={() => setEditingStep(step)}
                              >
                                Edit
                              </Button>
                              <Button
                                variant="outline-danger"
                                size="sm"
                                onClick={() => handleDeleteStep(step.id)}
                              >
                                Delete
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                )}
                <div className="p-3 border-top bg-light">
                  <small className="text-muted">
                    <strong>Drag and Drop:</strong> Drag steps to reorder them.
                    The workflow will execute steps in the order shown above.
                  </small>
                </div>
              </Card.Body>
            </Card>
          </Col>
        </Row>
      </Container>

      {/* Add Step Modal */}
      <AddStepModal
        show={showAddStepModal}
        onHide={() => setShowAddStepModal(false)}
        onAdd={handleAddStep}
        agents={agents}
        workflowId={parseInt(id as string)}
        existingSteps={steps}
      />

      {/* Edit Step Modal */}
      {editingStep && (
        <EditStepModal
          show={!!editingStep}
          onHide={() => setEditingStep(null)}
          onSave={handleEditStep}
          step={editingStep}
          agents={agents}
          workflowId={parseInt(id as string)}
          existingSteps={steps}
        />
      )}
    </>
  );
}

// Add Step Modal Component
function AddStepModal({
  show,
  onHide,
  onAdd,
  agents,
  workflowId,
  existingSteps,
}: {
  show: boolean;
  onHide: () => void;
  onAdd: (data: WorkflowStepCreateInput) => void;
  agents: ActionResponse<AgentList>["agents"];
  workflowId: number;
  existingSteps: ActionResponse<WorkflowStepList>["steps"];
}) {
  const [formData, setFormData] = useState<{
    stepType: WorkflowStepCreateInput["stepType"];
    agentId: string | undefined;
  }>({
    stepType: "agent",
    agentId: undefined,
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Validate that agent is selected if step type is agent
    if (
      formData.stepType === "agent" &&
      (!formData.agentId || formData.agentId === "")
    ) {
      alert("Please select an agent for agent-type steps");
      return;
    }

    onAdd({
      id: workflowId,
      ...formData,
      agentId: formData.agentId ? parseInt(formData.agentId) : undefined,
      position: 0, // This will be overridden by the parent component
    });
  };

  return (
    <Modal show={show} onHide={onHide} size="lg">
      <Modal.Header closeButton>
        <Modal.Title>Add Workflow Step</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <Form onSubmit={handleSubmit}>
          <Form.Group className="mb-3">
            <Form.Label>Step Type</Form.Label>
            <Form.Select
              value={formData.stepType}
              onChange={(e) =>
                setFormData((prev) => ({
                  ...prev,
                  stepType: e.target
                    .value as (typeof stepTypes.enumValues)[number],
                }))
              }
            >
              {stepTypes.enumValues.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </Form.Select>
          </Form.Group>

          {formData.stepType === "agent" && (
            <Form.Group className="mb-3">
              <Form.Label>Agent</Form.Label>
              <Form.Select
                value={formData.agentId}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, agentId: e.target.value }))
                }
                required
              >
                <option value="">Select an agent</option>
                {agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name}
                  </option>
                ))}
              </Form.Select>
            </Form.Group>
          )}
        </Form>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={onHide}>
          Cancel
        </Button>
        <Button variant="primary" onClick={handleSubmit}>
          Add Step
        </Button>
      </Modal.Footer>
    </Modal>
  );
}

// Edit Step Modal Component
function EditStepModal({
  show,
  onHide,
  onSave,
  step,
  agents,
  workflowId,
  existingSteps,
}: {
  show: boolean;
  onHide: () => void;
  onSave: (data: WorkflowStepEditInput) => void;
  step: ActionResponse<WorkflowStepList>["steps"][0];
  agents: ActionResponse<AgentList>["agents"];
  workflowId: number;
  existingSteps: ActionResponse<WorkflowStepList>["steps"];
}) {
  const [formData, setFormData] = useState({
    stepType: step.stepType,
    agentId: step.agentId?.toString() || undefined,
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      id: workflowId,
      stepId: step.id,
      ...formData,
      agentId:
        formData.stepType === "agent" && formData.agentId
          ? parseInt(formData.agentId)
          : undefined,
    });
  };

  return (
    <Modal show={show} onHide={onHide} size="lg">
      <Modal.Header closeButton>
        <Modal.Title>Edit Workflow Step</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <Form onSubmit={handleSubmit}>
          <Form.Group className="mb-3">
            <Form.Label>Step Type</Form.Label>
            <Form.Select
              value={formData.stepType}
              onChange={(e) =>
                setFormData((prev) => ({
                  ...prev,
                  stepType: e.target
                    .value as (typeof stepTypes.enumValues)[number],
                }))
              }
            >
              {stepTypes.enumValues.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </Form.Select>
          </Form.Group>

          {formData.stepType === "agent" && (
            <Form.Group className="mb-3">
              <Form.Label>Agent</Form.Label>
              <Form.Select
                value={formData.agentId}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, agentId: e.target.value }))
                }
                required
              >
                <option value="">Select an agent</option>
                {agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name}
                  </option>
                ))}
              </Form.Select>
            </Form.Group>
          )}
        </Form>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={onHide}>
          Cancel
        </Button>
        <Button variant="primary" onClick={handleSubmit}>
          Save Changes
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
