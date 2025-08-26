import Head from "next/head";
import { Card, Col, Container, Row } from "react-bootstrap";
import ServerStatus from "../components/ServerStatus";

export default function StatusPage() {
  return (
    <>
      <Head>
        <title>Server Status - Botholomew</title>
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
            <Col lg={10} xl={8}>
              <Card className="shadow-lg border-0">
                <Card.Body className="p-4">
                  <div className="text-center mb-4">
                    <h1 className="display-5 fw-bold text-primary mb-2">
                      📊 Server Status
                    </h1>
                    <p className="lead text-muted">
                      Monitor the health and performance of your Botholomew
                      server
                    </p>
                  </div>

                  <ServerStatus />
                </Card.Body>
              </Card>
            </Col>
          </Row>
        </Container>
      </div>
    </>
  );
}
