"use client";

import { useRouter } from "next/router";
import React, { useEffect, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Col,
  Container,
  Form,
  Row,
  Spinner,
} from "react-bootstrap";
import type {
  AgentEdit,
  AgentModels,
  AgentRun,
  AgentView,
} from "../../../../backend/actions/agent";
import type { ArcadeListToolkits } from "../../../../backend/actions/arcade";
import type { ToolkitAuthorizationList } from "../../../../backend/actions/toolkit_authorization";
import type { ActionResponse } from "../../../../backend/api";
import AgentMemory from "../../../components/AgentMemory";
import MarkdownRenderer from "../../../components/MarkdownRenderer";
import Navigation from "../../../components/Navigation";
import ProtectedRoute from "../../../components/ProtectedRoute";
import ToolkitSelector from "../../../components/ToolkitSelector";
import { APIWrapper } from "../../../lib/api";
import { useAuth } from "../../../lib/auth";

export default function EditAgent() {
  const router = useRouter();
  const { id } = router.query;
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [agent, setAgent] = useState<ActionResponse<AgentView>["agent"] | null>(
    null,
  );
  const [formData, setFormData] = useState<{
    name: string;
    description: string;
    model: string;
    userPrompt: string;
    responseType: "text" | "json" | "markdown";
    enabled: boolean;
    toolkits: string[];
  }>({
    name: "",
    description: "",
    model: "gpt-5",
    userPrompt: "",
    responseType: "text",
    enabled: false,
    toolkits: [],
  });

  // Test agent state
  const [testContext, setTestContext] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<ActionResponse<AgentRun> | null>(
    null,
  );

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
  const [showSuccessBanner, setShowSuccessBanner] = useState(false);
  const [bannerOpacity, setBannerOpacity] = useState(1);

  useEffect(() => {
    if (id) {
      fetchAgent();
      fetchToolkits();
      fetchAgentModels();
    }
  }, [id]);

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
        toolkits: agentData.toolkits || [],
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
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
          >[0],
        ) => {
          const isAuthorized = userAuthorizations.some(
            (
              auth: NonNullable<
                ActionResponse<ToolkitAuthorizationList>["toolkitAuthorizations"]
              >[0],
            ) => auth.toolkitName === toolkit.name,
          );
          return isAuthorized;
        },
      );

      // Ensure all toolkits have the expected structure
      const validatedToolkits = authorizedToolkits.filter(
        (
          toolkit: NonNullable<
            ActionResponse<ArcadeListToolkits>["toolkits"]
          >[0],
        ) => {
          const isValid =
            toolkit &&
            typeof toolkit.name === "string" &&
            typeof toolkit.description === "string" &&
            Array.isArray(toolkit.tools);

          if (!isValid) {
            console.warn("Invalid toolkit structure:", toolkit);
          }
          return isValid;
        },
      );

      setAvailableToolkits(validatedToolkits);
    } catch (err) {
      console.error("Failed to fetch toolkits:", err);
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
      console.error("Failed to fetch agent models:", err);
      setAvailableModels([]);
    } finally {
      setModelsLoading(false);
    }
  };

  const handleInputChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    const { name, value, type } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]:
        type === "checkbox" ? (e.target as HTMLInputElement).checked : value,
    }));
  };

  const handleToolkitChange = (toolkitName: string, checked: boolean) => {
    setFormData((prev) => ({
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

      const response: ActionResponse<AgentEdit> =
        await APIWrapper.post<AgentEdit>(`/agent/${id}`, submitData);

      // Show success banner instead of redirecting
      setShowSuccessBanner(true);
      setBannerOpacity(1);

      // Start fade out after 2.5 seconds, then hide after 3 seconds
      setTimeout(() => {
        setBannerOpacity(0);
      }, 2500);

      setTimeout(() => {
        setShowSuccessBanner(false);
      }, 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    router.push(`/agents/${id}`);
  };

  const handleTestAgent = async () => {
    if (!agent) return;

    setTesting(true);
    setTestResult(null);
    setError(null);

    try {
      const response: ActionResponse<AgentRun> =
        await APIWrapper.post<AgentRun>(`/agent/${agent.id}/run`, {
          additionalContext: testContext || undefined,
        });

      setTestResult(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to test agent");
    } finally {
      setTesting(false);
    }
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
            Agent not found or you don't have permission to edit it.
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
              <h1>Edit Agent: {agent.name}</h1>
              <div className="d-flex gap-2">
                <Button
                  variant="outline-secondary"
                  onClick={handleCancel}
                  disabled={saving}
                >
                  Cancel
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

        {showSuccessBanner && (
          <Row className="mb-4">
            <Col>
              <Alert
                variant="success"
                className="fade-in"
                style={{
                  animation: "fadeIn 0.5s ease-in-out",
                  transition: "opacity 0.5s ease-in-out",
                  opacity: bannerOpacity,
                }}
              >
                ✓ Agent updated successfully!
              </Alert>
            </Col>
          </Row>
        )}

        <Row>
          <Col lg={8}>
            <Card className="mb-4">
              <Card.Header>
                <h6>Edit Agent Configuration</h6>
              </Card.Header>
              <Card.Body className="p-3">
                <Form onSubmit={handleSubmit}>
                  <Form.Group className="mb-3">
                    <Form.Label className="small">Name *</Form.Label>
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
                    <Form.Label className="small">Model *</Form.Label>
                    <Form.Select
                      name="model"
                      value={formData.model}
                      onChange={(e) =>
                        setFormData((prev) => ({
                          ...prev,
                          model: e.target.value,
                        }))
                      }
                      required
                      size="sm"
                    >
                      {availableModels.length > 0 ? (
                        availableModels.map((model) => (
                          <option key={model.value} value={model.value}>
                            {model.label}
                          </option>
                        ))
                      ) : (
                        <option value="">No models available</option>
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
                      onChange={(e) =>
                        setFormData((prev) => ({
                          ...prev,
                          responseType: e.target.value as
                            | "text"
                            | "json"
                            | "markdown",
                        }))
                      }
                      size="sm"
                    >
                      <option value="text">Text</option>
                      <option value="json">JSON</option>
                      <option value="markdown">Markdown</option>
                    </Form.Select>
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
                    {availableToolkits && availableToolkits.length > 0 ? (
                      <ToolkitSelector
                        availableToolkits={availableToolkits}
                        selectedToolkits={formData.toolkits}
                        onToolkitChange={handleToolkitChange}
                        loading={toolkitsLoading}
                        disabled={saving}
                        size="sm"
                      />
                    ) : toolkitsLoading ? (
                      <div className="small text-muted">
                        <Spinner
                          as="span"
                          animation="border"
                          size="sm"
                          role="status"
                          aria-hidden="true"
                          className="me-2"
                        />
                        Loading toolkits...
                      </div>
                    ) : (
                      <div className="small text-muted">
                        No authorized toolkits available. Please authorize some
                        toolkits first.
                      </div>
                    )}
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
                      onClick={handleCancel}
                      disabled={saving}
                    >
                      Cancel
                    </Button>
                  </div>
                </Form>
              </Card.Body>
            </Card>
          </Col>

          <Col lg={4}>
            <Card className="mb-4">
              <Card.Header>
                <h6>Current Agent Info</h6>
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
                    <span
                      className={`badge bg-${agent.enabled ? "success" : "secondary"}`}
                    >
                      {agent.enabled ? "Active" : "Inactive"}
                    </span>
                  </div>
                </div>
                <div className="mb-3">
                  <strong>Created:</strong>
                  <div className="small text-muted">
                    {agent.createdAt
                      ? new Date(agent.createdAt).toLocaleString()
                      : "Unknown"}
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
                        <span key={toolkit} className="badge bg-info me-1 mb-1">
                          {toolkit}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </Card.Body>
            </Card>

            <Card className="mb-4">
              <Card.Header>
                <h6>Test Agent</h6>
              </Card.Header>
              <Card.Body className="p-3">
                <Form.Group className="mb-3">
                  <Form.Label className="small">
                    Additional Context (Optional)
                  </Form.Label>
                  <Form.Control
                    type="text"
                    placeholder="Enter additional context for testing"
                    value={testContext}
                    onChange={(e) => setTestContext(e.target.value)}
                    size="sm"
                  />
                </Form.Group>

                <div className="d-grid">
                  <Button
                    type="button"
                    variant="outline-info"
                    size="sm"
                    onClick={handleTestAgent}
                    disabled={testing || !agent}
                  >
                    {testing ? (
                      <>
                        <Spinner
                          as="span"
                          animation="border"
                          size="sm"
                          role="status"
                          aria-hidden="true"
                          className="me-2"
                        />
                        Testing...
                      </>
                    ) : (
                      "Test Agent"
                    )}
                  </Button>
                </div>

                {testResult && (
                  <div className="mt-3">
                    <div className="d-flex align-items-center mb-2">
                      <strong className="me-2">Test Result:</strong>
                      <span
                        className={`badge bg-${
                          testResult.status === "completed"
                            ? "success"
                            : "danger"
                        }`}
                      >
                        {testResult.status}
                      </span>
                    </div>
                    {testResult.result && (
                      <div className="mb-2">
                        <strong>Output:</strong>
                        <div className="mt-1 p-2 bg-light rounded small">
                          <MarkdownRenderer content={testResult.result} />
                        </div>
                      </div>
                    )}
                    {testResult.error && (
                      <div className="mb-2">
                        <strong>Error:</strong>
                        <div className="mt-1 p-2 bg-danger bg-opacity-10 text-danger rounded small">
                          {testResult.error}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </Card.Body>
            </Card>

            <AgentMemory agentId={agent.id} />
          </Col>
        </Row>
      </Container>
    </>
  );
}
