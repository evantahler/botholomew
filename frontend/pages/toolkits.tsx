"use client";

import React, { useState, useEffect } from "react";
import {
  Container,
  Row,
  Col,
  Card,
  Button,
  Alert,
  Spinner,
  Badge,
  Table,
  Form,
} from "react-bootstrap";
import { useAuth } from "../lib/auth";
import { APIWrapper } from "../lib/api";
import Navigation from "../components/Navigation";
import ProtectedRoute from "../components/ProtectedRoute";

interface Toolkit {
  name: string;
  description: string;
  tools: string[];
}

interface ToolkitAuthorization {
  id: number;
  toolkitName: string;
  userId: number;
  createdAt: number;
  updatedAt: number;
}

export default function Toolkits() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [availableToolkits, setAvailableToolkits] = useState<Toolkit[]>([]);
  const [userAuthorizations, setUserAuthorizations] = useState<
    ToolkitAuthorization[]
  >([]);
  const [processingToolkit, setProcessingToolkit] = useState<string | null>(
    null
  );
  const [searchTerm, setSearchTerm] = useState("");

  useEffect(() => {
    if (user) {
      fetchData();
    }
  }, [user]);

  const fetchData = async () => {
    try {
      setLoading(true);
      setError(null);

      // Fetch both available toolkits and user's current authorizations
      const [toolkitsResponse, authorizationsResponse] = await Promise.all([
        APIWrapper.get("/arcade/toolkits"),
        APIWrapper.get("/toolkit-authorizations"),
      ]);

      setAvailableToolkits(toolkitsResponse.toolkits || []);
      setUserAuthorizations(authorizationsResponse.toolkitAuthorizations || []);
    } catch (err) {
      console.error("Failed to load toolkits data:", err);
      setError(
        err instanceof Error
          ? err.message
          : "An error occurred while loading toolkits"
      );
    } finally {
      setLoading(false);
    }
  };

  const isToolkitAuthorized = (toolkitName: string): boolean => {
    return userAuthorizations.some(auth => auth.toolkitName === toolkitName);
  };

  const getSortedToolkits = (): Toolkit[] => {
    return [...availableToolkits].sort((a, b) => {
      const aAuthorized = isToolkitAuthorized(a.name);
      const bAuthorized = isToolkitAuthorized(b.name);

      // Authorized toolkits come first
      if (aAuthorized && !bAuthorized) return -1;
      if (!aAuthorized && bAuthorized) return 1;

      // If both have same authorization status, sort alphabetically by name
      return a.name.localeCompare(b.name);
    });
  };

  const getFilteredAndSortedToolkits = (): Toolkit[] => {
    const sortedToolkits = getSortedToolkits();

    if (!searchTerm.trim()) {
      return sortedToolkits;
    }

    const searchLower = searchTerm.toLowerCase();
    return sortedToolkits.filter(toolkit => {
      // Search in toolkit name
      if (toolkit.name.toLowerCase().includes(searchLower)) {
        return true;
      }

      // Search in toolkit description
      if (
        toolkit.description &&
        toolkit.description.toLowerCase().includes(searchLower)
      ) {
        return true;
      }

      // Search in toolkit tools
      if (
        toolkit.tools &&
        toolkit.tools.some(tool => tool.toLowerCase().includes(searchLower))
      ) {
        return true;
      }

      return false;
    });
  };

  const handleAuthorizeToolkit = async (toolkitName: string) => {
    try {
      setProcessingToolkit(toolkitName);
      setError(null);

      const response = await APIWrapper.put("/toolkit-authorizations", {
        toolkitName,
      });

      // Add the new authorization to the list
      setUserAuthorizations(prev => [...prev, response.toolkitAuthorization]);
    } catch (err) {
      console.error("Failed to authorize toolkit:", err);
      setError(
        err instanceof Error ? err.message : "Failed to authorize toolkit"
      );
    } finally {
      setProcessingToolkit(null);
    }
  };

  const handleDeauthorizeToolkit = async (toolkitName: string) => {
    try {
      setProcessingToolkit(toolkitName);
      setError(null);

      await APIWrapper.delete("/toolkit-authorizations", {
        toolkitName,
      });

      // Remove the authorization from the list
      setUserAuthorizations(prev =>
        prev.filter(auth => auth.toolkitName !== toolkitName)
      );
    } catch (err) {
      console.error("Failed to deauthorize toolkit:", err);
      setError(
        err instanceof Error ? err.message : "Failed to deauthorize toolkit"
      );
    } finally {
      setProcessingToolkit(null);
    }
  };

  if (!user) {
    return <ProtectedRoute children={undefined} />;
  }

  return (
    <>
      <Navigation />
      <Container fluid className="mt-5 pt-4">
        <Row>
          <Col>
            <div className="d-flex justify-content-between align-items-center mb-4">
              <h1>Toolkit Management</h1>
              <Button
                variant="outline-primary"
                size="sm"
                onClick={fetchData}
                disabled={loading}
              >
                ↻ Refresh
              </Button>
            </div>

            {error && (
              <Alert
                variant="danger"
                dismissible
                onClose={() => setError(null)}
              >
                {error}
              </Alert>
            )}

            {loading ? (
              <div className="text-center py-5">
                <Spinner animation="border" role="status">
                  <span className="visually-hidden">Loading...</span>
                </Spinner>
                <div className="mt-2">Loading toolkits...</div>
              </div>
            ) : (
              <Card>
                <Card.Header>
                  <h5 className="mb-0">Available Toolkits</h5>
                  <small className="text-muted">
                    Manage which toolkits you have access to for your agents
                  </small>
                </Card.Header>
                <Card.Body className="p-0">
                  <div className="p-3 border-bottom">
                    <div className="d-flex justify-content-between align-items-center mb-2">
                      <Form.Control
                        type="text"
                        placeholder="Search toolkits by name, description, or tools..."
                        value={searchTerm}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                          setSearchTerm(e.target.value)
                        }
                        className="w-100 me-3"
                        style={{ maxWidth: "400px" }}
                      />
                      <div className="small text-muted">
                        {searchTerm.trim() ? (
                          <>
                            {getFilteredAndSortedToolkits().length} of{" "}
                            {availableToolkits.length} toolkits
                          </>
                        ) : (
                          `${availableToolkits.length} total toolkits`
                        )}
                      </div>
                    </div>
                  </div>
                  <Table responsive hover className="mb-0">
                    <thead className="table-light">
                      <tr>
                        <th style={{ width: "200px" }}>Toolkit</th>
                        <th>Description</th>
                        <th style={{ width: "200px" }}>Tools</th>
                        <th style={{ width: "150px" }}>Status</th>
                        <th style={{ width: "150px" }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {getFilteredAndSortedToolkits().map(toolkit => {
                        const isAuthorized = isToolkitAuthorized(toolkit.name);
                        const isProcessing = processingToolkit === toolkit.name;

                        return (
                          <tr key={toolkit.name}>
                            <td>
                              <div className="fw-medium">{toolkit.name}</div>
                            </td>
                            <td>
                              <div className="text-muted">
                                {toolkit.description ||
                                  "No description available"}
                              </div>
                            </td>
                            <td>
                              <div className="d-flex flex-wrap gap-1">
                                {toolkit.tools.slice(0, 3).map(tool => (
                                  <Badge
                                    key={tool}
                                    bg="secondary"
                                    className="small"
                                  >
                                    {tool}
                                  </Badge>
                                ))}
                                {toolkit.tools.length > 3 && (
                                  <Badge
                                    bg="light"
                                    text="dark"
                                    className="small"
                                  >
                                    +{toolkit.tools.length - 3} more
                                  </Badge>
                                )}
                              </div>
                            </td>
                            <td>
                              {isAuthorized ? (
                                <Badge bg="success">Authorized</Badge>
                              ) : (
                                <Badge bg="secondary">Not Authorized</Badge>
                              )}
                            </td>
                            <td>
                              {isAuthorized ? (
                                <Button
                                  variant="outline-danger"
                                  size="sm"
                                  onClick={() =>
                                    handleDeauthorizeToolkit(toolkit.name)
                                  }
                                  disabled={isProcessing}
                                >
                                  {isProcessing ? (
                                    <Spinner animation="border" size="sm" />
                                  ) : (
                                    "Deauthorize"
                                  )}
                                </Button>
                              ) : (
                                <Button
                                  variant="outline-success"
                                  size="sm"
                                  onClick={() =>
                                    handleAuthorizeToolkit(toolkit.name)
                                  }
                                  disabled={isProcessing}
                                >
                                  {isProcessing ? (
                                    <Spinner animation="border" size="sm" />
                                  ) : (
                                    "Authorize"
                                  )}
                                </Button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </Table>
                </Card.Body>
              </Card>
            )}

            {!loading && availableToolkits.length === 0 && (
              <Alert variant="info">
                ℹ️ No toolkits are currently available. Please check back later.
              </Alert>
            )}

            {!loading &&
              availableToolkits.length > 0 &&
              getFilteredAndSortedToolkits().length === 0 && (
                <Alert variant="info">
                  🔍 No toolkits match your search "{searchTerm}". Try adjusting
                  your search terms.
                </Alert>
              )}
          </Col>
        </Row>
      </Container>
    </>
  );
}
