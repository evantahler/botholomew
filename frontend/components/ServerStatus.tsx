"use client";

import { useEffect, useState } from "react";
import { Alert, Badge, Button, Card } from "react-bootstrap";
import type { Status } from "../../backend/actions/status";
import type { ActionResponse } from "../../backend/api";
import { APIWrapper } from "../lib/api";

type ServerStatusData = ActionResponse<Status>;

export default function ServerStatus() {
  const [status, setStatus] = useState<"loading" | "success" | "error">(
    "loading",
  );
  const [statusData, setStatusData] = useState<ServerStatusData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadStatus = async () => {
    try {
      setStatus("loading");
      setError(null);

      const data = await APIWrapper.get<Status>("/api/status");
      setStatusData(data);
      setStatus("success");
    } catch (error) {
      console.error("Error loading server status:", error);
      setError(error instanceof Error ? error.message : "Unknown error");
      setStatus("error");
    }
  };

  useEffect(() => {
    loadStatus();
    const interval = setInterval(loadStatus, 5 * 1000);
    return () => clearInterval(interval);
  }, []);

  const formatUptime = (ms: number) => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) {
      return `${days}d ${hours % 24}h ${minutes % 60}m`;
    } else if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  };

  const getStatusVariant = () => {
    switch (status) {
      case "success":
        return "success";
      case "error":
        return "danger";
      default:
        return "info";
    }
  };

  const getStatusMessage = () => {
    switch (status) {
      case "success":
        return "✅ Server is running successfully";
      case "error":
        return "❌ Failed to load server status";
      default:
        return "Loading server status...";
    }
  };

  return (
    <Card className="mb-3">
      <Card.Body>
        <div className="d-flex justify-content-between align-items-center mb-2">
          <h5 className="mb-0">Server Status</h5>
          <Button
            type="button"
            variant="outline-secondary"
            size="sm"
            onClick={loadStatus}
            disabled={status === "loading"}
          >
            Refresh
          </Button>
        </div>

        <Alert variant={getStatusVariant()}>{getStatusMessage()}</Alert>

        {status === "success" && statusData && (
          <div className="mt-3">
            <h6>Status Details:</h6>
            <div className="table-responsive">
              <table className="table table-striped table-hover">
                <thead className="table-light">
                  <tr>
                    <th>Property</th>
                    <th>Value</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(statusData).map(([key, value]) => {
                    const label =
                      key.charAt(0).toUpperCase() +
                      key.slice(1).replace(/([A-Z])/g, " $1");
                    let displayValue = value;

                    if (key === "uptime") {
                      displayValue = formatUptime(value as number);
                    } else if (key === "consumedMemoryMB") {
                      displayValue = `${value} MB`;
                    }

                    return (
                      <tr key={key}>
                        <td className="fw-semibold text-muted">{label}</td>
                        <td>
                          <Badge bg="light" text="dark">
                            {displayValue}
                          </Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {status === "error" && error && (
          <div className="mt-2">
            <small className="text-muted">Error: {error}</small>
          </div>
        )}
      </Card.Body>
    </Card>
  );
}
