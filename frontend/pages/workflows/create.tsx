"use client";

import { useRouter } from "next/router";
import React, { useState } from "react";
import {
  Alert,
  Button,
  Card,
  Col,
  Container,
  Form,
  ListGroup,
  Row,
  Spinner,
} from "react-bootstrap";
import type { WorkflowCreate } from "../../../backend/actions/workflow";
import Navigation from "../../components/Navigation";
import ProtectedRoute from "../../components/ProtectedRoute";
import { APIWrapper } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import {
  CRON_EXAMPLES,
  describeCronExpression,
  validateCronExpression,
} from "../../lib/cronUtils";

type CreateWorkflowFormData = WorkflowCreate["inputs"]["_type"];

export default function CreateWorkflow() {
  const router = useRouter();
  const { user } = useAuth();
  const [formData, setFormData] = useState<CreateWorkflowFormData>({
    name: "",
    description: "",
    enabled: false,
    schedule: "",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [showExamples, setShowExamples] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setScheduleError(null);

    // Validate schedule if provided
    if (formData.schedule && formData.schedule.trim()) {
      const validation = validateCronExpression(formData.schedule);
      if (!validation.valid) {
        setScheduleError(validation.error || "Invalid cron expression");
        setLoading(false);
        return;
      }
    }

    try {
      const response = await APIWrapper.put<WorkflowCreate>("/workflow", {
        ...formData,
        schedule: formData.schedule?.trim() || undefined,
      });
      router.push(`/workflows/edit/${response.workflow.id}`);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to create workflow",
      );
    } finally {
      setLoading(false);
    }
  };

  const handleScheduleChange = (value: string) => {
    setFormData((prev) => ({ ...prev, schedule: value }));
    setScheduleError(null);

    // Validate on change for immediate feedback
    if (value && value.trim()) {
      const validation = validateCronExpression(value);
      if (!validation.valid) {
        setScheduleError(validation.error || "Invalid cron expression");
      }
    }
  };

  const handleInputChange = (
    field: keyof CreateWorkflowFormData,
    value: any,
  ) => {
    setFormData((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  if (!user) {
    return <ProtectedRoute children={undefined} />;
  }

  return (
    <>
      <Navigation />
      <Container className="mt-5 pt-4">
        <Row className="justify-content-center">
          <Col lg={8} xl={6}>
            <Card>
              <Card.Header>
                <h3 className="mb-0">Create New Workflow</h3>
              </Card.Header>
              <Card.Body>
                <Form onSubmit={handleSubmit}>
                  {error && (
                    <Alert
                      variant="danger"
                      onClose={() => setError(null)}
                      dismissible
                    >
                      {error}
                    </Alert>
                  )}

                  <Form.Group className="mb-3">
                    <Form.Label>Workflow Name *</Form.Label>
                    <Form.Control
                      type="text"
                      value={formData.name}
                      onChange={(e) =>
                        handleInputChange("name", e.target.value)
                      }
                      placeholder="Enter workflow name"
                      required
                      maxLength={256}
                    />
                    <Form.Text className="text-muted">
                      Choose a descriptive name for your workflow
                    </Form.Text>
                  </Form.Group>

                  <Form.Group className="mb-3">
                    <Form.Label>Description</Form.Label>
                    <Form.Control
                      as="textarea"
                      rows={3}
                      value={formData.description}
                      onChange={(e) =>
                        handleInputChange("description", e.target.value)
                      }
                      placeholder="Describe what this workflow does"
                    />
                    <Form.Text className="text-muted">
                      Optional description to help you remember what this
                      workflow does
                    </Form.Text>
                  </Form.Group>

                  <Form.Group className="mb-3">
                    <Form.Label>
                      Schedule (Cron Expression){" "}
                      <small className="text-muted">Optional</small>
                    </Form.Label>
                    <Form.Control
                      type="text"
                      value={formData.schedule || ""}
                      onChange={(e) => handleScheduleChange(e.target.value)}
                      placeholder="e.g., 0 9 * * * (daily at 9 AM)"
                      isInvalid={!!scheduleError}
                      maxLength={256}
                    />
                    {scheduleError && (
                      <Form.Control.Feedback type="invalid">
                        {scheduleError}
                      </Form.Control.Feedback>
                    )}
                    {!scheduleError &&
                      formData.schedule &&
                      describeCronExpression(formData.schedule) && (
                        <Form.Text className="text-success">
                          {describeCronExpression(formData.schedule)}
                        </Form.Text>
                      )}
                    {!scheduleError && (
                      <Form.Text className="text-muted d-block mt-1">
                        Leave empty to run manually, or enter a cron expression
                        for automatic scheduling.{" "}
                        <Button
                          variant="link"
                          size="sm"
                          className="p-0"
                          onClick={() => setShowExamples(!showExamples)}
                        >
                          {showExamples ? "Hide" : "Show"} examples
                        </Button>
                      </Form.Text>
                    )}
                    {showExamples && (
                      <Card className="mt-2">
                        <Card.Header className="py-2">
                          <small className="fw-bold">Common Examples</small>
                        </Card.Header>
                        <ListGroup variant="flush">
                          {CRON_EXAMPLES.map((example, idx) => (
                            <ListGroup.Item
                              key={idx}
                              action
                              onClick={() => {
                                handleScheduleChange(example.expression);
                                setShowExamples(false);
                              }}
                              style={{ cursor: "pointer" }}
                            >
                              <code className="text-primary">
                                {example.expression}
                              </code>
                              <span className="text-muted ms-2">
                                - {example.description}
                              </span>
                            </ListGroup.Item>
                          ))}
                        </ListGroup>
                      </Card>
                    )}
                  </Form.Group>

                  <Form.Group className="mb-4">
                    <Form.Check
                      type="checkbox"
                      id="enabled"
                      label="Enable workflow immediately"
                      checked={formData.enabled}
                      onChange={(e) =>
                        handleInputChange("enabled", e.target.checked)
                      }
                    />
                    <Form.Text className="text-muted">
                      You can always enable/disable the workflow later
                    </Form.Text>
                  </Form.Group>

                  <div className="d-flex gap-2 justify-content-end">
                    <Button
                      variant="outline-secondary"
                      onClick={() => router.push("/workflows")}
                      disabled={loading}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      variant="primary"
                      disabled={loading || !formData.name.trim()}
                    >
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
                        "Create Workflow"
                      )}
                    </Button>
                  </div>
                </Form>
              </Card.Body>
            </Card>
          </Col>
        </Row>
      </Container>
    </>
  );
}
