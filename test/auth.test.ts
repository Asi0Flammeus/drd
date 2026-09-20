/**
 * Password storage. One plausible bug here — a verifier that accepts on a
 * parse failure, a comparison that is not constant time, a format change that
 * silently invalidates every stored hash — locks every user out or lets every
 * user in.
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { hashPassword, verifyPassword } from "../server/auth.ts";

test("a password verifies against its own hash and nothing else", () => {
  const stored = hashPassword("correct horse battery staple");
  assert.equal(verifyPassword("correct horse battery staple", stored), true);
  assert.equal(verifyPassword("correct horse battery stapl", stored), false);
  assert.equal(verifyPassword("", stored), false);
});

test("the same password hashes differently every time", () => {
  const a = hashPassword("le même mot de passe");
  const b = hashPassword("le même mot de passe");
  assert.notEqual(a, b, "a per-user salt must make identical passwords store differently");
  assert.equal(verifyPassword("le même mot de passe", a), true);
  assert.equal(verifyPassword("le même mot de passe", b), true);
});

test("a malformed or truncated stored hash never verifies", () => {
  const stored = hashPassword("motdepasse-solide");
  const [scheme, n, r, p, salt, digest] = stored.split("$");
  assert.equal(scheme, "scrypt");
  assert.equal(verifyPassword("motdepasse-solide", ""), false);
  assert.equal(verifyPassword("motdepasse-solide", "plaintext"), false);
  assert.equal(verifyPassword("motdepasse-solide", `bcrypt$${n}$${r}$${p}$${salt}$${digest}`), false);
  assert.equal(verifyPassword("motdepasse-solide", `scrypt$${n}$${r}$${p}$${salt}`), false);
  assert.equal(verifyPassword("motdepasse-solide", `scrypt$${n}$${r}$${p}$${salt}$${digest.slice(0, 20)}`), false);
});
