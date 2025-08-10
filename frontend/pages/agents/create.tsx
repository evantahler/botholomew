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
  Alert,
  Spinner,
} from "react-bootstrap";
import { useAuth } from "../../lib/auth";
import { APIWrapper } from "../../lib/api";
import Navigation from "../../components/Navigation";
import ProtectedRoute from "../../components/ProtectedRoute";
import ToolkitSelector from "../../components/ToolkitSelector";

export default function CreateAgent() {
  const router = useRouter();
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formData, setFormData] = useState<{
    name: string;
    description: string;
    model: string;
    systemPrompt: string;
    contextSummary: string;
    enabled: boolean;
    schedule: string;
    toolkits: string[];
  }>({
    name: "",
    description: "",
    model: "gpt-4o",
    systemPrompt: "",
    contextSummary: "",
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

  useEffect(() => {
    fetchToolkits();
    fetchAgentModels();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      // Ensure toolkits is always an array
      const submitData = {
        ...formData,
        toolkits: Array.isArray(formData.toolkits) ? formData.toolkits : [],
      };

      console.log("Creating agent with data:", submitData);

      const response = await APIWrapper.put("/agent", submitData);
      router.push(`/agents/${response.agent.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  if (!user) {
    return <ProtectedRoute children={undefined} />;
  }

  return (
    <>
      <Navigation />
      <Container className="mt-5 pt-4">
        <Row className="mb-4">
          <Col>
            <div className="d-flex justify-content-between align-items-center">
              <h1>Create New Agent</h1>
              <Button
                variant="outline-secondary"
                onClick={() => router.push("/agents")}
              >
                Back to Agents
              </Button>
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
            <Card>
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
                      This prompt defines how the agent behaves and what it can
                      do
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
                          Optional cron schedule for automated runs (e.g., "0 9
                          * * *" for daily at 9 AM)
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
                          label="Enable agent immediately"
                        />
                        <Form.Text className="text-muted">
                          Enable the agent to run immediately after creation
                        </Form.Text>
                      </Form.Group>
                    </Col>
                  </Row>

                  <Form.Group className="mb-3">
                    <Form.Label>Toolkits</Form.Label>
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
                      disabled={loading}
                      size="lg"
                    />
                    <Form.Text className="text-muted">
                      Select toolkits to enable additional capabilities for your
                      agent
                    </Form.Text>
                  </Form.Group>

                  <div className="d-flex gap-2">
                    <Button type="submit" variant="primary" disabled={loading}>
                      {loading ? (
                        <>
                          <Spinner
                            as="span"
                            animation="border"
                            size="sm"
                            role="status"
                            aria-hidden="true"
                            className="me-2"
                          />
                          Creating...
                        </>
                      ) : (
                        "Create Agent"
                      )}
                    </Button>
                    <Button
                      type="button"
                      variant="outline-secondary"
                      onClick={() => router.push("/agents")}
                      disabled={loading}
                    >
                      Cancel
                    </Button>
                  </div>
                </Form>
              </Card.Body>
            </Card>
          </Col>
          <Col lg={4}>
            <Card>
              <Card.Header>
                <h5>Tips for Creating Agents</h5>
              </Card.Header>
              <Card.Body>
                <ul className="list-unstyled">
                  <li className="mb-2">
                    <strong>System Prompt:</strong> Be specific about the
                    agent's role, capabilities, and limitations.
                  </li>
                  <li className="mb-2">
                    <strong>Model Selection:</strong> Choose the appropriate
                    model based on your needs and budget.
                  </li>
                  <li className="mb-2">
                    <strong>Scheduling:</strong> Use cron expressions for
                    automated execution (e.g., "0 9 * * *" for daily at 9 AM).
                  </li>
                  <li className="mb-2">
                    <strong>Context Summary:</strong> Provide relevant
                    background information to help the agent understand its
                    context.
                  </li>
                  <li className="mb-2">
                    <strong>Toolkits:</strong> Select toolkits to give your
                    agent access to additional tools and capabilities.
                  </li>
                </ul>
              </Card.Body>
            </Card>
          </Col>
        </Row>
      </Container>
    </>
  );
}
