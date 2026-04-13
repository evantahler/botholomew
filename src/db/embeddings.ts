import type { DbConnection } from "./connection.ts";

export interface Embedding {
  id: string;
  context_item_id: string;
  chunk_index: number;
  chunk_content: string | null;
  title: string;
  description: string;
  source_path: string | null;
  embedding: number[];
  created_at: Date;
}

// Stub — full implementation in a later milestone
export async function searchEmbeddings(
  _db: DbConnection,
  _query: number[],
  _limit?: number,
): Promise<Embedding[]> {
  return [];
}
