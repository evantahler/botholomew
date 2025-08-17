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
  Handle,
  Position,
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

// Shared types - using backend action input types
// Note: nextStepId is handled by React Flow connections, not form input
type WorkflowStepCreateInput = WorkflowStepCreate["inputs"]["_type"];
type WorkflowStepEditInput = WorkflowStepEdit["inputs"]["_type"];

// Custom node types for different workflow steps
const WorkflowStepNode = ({ data }: { data: any }) => (
  <div className="workflow-step-node">
    {/* Input handle - allows connections TO this node */}
    <Handle
      type="target"
      position={Position.Left}
      style={{ background: "#555" }}
    />

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

    {/* Output handle - allows connections FROM this node */}
    <Handle
      type="source"
      position={Position.Right}
      style={{ background: "#555" }}
    />
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
        animated: true,
        style: { stroke: "#555", strokeWidth: 2 },
      }));

    setNodes(newNodes);
    setEdges(newEdges);
  };

  const onConnect = useCallback(
    async (params: Connection) => {
      setEdges(eds => addEdge(params, eds));

      // Update the step relationship in the backend
      if (!params.source || !params.target) return;

      const sourceStepId = parseInt(params.source);
      const targetStepId = parseInt(params.target);

      try {
        // Find the source step and update its nextStepId
        const sourceStep = steps.find(s => s.id === sourceStepId);
        if (sourceStep) {
          await APIWrapper.post<WorkflowStepEdit>(
            `/workflow/${id}/step/${sourceStepId}`,
            {
              nextStepId: targetStepId,
            }
          );

          // Update local state
          setSteps(prev =>
            prev.map(s =>
              s.id === sourceStepId ? { ...s, nextStepId: targetStepId } : s
            )
          );
        }
      } catch (err) {
        console.error("Failed to update step connection:", err);
        // Revert the edge if the backend update failed
        setEdges(eds =>
          eds.filter(e => e.id !== `e${params.source}-${params.target}`)
        );
      }
    },
    [setEdges, steps, id]
  );

  // Handle node deletion from the canvas
  const onNodeDelete = useCallback(
    async (nodeId: string) => {
      const stepId = parseInt(nodeId);

      try {
        await APIWrapper.delete<WorkflowStepDelete>(
          `/workflow/${id}/step/${stepId}`
        );

        // Remove the step from local state
        setSteps(prev => prev.filter(s => s.id !== stepId));

        // The useEffect will automatically update the flow when steps change
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to delete step");
      }
    },
    [id]
  );

  // Handle keyboard events for node deletion
  const onKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === "Delete" || event.key === "Backspace") {
        const selectedNodes = nodes.filter(node => node.selected);
        if (selectedNodes.length > 0) {
          // Delete the first selected node (you could extend this to delete multiple)
          onNodeDelete(selectedNodes[0].id);
        }
      }
    },
    [nodes, onNodeDelete]
  );

  // Add keyboard event listener
  useEffect(() => {
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onKeyDown]);

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

  const handleAddStep = async (stepData: WorkflowStepCreateInput) => {
    console.log("stepData", stepData);
    try {
      const response = await APIWrapper.put<WorkflowStepCreate>(
        `/workflow/${id}/step`,
        { ...stepData }
      );

      setSteps(prev => [...prev, response.step]);
      setShowAddStepModal(false);

      // The useEffect will automatically update the flow when steps change
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add step");
    }
  };

  const handleEditStep = async (stepData: WorkflowStepEditInput) => {
    try {
      const response = await APIWrapper.post<WorkflowStepEdit>(
        `/workflow/${id}/step/${editingStep.id}`,
        stepData
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
        { stepId }
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
              <Card.Header className="d-flex justify-content-between align-items-center">
                <h6 className="mb-0">Workflow Canvas</h6>
                <div className="d-flex gap-2">
                  <Button
                    variant="outline-danger"
                    size="sm"
                    disabled={!nodes.some(n => n.selected)}
                    onClick={() => {
                      const selectedNodes = nodes.filter(n => n.selected);
                      if (selectedNodes.length > 0) {
                        if (
                          confirm(
                            `Delete ${selectedNodes.length} selected step(s)?`
                          )
                        ) {
                          selectedNodes.forEach(node => onNodeDelete(node.id));
                        }
                      }
                    }}
                  >
                    Delete Selected
                  </Button>
                  <small className="text-muted">
                    Select nodes and press Delete or use the button above
                  </small>
                </div>
              </Card.Header>
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
                    snapToGrid={true}
                    snapGrid={[15, 15]}
                    deleteKeyCode="Delete"
                    onNodesDelete={nodesToDelete => {
                      nodesToDelete.forEach(node => onNodeDelete(node.id));
                    }}
                  >
                    <Controls />
                    <Background />
                    <MiniMap />
                  </ReactFlow>
                </div>
                <div className="p-3 border-top bg-light">
                  <small className="text-muted">
                    <strong>Canvas Controls:</strong> Click to select nodes,
                    drag to move, drag from output handles to input handles to
                    connect steps. Press Delete or use the Delete Selected
                    button to remove steps.
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
