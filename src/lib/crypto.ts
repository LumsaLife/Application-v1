/**
 * AES-256-GCM encryption for OAuth refresh tokens.
 *
 * Why this exists: Supabase does not encrypt ordinary Postgres columns at rest.
 * A refresh token grants standing read access to somebody's calendar, so it
 * should not sit in the database as plaintext where a leaked backup or an
 * over-broad service-role query would expose it. We encrypt with a key held
 * only in the environment, so a database dump alone is not enough to read them.
 *
 * Format: base64(iv[12] || authTag[16] || ciphertext)
 *
 * Generate a key with:  openssl rand -base64 32
 */

import crypto from "node:crypto";
import { env } from "./env";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 96 bits, the GCM-recommended nonce size
const AUTH_TAG_LENGTH = 16;

function getKey(): Buffer {
  const raw = env.encryptionKey();
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error(
      `ENCRYPTION_KEY must be 32 bytes base64-encoded (got ${key.length}). ` +
        `Generate one with: openssl rand -base64 32`,
    );
  }
  return key;
}

export function encrypt(plaintext: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString("base64");
}

export function decrypt(payload: string): string {
  const buf = Buffer.from(payload, "base64");
  if (buf.length < IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new Error("Ciphertext is too short to be valid.");
  }
  const iv = buf.subarray(0, IV_LENGTH);
  const authTag = buf.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = buf.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString("utf8");
}
