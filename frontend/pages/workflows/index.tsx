"use client";

import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  Col,
  Container,
  Modal,
  Row,
  Spinner,
} from "react-bootstrap";
import type {
  WorkflowDelete,
  WorkflowList,
} from "../../../backend/actions/workflow";
import Navigation from "../../components/Navigation";
import Pagination from "../../components/Pagination";
import ProtectedRoute from "../../components/ProtectedRoute";
import { APIWrapper } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { formatDate } from "../../lib/utils";

export default function WorkflowsList() {
  const router = useRouter();
  const { user } = useAuth();
  const [workflows, setWorkflows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleteModal, setDeleteModal] = useState<{
    show: boolean;
    workflow: any | null;
  }>({ show: false, workflow: null });
  const [pagination, setPagination] = useState({
    limit: 20,
    offset: 0,
    total: 0,
    hasMore: true,
  });

  useEffect(() => {
    fetchWorkflows();
  }, []);

  const fetchWorkflows = async (newOffset?: number) => {
    try {
      setLoading(true);
      const offset = newOffset !== undefined ? newOffset : pagination.offset;
      const response = await APIWrapper.get<WorkflowList>(
        "/workflows",
        {},
        pagination.limit,
        offset,
      );
      setWorkflows(response.workflows || []);
      setPagination((prev) => ({
        ...prev,
        offset,
        total: response.total || 0,
        hasMore: (response.workflows || []).length === pagination.limit,
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteModal.workflow) return;

    try {
      await APIWrapper.delete<WorkflowDelete>(
        `/workflow/${deleteModal.workflow.id}`,
        {
          id: deleteModal.workflow.id,
        },
      );
      // Remove the workflow from the list
      setWorkflows(workflows.filter((w) => w.id !== deleteModal.workflow!.id));
      setDeleteModal({ show: false, workflow: null });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to delete workflow",
      );
    }
  };

  // Calculate pagination values
  const currentPage = Math.floor(pagination.offset / pagination.limit) + 1;
  const totalPages = Math.ceil(pagination.total / pagination.limit);

  const handlePageChange = (page: number) => {
    const newOffset = (page - 1) * pagination.limit;
    fetchWorkflows(newOffset);
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
            <h1>Workflows</h1>
            <p className="text-muted">
              Create and manage your automated workflow processes
            </p>
          </Col>
          <Col xs="auto">
            <Button
              variant="primary"
              onClick={() => router.push("/workflows/create")}
            >
              Create Workflow
            </Button>
          </Col>
        </Row>

        {error && (
          <Alert variant="danger" onClose={() => setError(null)} dismissible>
            {error}
          </Alert>
        )}

        {loading ? (
          <div className="text-center py-5">
            <Spinner animation="border" role="status">
              <span className="visually-hidden">Loading...</span>
            </Spinner>
          </div>
        ) : workflows.length === 0 ? (
          <Card>
            <Card.Body className="text-center py-5">
              <h4>No workflows yet</h4>
              <p className="text-muted">
                Create your first workflow to get started with automation
              </p>
              <Button
                variant="primary"
                onClick={() => router.push("/workflows/create")}
              >
                Create Your First Workflow
              </Button>
            </Card.Body>
          </Card>
        ) : (
          <>
            <Row>
              {workflows.map((workflow) => (
                <Col key={workflow.id} lg={6} xl={4} className="mb-4">
                  <Card className="h-100">
                    <Card.Body>
                      <div className="d-flex justify-content-between align-items-start mb-2">
                        <h5 className="card-title mb-0">{workflow.name}</h5>
                        <Badge
                          bg={workflow.enabled ? "success" : "secondary"}
                          className="ms-2"
                        >
                          {workflow.enabled ? "Enabled" : "Disabled"}
                        </Badge>
                      </div>
                      {workflow.description && (
                        <p className="card-text text-muted mb-3">
                          {workflow.description}
                        </p>
                      )}
                      <div className="text-muted small mb-3">
                        Created: {formatDate(workflow.createdAt)}
                      </div>
                      <div className="d-flex gap-2">
                        <Button
                          variant="outline-primary"
                          size="sm"
                          onClick={() =>
                            router.push(`/workflows/edit/${workflow.id}`)
                          }
                        >
                          Edit
                        </Button>
                        <Button
                          variant="outline-secondary"
                          size="sm"
                          onClick={() =>
                            router.push(`/workflows/${workflow.id}`)
                          }
                        >
                          View
                        </Button>
                        <Button
                          variant="outline-danger"
                          size="sm"
                          onClick={() =>
                            setDeleteModal({ show: true, workflow })
                          }
                        >
                          Delete
                        </Button>
                      </div>
                    </Card.Body>
                  </Card>
                </Col>
              ))}
            </Row>

            {totalPages > 1 && (
              <Pagination
                currentPage={currentPage}
                totalPages={totalPages}
                onPageChange={handlePageChange}
                totalItems={pagination.total}
                itemsPerPage={pagination.limit}
                currentOffset={pagination.offset}
              />
            )}
          </>
        )}
      </Container>

      {/* Delete Confirmation Modal */}
      <Modal
        show={deleteModal.show}
        onHide={() => setDeleteModal({ show: false, workflow: null })}
        centered
      >
        <Modal.Header closeButton>
          <Modal.Title>Delete Workflow</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          Are you sure you want to delete "{deleteModal.workflow?.name}"? This
          action cannot be undone and will also delete all associated workflow
          steps and runs.
        </Modal.Body>
        <Modal.Footer>
          <Button
            variant="secondary"
            onClick={() => setDeleteModal({ show: false, workflow: null })}
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
