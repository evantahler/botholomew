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
  Pagination,
  Row,
  Spinner,
} from "react-bootstrap";
import type { WorkflowView } from "../../../../../backend/actions/workflow";
import type {
  WorkflowRunDelete,
  WorkflowRunList,
  WorkflowRunTick,
} from "../../../../../backend/actions/workflow_run";
import type { ActionResponse } from "../../../../../backend/api";
import Navigation from "../../../../components/Navigation";
import ProtectedRoute from "../../../../components/ProtectedRoute";
import { APIWrapper } from "../../../../lib/api";
import { useAuth } from "../../../../lib/auth";
import { formatDate } from "../../../../lib/utils";

export default function WorkflowRuns() {
  const router = useRouter();
  const { id } = router.query;
  const { user } = useAuth();

  const [workflow, setWorkflow] = useState<
    ActionResponse<WorkflowView>["workflow"] | null
  >(null);
  const [runs, setRuns] = useState<ActionResponse<WorkflowRunList>["runs"]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize] = useState(20);
  const [error, setError] = useState<string | null>(null);
  const [tickingRuns, setTickingRuns] = useState<Set<number>>(new Set());
  const [deletingRuns, setDeletingRuns] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (id) {
      fetchWorkflow();
      fetchRuns();
    }
  }, [id, currentPage]);

  const fetchWorkflow = async () => {
    try {
      const response = await APIWrapper.get<WorkflowView>(`/workflow/${id}`);
      setWorkflow(response.workflow);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch workflow");
    }
  };

  const fetchRuns = async () => {
    try {
      const offset = (currentPage - 1) * pageSize;
      const response = await APIWrapper.get<WorkflowRunList>(
        `/workflow/${id}/runs`,
        {},
        pageSize,
        offset,
      );
      setRuns(response.runs || []);
      setTotal(response.total || 0);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to fetch workflow runs",
      );
    } finally {
      setLoading(false);
    }
  };

  const handleTickRun = async (runId: number) => {
    setTickingRuns((prev) => new Set(prev).add(runId));
    try {
      await APIWrapper.post<WorkflowRunTick>(
        `/workflow/${id}/run/${runId}/tick`,
        { id: parseInt(id as string), runId },
      );
      fetchRuns(); // Refresh runs list
      setError(null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to tick workflow run",
      );
    } finally {
      setTickingRuns((prev) => {
        const newSet = new Set(prev);
        newSet.delete(runId);
        return newSet;
      });
    }
  };

  const handleDeleteRun = async (runId: number) => {
    if (
      !confirm(
        "Are you sure you want to delete this workflow run? This action cannot be undone.",
      )
    ) {
      return;
    }

    setDeletingRuns((prev) => new Set(prev).add(runId));
    try {
      await APIWrapper.delete<WorkflowRunDelete>(
        `/workflow/${id}/run/${runId}`,
        { id: parseInt(id as string), runId },
      );
      fetchRuns(); // Refresh runs list
      setError(null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to delete workflow run",
      );
    } finally {
      setDeletingRuns((prev) => {
        const newSet = new Set(prev);
        newSet.delete(runId);
        return newSet;
      });
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

  const totalPages = Math.ceil(total / pageSize);

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
                <h1>Workflow Runs</h1>
                <p className="text-muted">{workflow.name}</p>
              </div>
              <div className="d-flex gap-2">
                <Button
                  variant="outline-secondary"
                  onClick={() => router.push(`/workflows/${id}`)}
                >
                  Back to Workflow
                </Button>
                <Button
                  variant="primary"
                  onClick={() => router.push(`/workflows/${id}`)}
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
          <Col>
            <Card>
              <Card.Header>
                <div className="d-flex justify-content-between align-items-center">
                  <h5 className="mb-0">All Runs ({total})</h5>
                  <small className="text-muted">
                    Page {currentPage} of {totalPages}
                  </small>
                </div>
              </Card.Header>
              <Card.Body>
                {runs.length === 0 ? (
                  <p className="text-muted text-center py-4">
                    No workflow runs found
                  </p>
                ) : (
                  <div className="runs-list">
                    {runs.map((run) => (
                      <div
                        key={run.id}
                        className="run-item mb-3 p-3 border rounded"
                      >
                        <Row>
                          <Col md={8}>
                            <div className="d-flex justify-content-between align-items-start mb-2">
                              <div className="d-flex align-items-center gap-2">
                                <Badge bg={getStatusColor(run.status)}>
                                  {run.status}
                                </Badge>
                                <h6 className="mb-0">Run #{run.id}</h6>
                              </div>
                              <small className="text-muted">
                                {formatDate(run.startedAt || 0)}
                              </small>
                            </div>

                            {run.input && (
                              <div className="mb-2">
                                <strong>Input:</strong>
                                <div className="mt-1 p-2 bg-light rounded">
                                  <pre className="mb-0 small">{run.input}</pre>
                                </div>
                              </div>
                            )}

                            <div className="d-flex gap-3 text-muted small">
                              {run.startedAt && (
                                <span>
                                  Started: {formatDate(run.startedAt)}
                                </span>
                              )}
                              {run.completedAt && (
                                <span>
                                  Completed: {formatDate(run.completedAt)}
                                </span>
                              )}
                              {run.error && (
                                <span className="text-danger">
                                  Error: {run.error}
                                </span>
                              )}
                            </div>
                          </Col>

                          <Col md={4}>
                            <div className="d-flex flex-column gap-2">
                              <Button
                                variant="outline-primary"
                                size="sm"
                                onClick={() =>
                                  router.push(
                                    `/workflows/${workflow.id}/runs/${run.id}`,
                                  )
                                }
                              >
                                View Details
                              </Button>

                              {run.status !== "completed" &&
                                run.status !== "failed" && (
                                  <Button
                                    variant="outline-success"
                                    size="sm"
                                    onClick={() => handleTickRun(run.id)}
                                    disabled={tickingRuns.has(run.id)}
                                  >
                                    {tickingRuns.has(run.id) ? (
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
                                      "Tick"
                                    )}
                                  </Button>
                                )}

                              <Button
                                variant="outline-danger"
                                size="sm"
                                onClick={() => handleDeleteRun(run.id)}
                                disabled={deletingRuns.has(run.id)}
                              >
                                {deletingRuns.has(run.id) ? (
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
                                  "Delete"
                                )}
                              </Button>
                            </div>
                          </Col>
                        </Row>
                      </div>
                    ))}
                  </div>
                )}

                {totalPages > 1 && (
                  <div className="d-flex justify-content-center mt-4">
                    <Pagination>
                      <Pagination.First
                        onClick={() => setCurrentPage(1)}
                        disabled={currentPage === 1}
                      />
                      <Pagination.Prev
                        onClick={() => setCurrentPage(currentPage - 1)}
                        disabled={currentPage === 1}
                      />

                      {Array.from(
                        { length: Math.min(5, totalPages) },
                        (_, i) => {
                          const page =
                            Math.max(
                              1,
                              Math.min(totalPages - 4, currentPage - 2),
                            ) + i;
                          return (
                            <Pagination.Item
                              key={page}
                              active={page === currentPage}
                              onClick={() => setCurrentPage(page)}
                            >
                              {page}
                            </Pagination.Item>
                          );
                        },
                      )}

                      <Pagination.Next
                        onClick={() => setCurrentPage(currentPage + 1)}
                        disabled={currentPage === totalPages}
                      />
                      <Pagination.Last
                        onClick={() => setCurrentPage(totalPages)}
                        disabled={currentPage === totalPages}
                      />
                    </Pagination>
                  </div>
                )}
              </Card.Body>
            </Card>
          </Col>
        </Row>
      </Container>
    </>
  );
}
