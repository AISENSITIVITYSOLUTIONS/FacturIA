import { getAuth } from "firebase-admin/auth";
import { FACTURAI_ALLOWED_EMAILS, readSecretOrEmpty } from "./env.js";
import { httpError } from "./validators.js";

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
  if (!isAllowed(email, list)) {
    throw httpError(403, `La cuenta ${email} no esta autorizada para facturar.`);
  }

  return { uid: decoded.uid, email, name: decoded.name || email };
}
