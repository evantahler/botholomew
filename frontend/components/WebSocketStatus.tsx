"use client";

import React, { useState, useEffect, useRef } from "react";
import { Alert, Badge } from "react-bootstrap";
import { getWebSocketUrl } from "../lib/config";

interface WebSocketMessage {
  [key: string]: unknown;
}

interface WebSocketStatusProps {
  onMessage?: (data: WebSocketMessage) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
}

export default function WebSocketStatus({
  onMessage,
  onConnect,
  onDisconnect,
}: WebSocketStatusProps) {
  const [status, setStatus] = useState<
    "connecting" | "connected" | "disconnected" | "error"
  >("connecting");
  const [details, setDetails] = useState("Connecting...");
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const connect = () => {
    const wsUrl = getWebSocketUrl();

    wsRef.current = new WebSocket(wsUrl);

    wsRef.current.onopen = () => {
      setStatus("connected");
      setDetails("Ready to receive messages");
      onConnect?.();
    };

    wsRef.current.onclose = () => {
      setStatus("disconnected");
      setDetails("Connection lost. Attempting to reconnect...");
      onDisconnect?.();

      // Try to reconnect after 5 seconds
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      reconnectTimeoutRef.current = setTimeout(() => connect(), 5000);
    };

    wsRef.current.onerror = (error) => {
      setStatus("error");
      setDetails("Failed to establish connection");
      console.error("WebSocket error:", error);
    };

    wsRef.current.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as WebSocketMessage;
        onMessage?.(data);
      } catch (error) {
        console.error("Failed to parse WebSocket message:", error);
      }
    };
  };

  useEffect(() => {
    connect();

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const getStatusVariant = () => {
    switch (status) {
      case "connected":
        return "success";
      case "connecting":
        return "info";
      case "error":
        return "danger";
      default:
        return "warning";
    }
  };

  const getStatusText = () => {
    switch (status) {
      case "connected":
        return "Connected";
      case "connecting":
        return "Connecting...";
      case "error":
        return "Connection Error";
      default:
        return "Disconnected";
    }
  };

  return (
    <Alert variant={getStatusVariant()} className="mt-3">
      <div className="d-flex justify-content-between align-items-center">
        <div>
          <strong>WebSocket Status:</strong>{" "}
          <Badge bg={status === "connected" ? "success" : "secondary"}>
            {getStatusText()}
          </Badge>
        </div>
      </div>
      <div className="mt-2">
        <small className="text-muted">{details}</small>
      </div>
    </Alert>
  );
}
