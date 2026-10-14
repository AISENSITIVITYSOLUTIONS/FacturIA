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

/* ------------------------------------------------- Presentacion de la hoja */

const hex = (h) => {
  const n = parseInt(h.slice(1), 16);
  return { red: ((n >> 16) & 255) / 255, green: ((n >> 8) & 255) / 255, blue: (n & 255) / 255 };
};
const TAB_COLORS = {
  Facturas: "#0E2147", Clientes: "#2459C9", Conceptos: "#2459C9", Pagos: "#173E7E",
  Timbrados: "#7FA3D9", Auditoria: "#8A94A6", Configuracion: "#8A94A6"
};
const MONEY_COLS = new Set(["subtotal", "tax", "total", "unit_price", "amount"]);
const WIDE_COLS = { legal_name: 260, customer_name: 260, description: 300, payload: 420, result: 320, error: 260, notes: 220, email: 220 };
const ID_COLS = new Set(["id", "external_id", "facturapi_id", "uuid", "invoice_id", "facturapi_payment_id"]);

function styleRequests({ title, sheetId }) {
  const headers = HEADERS[title] || [];
  const n = headers.length;
  const reqs = [
    {
      repeatCell: {
        range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: n },
        cell: {
          userEnteredFormat: {
            backgroundColor: hex("#0E2147"),
            horizontalAlignment: "LEFT",
            verticalAlignment: "MIDDLE",
            padding: { left: 8, right: 8 },
            textFormat: { foregroundColor: hex("#FFFFFF"), bold: true, fontSize: 10, fontFamily: "Inter" }
          }
        },
        fields: "userEnteredFormat(backgroundColor,horizontalAlignment,verticalAlignment,padding,textFormat)"
      }
    },
    {
      repeatCell: {
        range: { sheetId, startRowIndex: 1, startColumnIndex: 0, endColumnIndex: n },
        cell: { userEnteredFormat: { verticalAlignment: "MIDDLE", textFormat: { fontSize: 10, fontFamily: "Inter", foregroundColor: hex("#24303F") } } },
        fields: "userEnteredFormat(verticalAlignment,textFormat)"
      }
    },
    { updateDimensionProperties: { range: { sheetId, dimension: "ROWS", startIndex: 0, endIndex: 1 }, properties: { pixelSize: 36 }, fields: "pixelSize" } },
    { updateDimensionProperties: { range: { sheetId, dimension: "ROWS", startIndex: 1, endIndex: 1000 }, properties: { pixelSize: 28 }, fields: "pixelSize" } },
    {
      addBanding: {
        bandedRange: {
          range: { sheetId, startRowIndex: 0, startColumnIndex: 0, endColumnIndex: n },
          rowProperties: { headerColor: hex("#0E2147"), firstBandColor: hex("#FFFFFF"), secondBandColor: hex("#F4F7FB") }
        }
      }
    }
  ];
  headers.forEach((key, i) => {
    const width = WIDE_COLS[key] || (ID_COLS.has(key) ? 200 : MONEY_COLS.has(key) ? 120 : 140);
    reqs.push({ updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: i, endIndex: i + 1 }, properties: { pixelSize: width }, fields: "pixelSize" } });
    if (MONEY_COLS.has(key)) {
      reqs.push({
        repeatCell: {
          range: { sheetId, startRowIndex: 1, startColumnIndex: i, endColumnIndex: i + 1 },
          cell: { userEnteredFormat: { numberFormat: { type: "CURRENCY", pattern: "\"$\"#,##0.00" }, horizontalAlignment: "RIGHT" } },
          fields: "userEnteredFormat(numberFormat,horizontalAlignment)"
        }
      });
    }
    if (ID_COLS.has(key)) {
      reqs.push({
        repeatCell: {
          range: { sheetId, startRowIndex: 1, startColumnIndex: i, endColumnIndex: i + 1 },
          cell: { userEnteredFormat: { textFormat: { fontFamily: "Roboto Mono", fontSize: 9, foregroundColor: hex("#5B6679") } } },
          fields: "userEnteredFormat.textFormat"
        }
      });
    }
  });
  if (title === SHEETS.invoices) {
    const statusCol = headers.indexOf("status");
    const rule = (text, bg, fg) => ({
      addConditionalFormatRule: {
        index: 0,
        rule: {
          ranges: [{ sheetId, startRowIndex: 1, startColumnIndex: statusCol, endColumnIndex: statusCol + 1 }],
          booleanRule: { condition: { type: "TEXT_EQ", values: [{ userEnteredValue: text }] }, format: { backgroundColor: hex(bg), textFormat: { foregroundColor: hex(fg), bold: true } } }
        }
      }
    });
    reqs.push(rule("stamped", "#E6F4EC", "#1D6B44"), rule("draft", "#E6EBF2", "#3E4A5C"), rule("cancelled", "#FCE9E7", "#B42318"));
  }
  return reqs;
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
      const created = await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests: missing.map((title) => ({ addSheet: { properties: { title, gridProperties: { frozenRowCount: 1 }, tabColor: hex(TAB_COLORS[title] || "#2459C9") } } })) }
      });
      const ids = (created.data.replies || []).map((r, i) => ({ title: missing[i], sheetId: r.addSheet.properties.sheetId }));
      await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: ids.flatMap(styleRequests) } })
        .catch((error) => console.error("No se pudo aplicar formato a Sheets", error));
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
  // Montos como numero para que el formato de moneda de la hoja aplique.
  const values = headers.map((key) => {
    const v = row[key] ?? "";
    return MONEY_COLS.has(key) && v !== "" && Number.isFinite(Number(v)) ? Number(v) : v;
  });
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
