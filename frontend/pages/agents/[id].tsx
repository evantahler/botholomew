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
  Row,
  Spinner,
} from "react-bootstrap";
import type { AgentRun, AgentView } from "../../../backend/actions/agent";
import type { ActionResponse } from "../../../backend/api";
import MarkdownRenderer from "../../components/MarkdownRenderer";
import Navigation from "../../components/Navigation";
import ProtectedRoute from "../../components/ProtectedRoute";
import { APIWrapper } from "../../lib/api";
import { useAuth } from "../../lib/auth";

export default function ViewAgent() {
  const router = useRouter();
  const { id } = router.query;
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [agent, setAgent] = useState<ActionResponse<AgentView>["agent"] | null>(
    null,
  );

  // Test agent state
  const [testContext, setTestContext] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<ActionResponse<AgentRun> | null>(
    null,
  );

  useEffect(() => {
    if (id) {
      fetchAgent();
    }
  }, [id]);

  const fetchAgent = async () => {
    try {
      setLoading(true);
      const response: ActionResponse<AgentView> =
        await APIWrapper.get<AgentView>("/agent/:id", {
          id: parseInt(id as string),
        });
      setAgent(response.agent);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
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
              <div>
                <h1>{agent.name}</h1>
                <div className="d-flex align-items-center gap-3">
                  <Badge
                    bg={agent.enabled ? "success" : "secondary"}
                    className="text-white"
                  >
                    {agent.enabled ? "Active" : "Inactive"}
                  </Badge>
                  <span className="text-muted small">
                    Created:{" "}
                    {agent.createdAt
                      ? new Date(agent.createdAt).toLocaleString()
                      : "Unknown"}
                  </span>
                </div>
              </div>
              <div className="d-flex gap-2">
                <Button
                  variant="outline-primary"
                  onClick={() => router.push(`/agents/edit/${agent.id}`)}
                >
                  Edit Agent
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
          <Col lg={8}>
            <Card className="mb-4">
              <Card.Header>
                <h6>Agent Details</h6>
              </Card.Header>
              <Card.Body>
                <Row>
                  <Col md={6}>
                    <div className="mb-3">
                      <strong>Model:</strong>
                      <div className="text-muted">{agent.model}</div>
                    </div>
                  </Col>
                  <Col md={6}>
                    <div className="mb-3">
                      <strong>Response Type:</strong>
                      <div className="text-muted capitalize">
                        {agent.responseType}
                      </div>
                    </div>
                  </Col>
                </Row>

                {agent.description && (
                  <div className="mb-3">
                    <strong>Description:</strong>
                    <div className="text-muted mt-1">{agent.description}</div>
                  </div>
                )}

                <div className="mb-3">
                  <strong>User Prompt:</strong>
                  <div className="mt-2 p-3 bg-light rounded">
                    <MarkdownRenderer content={agent.userPrompt} />
                  </div>
                </div>

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
          </Col>

          <Col lg={4}>
            <Card className="mb-4">
              <Card.Header>
                <h6>Test Agent</h6>
              </Card.Header>
              <Card.Body>
                <div className="mb-3">
                  <label className="form-label small">
                    Additional Context (Optional)
                  </label>
                  <textarea
                    className="form-control form-control-sm"
                    rows={3}
                    placeholder="Enter additional context for testing"
                    value={testContext}
                    onChange={(e) => setTestContext(e.target.value)}
                  />
                </div>

                <div className="d-grid mb-3">
                  <Button
                    variant="outline-info"
                    size="sm"
                    onClick={handleTestAgent}
                    disabled={testing}
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
                      <strong className="me-2 small">Test Result:</strong>
                      <Badge
                        bg={
                          testResult.status === "completed"
                            ? "success"
                            : "danger"
                        }
                        className="small"
                      >
                        {testResult.status}
                      </Badge>
                    </div>
                    {testResult.rationale && (
                      <div className="mb-2">
                        <strong className="small">Rationale:</strong>
                        <div className="mt-1 p-2 bg-info bg-opacity-10 rounded small">
                          <MarkdownRenderer content={testResult.rationale} />
                        </div>
                      </div>
                    )}
                    {testResult.result && (
                      <div className="mb-2">
                        <strong className="small">Output:</strong>
                        <div className="mt-1 p-2 bg-light rounded small">
                          <MarkdownRenderer content={testResult.result} />
                        </div>
                      </div>
                    )}
                    {testResult.error && (
                      <div className="mb-2">
                        <strong className="small">Error:</strong>
                        <div className="mt-1 p-2 bg-danger bg-opacity-10 text-danger rounded small">
                          {testResult.error}
                        </div>
                      </div>
                    )}
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
