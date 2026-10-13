import { defineSecret } from "firebase-functions/params";

export const FACTURAPI_SECRET_KEY = defineSecret("FACTURAPI_SECRET_KEY");
export const GOOGLE_SERVICE_ACCOUNT_JSON = defineSecret("GOOGLE_SERVICE_ACCOUNT_JSON");
export const GOOGLE_SHEET_ID = defineSecret("GOOGLE_SHEET_ID");

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
