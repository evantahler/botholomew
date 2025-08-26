"use client";

import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  Col,
  Container,
  Form,
  ListGroup,
  Modal,
  Row,
  Spinner,
} from "react-bootstrap";
import type { AgentList } from "../../../backend/actions/agent";
import type { WorkflowView } from "../../../backend/actions/workflow";
import type {
  WorkflowRunCreate,
  WorkflowRunList,
} from "../../../backend/actions/workflow_run";
import type { WorkflowStepList } from "../../../backend/actions/workflow_step";
import type { ActionResponse } from "../../../backend/api";
import Navigation from "../../components/Navigation";
import ProtectedRoute from "../../components/ProtectedRoute";
import { APIWrapper } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { formatDate } from "../../lib/utils";
import { getStepTypeColor } from "../../lib/workflowUtils";

export default function ViewWorkflow() {
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
  const [runs, setRuns] = useState<ActionResponse<WorkflowRunList>["runs"]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showRunModal, setShowRunModal] = useState(false);
  const [runInput, setRunInput] = useState("");

  useEffect(() => {
    if (id) {
      fetchWorkflow();
      fetchAgents();
      fetchRuns();
    }
  }, [id]);

  const fetchWorkflow = async () => {
    try {
      const response = await APIWrapper.get<WorkflowView>(`/workflow/${id}`);
      setWorkflow(response.workflow);

      // Fetch workflow steps
      const stepsResponse = await APIWrapper.get<WorkflowStepList>(
        `/workflow/${id}/steps`,
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

  const fetchRuns = async () => {
    try {
      const response = await APIWrapper.get<WorkflowRunList>(
        `/workflow/${id}/runs`,
      );
      setRuns(response.runs || []);
    } catch (err) {
      console.error("Failed to fetch runs:", err);
    }
  };

  const handleRunWorkflow = async () => {
    setRunning(true);
    try {
      await APIWrapper.post<WorkflowRunCreate>(`/workflow/${id}/run`, {
        id: parseInt(id as string),
        input: runInput || null,
      });

      setShowRunModal(false);
      setRunInput("");
      fetchRuns(); // Refresh runs list
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to run workflow");
    } finally {
      setRunning(false);
    }
  };

  const getRunStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      pending: "warning",
      running: "info",
      completed: "success",
      failed: "danger",
    };
    return colors[status] || "secondary";
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
      <Container className="mt-5 pt-4">
        <Row className="mb-4">
          <Col>
            <div className="d-flex justify-content-between align-items-center">
              <div>
                <h1>{workflow.name}</h1>
                {workflow.description && (
                  <p className="text-muted">{workflow.description}</p>
                )}
              </div>
              <div className="d-flex gap-2">
                <Button
                  variant="outline-secondary"
                  onClick={() => router.push("/workflows")}
                >
                  Back to Workflows
                </Button>
                <Button
                  variant="outline-primary"
                  onClick={() => router.push(`/workflows/edit/${workflow.id}`)}
                >
                  Edit Workflow
                </Button>
                <Button
                  variant="primary"
                  onClick={() => setShowRunModal(true)}
                  disabled={!workflow.enabled}
                >
                  Run Workflow
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
          <Col lg={8}>
            <Card className="mb-4">
              <Card.Header>
                <h5 className="mb-0">Workflow Details</h5>
              </Card.Header>
              <Card.Body>
                <Row>
                  <Col md={6}>
                    <div className="mb-3">
                      <strong>Status:</strong>{" "}
                      <Badge bg={workflow.enabled ? "success" : "secondary"}>
                        {workflow.enabled ? "Enabled" : "Disabled"}
                      </Badge>
                    </div>
                    <div className="mb-3">
                      <strong>Created:</strong> {formatDate(workflow.createdAt)}
                    </div>
                  </Col>
                  <Col md={6}>
                    <div className="mb-3">
                      <strong>Steps:</strong> {steps.length}
                    </div>
                    <div className="mb-3">
                      <strong>Total Runs:</strong> {runs.length}
                    </div>
                  </Col>
                </Row>
              </Card.Body>
            </Card>

            <Card className="mb-4">
              <Card.Header>
                <h5 className="mb-0">Workflow Steps</h5>
              </Card.Header>
              <Card.Body>
                {steps.length === 0 ? (
                  <p className="text-muted">
                    No steps configured for this workflow
                  </p>
                ) : (
                  <ListGroup variant="flush">
                    {steps.map((step, index) => (
                      <ListGroup.Item
                        key={step.id}
                        className="d-flex justify-content-between align-items-center"
                      >
                        <div>
                          <div className="d-flex align-items-center">
                            <Badge
                              bg={getStepTypeColor(step.stepType)}
                              className="me-2"
                            >
                              {step.stepType}
                            </Badge>
                            <span className="fw-bold">Step {index + 1}</span>
                          </div>
                          {step.stepType === "agent" && step.agentId && (
                            <div className="text-muted small mt-1">
                              Agent:{" "}
                              {agents.find((a) => a.id === step.agentId)
                                ?.name || "Unknown"}
                            </div>
                          )}
                        </div>
                      </ListGroup.Item>
                    ))}
                  </ListGroup>
                )}
              </Card.Body>
            </Card>
          </Col>

          <Col lg={4}>
            <Card>
              <Card.Header>
                <h5 className="mb-0">Recent Runs</h5>
              </Card.Header>
              <Card.Body>
                {runs.length === 0 ? (
                  <p className="text-muted">No runs yet</p>
                ) : (
                  <div className="run-list">
                    {runs.slice(0, 5).map((run) => (
                      <div
                        key={run.id}
                        className="run-item mb-3 p-3 border rounded"
                      >
                        <div className="d-flex justify-content-between align-items-center mb-2">
                          <Badge bg={getRunStatusColor(run.status)}>
                            {run.status}
                          </Badge>
                          <small className="text-muted">
                            {run.startedAt
                              ? formatDate(run.startedAt)
                              : "Not started"}
                          </small>
                        </div>
                        {run.startedAt && (
                          <div className="small text-muted mb-1">
                            Started: {formatDate(run.startedAt)}
                          </div>
                        )}
                        {run.completedAt && (
                          <div className="small text-muted mb-1">
                            Completed: {formatDate(run.completedAt)}
                          </div>
                        )}
                        {run.error && (
                          <div className="small text-danger">
                            Error: {run.error}
                          </div>
                        )}
                      </div>
                    ))}
                    {runs.length > 5 && (
                      <div className="text-center">
                        <Button
                          variant="outline-secondary"
                          size="sm"
                          onClick={() =>
                            router.push(`/workflows/${workflow.id}/runs`)
                          }
                        >
                          View All Runs
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </Card.Body>
            </Card>
          </Col>
        </Row>
      </Container>

      {/* Run Workflow Modal */}
      <Modal show={showRunModal} onHide={() => setShowRunModal(false)} centered>
        <Modal.Header closeButton>
          <Modal.Title>Run Workflow</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p>Are you sure you want to run "{workflow.name}"?</p>
          <Form.Group>
            <Form.Label>Input Data (Optional)</Form.Label>
            <Form.Control
              as="textarea"
              rows={3}
              value={runInput}
              onChange={(e) => setRunInput(e.target.value)}
              placeholder="Enter any input data for the workflow..."
            />
            <Form.Text className="text-muted">
              This data will be passed to the first step of your workflow
            </Form.Text>
          </Form.Group>
        </Modal.Body>
        <Modal.Footer>
          <Button
            variant="secondary"
            onClick={() => setShowRunModal(false)}
            disabled={running}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleRunWorkflow}
            disabled={running}
          >
            {running ? (
              <>
                <Spinner
                  as="span"
                  animation="border"
                  size="sm"
                  role="status"
                  aria-hidden="true"
                  className="me-2"
                />
                Running...
              </>
            ) : (
              "Run Workflow"
            )}
          </Button>
        </Modal.Footer>
      </Modal>
    </>
  );
}
