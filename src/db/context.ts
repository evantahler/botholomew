import type { DuckDBConnection } from "./connection.ts";

export interface ContextItem {
  id: string;
  title: string;
  description: string;
  content: string | null;
  mime_type: string;
  is_textual: boolean;
  source_path: string | null;
  context_path: string;
  indexed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

// Stub — full implementation in a later milestone
export async function listContextItems(
  _conn: DuckDBConnection,
): Promise<ContextItem[]> {
  return [];
}
