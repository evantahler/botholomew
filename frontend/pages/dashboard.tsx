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
  Table,
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
  const { user } = useAuth();
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

  return (
    <ProtectedRoute>
      <Navigation />
      <Container className="mt-5 pt-5">
        <Row>
          <Col>
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
                    <Table responsive hover className="mb-0">
                      <thead className="table-light">
                        <tr>
                          <th style={{ width: "200px" }}>Workflow</th>
                          <th style={{ width: "120px" }}>Run ID</th>
                          <th style={{ width: "120px" }}>Status</th>
                          <th style={{ width: "150px" }}>Created</th>
                          <th style={{ width: "150px" }}>Duration</th>
                          <th style={{ width: "200px" }}>Agents</th>
                          <th style={{ width: "100px" }}>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {workflowRuns.map((run) => (
                          <tr key={run.id}>
                            <td>
                              <div className="fw-medium">
                                {run.workflowName}
                              </div>
                              {run.workflowDescription && (
                                <div className="text-muted small">
                                  {run.workflowDescription}
                                </div>
                              )}
                              {run.error && (
                                <Alert
                                  variant="danger"
                                  className="py-1 mb-0 mt-1 small"
                                >
                                  {run.error}
                                </Alert>
                              )}
                            </td>
                            <td>
                              <code className="small">#{run.id}</code>
                            </td>
                            <td>{getStatusBadge(run.status)}</td>
                            <td>
                              <div className="small">
                                {formatDateTime(run.createdAt)}
                              </div>
                              {run.startedAt && (
                                <div className="text-muted small">
                                  Started: {formatDateTime(run.startedAt)}
                                </div>
                              )}
                              {run.completedAt && (
                                <div className="text-muted small">
                                  Completed: {formatDateTime(run.completedAt)}
                                </div>
                              )}
                            </td>
                            <td>
                              {run.startedAt && !run.completedAt && (
                                <div className="text-info small">
                                  Running:{" "}
                                  {Math.round(
                                    (Date.now() - run.startedAt) / 1000,
                                  )}
                                  s
                                </div>
                              )}
                              {run.startedAt && run.completedAt && (
                                <div className="text-muted small">
                                  {Math.round(
                                    (run.completedAt - run.startedAt) / 1000,
                                  )}
                                  s
                                </div>
                              )}
                              {!run.startedAt && (
                                <div className="text-muted small">-</div>
                              )}
                            </td>
                            <td>
                              {run.agents && run.agents.length > 0 ? (
                                <div className="d-flex flex-wrap gap-1">
                                  {run.agents.slice(0, 2).map((agent: any) => (
                                    <Badge
                                      key={agent.id}
                                      bg="secondary"
                                      className="small"
                                    >
                                      {agent.name}
                                    </Badge>
                                  ))}
                                  {run.agents.length > 2 && (
                                    <Badge
                                      bg="light"
                                      text="dark"
                                      className="small"
                                    >
                                      +{run.agents.length - 2}
                                    </Badge>
                                  )}
                                </div>
                              ) : (
                                <div className="text-muted small">-</div>
                              )}
                            </td>
                            <td>
                              <Button
                                variant="outline-primary"
                                size="sm"
                                href={`/workflows/${run.workflowId}/runs/${run.id}`}
                              >
                                View
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </Table>

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
        </Row>
      </Container>
    </ProtectedRoute>
  );
}
