import { readSecret, FACTURAPI_SECRET_KEY } from "./env.js";
import { httpError } from "./validators.js";

const BASE_URL = "https://www.facturapi.io/v2";

async function request(path, options = {}) {
  const secretKey = readSecret(FACTURAPI_SECRET_KEY);
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      "Authorization": `Bearer ${secretKey}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json")
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    throw httpError(response.status, "Facturapi rechazo la operacion", payload);
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

export function pdfUrl(invoiceId) {
  return `${BASE_URL}/invoices/${invoiceId}/pdf`;
}

export function xmlUrl(invoiceId) {
  return `${BASE_URL}/invoices/${invoiceId}/xml`;
}
