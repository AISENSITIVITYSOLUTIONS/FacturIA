import { google } from "googleapis";
import { GOOGLE_SERVICE_ACCOUNT_JSON, GOOGLE_SHEET_ID, readSecret, readSecretOrEmpty } from "./env.js";
import { DEFAULT_PRODUCTS, HEADERS, SHEETS } from "../data/sheetSchema.js";

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];

/**
 * Credenciales: si el secreto GOOGLE_SERVICE_ACCOUNT_JSON contiene una llave
 * valida, se usa. Si no (vacio o un valor de relleno), se usa la cuenta de
 * servicio con la que corre la funcion; basta con compartir la hoja con ella.
 */
function credentials() {
  const raw = readSecretOrEmpty(GOOGLE_SERVICE_ACCOUNT_JSON);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed.client_email && parsed.private_key ? parsed : null;
  } catch {
    return null;
  }
}

let cachedClient = null;
let cachedAuth = null;
async function client() {
  if (cachedClient) return cachedClient;
  const creds = credentials();
  cachedAuth = new google.auth.GoogleAuth(creds ? { credentials: creds, scopes: SCOPES } : { scopes: SCOPES });
  cachedClient = google.sheets({ version: "v4", auth: cachedAuth });
  return cachedClient;
}

/** Correo de la cuenta con la que la funcion entra a la hoja (para diagnostico). */
let cachedEmail = "";
export async function sheetsAccountEmail() {
  if (cachedEmail) return cachedEmail;
  try {
    await client();
    const creds = await cachedAuth.getCredentials();
    cachedEmail = creds.client_email || "";
  } catch {
    cachedEmail = "";
  }
  return cachedEmail;
}

function sheetId() {
  return readSecret(GOOGLE_SHEET_ID);
}

function sheetsError(error) {
  const status = error?.code || error?.response?.status;
  const detail = String(error?.response?.data?.error?.message || error?.message || "");
  const make = (msg) => { const e = new Error(msg); e.status = 503; e.sheets = true; return e; };
  if (/has not been used|is disabled|SERVICE_DISABLED/i.test(detail)) {
    return make("La API de Google Sheets no esta habilitada en el proyecto facturia-zscooters.");
  }
  if (status === 403) {
    return make(`Google Sheets rechazo el acceso. Comparte la hoja como Editor con ${cachedEmail || "la cuenta de servicio de la funcion"}.`);
  }
  if (status === 404) {
    return make("No se encontro la hoja de Google Sheets. Revisa el secreto GOOGLE_SHEET_ID.");
  }
  if (/Missing secret: GOOGLE_SHEET_ID/.test(detail)) {
    return make("Falta el secreto GOOGLE_SHEET_ID.");
  }
  return make(`Google Sheets respondio con un error: ${detail.slice(0, 200)}`);
}

/**
 * Crea las pestanas y encabezados que falten (una vez por instancia), y
 * siembra el catalogo con los conceptos base si la pestana es nueva.
 */
let ensured = null;
async function ensureSheets() {
  if (ensured) return ensured;
  await sheetsAccountEmail();
  ensured = (async () => {
    const sheets = await client();
    const spreadsheetId = sheetId();
    const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets.properties.title" });
    const existing = new Set((meta.data.sheets || []).map((s) => s.properties.title));
    const missing = Object.values(SHEETS).filter((title) => !existing.has(title));

    if (missing.length) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests: missing.map((title) => ({ addSheet: { properties: { title, gridProperties: { frozenRowCount: 1 } } } })) }
      });
    }

    const tabs = Object.values(SHEETS);
    const heads = await sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges: tabs.map((t) => `${t}!1:1`) });
    const updates = [];
    tabs.forEach((tab, i) => {
      const current = heads.data.valueRanges?.[i]?.values?.[0] || [];
      const expected = HEADERS[tab];
      const isPrefix = current.every((h, j) => h === expected[j]);
      if (isPrefix && current.length < expected.length) {
        updates.push({ range: `${tab}!A1`, values: [expected] });
      }
    });
    if (updates.length) {
      await sheets.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: "RAW", data: updates } });
    }

    if (missing.includes(SHEETS.products)) {
      const now = new Date().toISOString();
      const rows = DEFAULT_PRODUCTS.map((p) => HEADERS[SHEETS.products].map((k) =>
        k === "id" ? crypto.randomUUID() : k === "created_at" ? now : (p[k] ?? "")));
      await sheets.spreadsheets.values.append({
        spreadsheetId, range: `${SHEETS.products}!A:Z`, valueInputOption: "RAW", requestBody: { values: rows }
      });
    }
  })().catch((error) => {
    ensured = null;
    throw sheetsError(error);
  });
  return ensured;
}

