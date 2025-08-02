import React from "react";
import Head from "next/head";
import { Container, Row, Col, Card } from "react-bootstrap";

export default function Home() {
  return (
    <>
      <Head>
        <title>Botholomew - The Greatest Agent Framework</title>
      </Head>
      <div
        style={{
          minHeight: "100vh",
          background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
          padding: "5rem 0 2rem 0", // Adjusted padding for fixed navbar
        }}
      >
        <Container fluid>
          <Row className="justify-content-center">
            <Col lg={12} xl={10}>
              <Card className="shadow-lg border-0">
                <Card.Body className="p-4">
                  <div className="text-center mb-4">
                    <h1 className="display-4 fw-bold text-primary mb-2">
                      🤖 Botholomew
                    </h1>
                    <p className="lead text-muted">
                      The Greatest Agent Framework
                    </p>
                  </div>

                  <Row className="g-4">
                    <Col md={6}>
                      <Card className="h-100">
                        <Card.Body className="text-center">
                          <h5 className="card-title">Welcome to Botholomew</h5>
                          <p className="card-text">
                            The greatest agent framework for building
                            intelligent applications.
                          </p>
                          <a href="/status" className="btn btn-primary">
                            View Server Status
                          </a>
                        </Card.Body>
                      </Card>
                    </Col>
                    <Col md={6}>
                      <Card className="h-100">
                        <Card.Body className="text-center">
                          <h5 className="card-title">API Documentation</h5>
                          <p className="card-text">
                            Explore the comprehensive API documentation and
                            endpoints.
                          </p>
                          <a
                            href="/swagger"
                            className="btn btn-outline-primary"
                          >
                            View API Docs
                          </a>
                        </Card.Body>
                      </Card>
                    </Col>
                  </Row>
                </Card.Body>
              </Card>
            </Col>
          </Row>
        </Container>
      </div>
    </>
  );
}
