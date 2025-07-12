import { type Message, type NewMessage } from "../models/message";

export function serializeMessage(message: Message) {
  return {
    id: message.id,
    agentId: message.agentId,
    role: message.role,
    content: message.content,
    createdAt: message.createdAt.getTime(),
    updatedAt: message.updatedAt.getTime(),
  };
}
