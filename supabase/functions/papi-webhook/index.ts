import {
  getAdminClient,
  isRecord,
  jsonResponse,
  optionsResponse,
} from "../_shared/http.ts";

const MAX_BODY_BYTES = 64 * 1024;
const SIGNATURE_TOLERANCE_SECONDS = 300;

async function verifySignature(
  rawBody: Uint8Array,
  signatureHeader: string | null,
  secret: string,
): Promise<boolean> {
  const match = signatureHeader?.match(/^t=(\d+),v1=([0-9a-f]{64})$/);
  if (!match) return false;

  const timestamp = Number(match[1]);
  if (
    !Number.isSafeInteger(timestamp) ||
    Math.abs(Math.floor(Date.now() / 1000) - timestamp) >
      SIGNATURE_TOLERANCE_SECONDS
  ) {
    return false;
  }

  const signature = new Uint8Array(
    match[2].match(/.{2}/g)!.map((byte) => Number.parseInt(byte, 16)),
  );
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const signedMessage = new Uint8Array(
    new TextEncoder().encode(`${match[1]}.`).length + rawBody.length,
  );
  const prefix = new TextEncoder().encode(`${match[1]}.`);
  signedMessage.set(prefix);
  signedMessage.set(rawBody, prefix.length);
  return crypto.subtle.verify("HMAC", key, signature, signedMessage);
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return optionsResponse(request);
  if (request.method !== "POST") {
    return jsonResponse(request, 405, { error: "Méthode non autorisée." });
  }

  const webhookSecret = Deno.env.get("PAPI_WEBHOOK_SECRET");
  if (!webhookSecret) {
    return jsonResponse(request, 503, {
      error: "La vérification du webhook Papi n’est pas configurée.",
    });
  }

  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_BODY_BYTES) {
    return jsonResponse(request, 413, { error: "Notification trop volumineuse." });
  }

  try {
    const rawBody = new Uint8Array(await request.arrayBuffer());
    if (rawBody.length > MAX_BODY_BYTES) {
      return jsonResponse(request, 413, { error: "Notification trop volumineuse." });
    }

    if (
      !(await verifySignature(
        rawBody,
        request.headers.get("X-Papi-Signature"),
        webhookSecret,
      ))
    ) {
      return jsonResponse(request, 401, { error: "Signature Papi invalide ou expirée." });
    }

    const payload: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(rawBody));
    if (
      !isRecord(payload) ||
      typeof payload.merchantPaymentReference !== "string" ||
      typeof payload.notificationToken !== "string" ||
      typeof payload.paymentStatus !== "string" ||
      typeof payload.currency !== "string" ||
      typeof payload.amount !== "number" ||
      !Number.isSafeInteger(payload.amount)
    ) {
      return jsonResponse(request, 400, { error: "Corps de notification Papi invalide." });
    }

    const providerReference =
      typeof payload.paymentReference === "string"
        ? payload.paymentReference
        : null;
    const admin = getAdminClient();
    const { data, error } = await admin.rpc("process_papi_notification", {
      p_merchant_reference: payload.merchantPaymentReference,
      p_notification_token: payload.notificationToken,
      p_payment_status: payload.paymentStatus,
      p_provider_payment_reference: providerReference,
      p_amount_mga: payload.amount,
      p_currency: payload.currency,
    });
    if (error) {
      console.error("Papi notification could not be reconciled:", error.message);
      return jsonResponse(request, 503, {
        error: "Notification authentique, mais son rapprochement doit être réessayé.",
      });
    }

    return jsonResponse(
      request,
      200,
      isRecord(data) ? data : { received: true },
    );
  } catch (error) {
    console.error(
      "Papi webhook processing failed:",
      error instanceof Error ? error.message : "Unknown error",
    );
    return jsonResponse(request, 400, {
      error: "La notification Papi n’a pas pu être traitée.",
    });
  }
});
