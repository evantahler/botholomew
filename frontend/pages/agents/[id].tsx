"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/router";
import {
  Container,
  Row,
  Col,
  Card,
  Button,
  Badge,
  Alert,
  Spinner,
  Table,
} from "react-bootstrap";
import { useAuth } from "../../lib/auth";
import { APIWrapper } from "../../lib/api";
import Navigation from "../../components/Navigation";
import ProtectedRoute from "../../components/ProtectedRoute";
import Pagination from "../../components/Pagination";
import MarkdownRenderer from "../../components/MarkdownRenderer";
import type {
  AgentView,
  AgentDelete,
  AgentRunAction,
} from "../../../backend/actions/agent";
import type { AgentRunList } from "../../../backend/actions/agentRun";
import type { ActionResponse } from "../../../backend/api";

export default function AgentDetail() {
  const router = useRouter();
  const { id } = router.query;
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [agent, setAgent] = useState<ActionResponse<AgentView>["agent"] | null>(
    null
  );

  // Agent runs state
  const [agentRuns, setAgentRuns] = useState<
    ActionResponse<AgentRunList>["agentRuns"]
  >([]);
  const [agentRunsLoading, setAgentRunsLoading] = useState(false);
  const [agentRunsError, setAgentRunsError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalAgentRuns, setTotalAgentRuns] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const agentRunsPerPage = 20;

  useEffect(() => {
    if (id) {
      fetchAgent();
      fetchAgentRuns();
    }
  }, [id, currentPage]);

  const fetchAgent = async () => {
    try {
      setLoading(true);
      const response: ActionResponse<AgentView> =
        await APIWrapper.get<AgentView>("/agent/:id", {
          id: parseInt(id as string),
        });
      const agentData = response.agent;
      setAgent(agentData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  const fetchAgentRuns = async () => {
    if (!id) return;

    try {
      setAgentRunsLoading(true);
      setAgentRunsError(null);

      const offset = (currentPage - 1) * agentRunsPerPage;
      const response: ActionResponse<AgentRunList> =
        await APIWrapper.get<AgentRunList>(`/agent/${id}/runs`, {
          limit: agentRunsPerPage,
          offset: offset,
        });

      setAgentRuns(response.agentRuns || []);
      setTotalAgentRuns(response.total || 0);
      setTotalPages(Math.ceil((response.total || 0) / agentRunsPerPage));
    } catch (err) {
      setAgentRunsError(
        err instanceof Error ? err.message : "Failed to load agent runs"
      );
    } finally {
      setAgentRunsLoading(false);
    }
  };

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
  };

  const handleDelete = async () => {
    try {
      await APIWrapper.delete<AgentDelete>(`/agent/${id}`, {
        id: parseInt(id as string),
      });
      router.push("/agents");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete agent");
    }
  };

  const handleRunAgent = async () => {
    try {
      setRunning(true);
      setError(null);

      await APIWrapper.post<AgentRunAction>(`/agent/${id}/run`, {
        id: parseInt(id as string),
      });

      await fetchAgentRuns();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to run agent");
    } finally {
      setRunning(false);
    }
  };

  const handleDeleteAgentRun = async (agentRunId: number) => {
    if (!confirm("Are you sure you want to delete this agent run?")) {
      return;
    }

    try {
      await APIWrapper.delete<AgentRunList>(`/agent/${id}/run/${agentRunId}`, {
        id: agentRunId,
      });
      // Refresh agent runs to update the list
      await fetchAgentRuns();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to delete agent run"
      );
    }
  };

  const formatDate = (timestamp: number | undefined) => {
    if (!timestamp) return "Unknown date";
    return new Date(timestamp).toLocaleString();
  };

  if (!user) {
    return <ProtectedRoute children={undefined} />;
  }

  if (loading) {
    return (
      <>
        <Navigation />
        <Container className="mt-5 pt-4">
          <Row>
            <Col className="text-center">
              <Spinner animation="border" role="status">
                <span className="visually-hidden">Loading...</span>
              </Spinner>
            </Col>
          </Row>
        </Container>
      </>
    );
  }

  if (!agent) {
    return (
      <>
        <Navigation />
        <Container className="mt-5 pt-4">
          <Alert variant="danger">
            Agent not found or you don't have permission to view it.
          </Alert>
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
              <h1>{agent.name}</h1>
              <div className="d-flex gap-2">
                <Button
                  variant="primary"
                  onClick={handleRunAgent}
                  disabled={running || !agent.enabled}
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
                    "Run Agent"
                  )}
                </Button>
                <Button
                  variant="outline-secondary"
                  onClick={() => router.push(`/agents/edit/${id}`)}
                >
                  Edit
                </Button>
                <Button variant="outline-danger" onClick={handleDelete}>
                  Delete
                </Button>
                <Button
                  variant="outline-secondary"
                  onClick={() => router.push("/agents")}
                >
                  Back to Agents
                </Button>
              </div>
            </div>
          </Col>
        </Row>

        {error && (
          <Row className="mb-4">
            <Col>
              <Alert
                variant="danger"
                onClose={() => setError(null)}
                dismissible
              >
                {error}
              </Alert>
            </Col>
          </Row>
        )}

        <Row>
          {/* Left Sidebar - Agent Details */}
          <Col>
            <Card className="mb-4">
              <Card.Header>
                <h6>Agent Info</h6>
              </Card.Header>
              <Card.Body className="p-3">
                <div className="mb-3">
                  <strong>Name:</strong>
                  <div className="text-truncate">{agent.name}</div>
                </div>
                <div className="mb-3">
                  <strong>Model:</strong>
                  <div className="text-truncate">{agent.model}</div>
                </div>
                <div className="mb-3">
                  <strong>Status:</strong>
                  <div>
                    <Badge bg={agent.enabled ? "success" : "secondary"}>
                      {agent.enabled ? "Active" : "Inactive"}
                    </Badge>
                  </div>
                </div>
                <div className="mb-3">
                  <strong>Created:</strong>
                  <div className="small text-muted">
                    {formatDate(agent.createdAt)}
                  </div>
                </div>
                {agent.description && (
                  <div className="mb-3">
                    <strong>Description:</strong>
                    <div className="small text-muted">{agent.description}</div>
                  </div>
                )}
                {agent.toolkits && agent.toolkits.length > 0 && (
                  <div className="mb-3">
                    <strong>Toolkits:</strong>
                    <div className="mt-1">
                      {agent.toolkits.map((toolkit: string) => (
                        <Badge key={toolkit} bg="info" className="me-1 mb-1">
                          {toolkit}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </Card.Body>
            </Card>

            <Card className="mb-4">
              <Card.Header>
                <h6>Quick Actions</h6>
              </Card.Header>
              <Card.Body className="p-3">
                <div className="d-grid gap-2">
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={handleRunAgent}
                    disabled={running || !agent.enabled}
                  >
                    {running ? "Running..." : "Run Agent"}
                  </Button>
                  <Button
                    variant="outline-secondary"
                    size="sm"
                    onClick={() => router.push(`/agents/edit/${id}`)}
                  >
                    Edit Agent
                  </Button>
                  <Button
                    variant="outline-danger"
                    size="sm"
                    onClick={handleDelete}
                  >
                    Delete Agent
                  </Button>
                </div>
              </Card.Body>
            </Card>

            {agent.schedule && (
              <Card className="mb-4">
                <Card.Header>
                  <h6>Schedule</h6>
                </Card.Header>
                <Card.Body className="p-3">
                  <div className="mb-2">
                    <strong>Cron:</strong>
                    <code className="d-block small">{agent.schedule}</code>
                  </div>
                  {agent.scheduleNextRun && (
                    <div className="mb-2">
                      <strong>Next Run:</strong>
                      <div className="small text-muted">
                        {formatDate(agent.scheduleNextRun)}
                      </div>
                    </div>
                  )}
                </Card.Body>
              </Card>
            )}
          </Col>

          {/* Main Content - Agent Runs */}
          <Col lg={9}>
            {/* Agent Runs Section */}
            <Card>
              <Card.Header>
                <div className="d-flex justify-content-between align-items-center">
                  <h5 className="mb-0">Agent Runs</h5>
                  <div className="d-flex gap-2">
                    <Button
                      variant="outline-secondary"
                      size="sm"
                      onClick={fetchAgentRuns}
                      disabled={agentRunsLoading}
                    >
                      {agentRunsLoading ? (
                        <>
                          <Spinner
                            as="span"
                            animation="border"
                            size="sm"
                            role="status"
                            aria-hidden="true"
                            className="me-2"
                          />
                          Refreshing...
                        </>
                      ) : (
                        "Refresh"
                      )}
                    </Button>
                  </div>
                </div>
              </Card.Header>
              <Card.Body>
                {agentRunsError && (
                  <Alert
                    variant="danger"
                    onClose={() => setAgentRunsError(null)}
                    dismissible
                  >
                    {agentRunsError}
                  </Alert>
                )}

                {agentRunsLoading ? (
                  <div className="text-center py-4">
                    <Spinner animation="border" role="status">
                      <span className="visually-hidden">
                        Loading agent runs...
                      </span>
                    </Spinner>
                  </div>
                ) : agentRuns.length === 0 ? (
                  <div className="text-center py-4 text-muted">
                    <p>No agent runs found for this agent.</p>
                    <p className="small">
                      Run the agent to start a conversation.
                    </p>
                  </div>
                ) : (
                  <>
                    <Table responsive striped hover className="mb-3 table-sm">
                      <thead className="table-light">
                        <tr>
                          <th style={{ width: "150px" }}>Status</th>
                          <th style={{ width: "200px" }}>System Prompt</th>
                          <th>User Message</th>
                          <th>Response</th>
                          <th style={{ width: "80px" }}>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {agentRuns.map(
                          (
                            agentRun: NonNullable<
                              ActionResponse<AgentRunList>["agentRuns"]
                            >[0]
                          ) => (
                            <tr key={agentRun.id}>
                              <td>
                                <div className="d-flex flex-column">
                                  <Badge
                                    bg={
                                      agentRun.status === "completed"
                                        ? "success"
                                        : agentRun.status === "failed"
                                          ? "danger"
                                          : agentRun.status === "running"
                                            ? "warning"
                                            : "secondary"
                                    }
                                    className="mb-1"
                                  >
                                    {agentRun.status}
                                  </Badge>
                                  <small className="text-muted">
                                    {formatDate(agentRun.createdAt)}
                                  </small>
                                  <small className="text-muted">
                                    Type: {agentRun.type}
                                  </small>
                                </div>
                              </td>
                              <td>
                                <MarkdownRenderer
                                  content={agent.systemPrompt}
                                />
                              </td>
                              <td>
                                <MarkdownRenderer
                                  content={agentRun.userMessage}
                                />
                              </td>
                              <td>
                                {agentRun.response ? (
                                  <MarkdownRenderer
                                    content={agentRun.response}
                                  />
                                ) : (
                                  <span className="text-muted small">-</span>
                                )}
                              </td>
                              <td>
                                <Button
                                  variant="outline-danger"
                                  size="sm"
                                  onClick={() =>
                                    handleDeleteAgentRun(agentRun.id)
                                  }
                                  disabled={agentRunsLoading}
                                >
                                  X
                                </Button>
                              </td>
                            </tr>
                          )
                        )}
                      </tbody>
                    </Table>

                    <Pagination
                      currentPage={currentPage}
                      totalPages={totalPages}
                      totalItems={totalAgentRuns}
                      itemsPerPage={agentRunsPerPage}
                      currentOffset={(currentPage - 1) * agentRunsPerPage}
                      onPageChange={handlePageChange}
                    />
                  </>
                )}
              </Card.Body>
            </Card>
          </Col>
        </Row>
      </Container>
    </>
  );
}
