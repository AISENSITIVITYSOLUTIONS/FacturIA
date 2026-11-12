import { getAuth } from "firebase-admin/auth";
import { FACTURAI_ALLOWED_EMAILS, readSecretOrEmpty } from "./env.js";
import { httpError } from "./validators.js";
import { SHEETS } from "../data/sheetSchema.js";
import { appendRow, audit, findRow, listRows, updateRow } from "./sheets.js";

/**
 * Lista de acceso: correos completos (ventas@zescootersmx.com) o dominios
 * completos con arroba inicial (@zescootersmx.com), separados por comas,
 * espacios o saltos de linea. Se guarda en el secreto FACTURAI_ALLOWED_EMAILS.
 */
function allowList() {
  return readSecretOrEmpty(FACTURAI_ALLOWED_EMAILS)
    .split(/[\s,;]+/)
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

function isAllowed(email, list) {
  const normalized = email.toLowerCase();
  const domain = normalized.slice(normalized.indexOf("@"));
  return list.includes(normalized) || list.includes(domain);
}

/* ------------------------------------------------ Usuarios en Sheets */

// Administradores: el secreto FACTURAI_ALLOWED_EMAILS (correos o @dominios).
// Usuarios: la pestana "Usuarios" de Google Sheets, que los administradores
// gestionan desde la app sin tocar Firebase. Se lee con cache de 60 s.
const USERS_TTL_MS = 60 * 1000;
let usersCache = { at: 0, rows: [] };

const normEmail = (value) => String(value || "").trim().toLowerCase();
const isActive = (row) => String(row.active || "SI").trim().toUpperCase() !== "NO";

async function sheetUsers({ fresh = false } = {}) {
  if (!fresh && Date.now() - usersCache.at < USERS_TTL_MS) return usersCache.rows;
  try {
    const rows = await listRows(SHEETS.users, 2000);
    usersCache = { at: Date.now(), rows };
  } catch (error) {
    console.error("No se pudo leer la pestana Usuarios", error?.message);
    usersCache = { at: Date.now() - USERS_TTL_MS + 10000, rows: usersCache.rows };
  }
  return usersCache.rows;
}

export async function listUsers() {
  const admins = allowList().map((entry) => ({ email: entry, name: "", role: "admin", active: "SI", source: "firebase" }));
  const rows = (await sheetUsers({ fresh: true })).map((r) => ({ ...r, email: normEmail(r.email), source: "sheets" }));
  return [...admins, ...rows.filter((r) => r.email)];
}

export async function saveUser({ email, name, role, active }, actor) {
  const clean = normEmail(email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) throw httpError(400, "Escribe un correo válido.");
  const found = await findRow(SHEETS.users, "email", clean);
  const row = {
    email: clean,
    name: String(name ?? found?.row.name ?? "").trim().slice(0, 80),
    role: (role ?? found?.row.role) === "admin" ? "admin" : "usuario",
    active: active === false || active === "NO" ? "NO" : "SI",
    created_at: found?.row.created_at || new Date().toISOString(),
    created_by: found?.row.created_by || actor.email
  };
  if (found) await updateRow(SHEETS.users, found.rowNumber, row);
  else await appendRow(SHEETS.users, row);
  usersCache.at = 0;
  await audit(found ? "user.update" : "user.create", clean, row, actor.email).catch(() => {});
  return row;
}

/**
 * Verifica el token de Firebase Authentication enviado como
 * "Authorization: Bearer <idToken>" y que el correo este autorizado.
 * Falla cerrado: sin lista configurada, nadie entra.
 */
export async function requireUser(req) {
  const header = String(req.get("Authorization") || "");
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) {
    throw httpError(401, "Inicia sesion con tu cuenta de Google.");
  }

  let decoded;
  try {
    decoded = await getAuth().verifyIdToken(token);
  } catch {
    throw httpError(401, "La sesion expiro. Vuelve a iniciar sesion.");
  }

  const email = String(decoded.email || "");
  if (!email || decoded.email_verified === false) {
    throw httpError(403, "La cuenta no tiene un correo verificado.");
  }

  const list = allowList();
  if (!list.length) {
    throw httpError(503, "Falta configurar el secreto FACTURAI_ALLOWED_EMAILS en Firebase.");
  }
  const base = { uid: decoded.uid, email, name: decoded.name || email };
  if (isAllowed(email, list)) return { ...base, role: "admin" };

  const row = (await sheetUsers()).find((r) => normEmail(r.email) === email.toLowerCase());
  if (row && isActive(row)) return { ...base, role: row.role === "admin" ? "admin" : "usuario" };

  throw httpError(403, `La cuenta ${email} no esta autorizada para facturar. Pide a un administrador que la agregue en Usuarios.`);
}
