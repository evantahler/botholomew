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
  Modal,
  ListGroup,
} from "react-bootstrap";
import { useAuth } from "../../lib/auth";
import { APIWrapper } from "../../lib/api";

import Navigation from "../../components/Navigation";
import ProtectedRoute from "../../components/ProtectedRoute";

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
  const [deleteModal, setDeleteModal] = useState(false);
  const [runResult, setRunResult] = useState<{
    response?: string;
    message?: any;
  } | null>(null);
  const [formData, setFormData] = useState<any>({
    name: "",
    description: "",
    model: "gpt-4o",
    systemPrompt: "",
    contextSummary: "",
    enabled: false,
    schedule: "",
  });

  useEffect(() => {
    if (id) {
      fetchAgent();
    }
  }, [id]);

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
        contextSummary: agentData.contextSummary || "",
        enabled: agentData.enabled,
        schedule: agentData.schedule || "",
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);

    try {
      const response = await APIWrapper.post("/agent", {
        id: parseInt(id as string),
        ...formData,
      });
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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to run agent");
    } finally {
      setRunning(false);
    }
  };

  const formatDate = (timestamp: number) => {
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
                    <Button
                      variant="outline-danger"
                      onClick={() => setDeleteModal(true)}
                    >
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
          <Col lg={8}>
            {isEditing ? (
              <Card>
                <Card.Header>
                  <h5>Edit Agent</h5>
                </Card.Header>
                <Card.Body>
                  <Form onSubmit={handleSubmit}>
                    <Row>
                      <Col md={6}>
                        <Form.Group className="mb-3">
                          <Form.Label>Agent Name *</Form.Label>
                          <Form.Control
                            type="text"
                            name="name"
                            value={formData.name}
                            onChange={handleInputChange}
                            required
                            placeholder="Enter agent name"
                          />
                          <Form.Text className="text-muted">
                            A descriptive name for your agent
                          </Form.Text>
                        </Form.Group>
                      </Col>
                      <Col md={6}>
                        <Form.Group className="mb-3">
                          <Form.Label>AI Model *</Form.Label>
                          <Form.Select
                            name="model"
                            value={formData.model}
                            // @ts-ignore
                            onChange={handleInputChange}
                            required
                          >
                            <option value="gpt-4o">GPT-4o</option>
                            <option value="gpt-4o-mini">GPT-4o Mini</option>
                            <option value="gpt-4-turbo">GPT-4 Turbo</option>
                            <option value="gpt-3.5-turbo">GPT-3.5 Turbo</option>
                          </Form.Select>
                          <Form.Text className="text-muted">
                            The AI model to use for this agent
                          </Form.Text>
                        </Form.Group>
                      </Col>
                    </Row>

                    <Form.Group className="mb-3">
                      <Form.Label>Description</Form.Label>
                      <Form.Control
                        as="textarea"
                        rows={3}
                        name="description"
                        value={formData.description}
                        onChange={handleInputChange}
                        placeholder="Describe what this agent does"
                      />
                      <Form.Text className="text-muted">
                        Optional description of the agent's purpose
                      </Form.Text>
                    </Form.Group>

                    <Form.Group className="mb-3">
                      <Form.Label>System Prompt *</Form.Label>
                      <Form.Control
                        as="textarea"
                        rows={6}
                        name="systemPrompt"
                        value={formData.systemPrompt}
                        onChange={handleInputChange}
                        required
                        placeholder="Enter the system prompt that defines the agent's behavior and capabilities"
                      />
                      <Form.Text className="text-muted">
                        This prompt defines how the agent behaves and what it
                        can do
                      </Form.Text>
                    </Form.Group>

                    <Form.Group className="mb-3">
                      <Form.Label>Context Summary</Form.Label>
                      <Form.Control
                        as="textarea"
                        rows={3}
                        name="contextSummary"
                        value={formData.contextSummary}
                        onChange={handleInputChange}
                        placeholder="Optional summary of the agent's context or background"
                      />
                      <Form.Text className="text-muted">
                        A brief summary of the agent's context or background
                        information
                      </Form.Text>
                    </Form.Group>

                    <Row>
                      <Col md={6}>
                        <Form.Group className="mb-3">
                          <Form.Label>Schedule (Cron Expression)</Form.Label>
                          <Form.Control
                            type="text"
                            name="schedule"
                            value={formData.schedule}
                            onChange={handleInputChange}
                            placeholder="0 9 * * * (daily at 9 AM)"
                          />
                          <Form.Text className="text-muted">
                            Optional cron schedule for automated runs (e.g., "0
                            9 * * *" for daily at 9 AM)
                          </Form.Text>
                        </Form.Group>
                      </Col>
                      <Col md={6}>
                        <Form.Group className="mb-3">
                          <Form.Check
                            type="checkbox"
                            name="enabled"
                            checked={formData.enabled}
                            onChange={handleInputChange}
                            label="Enable agent"
                          />
                          <Form.Text className="text-muted">
                            Enable or disable the agent
                          </Form.Text>
                        </Form.Group>
                      </Col>
                    </Row>

                    <div className="d-flex gap-2">
                      <Button type="submit" variant="primary" disabled={saving}>
                        {saving ? (
                          <>
                            <Spinner
                              as="span"
                              animation="border"
                              size="sm"
                              role="status"
                              aria-hidden="true"
                              className="me-2"
                            />
                            Saving...
                          </>
                        ) : (
                          "Save Changes"
                        )}
                      </Button>
                      <Button
                        type="button"
                        variant="outline-secondary"
                        onClick={() => setIsEditing(false)}
                        disabled={saving}
                      >
                        Cancel
                      </Button>
                    </div>
                  </Form>
                </Card.Body>
              </Card>
            ) : (
              <>
                <Card className="mb-4">
                  <Card.Header>
                    <h5>Agent Details</h5>
                  </Card.Header>
                  <Card.Body>
                    <Row>
                      <Col md={6}>
                        <div className="mb-3">
                          <strong>Name:</strong> {agent.name}
                        </div>
                        <div className="mb-3">
                          <strong>Model:</strong> {agent.model}
                        </div>
                        <div className="mb-3">
                          <strong>Status:</strong>{" "}
                          <Badge bg={agent.enabled ? "success" : "secondary"}>
                            {agent.enabled ? "Active" : "Inactive"}
                          </Badge>
                        </div>
                        {agent.schedule && (
                          <div className="mb-3">
                            <strong>Schedule:</strong> {agent.schedule}
                          </div>
                        )}
                      </Col>
                      <Col md={6}>
                        <div className="mb-3">
                          <strong>Created:</strong>{" "}
                          {formatDate(agent.createdAt)}
                        </div>
                        <div className="mb-3">
                          <strong>Last Updated:</strong>{" "}
                          {formatDate(agent.updatedAt)}
                        </div>
                        {agent.scheduleNextRun && (
                          <div className="mb-3">
                            <strong>Next Run:</strong>{" "}
                            {formatDate(agent.scheduleNextRun)}
                          </div>
                        )}
                        {agent.scheduleLastRun && (
                          <div className="mb-3">
                            <strong>Last Run:</strong>{" "}
                            {formatDate(agent.scheduleLastRun)}
                          </div>
                        )}
                      </Col>
                    </Row>

                    {agent.description && (
                      <div className="mb-3">
                        <strong>Description:</strong>
                        <p className="mt-2">{agent.description}</p>
                      </div>
                    )}

                    {agent.contextSummary && (
                      <div className="mb-3">
                        <strong>Context Summary:</strong>
                        <p className="mt-2">{agent.contextSummary}</p>
                      </div>
                    )}

                    <div className="mb-3">
                      <strong>System Prompt:</strong>
                      <div className="mt-2 p-3 bg-light rounded">
                        <pre
                          className="mb-0"
                          style={{ whiteSpace: "pre-wrap" }}
                        >
                          {agent.systemPrompt}
                        </pre>
                      </div>
                    </div>
                  </Card.Body>
                </Card>

                {runResult && (
                  <Card>
                    <Card.Header>
                      <h5>Last Run Result</h5>
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
                                <strong>Content:</strong>{" "}
                                {runResult.message.content}
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
              </>
            )}
          </Col>

          <Col lg={4}>
            {!isEditing && (
              <>
                <Card className="mb-4">
                  <Card.Header>
                    <h5>Schedule Information</h5>
                  </Card.Header>
                  <Card.Body>
                    {agent.schedule ? (
                      <>
                        <div className="mb-3">
                          <strong>Cron Schedule:</strong>
                          <code className="d-block mt-1">{agent.schedule}</code>
                        </div>
                        {agent.scheduleNextRun && (
                          <div className="mb-3">
                            <strong>Next Scheduled Run:</strong>
                            <div>{formatDate(agent.scheduleNextRun)}</div>
                          </div>
                        )}
                        {agent.scheduleLastRun && (
                          <div className="mb-3">
                            <strong>Last Scheduled Run:</strong>
                            <div>{formatDate(agent.scheduleLastRun)}</div>
                          </div>
                        )}
                        {agent.scheduleLastRunResult && (
                          <div className="mb-3">
                            <strong>Last Run Result:</strong>
                            <div className="text-success">
                              {agent.scheduleLastRunResult}
                            </div>
                          </div>
                        )}
                        {agent.scheduleLastRunError && (
                          <div className="mb-3">
                            <strong>Last Run Error:</strong>
                            <div className="text-danger">
                              {agent.scheduleLastRunError}
                            </div>
                          </div>
                        )}
                      </>
                    ) : (
                      <p className="text-muted">No schedule configured</p>
                    )}
                  </Card.Body>
                </Card>

                <Card>
                  <Card.Header>
                    <h5>Quick Actions</h5>
                  </Card.Header>
                  <Card.Body>
                    <div className="d-grid gap-2">
                      <Button
                        variant="primary"
                        onClick={handleRunAgent}
                        disabled={running || !agent.enabled}
                      >
                        {running ? "Running..." : "Run Agent"}
                      </Button>
                      <Button
                        variant="outline-secondary"
                        onClick={() => setIsEditing(true)}
                      >
                        Edit Agent
                      </Button>
                      <Button
                        variant="outline-danger"
                        onClick={() => setDeleteModal(true)}
                      >
                        Delete Agent
                      </Button>
                    </div>
                  </Card.Body>
                </Card>
              </>
            )}
          </Col>
        </Row>
      </Container>

      {/* Delete Confirmation Modal */}
      <Modal show={deleteModal} onHide={() => setDeleteModal(false)} centered>
        <Modal.Header closeButton>
          <Modal.Title>Confirm Delete</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          Are you sure you want to delete the agent "{agent.name}"? This action
          cannot be undone.
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setDeleteModal(false)}>
            Cancel
          </Button>
          <Button variant="danger" onClick={handleDelete}>
            Delete
          </Button>
        </Modal.Footer>
      </Modal>
    </>
  );
}
