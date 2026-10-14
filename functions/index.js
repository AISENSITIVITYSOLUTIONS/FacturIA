import { onRequest } from "firebase-functions/v2/https";
import { initializeApp } from "firebase-admin/app";
import { COMPANY_PROFILE, DEFAULT_INVOICE_SETTINGS } from "./config/company.js";
import { SHEETS } from "./data/sheetSchema.js";
import { appendRow, audit, dashboard, listRows } from "./lib/sheets.js";
import { requireUser } from "./lib/auth.js";
import { acquireStampLock, completeStampLock, releaseStampLock } from "./lib/idempotency.js";
import { cancelInvoice, createDraft, createInvoice, downloadInvoiceFile, facturapiStatus, getInvoice, pdfUrl, sendInvoiceByEmail, xmlUrl } from "./lib/facturapi.js";
import { renderCfdiPdf } from "./lib/cfdiPdf.js";
import { validateCustomer, validateInvoiceDraft, sendError, httpError } from "./lib/validators.js";
import { FACTURAI_ALLOWED_EMAILS, FACTURAPI_SECRET_KEY, GOOGLE_SERVICE_ACCOUNT_JSON, GOOGLE_SHEET_ID } from "./lib/env.js";

initializeApp();

const runtimeSecrets = [
  FACTURAPI_SECRET_KEY,
  GOOGLE_SERVICE_ACCOUNT_JSON,
  GOOGLE_SHEET_ID,
  FACTURAI_ALLOWED_EMAILS
];

function cors(res) {
  // La interfaz se sirve desde el mismo dominio (rewrite /api/**), por eso no se abre CORS a terceros.
  res.set("Access-Control-Allow-Methods", "GET,POST,PUT,OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type,Authorization");
  res.set("Cache-Control", "no-store");
}

/**
 * Registro en Google Sheets despues de timbrar. Si Sheets falla, el CFDI ya
 * existe ante el SAT: se informa como advertencia y nunca como error, para
 * evitar que el usuario vuelva a timbrar la misma venta.
 */
