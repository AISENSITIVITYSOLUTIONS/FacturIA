import { readSecret, FACTURAPI_SECRET_KEY } from "./env.js";
import { httpError } from "./validators.js";

const BASE_URL = "https://www.facturapi.io/v2";

function facturapiErrorMessage(payload) {
  if (!payload || typeof payload === "string") {
    return payload || "Facturapi rechazo la operacion";
  }

  const messages = [
    payload.message,
    ...(Array.isArray(payload.errors) ? payload.errors.map((error) => {
      const path = error.path ? `${error.path}: ` : "";
      return `${path}${error.message}`;
    }) : [])
  ].filter(Boolean);

  return messages.length
    ? messages.join(" | ")
    : "Facturapi rechazo la operacion";
}

async function request(path, options = {}) {
  const secretKey = readSecret(FACTURAPI_SECRET_KEY);
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      "Authorization": `Bearer ${secretKey}`,
      "Accept-Language": "es",
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json")
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    throw httpError(response.status, facturapiErrorMessage(payload), payload);
  }

  return payload;
}

export async function createInvoice(invoicePayload) {
  return request("/invoices", {
    method: "POST",
    body: JSON.stringify(invoicePayload)
  });
}

export async function createDraft(invoicePayload) {
  return request("/invoices", {
    method: "POST",
    body: JSON.stringify({
      ...invoicePayload,
      status: "draft"
    })
  });
}

export async function sendInvoiceByEmail(invoiceId, email) {
  return request(`/invoices/${invoiceId}/email`, {
    method: "POST",
    body: JSON.stringify({ email })
  });
}

export async function cancelInvoice(invoiceId, motive = "02", substitution) {
  return request(`/invoices/${invoiceId}/cancel`, {
    method: "POST",
    body: JSON.stringify({
      motive,
      substitution
    })
  });
}

/**
 * Descarga el PDF o XML de un CFDI. La llave secreta nunca sale del servidor:
 * el navegador recibe el archivo a traves de /api/invoices/:id/pdf|xml.
 */
export async function downloadInvoiceFile(invoiceId, format) {
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(String(invoiceId))) {
    throw httpError(400, "Identificador de factura invalido");
  }
  const secretKey = readSecret(FACTURAPI_SECRET_KEY);
  const response = await fetch(`${BASE_URL}/invoices/${invoiceId}/${format}`, {
    headers: { "Authorization": `Bearer ${secretKey}` }
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    let payload = text;
    try { payload = JSON.parse(text); } catch { /* texto plano */ }
    throw httpError(response.status, facturapiErrorMessage(payload), payload);
  }
  return Buffer.from(await response.arrayBuffer());
}

/**
 * Verifica la llave contra Facturapi sin exponerla. Devuelve el modo
 * (prueba o produccion) para mostrarlo en la interfaz.
 */
export async function facturapiStatus() {
  let secretKey = "";
  try {
    secretKey = readSecret(FACTURAPI_SECRET_KEY);
  } catch {
    return { connected: false, reason: "missing", mode: null };
  }
  const mode = secretKey.startsWith("sk_test_") ? "test" : secretKey.startsWith("sk_live_") ? "live" : "unknown";
  if (mode === "unknown") {
    return { connected: false, reason: "invalid_format", mode };
  }
  try {
    const response = await fetch(`${BASE_URL}/customers?limit=1`, {
      headers: { "Authorization": `Bearer ${secretKey}` }
    });
    if (response.status === 401 || response.status === 403) {
      return { connected: false, reason: "rejected", mode };
    }
    return { connected: response.ok, reason: response.ok ? null : `http_${response.status}`, mode };
  } catch {
    return { connected: false, reason: "network", mode };
  }
}

export function pdfUrl(invoiceId) {
  return `/api/invoices/${invoiceId}/pdf`;
}

export function xmlUrl(invoiceId) {
  return `/api/invoices/${invoiceId}/xml`;
}
