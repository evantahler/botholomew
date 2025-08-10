"use client";

import React from "react";
import { Container, Card, Button, Alert } from "react-bootstrap";
import { useAuth } from "../lib/auth";
import ProtectedRoute from "../components/ProtectedRoute";

export default function Dashboard() {
  const { user, signout } = useAuth();

  const handleSignout = async () => {
    await signout();
  };

  return (
    <ProtectedRoute>
      <Container className="mt-5 pt-5">
        <div className="row justify-content-center">
          <div className="col-md-8 col-lg-6">
            <Card>
              <Card.Header>
                <h3 className="mb-0">Dashboard</h3>
              </Card.Header>
              <Card.Body>
                <Alert variant="success">
                  <h4>Welcome, {user?.name}!</h4>
                  <p>You are successfully signed in to your account.</p>
                </Alert>

                <div className="mb-4">
                  <h5>Account Information</h5>
                  <div className="row">
                    <div className="col-sm-4">
                      <strong>Name:</strong>
                    </div>
                    <div className="col-sm-8">{user?.name}</div>
                  </div>
                  <div className="row">
                    <div className="col-sm-4">
                      <strong>Email:</strong>
                    </div>
                    <div className="col-sm-8">{user?.email}</div>
                  </div>
                  <div className="row">
                    <div className="col-sm-4">
                      <strong>Member since:</strong>
                    </div>
                    <div className="col-sm-8">
                      {user?.createdAt &&
                        new Date(user.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                </div>

                <div className="d-grid gap-2">
                  <Button variant="outline-danger" onClick={handleSignout}>
                    Sign Out
                  </Button>
                </div>
              </Card.Body>
            </Card>
          </div>
        </div>
      </Container>
    </ProtectedRoute>
  );
}
