"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/router";
import {
  Container,
  Row,
  Col,
  Card,
  Button,
  Form,
  Alert,
  Spinner,
  Modal,
  Badge,
} from "react-bootstrap";
import ReactFlow, {
  Node,
  Edge,
  addEdge,
  Connection,
  useNodesState,
  useEdgesState,
  Controls,
  Background,
  MiniMap,
  NodeTypes,
} from "reactflow";
import "reactflow/dist/style.css";
import { useAuth } from "../../../lib/auth";
import { APIWrapper } from "../../../lib/api";
import Navigation from "../../../components/Navigation";
import ProtectedRoute from "../../../components/ProtectedRoute";
import type {
  WorkflowView,
  WorkflowEdit,
  WorkflowStepCreate,
  WorkflowStepEdit,
  WorkflowStepDelete,
  WorkflowStepList,
} from "../../../../backend/actions/workflow";
import type { AgentList } from "../../../../backend/actions/agent";
import type { ActionResponse } from "../../../../backend/api";

// Custom node types for different workflow steps
const WorkflowStepNode = ({ data }: { data: any }) => (
  <div className="workflow-step-node">
    <div className="step-header">
      <Badge bg={getStepTypeColor(data.stepType)} className="step-type">
        {data.stepType}
      </Badge>
      {data.stepType === "agent" && data.agentName && (
        <div className="agent-name">{data.agentName}</div>
      )}
    </div>
    <div className="step-content">
      <div className="step-title">{data.title}</div>
      {data.description && (
        <div className="step-description">{data.description}</div>
      )}
    </div>
  </div>
);

const nodeTypes: NodeTypes = {
  workflowStep: WorkflowStepNode,
};

const getStepTypeColor = (stepType: string) => {
  const colors: Record<string, string> = {
    agent: "primary",
    condition: "warning",
    loop: "info",
    webhook: "success",
    delay: "secondary",
    manual: "dark",
    timer: "light",
  };
  return colors[stepType] || "secondary";
};

const getStepTypeDescription = (stepType: string) => {
  const descriptions: Record<string, string> = {
    agent: "Run an AI agent",
    condition: "Conditional logic branch",
    loop: "Repeat steps",
    webhook: "HTTP webhook call",
    delay: "Wait for specified time",
    manual: "Manual human intervention",
    timer: "Scheduled execution",
  };
  return descriptions[stepType] || "Unknown step type";
};

