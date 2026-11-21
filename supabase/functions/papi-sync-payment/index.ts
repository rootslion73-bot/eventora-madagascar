import {
  getAdminClient,
  isRecord,
  jsonResponse,
  optionsResponse,
  parseUuid,
  requireUser,
  userErrorStatus,
} from "../_shared/http.ts";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return optionsResponse(request);
  if (request.method !== "POST") {
    return jsonResponse(request, 405, { error: "Méthode non autorisée." });
  }

  try {
    const admin = getAdminClient();
    const user = await requireUser(request, admin);
    const body: unknown = await request.json();
    const orderId = isRecord(body) ? parseUuid(body.orderId) : null;
    if (!orderId) {
      return jsonResponse(request, 400, { error: "Identifiant de commande invalide." });
    }

    const apiKey = Deno.env.get("PAPI_SANDBOX_API_KEY");
    if (!apiKey) {
      return jsonResponse(request, 503, {
        error: "La vérification Papi sandbox n’est pas configurée côté serveur.",
      });
    }

    const { data: intentData, error: intentError } = await admin.rpc(
      "get_papi_payment_intent",
      { p_order_id: orderId, p_customer_id: user.id },
    );
    if (intentError) {
      return jsonResponse(request, 400, { error: intentError.message });
    }
    if (!isRecord(intentData)) {
      return jsonResponse(request, 502, {
        error: "L’intention de paiement retournée par le serveur est invalide.",
      });
    }
    if (intentData.status === "succeeded") {
      return jsonResponse(request, 200, {
        status: "succeeded",
        message: "Le paiement est déjà enregistré.",
      });
    }
    if (
      typeof intentData.merchant_reference !== "string" ||
      typeof intentData.notification_token !== "string"
    ) {
      return jsonResponse(request, 409, {
        error: "Le lien Papi n’a pas encore été créé pour cette commande.",
      });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    let papiResponse: Response;
    try {
      papiResponse = await fetch(
        `https://app.papi.mg/engine/api/payment-links/${encodeURIComponent(intentData.merchant_reference)}`,
        {
          headers: { Token: apiKey },
          signal: controller.signal,
        },
      );
    } finally {
      clearTimeout(timeout);
    }

    const papiBody: unknown = await papiResponse.json().catch(() => null);
    const data =
      isRecord(papiBody) && isRecord(papiBody.data) ? papiBody.data : null;
    if (
      !papiResponse.ok ||
      !data ||
      data.merchantPaymentReference !== intentData.merchant_reference ||
      data.notificationToken !== intentData.notification_token ||
      data.currency !== "MGA" ||
      Number(data.amount) !== Number(intentData.amount_mga)
    ) {
      return jsonResponse(request, 502, {
        error: "La réponse de statut Papi ne correspond pas à cette commande.",
      });
    }

    const providerStatus =
      data.paymentStatus === "SUCCESS" ||
      data.paymentStatus === "FAILED" ||
      data.paymentStatus === "PENDING"
        ? data.paymentStatus
        : "PENDING";
    const providerReference =
      typeof data.papiPaymentReference === "string"
        ? data.papiPaymentReference
        : null;
    const { data: result, error: processError } = await admin.rpc(
      "process_papi_notification",
      {
        p_merchant_reference: intentData.merchant_reference,
        p_notification_token: intentData.notification_token,
        p_payment_status: providerStatus,
        p_provider_payment_reference: providerReference,
        p_amount_mga: Number(data.amount),
        p_currency: "MGA",
      },
    );
    if (processError) {
      return jsonResponse(request, 409, {
        error: "Le statut Papi a été lu, mais son rapprochement serveur a échoué.",
      });
    }

    const resultRecord = isRecord(result) ? result : {};
    return jsonResponse(request, 200, {
      status:
        typeof resultRecord.status === "string"
          ? resultRecord.status
          : providerStatus.toLowerCase(),
      message:
        providerStatus === "SUCCESS"
          ? "Paiement confirmé par le serveur Papi."
          : providerStatus === "FAILED"
            ? "Papi indique que le paiement a échoué."
            : "Le paiement est toujours en attente chez Papi.",
    });
  } catch (error) {
    const status = userErrorStatus(error);
    const message =
      error instanceof Error && status < 500
        ? error.message
        : "La vérification du paiement auprès de Papi a échoué.";
    return jsonResponse(request, status, { error: message });
  }
});