async function safeLog(task) {
  try {
    await task();
    return null;
  } catch (error) {
    console.error("Registro en Sheets fallido", error);
    return "El CFDI se emitio, pero no se pudo registrar en Google Sheets.";
  }
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

/** Guarda al receptor como cliente frecuente si su RFC aun no esta en la hoja. */
async function upsertCustomer(payload) {
  const { customer } = payload;
  if (customer.tax_id === "XAXX010101000" || customer.tax_id === "XEXX010101000") return;
  const existing = await listRows(SHEETS.customers, 1000);
  if (existing.some((row) => String(row.tax_id).toUpperCase() === customer.tax_id)) return;
  await appendRow(SHEETS.customers, {
    id: crypto.randomUUID(),
    created_at: new Date().toISOString(),
    legal_name: customer.legal_name,
    tax_id: customer.tax_id,
    tax_system: customer.tax_system,
    zip: customer.address.zip,
    email: customer.email,
    phone: customer.phone,
    default_use: payload.use,
    notes: ""
  });
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
      version: "2026-10-14.3",
      company: COMPANY_PROFILE.legalName,
      monthlyInvoiceEstimate: COMPANY_PROFILE.monthlyInvoiceEstimate
    });
    return;
  }

  const user = await requireUser(req);

  if (method === "GET" && path === "/session") {
    res.json({ ok: true, data: { user: { email: user.email, name: user.name }, facturapi: await facturapiStatus() } });
    return;
  }

  if (method === "GET" && path === "/invoices") {
    const rows = await listRows(SHEETS.invoices, 500);
    res.json({ ok: true, data: rows.slice(-60).reverse() });
    return;
  }

  const fileMatch = path.match(/^\/invoices\/([^/]+)\/(pdf|xml)$/);
  if (method === "GET" && fileMatch) {
    const [, invoiceId, format] = fileMatch;
    let file;
    if (format === "pdf" && req.query?.original !== "1") {
      // Representacion impresa propia (identidad Z); si falla, se entrega la de Facturapi.
      try {
        const [xmlBuf, info] = await Promise.all([downloadInvoiceFile(invoiceId, "xml"), getInvoice(invoiceId).catch(() => ({}))]);
        file = await renderCfdiPdf(xmlBuf.toString("utf8"), { livemode: info.livemode, verificationUrl: info.verification_url });
      } catch (error) {
        console.error("PDF propio fallido; se usa el de Facturapi", error);
        file = await downloadInvoiceFile(invoiceId, "pdf");
      }
    } else {
      file = await downloadInvoiceFile(invoiceId, format);
    }
    res.set("Content-Type", format === "pdf" ? "application/pdf" : "application/xml");
    res.set("Content-Disposition", `attachment; filename="CFDI-${invoiceId}.${format}"`);
    res.send(file);
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
    await audit("create_customer", "customer", row, user.email);
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
    await audit("create_product", "product", row, user.email);
    res.status(201).json({ ok: true, data: row });
    return;
  }

  if (method === "POST" && path === "/invoices/draft") {
    const payload = validateInvoiceDraft(jsonBody(req));
    const draft = await createDraft(payload);
    const row = rowFromInvoice(payload.external_id, payload, draft, "draft");
    const warning = await safeLog(async () => {
      await appendRow(SHEETS.invoices, row);
      await audit("create_invoice_draft", "invoice", { localId: payload.external_id, facturapiId: draft.id }, user.email);
    });
    res.status(201).json({ ok: true, data: { invoice: draft, row, warnings: warning ? [warning] : [] } });
    return;
  }

  if (method === "POST" && path === "/invoices/stamp") {
    const payload = validateInvoiceDraft(jsonBody(req));
    const externalId = payload.external_id;

    // Candado: si esta captura ya se timbro, se devuelve el mismo CFDI.
    const lock = await acquireStampLock(externalId, user);
    if (lock.existing) {
      res.status(200).json({ ok: true, data: { ...lock.existing, replayed: true, warnings: ["Esta factura ya se habia timbrado; se muestra el mismo CFDI."] } });
      return;
    }

    let invoice;
    try {
      invoice = await createInvoice(payload);
    } catch (error) {
      await releaseStampLock(externalId, error.message);
      throw error;
    }

    const row = rowFromInvoice(externalId, payload, invoice, "stamped");
    const warnings = [];
    let emailed = false;
    if (payload.customer.email) {
      try {
        await sendInvoiceByEmail(invoice.id, payload.customer.email);
        emailed = true;
      } catch (error) {
        console.error("Envio por correo fallido", error);
        warnings.push("El CFDI se emitio, pero el correo al cliente no se envio. Puedes reenviarlo.");
      }
    }

    const result = { invoice, row, emailed };
    try {
      await completeStampLock(externalId, result);
    } catch (error) {
      console.error("No se pudo cerrar el candado de timbrado", error);
    }

    const logWarning = await safeLog(async () => {
      await appendRow(SHEETS.invoices, { ...row, actor: user.email });
      await audit("stamp_invoice", "invoice", { localId: externalId, facturapiId: invoice.id, uuid: invoice.uuid }, user.email);
      await upsertCustomer(payload);
    });
    if (logWarning) warnings.push(logWarning);
    res.status(201).json({ ok: true, data: { ...result, warnings } });
    return;
  }

  const emailMatch = path.match(/^\/invoices\/([^/]+)\/email$/);
  if (method === "POST" && emailMatch) {
    const body = jsonBody(req);
    const email = String(body.email || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw httpError(400, "Correo invalido");
    }
    await sendInvoiceByEmail(emailMatch[1], email);
    res.json({ ok: true, data: { emailed: true } });
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
    await audit("cancel_invoice", "invoice", { facturapiId: invoiceId, motive: body.motive || "02" }, user.email);
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
