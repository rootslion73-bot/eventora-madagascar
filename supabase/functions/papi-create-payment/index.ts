import {
  getAdminClient,
  isRecord,
  jsonResponse,
  optionsResponse,
  parseUuid,
  requireUser,
  userErrorStatus,
} from "../_shared/http.ts";

type PaymentIntent = {
  payment_id: string;
  merchant_reference: string;
  amount_mga: number;
  checkout_url: string | null;
  link_expires_at: string | null;
};

function parseIntent(value: unknown): PaymentIntent | null {
  if (!isRecord(value)) return null;
  const amount = Number(value.amount_mga);
  if (
    typeof value.payment_id !== "string" ||
    typeof value.merchant_reference !== "string" ||
    !Number.isSafeInteger(amount) ||
    amount < 300 ||
    (value.checkout_url !== null &&
      typeof value.checkout_url !== "string") ||
    (value.link_expires_at !== null &&
      typeof value.link_expires_at !== "string")
  ) {
    return null;
  }
  return {
    payment_id: value.payment_id,
    merchant_reference: value.merchant_reference,
    amount_mga: amount,
    checkout_url: value.checkout_url,
    link_expires_at: value.link_expires_at,
  };
}

function safeCheckoutUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      ["payment-form.papi.mg", "link.papi.mg"].includes(url.hostname)
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return optionsResponse(request);
  if (request.method !== "POST") {
    return jsonResponse(request, 405, { error: "Méthode non autorisée." });
  }

  let admin: ReturnType<typeof getAdminClient>;
  try {
    admin = getAdminClient();
    const user = await requireUser(request, admin);
    const body: unknown = await request.json();
    const orderId = isRecord(body) ? parseUuid(body.orderId) : null;
    if (!orderId) {
      return jsonResponse(request, 400, { error: "Identifiant de commande invalide." });
    }

    const sandboxKey = Deno.env.get("PAPI_SANDBOX_API_KEY");
    const webhookSecret = Deno.env.get("PAPI_WEBHOOK_SECRET");
    const appBaseUrl = Deno.env.get("APP_BASE_URL");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    if (!sandboxKey || !webhookSecret || !appBaseUrl || !supabaseUrl) {
      return jsonResponse(request, 503, {
        error: "Le paiement sandbox n’est pas configuré côté serveur.",
      });
    }

    const appUrl = new URL(appBaseUrl);
    if (
      !["https:", "http:"].includes(appUrl.protocol) ||
      (appUrl.protocol === "http:" &&
        !["localhost", "127.0.0.1"].includes(appUrl.hostname)) ||
      appUrl.username ||
      appUrl.password
    ) {
      return jsonResponse(request, 503, {
        error: "APP_BASE_URL doit être une URL HTTPS valide (localhost autorisé en test).",
      });
    }

    const { data: intentData, error: intentError } = await admin.rpc(
      "prepare_papi_payment",
      { p_order_id: orderId, p_customer_id: user.id },
    );
    if (intentError) {
      return jsonResponse(request, 400, { error: intentError.message });
    }
    const intent = parseIntent(intentData);
    if (!intent) {
      return jsonResponse(request, 502, {
        error: "Le serveur a retourné une intention de paiement invalide.",
      });
    }

    if (intent.checkout_url) {
      const checkoutUrl = safeCheckoutUrl(intent.checkout_url);
      if (!checkoutUrl) {
        return jsonResponse(request, 502, {
          error: "L’URL de paiement enregistrée n’est pas autorisée.",
        });
      }
      return jsonResponse(request, 200, {
        checkoutUrl,
        expiresAt: intent.link_expires_at,
      });
    }

    const webhookUrl = `${supabaseUrl.replace(/\/$/, "")}/functions/v1/papi-webhook`;
    const returnUrl = new URL(appUrl.origin);
    returnUrl.searchParams.set("payment", "return");
    returnUrl.searchParams.set("order_id", orderId);
    const profileResponse = await admin
      .from("profiles")
      .select("display_name")
      .eq("id", user.id)
      .maybeSingle();
    if (profileResponse.error) {
      return jsonResponse(request, 500, {
        error: "Impossible de récupérer le nom du compte client.",
      });
    }
    const displayName =
      typeof profileResponse.data?.display_name === "string"
        ? profileResponse.data.display_name.trim()
        : "";
    const clientName = (displayName || user.email || "Client Eventora").slice(0, 100);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    let papiResponse: Response;
    try {
      papiResponse = await fetch(
        "https://app.papi.mg/engine/api/payment-links",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Token: sandboxKey,
          },
          body: JSON.stringify({
            amount: intent.amount_mga,
            currency: "MGA",
            reference: intent.merchant_reference,
            clientName,
            description: `Billets Eventora · commande ${orderId.slice(0, 8)}`,
            successUrl: returnUrl.toString(),
            failureUrl: returnUrl.toString(),
            notificationUrl: webhookUrl,
            validDuration: 1,
            testReason: "Validation du checkout Eventora en boutique sandbox",
          }),
          signal: controller.signal,
        },
      );
    } finally {
      clearTimeout(timeout);
    }

    const papiBody: unknown = await papiResponse.json().catch(() => null);
    const data = isRecord(papiBody) && isRecord(papiBody.data)
      ? papiBody.data
      : null;
    const checkoutUrl = safeCheckoutUrl(data?.paymentLink);
    const notificationToken =
      typeof data?.notificationToken === "string"
        ? data.notificationToken
        : null;
    const providerAmount = Number(data?.amount);
    const linkExpiresAt =
      typeof data?.linkExpirationDateTime === "number"
        ? new Date(data.linkExpirationDateTime).toISOString()
        : null;

    if (
      !papiResponse.ok ||
      !data ||
      data.paymentReference !== intent.merchant_reference ||
      data.currency !== "MGA" ||
      providerAmount !== intent.amount_mga ||
      !checkoutUrl ||
      !notificationToken ||
      !linkExpiresAt
    ) {
      return jsonResponse(request, 502, {
        error: "Papi n’a pas retourné un lien sandbox complet et conforme au montant de la commande.",
      });
    }

    const { data: savedData, error: saveError } = await admin.rpc(
      "store_papi_checkout_link",
      {
        p_payment_id: intent.payment_id,
        p_customer_id: user.id,
        p_checkout_url: checkoutUrl,
        p_notification_token: notificationToken,
        p_link_expires_at: linkExpiresAt,
      },
    );
    if (saveError) {
      return jsonResponse(request, 409, {
        error: "Le lien sandbox n’a pas pu être associé à la commande. Vérifiez le statut avant toute nouvelle tentative.",
      });
    }

    const saved = isRecord(savedData) ? savedData : {};
    return jsonResponse(request, 200, {
      checkoutUrl,
      expiresAt:
        typeof saved.link_expires_at === "string"
          ? saved.link_expires_at
          : linkExpiresAt,
    });
  } catch (error) {
    const status = userErrorStatus(error);
    const message =
      error instanceof Error && status < 500
        ? error.message
        : "La création du lien de paiement sandbox a échoué.";
    return jsonResponse(request, status, { error: message });
  }
});
