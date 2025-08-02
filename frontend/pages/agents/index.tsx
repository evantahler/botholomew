"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/router";
import {
  Container,
  Row,
  Col,
  Card,
  Button,
  Badge,
  Alert,
  Spinner,
  Modal,
} from "react-bootstrap";
import { useAuth } from "../../lib/auth";
import { APIWrapper } from "../../lib/api";
import { formatDate } from "../../lib/utils";
import Navigation from "../../components/Navigation";
import ProtectedRoute from "../../components/ProtectedRoute";
import Pagination from "../../components/Pagination";

export default function AgentsList() {
  const router = useRouter();
  const { user } = useAuth();
  const [agents, setAgents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleteModal, setDeleteModal] = useState<{
    show: boolean;
    agent: any | null;
  }>({ show: false, agent: null });
  const [pagination, setPagination] = useState({
    limit: 20,
    offset: 0,
    total: 0,
    hasMore: true,
  });

  useEffect(() => {
    fetchAgents();
  }, []);

  const fetchAgents = async (newOffset?: number) => {
    try {
      setLoading(true);
      const offset = newOffset !== undefined ? newOffset : pagination.offset;
      const response = await APIWrapper.get(
        "/agents",
        {},
        pagination.limit,
        offset
      );
      setAgents(response.agents || []);
      setPagination(prev => ({
        ...prev,
        offset,
        total: response.total || 0,
        hasMore: (response.agents || []).length === pagination.limit,
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteModal.agent) return;

    try {
      await APIWrapper.delete("/agent", { id: deleteModal.agent.id });
      // Remove the agent from the list
      setAgents(agents.filter(a => a.id !== deleteModal.agent!.id));
      setDeleteModal({ show: false, agent: null });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete agent");
    }
  };

  // Calculate pagination values
  const currentPage = Math.floor(pagination.offset / pagination.limit) + 1;
  const totalPages = Math.ceil(pagination.total / pagination.limit);

  const handlePageChange = (page: number) => {
    const newOffset = (page - 1) * pagination.limit;
    fetchAgents(newOffset);
  };

  if (!user) {
    return <ProtectedRoute children={undefined} />;
  }

  return (
    <>
      <Navigation />
      <Container className="mt-5 pt-4">
        <Row className="mb-4">
          <Col>
            <div className="d-flex justify-content-between align-items-center">
              <h1>My Agents</h1>
              <Button
                variant="primary"
                onClick={() => router.push("/agents/create")}
              >
                Create New Agent
              </Button>
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

        {loading ? (
          <Row>
            <Col className="text-center">
              <Spinner animation="border" role="status">
                <span className="visually-hidden">Loading...</span>
              </Spinner>
            </Col>
          </Row>
        ) : agents.length === 0 ? (
          <Row>
            <Col>
              <Card>
                <Card.Body className="text-center py-5">
                  <h4>No agents found</h4>
                  <p className="text-muted">
                    Create your first agent to get started
                  </p>
                  <Button
                    variant="primary"
                    onClick={() => router.push("/agents/create")}
                  >
                    Create Your First Agent
                  </Button>
                </Card.Body>
              </Card>
            </Col>
          </Row>
        ) : (
          <Row>
            {agents.map(agent => (
              <Col key={agent.id} lg={4} md={6} className="mb-4">
                <Card className="h-100">
                  <Card.Header className="d-flex justify-content-between align-items-center">
                    <h5 className="mb-0">{agent.name}</h5>
                    <Badge
                      bg={agent.enabled ? "success" : "warning"}
                      className="text-white"
                    >
                      {agent.enabled ? "Active" : "Inactive"}
                    </Badge>
                  </Card.Header>
                  <Card.Body>
                    {agent.description && (
                      <p className="text-muted mb-3">{agent.description}</p>
                    )}
                    <div className="mb-3">
                      <strong>Model:</strong> {agent.model}
                    </div>
                    {agent.schedule && (
                      <div className="mb-3">
                        <strong>Schedule:</strong> {agent.schedule}
                      </div>
                    )}
                    <div className="text-muted small">
                      Created: {formatDate(agent.createdAt)}
                    </div>
                  </Card.Body>
                  <Card.Footer>
                    <div className="d-flex gap-2">
                      <Button
                        variant="outline-primary"
                        size="sm"
                        onClick={() => router.push(`/agents/${agent.id}`)}
                      >
                        View
                      </Button>
                      <Button
                        variant="outline-danger"
                        size="sm"
                        onClick={() => setDeleteModal({ show: true, agent })}
                      >
                        Delete
                      </Button>
                    </div>
                  </Card.Footer>
                </Card>
              </Col>
            ))}
          </Row>
        )}

        {/* Pagination Controls */}
        {agents.length > 0 && (
          <Row className="mt-4">
            <Col>
              <Pagination
                currentPage={currentPage}
                totalPages={totalPages}
                totalItems={pagination.total}
                itemsPerPage={pagination.limit}
                currentOffset={pagination.offset}
                onPageChange={handlePageChange}
                showInfo={true}
              />
            </Col>
          </Row>
        )}
      </Container>

      {/* Delete Confirmation Modal */}
      <Modal
        show={deleteModal.show}
        onHide={() => setDeleteModal({ show: false, agent: null })}
        centered
      >
        <Modal.Header closeButton>
          <Modal.Title>Confirm Delete</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          Are you sure you want to delete the agent "{deleteModal.agent?.name}"?
          This action cannot be undone.
        </Modal.Body>
        <Modal.Footer>
          <Button
            variant="secondary"
            onClick={() => setDeleteModal({ show: false, agent: null })}
          >
            Cancel
          </Button>
          <Button variant="danger" onClick={handleDelete}>
            Delete
          </Button>
        </Modal.Footer>
      </Modal>
    </>
  );
}
