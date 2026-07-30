// Local account support for development. Passwords are salted and hashed; raw
// passwords and session tokens are never put in the database.
import crypto from "node:crypto";
import { db } from "./database.js";

const now = () => new Date().toISOString();
const hashToken = (value: string) => crypto.createHash("sha256").update(value).digest("hex");

function passwordHash(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}
function passwordMatches(password: string, saved: string): boolean {
  const [salt, expected] = saved.split(":");
  const actual = crypto.scryptSync(password, salt, 64).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"));
}

export function register(emailValue: unknown, passwordValue: unknown) {
  const email = String(emailValue || "").trim().toLowerCase();
  const password = String(passwordValue || "");
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error("Enter a valid email address.");
  if (password.length < 10) throw new Error("Use a password with at least 10 characters.");
  try {
    const time = now();
    const result = db.prepare("INSERT INTO users (email, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?)").run(email, passwordHash(password), time, time);
    return { id: Number(result.lastInsertRowid), email };
  } catch { throw new Error("That email address is already registered."); }
}

export function signIn(emailValue: unknown, passwordValue: unknown) {
  const email = String(emailValue || "").trim().toLowerCase();
  const password = String(passwordValue || "");
  const user = db.prepare("SELECT id, email, password_hash FROM users WHERE email=?").get(email) as { id: number; email: string; password_hash: string } | undefined;
  if (!user || !passwordMatches(password, user.password_hash)) throw new Error("Email or password is incorrect.");
  const token = crypto.randomBytes(32).toString("base64url");
  const expiry = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString();
  db.prepare("INSERT INTO sessions (user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?)").run(user.id, hashToken(token), expiry, now());
  return { user: { id: user.id, email: user.email }, token, expiry };
}

export function signedInUser(cookieHeader?: string) {
  const token = cookieHeader?.split(";").map((item) => item.trim()).find((item) => item.startsWith("glassnet_session="))?.split("=")[1];
  if (!token) return undefined;
  return db.prepare("SELECT users.id, users.email FROM sessions JOIN users ON users.id=sessions.user_id WHERE sessions.token_hash=? AND sessions.expires_at>? ").get(hashToken(token), now()) as { id: number; email: string } | undefined;
}

export function signOut(cookieHeader?: string) {
  const token = cookieHeader?.split(";").map((item) => item.trim()).find((item) => item.startsWith("glassnet_session="))?.split("=")[1];
  if (token) db.prepare("DELETE FROM sessions WHERE token_hash=?").run(hashToken(token));
}
