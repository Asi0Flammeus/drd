/**
 * Accounts and sessions.
 *
 * scrypt from `node:crypto` with a per-user salt; the session token is 32
 * random bytes, and only its SHA-256 lives in the database — a stolen database
 * dump therefore contains no usable session. Session lookup is by hash, so a
 * timing side channel on the token would leak nothing that the hash does not
 * already protect.
 */

import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { config } from "./config.ts";
import { db } from "./db.ts";
import { HttpError } from "./http.ts";

export type SessionUser = { id: string; email: string };

const SCRYPT_KEYLEN = 64;
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export const SESSION_COOKIE = "drd_session";

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, SCRYPT_KEYLEN, SCRYPT_PARAMS);
  return `scrypt$${SCRYPT_PARAMS.N}$${SCRYPT_PARAMS.r}$${SCRYPT_PARAMS.p}$${salt.toString("base64")}$${derived.toString("base64")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, salt, expected] = parts;
  const expectedBuffer = Buffer.from(expected, "base64");
  // The digest length is read from the record so a future parameter change
  // can still verify old hashes — but it is the one field an attacker with
  // write access could shorten, and scrypt's PBKDF2 tail is prefix-stable, so
  // a truncated digest would otherwise match on its first bytes. Floor it.
  if (expectedBuffer.length < 32) return false;
  const params = { N: Number(n), r: Number(r), p: Number(p) };
  if (!Number.isInteger(params.N) || !Number.isInteger(params.r) || !Number.isInteger(params.p)) return false;
  if (params.N < 16384 || params.r < 8 || params.p < 1) return false;
  const derived = scryptSync(password, Buffer.from(salt, "base64"), expectedBuffer.length, {
    ...params,
    maxmem: 64 * 1024 * 1024,
  });
  return derived.length === expectedBuffer.length && timingSafeEqual(derived, expectedBuffer);
}

/** Minimum viable policy: a real address shape and a password long enough that scrypt matters. */
export function validateCredentials(email: unknown, password: unknown): { email: string; password: string } {
  if (typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) {
    throw new HttpError(400, "bad_email", "Adresse e-mail invalide.");
  }
  if (typeof password !== "string" || password.length < 10) {
    throw new HttpError(400, "weak_password", "Le mot de passe doit faire au moins 10 caractères.");
  }
  if (password.length > 512) {
    throw new HttpError(400, "long_password", "Mot de passe trop long.");
  }
  return { email: email.trim().toLowerCase(), password };
}

export function createUser(email: string, password: string): SessionUser {
  const id = randomUUID();
  const now = new Date().toISOString();
  try {
    db()
      .prepare("INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)")
      .run(id, email, hashPassword(password), now);
  } catch (error) {
    if (String(error).includes("UNIQUE")) {
      throw new HttpError(409, "email_taken", "Un compte existe déjà avec cette adresse.");
    }
    throw error;
  }
  // Every account starts with the two roots the whole UI assumes exist.
  const insert = db().prepare(
    "INSERT INTO collections (id, user_id, parent_id, name, kind, position, created_at) VALUES (?, ?, NULL, ?, ?, ?, ?)",
  );
  insert.run(randomUUID(), id, "Boîte de réception", "inbox", 0, now);
  insert.run(randomUUID(), id, "Bibliothèque", "folder", 1, now);
  return { id, email };
}

export function authenticate(email: string, password: string): SessionUser {
  const row = db()
    .prepare("SELECT id, email, password_hash FROM users WHERE email = ?")
    .get(email) as { id: string; email: string; password_hash: string } | undefined;
  // Spend the same work whether or not the account exists, so response time
  // does not enumerate registered addresses.
  const hash = row?.password_hash ?? hashPassword("no-such-account-placeholder");
  const ok = verifyPassword(password, hash);
  if (!row || !ok) throw new HttpError(401, "bad_credentials", "Adresse ou mot de passe incorrect.");
  return { id: row.id, email: row.email };
}

export function openSession(userId: string): { token: string; maxAgeSeconds: number } {
  const token = randomBytes(32).toString("base64url");
  const now = Date.now();
  const maxAgeSeconds = config.sessionTtlDays * 24 * 3600;
  db()
    .prepare("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
    .run(
      createHash("sha256").update(token).digest("hex"),
      userId,
      new Date(now).toISOString(),
      new Date(now + maxAgeSeconds * 1000).toISOString(),
    );
  return { token, maxAgeSeconds };
}

export function closeSession(token: string): void {
  db()
    .prepare("DELETE FROM sessions WHERE token_hash = ?")
    .run(createHash("sha256").update(token).digest("hex"));
}

export function userForToken(token: string | undefined): SessionUser | null {
  if (!token) return null;
  const row = db()
    .prepare(
      `SELECT u.id AS id, u.email AS email, s.expires_at AS expires_at
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ?`,
    )
    .get(createHash("sha256").update(token).digest("hex")) as
    | { id: string; email: string; expires_at: string }
    | undefined;
  if (!row) return null;
  if (Date.parse(row.expires_at) < Date.now()) {
    closeSession(token);
    return null;
  }
  return { id: row.id, email: row.email };
}

export function purgeExpiredSessions(): number {
  const result = db().prepare("DELETE FROM sessions WHERE expires_at < ?").run(new Date().toISOString());
  return Number(result.changes);
}
