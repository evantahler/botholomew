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
  Modal,
  Row,
  Spinner,
} from "react-bootstrap";
import type { WorkflowView } from "../../../../../backend/actions/workflow";
import type {
  WorkflowRunDelete,
  WorkflowRunStepList,
  WorkflowRunTick,
  WorkflowRunView,
} from "../../../../../backend/actions/workflow_run";
import type { ActionResponse } from "../../../../../backend/api";
import Navigation from "../../../../components/Navigation";
import ProtectedRoute from "../../../../components/ProtectedRoute";
import { APIWrapper } from "../../../../lib/api";
import { useAuth } from "../../../../lib/auth";
import { formatDate } from "../../../../lib/utils";

export default function ViewWorkflowRun() {
  const router = useRouter();
  const { id, runId } = router.query;
  const { user } = useAuth();

  const [workflow, setWorkflow] = useState<
    ActionResponse<WorkflowView>["workflow"] | null
  >(null);
  const [workflowRun, setWorkflowRun] = useState<
    ActionResponse<WorkflowRunView>["run"] | null
  >(null);
  const [workflowRunSteps, setWorkflowRunSteps] = useState<
    ActionResponse<WorkflowRunStepList>["steps"]
  >([]);
  const [loading, setLoading] = useState(true);
  const [stepsLoading, setStepsLoading] = useState(true);
  const [ticking, setTicking] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  useEffect(() => {
    if (id && runId) {
      fetchWorkflow();
      fetchWorkflowRun();
      fetchWorkflowRunSteps();
    }
  }, [id, runId]);

  const fetchWorkflow = async () => {
    try {
      const response = await APIWrapper.get<WorkflowView>(`/workflow/${id}`);
      setWorkflow(response.workflow);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch workflow");
    }
  };

  const fetchWorkflowRun = async () => {
    try {
      const response = await APIWrapper.get<WorkflowRunView>(
        `/workflow/${id}/run/${runId}`,
      );
      setWorkflowRun(response.run);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to fetch workflow run",
      );
    } finally {
      setLoading(false);
    }
  };

  const fetchWorkflowRunSteps = async () => {
    try {
      const response = await APIWrapper.get<WorkflowRunStepList>(
        `/workflow/${id}/run/${runId}/steps`,
      );
      setWorkflowRunSteps(response.steps || []);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to fetch workflow run steps",
      );
    } finally {
      setStepsLoading(false);
    }
  };

  const handleTick = async () => {
    if (!workflowRun) return;

    setTicking(true);
    try {
      const response = await APIWrapper.post<WorkflowRunTick>(
        `/workflow/${id}/run/${runId}/tick`,
        { id: parseInt(id as string), runId: parseInt(runId as string) },
      );
      setWorkflowRun(response.workflowRun);
      setError(null);

      // Refresh workflow run steps after tick is complete
      await fetchWorkflowRunSteps();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to tick workflow run",
      );
    } finally {
      setTicking(false);
    }
  };

  const handleDelete = async () => {
    if (!workflowRun) return;

    setDeleting(true);
    try {
      await APIWrapper.delete<WorkflowRunDelete>(
        `/workflow/${id}/run/${runId}`,
        { id: parseInt(id as string), runId: parseInt(runId as string) },
      );
      router.push(`/workflows/${id}`);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to delete workflow run",
      );
      setDeleting(false);
    }
  };

  const getStatusColor = (status: string) => {
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

  if (!workflow || !workflowRun) {
    return (
      <>
        <Navigation />
        <Container className="mt-5 pt-4">
          <Alert variant="danger">Workflow run not found</Alert>
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
                <h1>Workflow Run Details</h1>
                <p className="text-muted">
                  {workflow.name} - Run #{workflowRun.id}
                </p>
              </div>
              <div className="d-flex gap-2">
                <Button
                  variant="outline-secondary"
                  onClick={() => router.push(`/workflows/${id}`)}
                >
                  Back to Workflow
                </Button>
                {workflowRun.status !== "completed" &&
                  workflowRun.status !== "failed" && (
                    <Button
                      variant="primary"
                      onClick={handleTick}
                      disabled={ticking}
                    >
                      {ticking ? (
                        <>
                          <Spinner
                            as="span"
                            animation="border"
                            size="sm"
                            role="status"
                            aria-hidden="true"
                            className="me-2"
                          />
                          Ticking...
                        </>
                      ) : (
                        "Tick Workflow"
                      )}
                    </Button>
                  )}
                <Button
                  variant="outline-danger"
                  onClick={() => setShowDeleteModal(true)}
                  disabled={deleting}
                >
                  {deleting ? (
                    <>
                      <Spinner
                        as="span"
                        animation="border"
                        size="sm"
                        role="status"
                        aria-hidden="true"
                        className="me-2"
                      />
                      Deleting...
                    </>
                  ) : (
                    "Delete Run"
                  )}
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
                <h5 className="mb-0">Run Information</h5>
              </Card.Header>
              <Card.Body>
                <Row>
                  <Col md={6}>
                    <div className="mb-3">
                      <strong>Status:</strong>
                      <Badge
                        bg={getStatusColor(workflowRun.status)}
                        className="ms-2"
                      >
                        {workflowRun.status}
                      </Badge>
                    </div>
                    <div className="mb-3">
                      <strong>Created:</strong>
                      <br />
                      {formatDate(workflowRun.startedAt || 0)}
                    </div>
                    {workflowRun.startedAt && (
                      <div className="mb-3">
                        <strong>Started:</strong>
                        <br />
                        {formatDate(workflowRun.startedAt)}
                      </div>
                    )}
                    {workflowRun.completedAt && (
                      <div className="mb-3">
                        <strong>Completed:</strong>
                        <br />
                        {formatDate(workflowRun.completedAt)}
                      </div>
                    )}
                  </Col>
                  <Col md={6}>
                    {workflowRun.input && (
                      <div className="mb-3">
                        <strong>Input:</strong>
                        <div className="mt-1 p-2 bg-light rounded">
                          <pre className="mb-0">{workflowRun.input}</pre>
                        </div>
                      </div>
                    )}
                    {workflowRun.output && (
                      <div className="mb-3">
                        <strong>Output:</strong>
                        <div className="mt-1 p-2 bg-light rounded">
                          <pre className="mb-0">
                            {JSON.stringify(workflowRun.output, null, 2)}
                          </pre>
                        </div>
                      </div>
                    )}
                    {workflowRun.error && (
                      <div className="mb-3">
                        <strong>Error:</strong>
                        <div className="mt-1 p-2 bg-danger text-white rounded">
                          <pre className="mb-0">{workflowRun.error}</pre>
                        </div>
                      </div>
                    )}
                  </Col>
                </Row>
              </Card.Body>
            </Card>
          </Col>

          <Col lg={4}>
            <Card>
              <Card.Header>
                <h5 className="mb-0">Actions</h5>
              </Card.Header>
              <Card.Body>
                <div className="d-grid gap-2">
                  {workflowRun.status === "pending" && (
                    <Button
                      variant="primary"
                      onClick={handleTick}
                      disabled={ticking}
                    >
                      {ticking ? "Processing..." : "Start Workflow"}
                    </Button>
                  )}
                  {workflowRun.status === "running" && (
                    <Button
                      variant="info"
                      onClick={handleTick}
                      disabled={ticking}
                    >
                      {ticking ? "Processing..." : "Continue Workflow"}
                    </Button>
                  )}
                  <Button
                    variant="outline-secondary"
                    onClick={() => router.push(`/workflows/${id}`)}
                  >
                    View All Runs
                  </Button>
                </div>
              </Card.Body>
            </Card>
          </Col>
        </Row>

        {/* Workflow Run Steps Section */}
        <Row className="mt-4">
          <Col>
            <Card>
              <Card.Header>
                <h5 className="mb-0">Workflow Run Steps</h5>
              </Card.Header>
              <Card.Body>
                {stepsLoading ? (
                  <div className="text-center py-3">
                    <Spinner animation="border" role="status" size="sm">
                      <span className="visually-hidden">Loading steps...</span>
                    </Spinner>
                  </div>
                ) : workflowRunSteps.length === 0 ? (
                  <p className="text-muted text-center py-3">
                    No steps have been executed yet.
                  </p>
                ) : (
                  <div className="workflow-steps">
                    {workflowRunSteps.map((step, index) => (
                      <div
                        key={step.id}
                        className="workflow-step mb-3 p-3 border rounded"
                      >
                        <div className="d-flex justify-content-between align-items-start mb-2">
                          <div className="d-flex align-items-center">
                            <Badge
                              bg={getStatusColor(step.status)}
                              className="me-2"
                            >
                              {step.status}
                            </Badge>
                            <span className="fw-bold">Step {index + 1}</span>
                          </div>
                          <small className="text-muted">
                            {formatDate(step.createdAt)}
                          </small>
                        </div>

                        <div className="mb-2">
                          <strong>System Prompt:</strong>
                          <div className="mt-1 p-2 bg-light rounded">
                            <pre className="mb-0 small">
                              {step.systemPrompt}
                            </pre>
                          </div>
                        </div>

                        <div className="mb-2">
                          <strong>User Prompt:</strong>
                          <div className="mt-1 p-2 bg-light rounded">
                            <pre className="mb-0 small">{step.userPrompt}</pre>
                          </div>
                        </div>

                        {step.input && (
                          <div className="mb-2">
                            <strong>Input:</strong>
                            <div className="mt-1 p-2 bg-light rounded">
                              <pre className="mb-0 small">{step.input}</pre>
                            </div>
                          </div>
                        )}

                        {step.output && (
                          <div className="mb-2">
                            <strong>Output:</strong>
                            <div className="mt-1 p-2 bg-light rounded">
                              <pre className="mb-0 small">{step.output}</pre>
                            </div>
                          </div>
                        )}

                        {step.rationale && (
                          <div className="mb-2">
                            <strong>Rationale:</strong>
                            <div className="mt-1 p-2 bg-light rounded">
                              <pre className="mb-0 small">{step.rationale}</pre>
                            </div>
                          </div>
                        )}

                        <div className="mt-2">
                          <small className="text-muted">
                            Response Type: {step.responseType}
                          </small>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card.Body>
            </Card>
          </Col>
        </Row>
      </Container>

      {/* Delete Confirmation Modal */}
      <Modal
        show={showDeleteModal}
        onHide={() => setShowDeleteModal(false)}
        centered
      >
        <Modal.Header closeButton>
          <Modal.Title>Delete Workflow Run</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p>
            Are you sure you want to delete this workflow run? This action
            cannot be undone.
          </p>
        </Modal.Body>
        <Modal.Footer>
          <Button
            variant="secondary"
            onClick={() => setShowDeleteModal(false)}
            disabled={deleting}
          >
            Cancel
          </Button>
          <Button variant="danger" onClick={handleDelete} disabled={deleting}>
            {deleting ? "Deleting..." : "Delete Run"}
          </Button>
        </Modal.Footer>
      </Modal>
    </>
  );
}