export async function appendRow(tab, row) {
  await ensureSheets();
  const sheets = await client();
  const headers = HEADERS[tab] || Object.keys(row);
  const values = headers.map((key) => row[key] ?? "");
  try {
    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId(),
      range: `${tab}!A:Z`,
      valueInputOption: "RAW",
      requestBody: { values: [values] }
    });
  } catch (error) {
    throw sheetsError(error);
  }
  return row;
}

export async function listRows(tab, limit = 200) {
  await ensureSheets();
  const sheets = await client();
  let response;
  try {
    response = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId(),
      range: `${tab}!A1:Z`
    });
  } catch (error) {
    throw sheetsError(error);
  }
  const [headers = [], ...rows] = response.data.values || [];
  return rows
    .filter((row) => row.length)
    .slice(-limit)
    .map((row) => Object.fromEntries(headers.map((key, index) => [key, row[index] || ""])));
}

/** Busca la primera fila cuya columna `key` sea `value`. Devuelve { rowNumber, row } o null. */
export async function findRow(tab, key, value) {
  await ensureSheets();
  const sheets = await client();
  let response;
  try {
    response = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId(), range: `${tab}!A1:Z` });
  } catch (error) {
    throw sheetsError(error);
  }
  const [headers = [], ...rows] = response.data.values || [];
  const col = headers.indexOf(key);
  if (col < 0) return null;
  const index = rows.findIndex((r) => r[col] === String(value));
  if (index < 0) return null;
  const row = Object.fromEntries(headers.map((h, i) => [h, rows[index][i] || ""]));
  return { rowNumber: index + 2, row };
}

/** Reescribe una fila completa (rowNumber es 1-based, incluye encabezado). */
export async function updateRow(tab, rowNumber, row) {
  await ensureSheets();
  const sheets = await client();
  const headers = HEADERS[tab];
  try {
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId(),
      range: `${tab}!A${rowNumber}`,
      valueInputOption: "RAW",
      requestBody: { values: [headers.map((k) => row[k] ?? "")] }
    });
  } catch (error) {
    throw sheetsError(error);
  }
  return row;
}

export async function audit(action, resource, payload, actor = "system") {
  return appendRow(SHEETS.audit, {
    id: crypto.randomUUID(),
    created_at: new Date().toISOString(),
    actor,
    action,
    resource,
    payload: JSON.stringify(payload).slice(0, 45000)
  });
}

export async function dashboard() {
  const invoices = await listRows(SHEETS.invoices, 2000);
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const monthInvoices = invoices.filter((invoice) => String(invoice.created_at || "").startsWith(month));
  const totals = monthInvoices.reduce((acc, invoice) => {
    const total = Number(invoice.total || 0);
    if (invoice.status === "stamped") {
      acc.total += Number.isFinite(total) ? total : 0;
      acc.count += 1;
      acc.stamped += 1;
    }
    if (invoice.status === "draft") acc.draft += 1;
    if (invoice.status === "cancelled") acc.cancelled += 1;
    return acc;
  }, { count: 0, total: 0, stamped: 0, draft: 0, cancelled: 0 });

  return {
    month,
    invoiceTarget: 100,
    ...totals,
    remainingCapacity: Math.max(0, 100 - totals.count)
  };
}
