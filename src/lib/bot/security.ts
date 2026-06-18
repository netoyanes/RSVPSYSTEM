import crypto from "crypto";

/**
 * Verify Meta's X-Hub-Signature-256 header (used by both WhatsApp Cloud API and
 * Instagram Messaging). The signature is HMAC-SHA256 of the RAW request body
 * keyed by the app secret. Always compute over the raw bytes — re-serializing
 * the parsed JSON changes the bytes and breaks the check.
 */
export function verifyMetaSignature(
  rawBody: string,
  signatureHeader: string | null,
  appSecret: string,
): boolean {
  if (!signatureHeader || !appSecret) return false;
  const expected =
    "sha256=" +
    crypto.createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
  const a = Buffer.from(signatureHeader);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
