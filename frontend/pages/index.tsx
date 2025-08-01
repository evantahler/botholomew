import React, { useRef } from "react";
import Head from "next/head";
import Link from "next/link";
import { Container, Row, Col, Button, Card } from "react-bootstrap";
import ServerStatus from "../components/ServerStatus";
import WebSocketStatus from "../components/WebSocketStatus";
import MessageLog, { MessageLogRef } from "../components/MessageLog";
import { SERVER_HOSTNAME } from "../lib/config";

interface WebSocketMessage {
  [key: string]: unknown;
}

export default function Home() {
  const messageLogRef = useRef<MessageLogRef>(null);

  const handleWebSocketMessage = (data: WebSocketMessage) => {
    messageLogRef.current?.addMessage(JSON.stringify(data, null, 2), "info");
  };

  const handleWebSocketConnect = () => {
    messageLogRef.current?.addMessage(
      "WebSocket connected successfully",
      "success"
    );
  };

  const handleWebSocketDisconnect = () => {
    messageLogRef.current?.addMessage("WebSocket disconnected", "warning");
  };

  return (
    <>
      <Head>
        <title>Botholomew - The Greatest Agent Framework</title>
      </Head>
      <div
        style={{
          minHeight: "100vh",
          background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
          padding: "2rem 0",
        }}
      >
        <Container>
          <Row className="justify-content-center">
            <Col lg={10} xl={8}>
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
                      <ServerStatus />
                    </Col>
                    <Col md={6}>
                      <WebSocketStatus
                        onMessage={handleWebSocketMessage}
                        onConnect={handleWebSocketConnect}
                        onDisconnect={handleWebSocketDisconnect}
                      />
                    </Col>
                  </Row>

                  <div className="mt-4">
                    <div className="d-flex gap-2 mb-3">
                      <Link href="/swagger" passHref>
                        <Button variant="primary">OpenAPI Swagger UI</Button>
                      </Link>
                    </div>
                  </div>

                  <div className="mt-4">
                    <MessageLog ref={messageLogRef} maxMessages={100} />
                  </div>
                </Card.Body>
              </Card>
            </Col>
          </Row>
        </Container>
      </div>
    </>
  );
}
