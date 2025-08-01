"use client";

import React, {
  useState,
  useRef,
  useEffect,
  forwardRef,
  useImperativeHandle,
} from "react";
import { Card, Button, Badge, ListGroup } from "react-bootstrap";

interface Message {
  id: string;
  content: string;
  type: "info" | "error" | "success" | "warning";
  timestamp: Date;
}

interface MessageLogProps {
  maxMessages?: number;
  onMessageAdded?: (message: Message) => void;
  onMessagesCleared?: () => void;
}

export interface MessageLogRef {
  addMessage: (content: string, type?: Message["type"]) => string;
  addErrorMessage: (content: string) => string;
  addSuccessMessage: (content: string) => string;
  addWarningMessage: (content: string) => string;
  clear: () => void;
  removeMessage: (messageId: string) => void;
}

const MessageLog = forwardRef<MessageLogRef, MessageLogProps>(
  ({ maxMessages = 100, onMessageAdded, onMessagesCleared }, ref) => {
    const [messages, setMessages] = useState<Message[]>([]);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    const scrollToBottom = () => {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(() => {
      scrollToBottom();
    }, [messages]);

    const addMessage = (
      content: string,
      type: Message["type"] = "info",
      timestamp = new Date()
    ) => {
      const message: Message = {
        id: Date.now().toString() + Math.random().toString(),
        content,
        type,
        timestamp,
      };

      setMessages(prev => {
        const newMessages = [...prev, message];
        // Limit the number of messages
        if (newMessages.length > maxMessages) {
          return newMessages.slice(-maxMessages);
        }
        return newMessages;
      });

      onMessageAdded?.(message);
      return message.id;
    };

    const addErrorMessage = (content: string) => {
      return addMessage(content, "error");
    };

    const addSuccessMessage = (content: string) => {
      return addMessage(content, "success");
    };

    const addWarningMessage = (content: string) => {
      return addMessage(content, "warning");
    };

    const clear = () => {
      setMessages([]);
      onMessagesCleared?.();
    };

    const removeMessage = (messageId: string) => {
      setMessages(prev => prev.filter(msg => msg.id !== messageId));
    };

    // Expose methods to parent component
    useImperativeHandle(ref, () => ({
      addMessage,
      addErrorMessage,
      addSuccessMessage,
      addWarningMessage,
      clear,
      removeMessage,
    }));

    const getMessageVariant = (type: Message["type"]) => {
      switch (type) {
        case "error":
          return "danger";
        case "success":
          return "success";
        case "warning":
          return "warning";
        default:
          return "info";
      }
    };

    const getMessageIcon = (type: Message["type"]) => {
      switch (type) {
        case "error":
          return "❌";
        case "success":
          return "✅";
        case "warning":
          return "⚠️";
        default:
          return "ℹ️";
      }
    };

    return (
      <Card>
        <Card.Header>
          <div className="d-flex justify-content-between align-items-center">
            <h5 className="mb-0">Message Log</h5>
            <div className="d-flex align-items-center gap-2">
              <Badge bg="secondary">{messages.length} messages</Badge>
              <Button
                variant="outline-secondary"
                size="sm"
                onClick={clear}
                disabled={messages.length === 0}
              >
                Clear Messages
              </Button>
            </div>
          </div>
        </Card.Header>
        <Card.Body className="p-0">
          <div
            style={{
              height: "300px",
              overflowY: "auto",
              backgroundColor: "#f8f9fa",
            }}
          >
            {messages.length === 0 ? (
              <div className="text-center text-muted p-4">No messages yet</div>
            ) : (
              <ListGroup variant="flush">
                {messages.map(message => (
                  <ListGroup.Item
                    key={message.id}
                    className="border-0 border-bottom"
                    style={{
                      borderLeft: `3px solid ${
                        message.type === "error"
                          ? "#dc3545"
                          : message.type === "success"
                            ? "#28a745"
                            : message.type === "warning"
                              ? "#ffc107"
                              : "#17a2b8"
                      } !important`,
                    }}
                  >
                    <div className="d-flex justify-content-between align-items-start">
                      <div className="flex-grow-1">
                        <div className="d-flex align-items-center gap-2 mb-1">
                          <span>{getMessageIcon(message.type)}</span>
                          <Badge
                            bg={getMessageVariant(message.type)}
                            className="fs-6"
                          >
                            {message.type}
                          </Badge>
                          <small className="text-muted">
                            {message.timestamp.toLocaleTimeString()}
                          </small>
                        </div>
                        <div
                          className="font-monospace"
                          style={{
                            whiteSpace: "pre-wrap",
                            fontSize: "0.9rem",
                          }}
                        >
                          {message.content}
                        </div>
                      </div>
                      <Button
                        variant="outline-danger"
                        size="sm"
                        onClick={() => removeMessage(message.id)}
                        className="ms-2"
                      >
                        ×
                      </Button>
                    </div>
                  </ListGroup.Item>
                ))}
              </ListGroup>
            )}
            <div ref={messagesEndRef} />
          </div>
        </Card.Body>
      </Card>
    );
  }
);

MessageLog.displayName = "MessageLog";

export default MessageLog;
