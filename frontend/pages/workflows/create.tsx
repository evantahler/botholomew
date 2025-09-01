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
  Row,
  Spinner,
} from "react-bootstrap";
import type { WorkflowCreate } from "../../../backend/actions/workflow";
import Navigation from "../../components/Navigation";
import ProtectedRoute from "../../components/ProtectedRoute";
import { APIWrapper } from "../../lib/api";
import { useAuth } from "../../lib/auth";

type CreateWorkflowFormData = WorkflowCreate["inputs"]["_type"];

export default function CreateWorkflow() {
  const router = useRouter();
  const { user } = useAuth();
  const [formData, setFormData] = useState<CreateWorkflowFormData>({
    name: "",
    description: "",
    enabled: false,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const response = await APIWrapper.put<WorkflowCreate>(
        "/workflow",
        formData,
      );
      router.push(`/workflows/edit/${response.workflow.id}`);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to create workflow",
      );
    } finally {
      setLoading(false);
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