export default function EditWorkflow() {
  const router = useRouter();
  const { id } = router.query;
  const { user } = useAuth();

  const [workflow, setWorkflow] = useState<
    ActionResponse<WorkflowView>["workflow"] | null
  >(null);
  const [steps, setSteps] = useState<ActionResponse<WorkflowStepList>["steps"]>(
    []
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

  // React Flow state
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

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

  useEffect(() => {
    if (steps.length > 0) {
      updateFlowFromSteps();
    }
  }, [steps]);

  const fetchWorkflow = async () => {
    try {
      const response = await APIWrapper.get<WorkflowView>(`/workflow/${id}`);
      setWorkflow(response.workflow);

      // Fetch workflow steps
      const stepsResponse = await APIWrapper.get<WorkflowStepList>(
        `/workflow/${id}/steps`
      );
      setSteps(stepsResponse.steps || []);
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

  const updateFlowFromSteps = () => {
    const newNodes: Node[] = steps.map((step, index) => ({
      id: step.id.toString(),
      type: "workflowStep",
      position: { x: index * 250, y: 100 },
      data: {
        stepType: step.stepType,
        title: `${step.stepType.charAt(0).toUpperCase() + step.stepType.slice(1)} Step`,
        description: getStepTypeDescription(step.stepType),
        agentName: step.agentId
          ? agents.find(a => a.id === step.agentId)?.name
          : null,
        step,
      },
    }));

    const newEdges: Edge[] = steps
      .filter(step => step.nextStepId !== null)
      .map(step => ({
        id: `e${step.id}-${step.nextStepId}`,
        source: step.id.toString(),
        target: step.nextStepId!.toString(),
        type: "smoothstep",
      }));

    setNodes(newNodes);
    setEdges(newEdges);
  };

  const onConnect = useCallback(
    (params: Connection) => {
      setEdges(eds => addEdge(params, eds));
    },
    [setEdges]
  );

  const handleSaveWorkflow = async () => {
    setSaving(true);
    try {
      await APIWrapper.post<WorkflowEdit>(`/workflow/${id}`, formData);
      setWorkflow(prev => (prev ? { ...prev, ...formData } : null));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save workflow");
    } finally {
      setSaving(false);
    }
  };

  const handleAddStep = async (stepData: any) => {
    try {
      const response = await APIWrapper.put<WorkflowStepCreate>(
        `/workflow/${id}/step`,
        {
          id: parseInt(id as string),
          ...stepData,
        }
      );

      setSteps(prev => [...prev, response.step]);
      setShowAddStepModal(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add step");
    }
  };

  const handleEditStep = async (stepData: any) => {
    try {
      const response = await APIWrapper.post<WorkflowStepEdit>(
        `/workflow/${id}/step/${editingStep.id}`,
        {
          id: parseInt(id as string),
          stepId: editingStep.id,
          ...stepData,
        }
      );

      setSteps(prev =>
        prev.map(s => (s.id === editingStep.id ? response.step : s))
      );
      setEditingStep(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to edit step");
    }
  };

  const handleDeleteStep = async (stepId: number) => {
    try {
      await APIWrapper.delete<WorkflowStepDelete>(
        `/workflow/${id}/step/${stepId}`,
        {
          id: parseInt(id as string),
          stepId,
        }
      );

      setSteps(prev => prev.filter(s => s.id !== stepId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete step");
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
                  Design your workflow using the visual builder below
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
                    onChange={e =>
                      setFormData(prev => ({ ...prev, name: e.target.value }))
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
                    onChange={e =>
                      setFormData(prev => ({
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
                    onChange={e =>
                      setFormData(prev => ({
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

            <Card className="mt-3">
              <Card.Header>
                <h5 className="mb-0">Steps ({steps.length})</h5>
              </Card.Header>
              <Card.Body>
                {steps.length === 0 ? (
                  <p className="text-muted small">No steps added yet</p>
                ) : (
                  <div className="step-list">
                    {steps.map((step, index) => (
                      <div
                        key={step.id}
                        className="step-item d-flex align-items-center justify-content-between mb-2"
                      >
                        <div className="d-flex align-items-center">
                          <Badge
                            bg={getStepTypeColor(step.stepType)}
                            className="me-2"
                          >
                            {step.stepType}
                          </Badge>
                          <span className="small">Step {index + 1}</span>
                        </div>
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
                      </div>
                    ))}
                  </div>
                )}
              </Card.Body>
            </Card>
          </Col>

          <Col lg={9}>
            <Card>
              <Card.Body className="p-0">
                <div style={{ height: "600px" }}>
                  <ReactFlow
                    nodes={nodes}
                    edges={edges}
                    onNodesChange={onNodesChange}
                    onEdgesChange={onEdgesChange}
                    onConnect={onConnect}
                    nodeTypes={nodeTypes}
                    fitView
                  >
                    <Controls />
                    <Background />
                    <MiniMap />
                  </ReactFlow>
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
  onAdd: (data: any) => void;
  agents: ActionResponse<AgentList>["agents"];
  workflowId: number;
  existingSteps: ActionResponse<WorkflowStepList>["steps"];
}) {
  const [formData, setFormData] = useState<{
    stepType:
      | "agent"
      | "condition"
      | "loop"
      | "webhook"
      | "delay"
      | "manual"
      | "timer";
    agentId: string;
    order: number;
    nextStepId: string;
  }>({
    stepType: "agent",
    agentId: "",
    order: existingSteps.length + 1,
    nextStepId: "",
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onAdd({
      ...formData,
      agentId:
        formData.stepType === "agent" ? parseInt(formData.agentId) : null,
      nextStepId: formData.nextStepId ? parseInt(formData.nextStepId) : null,
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
              onChange={e =>
                setFormData(prev => ({
                  ...prev,
                  stepType: e.target.value as
                    | "agent"
                    | "condition"
                    | "loop"
                    | "webhook"
                    | "delay"
                    | "manual"
                    | "timer",
                }))
              }
            >
              <option value="agent">Agent</option>
              <option value="condition">Condition</option>
              <option value="loop">Loop</option>
              <option value="webhook">Webhook</option>
              <option value="delay">Delay</option>
              <option value="manual">Manual</option>
              <option value="timer">Timer</option>
            </Form.Select>
          </Form.Group>

          {formData.stepType === "agent" && (
            <Form.Group className="mb-3">
              <Form.Label>Agent</Form.Label>
              <Form.Select
                value={formData.agentId}
                onChange={e =>
                  setFormData(prev => ({ ...prev, agentId: e.target.value }))
                }
                required
              >
                <option value="">Select an agent</option>
                {agents.map(agent => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name}
                  </option>
                ))}
              </Form.Select>
            </Form.Group>
          )}

          <Form.Group className="mb-3">
            <Form.Label>Order</Form.Label>
            <Form.Control
              type="number"
              min={1}
              value={formData.order}
              onChange={e =>
                setFormData(prev => ({
                  ...prev,
                  order: parseInt(e.target.value),
                }))
              }
              required
            />
          </Form.Group>

          <Form.Group className="mb-3">
            <Form.Label>Next Step (Optional)</Form.Label>
            <Form.Select
              value={formData.nextStepId}
              onChange={e =>
                setFormData(prev => ({ ...prev, nextStepId: e.target.value }))
              }
            >
              <option value="">No next step</option>
              {existingSteps.map((step: any) => (
                <option key={step.id} value={step.id}>
                  Step {step.order} ({step.stepType})
                </option>
              ))}
            </Form.Select>
          </Form.Group>
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
  onSave: (data: any) => void;
  step: ActionResponse<WorkflowStepList>["steps"][0];
  agents: ActionResponse<AgentList>["agents"];
  workflowId: number;
  existingSteps: ActionResponse<WorkflowStepList>["steps"];
}) {
  const [formData, setFormData] = useState({
    stepType: step.stepType,
    agentId: step.agentId?.toString() || "",
    order: step.order,
    nextStepId: step.nextStepId?.toString() || "",
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      ...formData,
      agentId:
        formData.stepType === "agent" ? parseInt(formData.agentId) : null,
      nextStepId: formData.nextStepId ? parseInt(formData.nextStepId) : null,
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
              onChange={e =>
                setFormData(prev => ({
                  ...prev,
                  stepType: e.target.value as
                    | "agent"
                    | "condition"
                    | "loop"
                    | "webhook"
                    | "delay"
                    | "manual"
                    | "timer",
                }))
              }
            >
              <option value="agent">Agent</option>
              <option value="condition">Condition</option>
              <option value="loop">Loop</option>
              <option value="webhook">Webhook</option>
              <option value="delay">Delay</option>
              <option value="manual">Manual</option>
              <option value="timer">Timer</option>
            </Form.Select>
          </Form.Group>

          {formData.stepType === "agent" && (
            <Form.Group className="mb-3">
              <Form.Label>Agent</Form.Label>
              <Form.Select
                value={formData.agentId}
                onChange={e =>
                  setFormData(prev => ({ ...prev, agentId: e.target.value }))
                }
                required
              >
                <option value="">Select an agent</option>
                {agents.map(agent => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name}
                  </option>
                ))}
              </Form.Select>
            </Form.Group>
          )}

          <Form.Group className="mb-3">
            <Form.Label>Order</Form.Label>
            <Form.Control
              type="number"
              min={1}
              value={formData.order}
              onChange={e =>
                setFormData(prev => ({
                  ...prev,
                  order: parseInt(e.target.value),
                }))
              }
              required
            />
          </Form.Group>

          <Form.Group className="mb-3">
            <Form.Label>Next Step (Optional)</Form.Label>
            <Form.Select
              value={formData.nextStepId}
              onChange={e =>
                setFormData(prev => ({ ...prev, nextStepId: e.target.value }))
              }
            >
              <option value="">No next step</option>
              {existingSteps
                .filter((s: any) => s.id !== step.id)
                .map((s: any) => (
                  <option key={s.id} value={s.id}>
                    Step {s.order} ({s.stepType})
                  </option>
                ))}
            </Form.Select>
          </Form.Group>
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
