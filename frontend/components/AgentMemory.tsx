"use client";

import React, { useEffect, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  Form,
  Modal,
  Spinner,
  Table,
} from "react-bootstrap";
import type {
  AgentMemoryCreate,
  AgentMemoryDelete,
  AgentMemoryEdit,
  AgentMemoryList,
} from "../../backend/actions/agent_memory";
import type { ActionResponse } from "../../backend/api";
import { APIWrapper } from "../lib/api";

type AgentMemoryProps = {
  agentId: number;
};

type Memory = NonNullable<ActionResponse<AgentMemoryList>["memories"]>[number];

export default function AgentMemory({ agentId }: AgentMemoryProps) {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editingMemory, setEditingMemory] = useState<Memory | null>(null);
  const [formData, setFormData] = useState({
    key: "",
    content: "",
    memoryType: "fact" as "fact" | "conversation" | "result" | "context",
    expiresAt: "",
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchMemories();
  }, [agentId]);

  const fetchMemories = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await APIWrapper.get<AgentMemoryList>(
        "/agent/:id/memories",
        { id: agentId },
        100,
        0,
      );
      setMemories(response.memories || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load memories");
    } finally {
      setLoading(false);
    }
  };

  const handleShowModal = (memory?: Memory) => {
    if (memory) {
      setEditingMemory(memory);
      setFormData({
        key: memory.key,
        content: memory.content,
        memoryType: memory.memoryType as
          | "fact"
          | "conversation"
          | "result"
          | "context",
        expiresAt: memory.expiresAt
          ? new Date(memory.expiresAt).toISOString().slice(0, 16)
          : "",
      });
    } else {
      setEditingMemory(null);
      setFormData({
        key: "",
        content: "",
        memoryType: "fact",
        expiresAt: "",
      });
    }
    setShowModal(true);
  };

  const handleCloseModal = () => {
    setShowModal(false);
    setEditingMemory(null);
    setFormData({ key: "", content: "", memoryType: "fact", expiresAt: "" });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);

    try {
      if (editingMemory) {
        // Edit existing memory
        await APIWrapper.post<AgentMemoryEdit>(
          `/agent/${agentId}/memory/${editingMemory.id}`,
          {
            id: agentId,
            memoryId: editingMemory.id,
            ...formData,
            expiresAt: formData.expiresAt ? new Date(formData.expiresAt) : null,
          },
        );
      } else {
        // Create new memory
        await APIWrapper.put<AgentMemoryCreate>(`/agent/${agentId}/memory`, {
          id: agentId,
          ...formData,
          expiresAt: formData.expiresAt ? new Date(formData.expiresAt) : null,
        });
      }
      handleCloseModal();
      fetchMemories();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save memory");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (memoryId: number) => {
    if (!confirm("Are you sure you want to delete this memory?")) return;

    try {
      setError(null);
      await APIWrapper.delete<AgentMemoryDelete>(
        `/agent/${agentId}/memory/${memoryId}`,
        { id: agentId, memoryId },
      );
      fetchMemories();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete memory");
    }
  };

  const getMemoryTypeBadge = (type: string) => {
    const variants: Record<string, string> = {
      fact: "primary",
      conversation: "info",
      result: "success",
      context: "secondary",
    };
    return <Badge bg={variants[type] || "secondary"}>{type}</Badge>;
  };

  return (
    <Card className="mb-4">
      <Card.Header>
        <div className="d-flex justify-content-between align-items-center">
          <h6 className="mb-0">Agent Memory</h6>
          <Button variant="primary" size="sm" onClick={() => handleShowModal()}>
            + Add Memory
          </Button>
        </div>
      </Card.Header>
      <Card.Body className="p-3">
        {error && (
          <Alert variant="danger" dismissible onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        {loading ? (
          <div className="text-center py-3">
            <Spinner animation="border" size="sm" role="status">
              <span className="visually-hidden">Loading...</span>
            </Spinner>
          </div>
        ) : memories.length === 0 ? (
          <Alert variant="info" className="mb-0">
            No memories yet. Add memories to give your agent context across
            runs.
          </Alert>
        ) : (
          <Table responsive hover size="sm" className="mb-0">
            <thead>
              <tr>
                <th style={{ width: "20%" }}>Key</th>
                <th style={{ width: "40%" }}>Content</th>
                <th style={{ width: "15%" }}>Type</th>
                <th style={{ width: "15%" }}>Created</th>
                <th style={{ width: "10%" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {memories.map((memory) => (
                <tr key={memory.id}>
                  <td className="text-truncate">
                    <code className="small">{memory.key}</code>
                  </td>
                  <td>
                    <div
                      className="small text-truncate"
                      title={memory.content}
                      style={{ maxWidth: "300px" }}
                    >
                      {memory.content}
                    </div>
                  </td>
                  <td>{getMemoryTypeBadge(memory.memoryType)}</td>
                  <td className="small text-muted">
                    {new Date(memory.createdAt).toLocaleDateString()}
                  </td>
                  <td>
                    <div className="d-flex gap-1">
                      <Button
                        variant="outline-primary"
                        size="sm"
                        onClick={() => handleShowModal(memory)}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="outline-danger"
                        size="sm"
                        onClick={() => handleDelete(memory.id)}
                      >
                        Delete
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card.Body>

      <Modal show={showModal} onHide={handleCloseModal} size="lg">
        <Modal.Header closeButton>
          <Modal.Title>
            {editingMemory ? "Edit Memory" : "Add Memory"}
          </Modal.Title>
        </Modal.Header>
        <Form onSubmit={handleSubmit}>
          <Modal.Body>
            <Form.Group className="mb-3">
              <Form.Label>Key *</Form.Label>
              <Form.Control
                type="text"
                placeholder="e.g., user_preference, last_result"
                value={formData.key}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, key: e.target.value }))
                }
                required
              />
              <Form.Text className="text-muted">
                A unique identifier for this memory
              </Form.Text>
            </Form.Group>

            <Form.Group className="mb-3">
              <Form.Label>Content *</Form.Label>
              <Form.Control
                as="textarea"
                rows={4}
                placeholder="Enter the memory content"
                value={formData.content}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, content: e.target.value }))
                }
                required
              />
            </Form.Group>

            <Form.Group className="mb-3">
              <Form.Label>Memory Type</Form.Label>
              <Form.Select
                value={formData.memoryType}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    memoryType: e.target.value as
                      | "fact"
                      | "conversation"
                      | "result"
                      | "context",
                  }))
                }
              >
                <option value="fact">Fact</option>
                <option value="conversation">Conversation</option>
                <option value="result">Result</option>
                <option value="context">Context</option>
              </Form.Select>
            </Form.Group>

            <Form.Group className="mb-3">
              <Form.Label>Expires At (Optional)</Form.Label>
              <Form.Control
                type="datetime-local"
                value={formData.expiresAt}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    expiresAt: e.target.value,
                  }))
                }
              />
              <Form.Text className="text-muted">
                Leave blank for permanent memories
              </Form.Text>
            </Form.Group>
          </Modal.Body>
          <Modal.Footer>
            <Button
              variant="secondary"
              onClick={handleCloseModal}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={saving}>
              {saving
                ? "Saving..."
                : editingMemory
                  ? "Update Memory"
                  : "Create Memory"}
            </Button>
          </Modal.Footer>
        </Form>
      </Modal>
    </Card>
  );
}
