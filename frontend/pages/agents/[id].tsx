"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/router";
import {
  Container,
  Row,
  Col,
  Card,
  Form,
  Button,
  Badge,
  Alert,
  Spinner,
  ListGroup,
} from "react-bootstrap";
import { useAuth } from "../../lib/auth";
import { APIWrapper } from "../../lib/api";
import ReactMarkdown from "react-markdown";
import Navigation from "../../components/Navigation";
import ProtectedRoute from "../../components/ProtectedRoute";
import Pagination from "../../components/Pagination";
import ToolkitSelector from "../../components/ToolkitSelector";
import type {
  AgentView,
  AgentEdit,
  AgentDelete,
  AgentRunAction,
  AgentModels,
} from "../../../backend/actions/agent";
import type { ArcadeListToolkits } from "../../../backend/actions/arcade";
import type { ToolkitAuthorizationList } from "../../../backend/actions/toolkit_authorization";
import type { AgentRunList } from "../../../backend/actions/agentRun";
import type { ActionResponse } from "../../../backend/api";

export default function AgentDetail() {
  const router = useRouter();
  const { id } = router.query;
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [agent, setAgent] = useState<ActionResponse<AgentView>["agent"] | null>(
    null
  );
  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState<{
    name: string;
    description: string;
    model: string;
    userPrompt: string;
    responseType: "text" | "json" | "markdown";
    enabled: boolean;
    schedule: string;
    toolkits: string[];
  }>({
    name: "",
    description: "",
    model: "gpt-5",
    userPrompt: "",
    responseType: "text" as "text" | "json" | "markdown",
    enabled: false,
    schedule: "",
    toolkits: [],
  });

  // Toolkits state
  const [availableToolkits, setAvailableToolkits] = useState<
    ActionResponse<ArcadeListToolkits>["toolkits"]
  >([]);
  const [toolkitsLoading, setToolkitsLoading] = useState(false);

  // Agent models state
  const [availableModels, setAvailableModels] = useState<
    Array<{ value: string; label: string }>
  >([]);
  const [modelsLoading, setModelsLoading] = useState(false);

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
      fetchToolkits();
      fetchAgentModels();
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
      setFormData({
        name: agentData.name,
        description: agentData.description || "",
        model: agentData.model,
        userPrompt: agentData.userPrompt,
        responseType: agentData.responseType || "text",
        enabled: agentData.enabled,
        schedule: agentData.schedule || "",
        toolkits: agentData.toolkits || [],
      });
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
        await APIWrapper.get<AgentRunList>("/agentRuns", {
          agentId: parseInt(id as string),
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

  const fetchToolkits = async () => {
    try {
      setToolkitsLoading(true);

      // Fetch both available toolkits and user's authorizations
      const [toolkitsResponse, authorizationsResponse] = await Promise.all([
        APIWrapper.get<ArcadeListToolkits>("/arcade/toolkits"),
        APIWrapper.get<ToolkitAuthorizationList>("/toolkit-authorizations"),
      ]);

      const allToolkits = toolkitsResponse.toolkits || [];
      const userAuthorizations =
        authorizationsResponse.toolkitAuthorizations || [];

      // Filter to only show authorized toolkits
      const authorizedToolkits = allToolkits.filter(
        (
          toolkit: NonNullable<
            ActionResponse<ArcadeListToolkits>["toolkits"]
          >[0]
        ) =>
          userAuthorizations.some(
            (
              auth: NonNullable<
                ActionResponse<ToolkitAuthorizationList>["toolkitAuthorizations"]
              >[0]
            ) => auth.toolkitName === toolkit.name
          )
      );

      setAvailableToolkits(authorizedToolkits);
    } catch (err) {
      console.error("Failed to load toolkits:", err);
      setAvailableToolkits([]);
    } finally {
      setToolkitsLoading(false);
    }
  };

  const fetchAgentModels = async () => {
    try {
      setModelsLoading(true);
      const response: ActionResponse<AgentModels> =
        await APIWrapper.get<AgentModels>("/agent/models");
      setAvailableModels(response.models);
    } catch (err) {
      console.error("Failed to load agent models:", err);
    } finally {
      setModelsLoading(false);
    }
  };

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
  };

  const handleInputChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    const { name, value, type } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]:
        type === "checkbox" ? (e.target as HTMLInputElement).checked : value,
    }));
  };

  const handleToolkitChange = (toolkitName: string, checked: boolean) => {
    setFormData(prev => ({
      ...prev,
      toolkits: checked
        ? [...prev.toolkits, toolkitName]
        : prev.toolkits.filter((t: string) => t !== toolkitName),
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);

    try {
      // Ensure toolkits is always an array, handling stringified arrays
      let toolkitsArray: string[] = [];
      if (Array.isArray(formData.toolkits)) {
        toolkitsArray = formData.toolkits;
      } else if (typeof formData.toolkits === "string") {
        try {
          const parsed = JSON.parse(formData.toolkits);
          toolkitsArray = Array.isArray(parsed) ? parsed : [];
        } catch {
          // If it's not valid JSON, treat as empty array
          toolkitsArray = [];
        }
      }

      const submitData = {
        id: parseInt(id as string),
        ...formData,
        toolkits: toolkitsArray,
      };

      console.log("Submitting agent data:", submitData);

      const response: ActionResponse<AgentEdit> =
        await APIWrapper.post<AgentEdit>("/agent", submitData);
      setAgent(response.agent);
      setIsEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    try {
      await APIWrapper.delete<AgentDelete>("/agent", {
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

      await APIWrapper.post<AgentRunAction>("/agent/run", {
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
      await APIWrapper.delete<AgentRunList>("/agentRun", { id: agentRunId });
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
                {!isEditing && (
                  <>
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
                      onClick={() => setIsEditing(true)}
                    >
                      Edit
                    </Button>
                    <Button variant="outline-danger" onClick={handleDelete}>
                      Delete
                    </Button>
                  </>
                )}
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
            {!isEditing && (
              <>
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
                        <div className="small text-muted">
                          {agent.description}
                        </div>
                      </div>
                    )}
                    {agent.toolkits && agent.toolkits.length > 0 && (
                      <div className="mb-3">
                        <strong>Toolkits:</strong>
                        <div className="mt-1">
                          {agent.toolkits.map((toolkit: string) => (
                            <Badge
                              key={toolkit}
                              bg="info"
                              className="me-1 mb-1"
                            >
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
                        onClick={() => setIsEditing(true)}
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
              </>
            )}

            {isEditing && (
              <Card>
                <Card.Header>
                  <h6>Edit Agent</h6>
                </Card.Header>
                <Card.Body className="p-3">
                  <Form onSubmit={handleSubmit}>
                    <Form.Group className="mb-3">
                      <Form.Label className="small">Agent Name *</Form.Label>
                      <Form.Control
                        type="text"
                        name="name"
                        value={formData.name}
                        onChange={handleInputChange}
                        required
                        size="sm"
                        placeholder="Enter agent name"
                      />
                    </Form.Group>

                    <Form.Group className="mb-3">
                      <Form.Label className="small">AI Model *</Form.Label>
                      <Form.Select
                        name="model"
                        value={formData.model}
                        // @ts-ignore
                        onChange={handleInputChange}
                        required
                        size="sm"
                        disabled={modelsLoading}
                      >
                        {modelsLoading ? (
                          <option>Loading models...</option>
                        ) : (
                          availableModels.map(model => (
                            <option key={model.value} value={model.value}>
                              {model.label}
                            </option>
                          ))
                        )}
                      </Form.Select>
                    </Form.Group>

                    <Form.Group className="mb-3">
                      <Form.Label className="small">Description</Form.Label>
                      <Form.Control
                        as="textarea"
                        rows={2}
                        name="description"
                        value={formData.description}
                        onChange={handleInputChange}
                        size="sm"
                        placeholder="Describe what this agent does"
                      />
                    </Form.Group>

                    <Form.Group className="mb-3">
                      <Form.Label className="small">User Prompt *</Form.Label>
                      <Form.Control
                        as="textarea"
                        rows={4}
                        name="userPrompt"
                        value={formData.userPrompt}
                        onChange={handleInputChange}
                        required
                        size="sm"
                        placeholder="Enter the user prompt"
                      />
                    </Form.Group>

                    <Form.Group className="mb-3">
                      <Form.Label className="small">Response Type</Form.Label>
                      <Form.Select
                        name="responseType"
                        value={formData.responseType}
                        // @ts-ignore
                        onChange={handleInputChange}
                        size="sm"
                      >
                        <option value="text">Text</option>
                        <option value="json">JSON</option>
                        <option value="markdown">Markdown</option>
                      </Form.Select>
                    </Form.Group>

                    <Form.Group className="mb-3">
                      <Form.Label className="small">Schedule</Form.Label>
                      <Form.Control
                        type="text"
                        name="schedule"
                        value={formData.schedule}
                        onChange={handleInputChange}
                        size="sm"
                        placeholder="0 9 * * *"
                      />
                    </Form.Group>

                    <Form.Group className="mb-3">
                      <Form.Label className="small">Toolkits</Form.Label>
                      <div className="small text-muted mb-2">
                        Only toolkits you have authorized are available for
                        selection.
                        <a href="/toolkits" className="ms-1">
                          Manage toolkit authorizations
                        </a>
                      </div>
                      <ToolkitSelector
                        availableToolkits={availableToolkits}
                        selectedToolkits={formData.toolkits}
                        onToolkitChange={handleToolkitChange}
                        loading={toolkitsLoading}
                        disabled={saving}
                        size="sm"
                      />
                    </Form.Group>

                    <Form.Group className="mb-3">
                      <Form.Check
                        type="checkbox"
                        name="enabled"
                        checked={formData.enabled}
                        onChange={handleInputChange}
                        label="Enable agent"
                        className="small"
                      />
                    </Form.Group>

                    <div className="d-grid gap-2">
                      <Button
                        type="submit"
                        variant="primary"
                        size="sm"
                        disabled={saving}
                      >
                        {saving ? "Saving..." : "Save Changes"}
                      </Button>
                      <Button
                        type="button"
                        variant="outline-secondary"
                        size="sm"
                        onClick={() => setIsEditing(false)}
                        disabled={saving}
                      >
                        Cancel
                      </Button>
                    </div>
                  </Form>
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
                    <ListGroup className="mb-3">
                      {agentRuns.map(
                        (
                          agentRun: NonNullable<
                            ActionResponse<AgentRunList>["agentRuns"]
                          >[0]
                        ) => (
                          <ListGroup.Item
                            key={agentRun.id}
                            className="border-0 border-bottom py-3"
                          >
                            <div className="d-flex justify-content-between align-items-start mb-2">
                              <div className="d-flex align-items-center">
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
                                  className="me-2"
                                >
                                  {agentRun.status}
                                </Badge>
                                <small className="text-muted">
                                  {formatDate(agentRun.createdAt)}
                                </small>
                              </div>
                              <div className="d-flex gap-1">
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
                              </div>
                            </div>
                            <div className="agent-run-content">
                              <div className="mb-2">
                                <strong>User Message:</strong>
                                <div
                                  className="p-2 rounded mt-1"
                                  style={{
                                    backgroundColor: "#f8f9fa",
                                    border: "1px solid #dee2e6",
                                  }}
                                >
                                  <div
                                    style={{
                                      fontFamily: "inherit",
                                      fontSize: "0.9rem",
                                      lineHeight: "1.5",
                                    }}
                                  >
                                    <ReactMarkdown>
                                      {agentRun.userMessage}
                                    </ReactMarkdown>
                                  </div>
                                </div>
                              </div>
                              {agentRun.response && (
                                <div>
                                  <strong>Response:</strong>
                                  <div
                                    className="p-2 rounded mt-1"
                                    style={{
                                      backgroundColor: "#e8f5e8",
                                      border: "1px solid #dee2e6",
                                    }}
                                  >
                                    <div
                                      style={{
                                        fontFamily: "inherit",
                                        fontSize: "0.9rem",
                                        lineHeight: "1.5",
                                      }}
                                    >
                                      <ReactMarkdown>
                                        {agentRun.response}
                                      </ReactMarkdown>
                                    </div>
                                  </div>
                                </div>
                              )}
                            </div>
                          </ListGroup.Item>
                        )
                      )}
                    </ListGroup>

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
