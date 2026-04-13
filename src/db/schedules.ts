import type { DbConnection } from "./connection.ts";

export interface Schedule {
  id: string;
  name: string;
  description: string;
  frequency: string;
  last_run_at: Date | null;
  enabled: boolean;
  created_at: Date;
  updated_at: Date;
}

// Stub — full implementation in a later milestone
export async function listSchedules(_db: DbConnection): Promise<Schedule[]> {
  return [];
}
