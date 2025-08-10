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

export default function AgentDetail() {
  const router = useRouter();
  const { id } = router.query;
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [agent, setAgent] = useState<any | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [runResult, setRunResult] = useState<{
    response?: string;
    message?: any;
  } | null>(null);
  const [formData, setFormData] = useState<any>({
    name: "",
    description: "",
    model: "gpt-4o",
    systemPrompt: "",
    enabled: false,
    schedule: "",
    toolkits: [],
  });

  // Toolkits state
  const [availableToolkits, setAvailableToolkits] = useState<any[]>([]);
  const [toolkitsLoading, setToolkitsLoading] = useState(false);

  // Agent models state
  const [availableModels, setAvailableModels] = useState<
    Array<{ value: string; label: string }>
  >([]);
  const [modelsLoading, setModelsLoading] = useState(false);

  // Messages state
  const [messages, setMessages] = useState<any[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messagesError, setMessagesError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalMessages, setTotalMessages] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const messagesPerPage = 20;

  useEffect(() => {
    if (id) {
      fetchAgent();
      fetchMessages();
      fetchToolkits();
      fetchAgentModels();
    }
  }, [id, currentPage]);

  const fetchAgent = async () => {
    try {
      setLoading(true);
      const response = await APIWrapper.get("/agent/:id", {
        id: parseInt(id as string),
      });
      const agentData = response.agent;
      setAgent(agentData);
      setFormData({
        name: agentData.name,
        description: agentData.description || "",
        model: agentData.model,
        systemPrompt: agentData.systemPrompt,
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

  const fetchMessages = async () => {
    if (!id) return;

    try {
      setMessagesLoading(true);
      setMessagesError(null);

      const offset = (currentPage - 1) * messagesPerPage;
      const response = await APIWrapper.get("/messages", {
        agentId: parseInt(id as string),
        limit: messagesPerPage,
        offset: offset,
      });

      setMessages(response.messages || []);
      // Handle both new format (with total) and old format (without total)
      const total =
        response.total !== undefined
          ? response.total
          : response.messages?.length || 0;
      setTotalMessages(total);
      setTotalPages(Math.ceil(total / messagesPerPage));
    } catch (err) {
      setMessagesError(
        err instanceof Error ? err.message : "Failed to load messages"
      );
    } finally {
      setMessagesLoading(false);
    }
  };

  const fetchToolkits = async () => {
    try {
      setToolkitsLoading(true);

      // Fetch both available toolkits and user's authorizations
      const [toolkitsResponse, authorizationsResponse] = await Promise.all([
        APIWrapper.get("/arcade/toolkits"),
        APIWrapper.get("/toolkit-authorizations"),
      ]);

      const allToolkits = toolkitsResponse.toolkits || [];
      const userAuthorizations =
        authorizationsResponse.toolkitAuthorizations || [];

      // Filter to only show authorized toolkits
      const authorizedToolkits = allToolkits.filter((toolkit: any) =>
        userAuthorizations.some(
          (auth: any) => auth.toolkitName === toolkit.name
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
      const response = await APIWrapper.get("/agent/models");
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
    setFormData((prev: any) => ({
      ...prev,
      [name]:
        type === "checkbox" ? (e.target as HTMLInputElement).checked : value,
    }));
  };

  const handleToolkitChange = (toolkitName: string, checked: boolean) => {
    setFormData((prev: any) => ({
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

      const response = await APIWrapper.post("/agent", submitData);
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
      await APIWrapper.delete("/agent", { id: parseInt(id as string) });
      router.push("/agents");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete agent");
    }
  };

  const handleRunAgent = async () => {
    try {
      setRunning(true);
      setRunResult(null);
      setError(null);

      const result = await APIWrapper.post("/agent/tick", {
        id: parseInt(id as string),
      });
      setRunResult({
        response: result.response,
        message: result.message,
      });

      // Refresh messages to show the new message
      await fetchMessages();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to run agent");
    } finally {
      setRunning(false);
    }
  };

  const handleDeleteMessage = async (messageId: number) => {
    if (!confirm("Are you sure you want to delete this message?")) {
      return;
    }

    try {
      await APIWrapper.delete("/message", { id: messageId });
      // Refresh messages to update the list
      await fetchMessages();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete message");
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
                      <Form.Label className="small">System Prompt *</Form.Label>
                      <Form.Control
                        as="textarea"
                        rows={4}
                        name="systemPrompt"
                        value={formData.systemPrompt}
                        onChange={handleInputChange}
                        required
                        size="sm"
                        placeholder="Enter the system prompt"
                      />
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

          {/* Main Content - Messages */}
          <Col lg={9}>
            {/* Run Result Section */}
            {runResult && (
              <Card className="mt-4">
                <Card.Header>
                  <h6>Last Run Result</h6>
                </Card.Header>
                <Card.Body>
                  {runResult.response && (
                    <div className="mb-3">
                      <strong>Response:</strong>
                      <div className="mt-2 p-3 bg-light rounded">
                        <pre
                          className="mb-0"
                          style={{ whiteSpace: "pre-wrap" }}
                        >
                          {runResult.response}
                        </pre>
                      </div>
                    </div>
                  )}
                  {runResult.message && (
                    <div>
                      <strong>Message Details:</strong>
                      <div className="mt-2">
                        <ListGroup>
                          <ListGroup.Item>
                            <strong>ID:</strong> {runResult.message.id}
                          </ListGroup.Item>
                          <ListGroup.Item>
                            <strong>Content:</strong>
                            <div className="mt-2">
                              <ReactMarkdown>
                                {runResult.message.content}
                              </ReactMarkdown>
                            </div>
                          </ListGroup.Item>
                          <ListGroup.Item>
                            <strong>Created:</strong>{" "}
                            {formatDate(runResult.message.createdAt)}
                          </ListGroup.Item>
                        </ListGroup>
                      </div>
                    </div>
                  )}
                </Card.Body>
              </Card>
            )}

            {/* Messages Section */}
            <Card>
              <Card.Header>
                <div className="d-flex justify-content-between align-items-center">
                  <h5 className="mb-0">Messages</h5>
                  <div className="d-flex gap-2">
                    <Button
                      variant="outline-secondary"
                      size="sm"
                      onClick={fetchMessages}
                      disabled={messagesLoading}
                    >
                      {messagesLoading ? (
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
                {messagesError && (
                  <Alert
                    variant="danger"
                    onClose={() => setMessagesError(null)}
                    dismissible
                  >
                    {messagesError}
                  </Alert>
                )}

                {messagesLoading ? (
                  <div className="text-center py-4">
                    <Spinner animation="border" role="status">
                      <span className="visually-hidden">
                        Loading messages...
                      </span>
                    </Spinner>
                  </div>
                ) : messages.length === 0 ? (
                  <div className="text-center py-4 text-muted">
                    <p>No messages found for this agent.</p>
                    <p className="small">
                      Run the agent to start a conversation.
                    </p>
                  </div>
                ) : (
                  <>
                    <ListGroup className="mb-3">
                      {messages.map(message => (
                        <ListGroup.Item
                          key={message.id}
                          className="border-0 border-bottom py-3"
                        >
                          <div className="d-flex justify-content-between align-items-start mb-2">
                            <div className="d-flex align-items-center">
                              <Badge
                                bg={
                                  message.role === "user"
                                    ? "primary"
                                    : message.role === "assistant"
                                      ? "success"
                                      : "secondary"
                                }
                                className="me-2"
                              >
                                {message.role}
                              </Badge>
                              <small className="text-muted">
                                {formatDate(message.createdAt)}
                              </small>
                            </div>
                            <div className="d-flex gap-1">
                              <Button
                                variant="outline-danger"
                                size="sm"
                                onClick={() => handleDeleteMessage(message.id)}
                                disabled={messagesLoading}
                              >
                                X
                              </Button>
                            </div>
                          </div>
                          <div className="message-content">
                            <div
                              className="p-3 rounded"
                              style={{
                                backgroundColor:
                                  message.role === "user"
                                    ? "#f8f9fa"
                                    : "#e8f5e8",
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
                                <ReactMarkdown>{message.content}</ReactMarkdown>
                              </div>
                            </div>
                          </div>
                        </ListGroup.Item>
                      ))}
                    </ListGroup>

                    <Pagination
                      currentPage={currentPage}
                      totalPages={totalPages}
                      totalItems={totalMessages}
                      itemsPerPage={messagesPerPage}
                      currentOffset={(currentPage - 1) * messagesPerPage}
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
