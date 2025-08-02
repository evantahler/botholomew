"use client";

import React, { useState } from "react";
import { useRouter } from "next/router";
import { Container, Form, Button, Alert, Card } from "react-bootstrap";
import { useAuth } from "../lib/auth";
import type { UserCreate } from "../../backend/actions/user";

type SignupFormData = UserCreate["inputs"]["_type"];

export default function Signup() {
  const [formData, setFormData] = useState<
    SignupFormData & { confirmPassword: string }
  >({
    name: "",
    email: "",
    password: "",
    confirmPassword: "",
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { signup } = useAuth();
  const router = useRouter();

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    // Validation
    if (formData.password !== formData.confirmPassword) {
      setError("Passwords do not match");
      setLoading(false);
      return;
    }

    if (formData.password.length < 8) {
      setError("Password must be at least 8 characters long");
      setLoading(false);
      return;
    }

    try {
      await signup({
        name: formData.name,
        email: formData.email,
        password: formData.password,
      });
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Signup failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Container className="mt-5 pt-5">
      <div className="row justify-content-center">
        <div className="col-md-6 col-lg-4">
          <Card>
            <Card.Header>
              <h3 className="text-center mb-0">Create Account</h3>
            </Card.Header>
            <Card.Body>
              {error && <Alert variant="danger">{error}</Alert>}
              <Form onSubmit={handleSubmit}>
                <Form.Group className="mb-3">
                  <Form.Label>Name</Form.Label>
                  <Form.Control
                    type="text"
                    name="name"
                    value={formData.name}
                    onChange={handleChange}
                    required
                    minLength={3}
                    maxLength={256}
                  />
                </Form.Group>

                <Form.Group className="mb-3">
                  <Form.Label>Email</Form.Label>
                  <Form.Control
                    type="email"
                    name="email"
                    value={formData.email}
                    onChange={handleChange}
                    required
                  />
                </Form.Group>

                <Form.Group className="mb-3">
                  <Form.Label>Password</Form.Label>
                  <Form.Control
                    type="password"
                    name="password"
                    value={formData.password}
                    onChange={handleChange}
                    required
                    minLength={8}
                    maxLength={256}
                  />
                  <Form.Text className="text-muted">
                    Must be at least 8 characters long
                  </Form.Text>
                </Form.Group>

                <Form.Group className="mb-3">
                  <Form.Label>Confirm Password</Form.Label>
                  <Form.Control
                    type="password"
                    name="confirmPassword"
                    value={formData.confirmPassword}
                    onChange={handleChange}
                    required
                  />
                </Form.Group>

                <Button
                  type="submit"
                  variant="primary"
                  className="w-100"
                  disabled={loading}
                >
                  {loading ? "Creating Account..." : "Create Account"}
                </Button>
              </Form>

              <div className="text-center mt-3">
                <small>
                  Already have an account?{" "}
                  <a href="/signin" className="text-decoration-none">
                    Sign in
                  </a>
                </small>
              </div>
            </Card.Body>
          </Card>
        </div>
      </div>
    </Container>
  );
}
