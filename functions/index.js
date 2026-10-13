import { onRequest } from "firebase-functions/v2/https";
import { initializeApp } from "firebase-admin/app";
import { COMPANY_PROFILE, DEFAULT_INVOICE_SETTINGS } from "./config/company.js";
import { SHEETS } from "./data/sheetSchema.js";
import { appendRow, audit, dashboard, listRows } from "./lib/sheets.js";
import { cancelInvoice, createDraft, createInvoice, pdfUrl, sendInvoiceByEmail, xmlUrl } from "./lib/facturapi.js";
import { validateCustomer, validateInvoiceDraft, sendError, httpError } from "./lib/validators.js";
import { FACTURAPI_SECRET_KEY, GOOGLE_SERVICE_ACCOUNT_JSON, GOOGLE_SHEET_ID } from "./lib/env.js";

initializeApp();

const runtimeSecrets = [
  FACTURAPI_SECRET_KEY,
  GOOGLE_SERVICE_ACCOUNT_JSON,
  GOOGLE_SHEET_ID
];

function cors(res) {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "GET,POST,PUT,OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type,Authorization");
}

function route(req) {
  return req.path.replace(/^\/api/, "") || "/";
}

function jsonBody(req) {
  if (!req.body) return {};
  return typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body;
}

function moneyFromItems(items) {
  return items.reduce((acc, item) => {
    const quantity = Number(item.quantity || 1);
    const price = Number(item.product?.price || 0);
    const rate = Number(item.product?.taxes?.[0]?.rate || item.taxes?.[0]?.rate || 0);
    const subtotal = quantity * price;
    acc.subtotal += subtotal;
    acc.tax += subtotal * rate;
    acc.total += subtotal * (1 + rate);
    return acc;
  }, { subtotal: 0, tax: 0, total: 0 });
}

function rowFromInvoice(localId, payload, facturapiInvoice, status) {
  const totals = moneyFromItems(payload.items);
  return {
    id: localId,
    created_at: new Date().toISOString(),
    status,
    customer_tax_id: payload.customer.tax_id,
    customer_name: payload.customer.legal_name,
    facturapi_id: facturapiInvoice?.id || "",
    uuid: facturapiInvoice?.uuid || "",
    series: facturapiInvoice?.series || DEFAULT_INVOICE_SETTINGS.series,
    folio: facturapiInvoice?.folio_number || facturapiInvoice?.folio || "",
    subtotal: totals.subtotal.toFixed(2),
    tax: totals.tax.toFixed(2),
    total: totals.total.toFixed(2),
    payment_form: payload.payment_form,
    payment_method: payload.payment_method,
    cfdi_use: payload.use,
    pdf_url: facturapiInvoice?.id ? pdfUrl(facturapiInvoice.id) : "",
    xml_url: facturapiInvoice?.id ? xmlUrl(facturapiInvoice.id) : "",
    error: ""
  };
}

async function handle(req, res) {
  cors(res);
  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }

  const path = route(req);
  const method = req.method.toUpperCase();

  if (method === "GET" && path === "/health") {
    res.json({
      ok: true,
      service: "FacturIA",
      company: COMPANY_PROFILE.legalName,
      monthlyInvoiceEstimate: COMPANY_PROFILE.monthlyInvoiceEstimate
    });
    return;
  }

  if (method === "GET" && path === "/config") {
    res.json({
      ok: true,
      company: COMPANY_PROFILE,
      invoiceDefaults: DEFAULT_INVOICE_SETTINGS
    });
    return;
  }

  if (method === "GET" && path === "/dashboard") {
    res.json({ ok: true, data: await dashboard() });
    return;
  }

  if (method === "GET" && path === "/customers") {
    res.json({ ok: true, data: await listRows(SHEETS.customers) });
    return;
  }

  if (method === "POST" && path === "/customers") {
    const customer = validateCustomer(jsonBody(req));
    const row = await appendRow(SHEETS.customers, {
      id: crypto.randomUUID(),
      created_at: new Date().toISOString(),
      legal_name: customer.legal_name,
      tax_id: customer.tax_id,
      tax_system: customer.tax_system,
      zip: customer.address.zip,
      email: customer.email,
      phone: customer.phone,
      default_use: "G03",
      notes: ""
    });
    await audit("create_customer", "customer", row);
    res.status(201).json({ ok: true, data: row });
    return;
  }

  if (method === "GET" && path === "/products") {
    res.json({ ok: true, data: await listRows(SHEETS.products) });
    return;
  }

  if (method === "POST" && path === "/products") {
    const body = jsonBody(req);
    const row = await appendRow(SHEETS.products, {
      id: crypto.randomUUID(),
      created_at: new Date().toISOString(),
      sku: body.sku || "",
      description: body.description || "",
      product_key: body.product_key || "",
      unit_key: body.unit_key || "H87",
      unit_name: body.unit_name || "Pieza",
      unit_price: Number(body.unit_price || 0).toFixed(2),
      tax_rate: Number(body.tax_rate ?? 0.16),
      active: body.active ?? "SI"
    });
    await audit("create_product", "product", row);
    res.status(201).json({ ok: true, data: row });
    return;
  }

  if (method === "POST" && path === "/invoices/draft") {
    const payload = validateInvoiceDraft(jsonBody(req));
    const draft = await createDraft(payload);
    const row = rowFromInvoice(payload.external_id, payload, draft, "draft");
    await appendRow(SHEETS.invoices, row);
    await audit("create_invoice_draft", "invoice", { localId: payload.external_id, facturapiId: draft.id });
    res.status(201).json({ ok: true, data: { invoice: draft, row } });
    return;
  }

  if (method === "POST" && path === "/invoices/stamp") {
    const payload = validateInvoiceDraft(jsonBody(req));
    const invoice = await createInvoice(payload);
    const row = rowFromInvoice(payload.external_id, payload, invoice, "stamped");
    await appendRow(SHEETS.invoices, row);
    if (payload.customer.email) {
      await sendInvoiceByEmail(invoice.id, payload.customer.email);
    }
    await audit("stamp_invoice", "invoice", { localId: payload.external_id, facturapiId: invoice.id, uuid: invoice.uuid });
    res.status(201).json({ ok: true, data: { invoice, row } });
    return;
  }

  if (method === "POST" && path.startsWith("/invoices/") && path.endsWith("/cancel")) {
    const invoiceId = path.split("/")[2];
    const body = jsonBody(req);
    const cancelled = await cancelInvoice(invoiceId, body.motive || "02", body.substitution);
    await appendRow(SHEETS.invoices, {
      id: crypto.randomUUID(),
      created_at: new Date().toISOString(),
      status: "cancelled",
      customer_tax_id: "",
      customer_name: "",
      facturapi_id: invoiceId,
      uuid: cancelled.uuid || "",
      series: "",
      folio: "",
      subtotal: "",
      tax: "",
      total: "",
      payment_form: "",
      payment_method: "",
      cfdi_use: "",
      pdf_url: "",
      xml_url: "",
      error: ""
    });
    await audit("cancel_invoice", "invoice", { facturapiId: invoiceId, motive: body.motive || "02" });
    res.json({ ok: true, data: cancelled });
    return;
  }

  throw httpError(404, `Ruta no encontrada: ${method} ${path}`);
}

export const api = onRequest({
  region: "us-central1",
  timeoutSeconds: 60,
  memory: "512MiB",
  secrets: runtimeSecrets
}, async (req, res) => {
  try {
    await handle(req, res);
  } catch (error) {
    sendError(res, error);
  }
});
