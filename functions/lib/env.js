import { defineSecret } from "firebase-functions/params";

export const FACTURAPI_SECRET_KEY = defineSecret("FACTURAPI_SECRET_KEY");
export const GOOGLE_SERVICE_ACCOUNT_JSON = defineSecret("GOOGLE_SERVICE_ACCOUNT_JSON");
export const GOOGLE_SHEET_ID = defineSecret("GOOGLE_SHEET_ID");
export const FACTURAI_ACCESS_CODE = defineSecret("FACTURAI_ACCESS_CODE");

function cleanSecret(value) {
  return String(value).replace(/^\uFEFF/, "").trim();
}

export function readSecret(secret) {
  const value = secret.value();
  if (!value) {
    throw new Error(`Missing secret: ${secret.name}`);
  }
  return cleanSecret(value);
}

export function readSecretOrEmpty(secret) {
  try {
    return cleanSecret(secret.value() || "");
  } catch {
    return "";
  }
}
