"use client";

import { useEffect, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  Col,
  Container,
  Row,
  Spinner,
} from "react-bootstrap";
import type { WorkflowRunListAll } from "../../backend/actions/workflow_run";
import type { ActionResponse } from "../../backend/api";
import Navigation from "../components/Navigation";
import Pagination from "../components/Pagination";
import ProtectedRoute from "../components/ProtectedRoute";
import { APIWrapper } from "../lib/api";
import { useAuth } from "../lib/auth";
import { formatDateTime } from "../lib/utils";

type WorkflowRunResponse = ActionResponse<WorkflowRunListAll>;

export default function Dashboard() {
  const { user, signout } = useAuth();
  const [workflowRuns, setWorkflowRuns] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pagination, setPagination] = useState({
    limit: 10,
    offset: 0,
    total: 0,
    hasMore: true,
  });

  useEffect(() => {
    fetchWorkflowRuns();
  }, []);

  const fetchWorkflowRuns = async (newOffset?: number) => {
    try {
      setLoading(true);
      setError(null);

      const offset = newOffset !== undefined ? newOffset : pagination.offset;
      const response = await APIWrapper.get<WorkflowRunListAll>(
        "/workflows/runs",
        {},
        pagination.limit,
        offset,
      );

      if (response.error) {
        setError(response.error.message || "Failed to fetch workflow runs");
      } else {
        setWorkflowRuns(response.runs);
        setPagination((prev) => ({
          ...prev,
          offset,
          total: response.total,
          hasMore: offset + pagination.limit < response.total,
        }));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  const handlePageChange = (page: number) => {
    const newOffset = (page - 1) * pagination.limit;
    fetchWorkflowRuns(newOffset);
  };

  const getStatusBadge = (status: string) => {
    const statusConfig = {
      pending: { variant: "warning", text: "Pending" },
      running: { variant: "info", text: "Running" },
      completed: { variant: "success", text: "Completed" },
      failed: { variant: "danger", text: "Failed" },
      cancelled: { variant: "secondary", text: "Cancelled" },
    };

    const config = statusConfig[status as keyof typeof statusConfig] || {
      variant: "secondary",
      text: status,
    };

    return <Badge bg={config.variant}>{config.text}</Badge>;
  };

  const handleSignout = async () => {
    await signout();
  };

  return (
    <ProtectedRoute>
      <Navigation />
      <Container className="mt-5 pt-5">
        <Row>
          <Col lg={8}>
            <Card className="mb-4">
              <Card.Header>
                <h3 className="mb-0">Recent Workflow Runs</h3>
              </Card.Header>
              <Card.Body>
                {loading ? (
                  <div className="text-center">
                    <Spinner animation="border" role="status">
                      <span className="visually-hidden">Loading...</span>
                    </Spinner>
                  </div>
                ) : error ? (
                  <Alert variant="danger">{error}</Alert>
                ) : workflowRuns.length === 0 ? (
                  <Alert variant="info">
                    No workflow runs found. Create a workflow to get started!
                  </Alert>
                ) : (
                  <>
                    {workflowRuns.map((run) => (
                      <Card key={run.id} className="mb-3">
                        <Card.Body>
                          <Row className="align-items-center">
                            <Col md={8}>
                              <h6 className="mb-1">
                                {run.workflowName}
                                {run.workflowDescription && (
                                  <small className="text-muted ms-2">
                                    - {run.workflowDescription}
                                  </small>
                                )}
                              </h6>
                              <div className="mb-2">
                                <small className="text-muted">
                                  Run #{run.id} • Created:{" "}
                                  {formatDateTime(run.createdAt)}
                                </small>
                              </div>
                              {run.startedAt && (
                                <div className="mb-1">
                                  <small className="text-muted">
                                    Started: {formatDateTime(run.startedAt)}
                                    {!run.completedAt && (
                                      <span className="ms-2">
                                        (Running:{" "}
                                        {Math.round(
                                          (Date.now() - run.startedAt) / 1000,
                                        )}
                                        s)
                                      </span>
                                    )}
                                  </small>
                                </div>
                              )}
                              {run.completedAt && (
                                <div className="mb-1">
                                  <small className="text-muted">
                                    Completed: {formatDateTime(run.completedAt)}
                                    {run.startedAt && (
                                      <span className="ms-2">
                                        (Duration:{" "}
                                        {Math.round(
                                          (run.completedAt - run.startedAt) /
                                            1000,
                                        )}
                                        s)
                                      </span>
                                    )}
                                  </small>
                                </div>
                              )}
                              {run.agents && run.agents.length > 0 && (
                                <div className="mb-2">
                                  <small className="text-muted">
                                    Agents:{" "}
                                    {run.agents
                                      .map((agent: any) => agent.name)
                                      .join(", ")}
                                  </small>
                                </div>
                              )}
                              {run.error && (
                                <Alert variant="danger" className="py-2 mb-0">
                                  <small>{run.error}</small>
                                </Alert>
                              )}
                            </Col>
                            <Col md={4} className="text-end">
                              {getStatusBadge(run.status)}
                              <div className="mt-2">
                                <Button
                                  variant="outline-primary"
                                  size="sm"
                                  href={`/workflows/${run.workflowId}/runs/${run.id}`}
                                >
                                  View Details
                                </Button>
                              </div>
                            </Col>
                          </Row>
                        </Card.Body>
                      </Card>
                    ))}

                    {pagination.total > pagination.limit && (
                      <Pagination
                        currentPage={
                          Math.floor(pagination.offset / pagination.limit) + 1
                        }
                        totalPages={Math.ceil(
                          pagination.total / pagination.limit,
                        )}
                        totalItems={pagination.total}
                        itemsPerPage={pagination.limit}
                        currentOffset={pagination.offset}
                        onPageChange={handlePageChange}
                      />
                    )}
                  </>
                )}
              </Card.Body>
            </Card>
          </Col>

          <Col lg={4}>
            <Card className="mb-4">
              <Card.Header>
                <h5 className="mb-0">Account Information</h5>
              </Card.Header>
              <Card.Body>
                <Alert variant="success">
                  <h6>Welcome, {user?.name}!</h6>
                  <p className="mb-0">
                    You are successfully signed in to your account.
                  </p>
                </Alert>

                <div className="mb-3">
                  <div className="row mb-2">
                    <div className="col-sm-4">
                      <strong>Name:</strong>
                    </div>
                    <div className="col-sm-8">{user?.name}</div>
                  </div>
                  <div className="row mb-2">
                    <div className="col-sm-4">
                      <strong>Email:</strong>
                    </div>
                    <div className="col-sm-8">{user?.email}</div>
                  </div>
                  <div className="row">
                    <div className="col-sm-4">
                      <strong>Member since:</strong>
                    </div>
                    <div className="col-sm-8">
                      {user?.createdAt &&
                        new Date(user.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                </div>

                <div className="d-grid gap-2">
                  <Button variant="outline-danger" onClick={handleSignout}>
                    Sign Out
                  </Button>
                </div>
              </Card.Body>
            </Card>
          </Col>
        </Row>
      </Container>
    </ProtectedRoute>
  );
}
