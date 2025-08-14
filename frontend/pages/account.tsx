"use client";

import React, { useState, useEffect } from "react";
import {
  Container,
  Card,
  Form,
  Button,
  Alert,
  Row,
  Col,
  Tabs,
  Tab,
} from "react-bootstrap";
import { useAuth } from "../lib/auth";
import MarkdownRenderer from "../components/MarkdownRenderer";

export default function AccountPage() {
  const { user, updateUser } = useAuth();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "danger";
    text: string;
  } | null>(null);

  const [formData, setFormData] = useState({
    name: "",
    email: "",
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
    metadata: "",
  });

  useEffect(() => {
    if (user) {
      setFormData(prev => ({
        ...prev,
        name: user.name || "",
        email: user.email || "",
        metadata: user.metadata || "",
      }));
    }
  }, [user]);

  const handleInputChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage(null);

    try {
      // Validate password change if attempting to change password
      if (formData.newPassword || formData.confirmPassword) {
        if (!formData.currentPassword) {
          setMessage({
            type: "danger",
            text: "Current password is required to change password",
          });
          return;
        }
        if (formData.newPassword !== formData.confirmPassword) {
          setMessage({ type: "danger", text: "New passwords do not match" });
          return;
        }
        if (formData.newPassword.length < 8) {
          setMessage({
            type: "danger",
            text: "New password must be at least 8 characters",
          });
          return;
        }
      }

      // Prepare update data
      const updateData: {
        name?: string;
        email?: string;
        password?: string;
        metadata?: string;
      } = {};

      if (formData.name !== user?.name) {
        updateData.name = formData.name;
      }
      if (formData.email !== user?.email) {
        updateData.email = formData.email;
      }
      if (formData.newPassword) {
        updateData.password = formData.newPassword;
      }
      if (formData.metadata !== user?.metadata) {
        updateData.metadata = formData.metadata;
      }

      // Only update if there are changes
      if (Object.keys(updateData).length > 0) {
        await updateUser(updateData);
        setMessage({ type: "success", text: "Profile updated successfully!" });

        // Clear password fields
        setFormData(prev => ({
          ...prev,
          currentPassword: "",
          newPassword: "",
          confirmPassword: "",
        }));
      } else {
        setMessage({ type: "danger", text: "No changes to save" });
      }
    } catch (error) {
      console.error("Update error:", error);
      setMessage({
        type: "danger",
        text:
          error instanceof Error ? error.message : "Failed to update profile",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Container className="mt-5 pt-4">
      <Row className="justify-content-center">
        <Col md={10} lg={8}>
          <Card className="shadow">
            <Card.Header className="bg-primary text-white">
              <h3 className="mb-0">Account Settings</h3>
            </Card.Header>
            <Card.Body className="p-4">
              {message && (
                <Alert
                  variant={message.type}
                  dismissible
                  onClose={() => setMessage(null)}
                >
                  {message.text}
                </Alert>
              )}

              <Form onSubmit={handleSubmit}>
                <Form.Group className="mb-3">
                  <Form.Label>Name</Form.Label>
                  <Form.Control
                    type="text"
                    name="name"
                    value={formData.name}
                    onChange={handleInputChange}
                    placeholder="Enter your name"
                    required
                  />
                </Form.Group>

                <Form.Group className="mb-3">
                  <Form.Label>Email</Form.Label>
                  <Form.Control
                    type="email"
                    name="email"
                    value={formData.email}
                    onChange={handleInputChange}
                    placeholder="Enter your email"
                    required
                  />
                </Form.Group>

                <Form.Group className="mb-3">
                  <Form.Label>Additional Information</Form.Label>
                  <Form.Text className="text-muted mb-2 d-block">
                    Add any additional information about yourself that will be
                    shared with your agents. Supports markdown formatting (e.g.,
                    **bold**, *italic*, [links](url), etc.)
                  </Form.Text>
                  <Tabs defaultActiveKey="edit" className="mb-2">
                    <Tab eventKey="edit" title="Edit">
                      <Form.Control
                        as="textarea"
                        name="metadata"
                        value={formData.metadata}
                        onChange={handleInputChange}
                        placeholder="Enter additional information about yourself..."
                        rows={6}
                        maxLength={10000}
                      />
                      <Form.Text className="text-muted">
                        {formData.metadata.length}/10,000 characters
                      </Form.Text>
                    </Tab>
                    <Tab eventKey="preview" title="Preview">
                      <div className="border rounded p-3 bg-light">
                        {formData.metadata ? (
                          <MarkdownRenderer content={formData.metadata} />
                        ) : (
                          <p className="text-muted">No content to preview</p>
                        )}
                      </div>
                    </Tab>
                  </Tabs>
                </Form.Group>

                <hr className="my-4" />

                <h5>Change Password</h5>
                <p className="text-muted small">
                  Leave blank if you don't want to change your password
                </p>

                <Form.Group className="mb-3">
                  <Form.Label>Current Password</Form.Label>
                  <Form.Control
                    type="password"
                    name="currentPassword"
                    value={formData.currentPassword}
                    onChange={handleInputChange}
                    placeholder="Enter current password"
                  />
                </Form.Group>

                <Form.Group className="mb-3">
                  <Form.Label>New Password</Form.Label>
                  <Form.Control
                    type="password"
                    name="newPassword"
                    value={formData.newPassword}
                    onChange={handleInputChange}
                    placeholder="Enter new password (min 8 characters)"
                  />
                </Form.Group>

                <Form.Group className="mb-4">
                  <Form.Label>Confirm New Password</Form.Label>
                  <Form.Control
                    type="password"
                    name="confirmPassword"
                    value={formData.confirmPassword}
                    onChange={handleInputChange}
                    placeholder="Confirm new password"
                  />
                </Form.Group>

                <div className="d-grid">
                  <Button
                    type="submit"
                    variant="primary"
                    size="lg"
                    disabled={loading}
                  >
                    {loading ? "Updating..." : "Update Profile"}
                  </Button>
                </div>
              </Form>
            </Card.Body>
          </Card>
        </Col>
      </Row>
    </Container>
  );
}
