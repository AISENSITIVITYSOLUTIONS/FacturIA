import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { httpError } from "./validators.js";

/**
 * Candado de timbrado por factura capturada (external_id).
 *
 * El navegador genera un external_id al empezar a capturar y lo conserva en
 * todos los reintentos. Antes de llamar a Facturapi se reserva ese id en
 * Firestore con una transaccion:
 *   - Si ya se timbro, se devuelve el mismo CFDI (no se timbra dos veces).
 *   - Si otro intento sigue en curso, se rechaza con 409.
 *   - Si el intento anterior fallo, se permite reintentar.
 */
const COLLECTION = "stampLocks";
const STALE_MS = 2 * 60 * 1000;

function lockRef(externalId) {
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(String(externalId))) {
    throw httpError(400, "Identificador de captura invalido.");
  }
  return getFirestore().collection(COLLECTION).doc(String(externalId));
}

function firestoreError(error) {
  const code = error?.code;
  // 5 = NOT_FOUND (la base de datos no existe), 7 = PERMISSION_DENIED
  if (code === 5 || code === 7 || /NOT_FOUND|database .* does not exist/i.test(String(error?.message))) {
    return httpError(503, "Falta crear la base de datos Firestore del proyecto (necesaria para evitar timbrados duplicados).");
  }
  return error;
}

/**
 * Devuelve { existing } si ese external_id ya tiene un CFDI timbrado,
 * o { acquired: true } si este intento puede timbrar.
 */
export async function acquireStampLock(externalId, user) {
  const ref = lockRef(externalId);
  try {
    return await getFirestore().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const data = snap.exists ? snap.data() : null;

      if (data?.status === "stamped") {
        return { existing: data.result };
      }
      const startedAt = data?.startedAt?.toMillis?.() || 0;
      if (data?.status === "pending" && Date.now() - startedAt < STALE_MS) {
        throw httpError(409, "Esta factura ya se esta timbrando. Espera unos segundos y revisa el Historial antes de reintentar.");
      }

      tx.set(ref, {
        status: "pending",
        startedAt: FieldValue.serverTimestamp(),
        actor: user?.email || "",
        attempts: FieldValue.increment(1)
      }, { merge: true });
      return { acquired: true };
    });
  } catch (error) {
    throw error?.status ? error : firestoreError(error);
  }
}

export async function completeStampLock(externalId, result) {
  await lockRef(externalId).set({
    status: "stamped",
    finishedAt: FieldValue.serverTimestamp(),
    result
  }, { merge: true });
}

export async function releaseStampLock(externalId, errorMessage) {
  await lockRef(externalId).set({
    status: "failed",
    finishedAt: FieldValue.serverTimestamp(),
    error: String(errorMessage || "").slice(0, 500)
  }, { merge: true }).catch(() => {});
}
