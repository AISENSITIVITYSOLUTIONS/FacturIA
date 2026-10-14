import { SHEETS } from "../data/sheetSchema.js";
import { appendRow, findRow, updateRow } from "./sheets.js";
import { httpError } from "./validators.js";

/**
 * Candado de timbrado por factura capturada (external_id), guardado en la
 * pestana "Timbrados" de Google Sheets.
 *
 * El navegador genera un external_id al empezar a capturar y lo conserva en
 * todos los reintentos. Antes de llamar a Facturapi se busca ese id:
 *   - si ya se timbro, se devuelve el mismo CFDI (no se timbra dos veces);
 *   - si otro intento sigue en curso, se rechaza con 409;
 *   - si el intento anterior fallo, se permite reintentar.
 *
 * Sheets no ofrece transacciones; para cubrir dos clics casi simultaneos que
 * lleguen a la misma instancia se usa ademas un candado en memoria.
 */
const STALE_MS = 2 * 60 * 1000;
const inFlight = new Set();
const TAB = SHEETS.locks;

function checkId(externalId) {
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(String(externalId))) {
    throw httpError(400, "Identificador de captura invalido.");
  }
}

function sheetsUnavailable(error) {
  if (error?.status) {
    return httpError(503, `No se puede timbrar sin el registro en Google Sheets: ${error.message}`);
  }
  return error;
}

export async function acquireStampLock(externalId, user) {
  checkId(externalId);
  if (inFlight.has(externalId)) {
    throw httpError(409, "Esta factura ya se esta timbrando. Espera unos segundos y revisa el Historial antes de reintentar.");
  }
  inFlight.add(externalId);
  try {
    const found = await findRow(TAB, "external_id", externalId);
    const data = found?.row;

    if (data?.status === "stamped") {
      inFlight.delete(externalId);
      let result = null;
      try { result = JSON.parse(data.result || "null"); } catch { result = null; }
      return { existing: result || { invoice: { id: data.facturapi_id, uuid: data.uuid } } };
    }
    const startedAt = Date.parse(data?.started_at || "") || 0;
    if (data?.status === "pending" && Date.now() - startedAt < STALE_MS) {
      inFlight.delete(externalId);
      throw httpError(409, "Esta factura ya se esta timbrando. Espera unos segundos y revisa el Historial antes de reintentar.");
    }

    const row = {
      external_id: externalId,
      status: "pending",
      started_at: new Date().toISOString(),
      finished_at: "",
      actor: user?.email || "",
      attempts: String(Number(data?.attempts || 0) + 1),
      facturapi_id: "",
      uuid: "",
      result: "",
      error: ""
    };
    if (found) await updateRow(TAB, found.rowNumber, row);
    else await appendRow(TAB, row);
    return { acquired: true, rowNumber: found?.rowNumber || null };
  } catch (error) {
    inFlight.delete(externalId);
    throw error?.status === 409 || error?.status === 400 ? error : sheetsUnavailable(error);
  }
}

function compactResult(result) {
  const inv = result.invoice || {};
  return {
    invoice: { id: inv.id, uuid: inv.uuid, series: inv.series, folio_number: inv.folio_number, total: inv.total, date: inv.date },
    row: result.row,
    emailed: result.emailed
  };
}

async function writeFinal(externalId, patch) {
  const found = await findRow(TAB, "external_id", externalId);
  const base = found?.row || { external_id: externalId };
  const row = { ...base, ...patch, finished_at: new Date().toISOString() };
  if (found) await updateRow(TAB, found.rowNumber, row);
  else await appendRow(TAB, row);
}

export async function completeStampLock(externalId, result) {
  try {
    await writeFinal(externalId, {
      status: "stamped",
      facturapi_id: result.invoice?.id || "",
      uuid: result.invoice?.uuid || "",
      result: JSON.stringify(compactResult(result)).slice(0, 45000)
    });
  } finally {
    inFlight.delete(externalId);
  }
}

export async function releaseStampLock(externalId, errorMessage) {
  try {
    await writeFinal(externalId, { status: "failed", error: String(errorMessage || "").slice(0, 500) });
  } catch {
    /* el siguiente intento lo vera como pendiente vencido */
  } finally {
    inFlight.delete(externalId);
  }
}
