"use client";

import { useRouter } from "next/router";
import React, { useState } from "react";
import { Alert, Button, Card, Container, Form } from "react-bootstrap";
import type { SessionCreate } from "../../backend/actions/session";
import { useAuth } from "../lib/auth";

type SigninFormData = SessionCreate["inputs"]["_type"];

export default function Signin() {
  const [formData, setFormData] = useState<SigninFormData>({
    email: "",
    password: "",
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { signin } = useAuth();
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

    try {
      await signin(formData);
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Signin failed");
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
              <h3 className="text-center mb-0">Sign In</h3>
            </Card.Header>
            <Card.Body>
              {error && <Alert variant="danger">{error}</Alert>}
              <Form onSubmit={handleSubmit}>
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
                  />
                </Form.Group>

                <Button
                  type="submit"
                  variant="primary"
                  className="w-100"
                  disabled={loading}
                >
                  {loading ? "Signing In..." : "Sign In"}
                </Button>
              </Form>

              <div className="text-center mt-3">
                <small>
                  Don't have an account?{" "}
                  <a href="/signup" className="text-decoration-none">
                    Create one
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
