import { eq } from "drizzle-orm";
import { api } from "keryx";
import { type User, users } from "../schema/users";
import type { TxHandle } from "./ProjectOps";

/**
 * Hash a plaintext password with `Bun.password` (argon2id by default).
 * @param password - The plaintext password.
 * @returns The password hash to store on the user row.
 */
export async function hashPassword(password: string): Promise<string> {
  return Bun.password.hash(password);
}

/**
 * Verify a plaintext password against a user's stored hash.
 * @param user - The user row holding the hash.
 * @param password - The plaintext password to check.
 * @returns `true` if the password matches.
 */
export async function checkPassword(
  user: User,
  password: string,
): Promise<boolean> {
  return Bun.password.verify(password, user.password_hash);
}

/**
 * Load a user by id. Accepts a transaction handle so audited actions can read
 * inside the transaction they are about to write in — reaching for a second pool
 * connection mid-transaction is both a stale read and, with enough concurrency, a
 * way to deadlock against the pool's own limit.
 * @param id - The user's id.
 * @param db - A Drizzle transaction handle, or the shared `api.db.db` (the default).
 * @returns The user row, or `undefined` if not found.
 */
export async function getUserById(
  id: number,
  db: TxHandle | typeof api.db.db = api.db.db,
): Promise<User | undefined> {
  const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return user;
}

/**
 * Shape a user row into the API-safe object returned by actions: the password
 * hash is dropped and timestamps are emitted as epoch milliseconds.
 * @param user - The user row from the database.
 * @returns The serialized user, including their email.
 */
export function serializeUser(user: User) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    createdAt: user.createdAt.getTime(),
    updatedAt: user.updatedAt.getTime(),
  };
}

/**
 * Shape a user row for surfaces where the viewer is not a project peer: the same
 * as {@link serializeUser} but with the email dropped too. Used wherever a user
 * is named as an actor rather than listed as a teammate.
 * @param user - The user row from the database.
 * @returns The serialized user without their email.
 */
export function serializePublicUser(user: User) {
  return {
    id: user.id,
    name: user.name,
    createdAt: user.createdAt.getTime(),
    updatedAt: user.updatedAt.getTime(),
  };
}
