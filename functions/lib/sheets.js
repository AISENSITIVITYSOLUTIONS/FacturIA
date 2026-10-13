import { google } from "googleapis";
import { GOOGLE_SERVICE_ACCOUNT_JSON, GOOGLE_SHEET_ID, readSecret } from "./env.js";
import { HEADERS, SHEETS } from "../data/sheetSchema.js";

function parseServiceAccount() {
  const raw = readSecret(GOOGLE_SERVICE_ACCOUNT_JSON);
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON no es JSON valido");
  }
}

async function client() {
  const credentials = parseServiceAccount();
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"]
  });
  return google.sheets({ version: "v4", auth });
}

function sheetId() {
  return readSecret(GOOGLE_SHEET_ID);
}

export async function appendRow(tab, row) {
  const sheets = await client();
  const headers = HEADERS[tab] || Object.keys(row);
  const values = headers.map((key) => row[key] ?? "");
  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId(),
    range: `${tab}!A:Z`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [values] }
  });
  return row;
}

export async function listRows(tab, limit = 200) {
  const sheets = await client();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId(),
    range: `${tab}!A1:Z${limit + 1}`
  });
  const [headers = [], ...rows] = response.data.values || [];
  return rows
    .filter((row) => row.length)
    .map((row) => Object.fromEntries(headers.map((key, index) => [key, row[index] || ""])));
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
  const invoices = await listRows(SHEETS.invoices, 500);
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const monthInvoices = invoices.filter((invoice) => String(invoice.created_at || "").startsWith(month));
  const totals = monthInvoices.reduce((acc, invoice) => {
    const total = Number(invoice.total || 0);
    acc.total += Number.isFinite(total) ? total : 0;
    acc.count += 1;
    if (invoice.status === "stamped") acc.stamped += 1;
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
