import { supabase } from "./supabase";

export type PublishedTransportOffer = {
  id: string;
  origin: string;
  destination: string;
  departureAt: string;
  arrivalAt: string | null;
  operator: string;
  vehicle: string | null;
  priceMGA: number;
  baggageDetails: string | null;
  conditions: string | null;
};

export type VisibleTransportRequest = {
  id: string;
  customerId: string;
  offerId: string;
  operator: string;
  origin: string;
  destination: string;
  status: string;
  departureAt: string;
  passengerCount: number;
  budgetMGA: number;
  message: string | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function safeInteger(value: unknown): number | null {
  const parsed =
    typeof value === "number" || typeof value === "string"
      ? Number(value)
      : Number.NaN;
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

export async function fetchPublishedTransportOffers(): Promise<
  PublishedTransportOffer[]
> {
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("transport_offers")
    .select(
      "id,origin,destination,departure_at,estimated_arrival_at,operator_name,vehicle,price_mga,manual_confirmation,baggage_details,conditions",
    )
    .eq("status", "published")
    .eq("manual_confirmation", true)
    .not("departure_at", "is", null)
    .gt("departure_at", new Date().toISOString())
    .order("departure_at")
    .limit(100);

  if (error) throw new Error(error.message);
  if (!Array.isArray(data)) return [];

  return data.flatMap((row) => {
    const record = asRecord(row);
    const priceMGA = safeInteger(record?.price_mga);
    if (
      !record ||
      typeof record.id !== "string" ||
      typeof record.origin !== "string" ||
      typeof record.destination !== "string" ||
      typeof record.departure_at !== "string" ||
      typeof record.operator_name !== "string" ||
      priceMGA === null
    ) {
      return [];
    }

    return [{
      id: record.id,
      origin: record.origin,
      destination: record.destination,
      departureAt: record.departure_at,
      arrivalAt:
        typeof record.estimated_arrival_at === "string"
          ? record.estimated_arrival_at
          : null,
      operator: record.operator_name,
      vehicle: typeof record.vehicle === "string" ? record.vehicle : null,
      priceMGA,
      baggageDetails:
        typeof record.baggage_details === "string"
          ? record.baggage_details
          : null,
      conditions:
        typeof record.conditions === "string" ? record.conditions : null,
    }];
  });
}

export async function createTransportRequest(input: {
  offerId: string;
  passengerCount: number;
  budgetMGA: number;
  message: string;
}): Promise<string> {
  if (!supabase) throw new Error("Supabase n’est pas configuré.");

  const { data, error } = await supabase.rpc("create_transport_request", {
    p_offer_id: input.offerId,
    p_passenger_count: input.passengerCount,
    p_budget_mga: input.budgetMGA,
    p_message: input.message,
  });
  if (error) throw new Error(error.message);

  const record = asRecord(data);
  if (
    !record ||
    typeof record.reservation_id !== "string" ||
    record.status !== "requested"
  ) {
    throw new Error("La demande de trajet n’a pas pu être créée.");
  }
  return record.reservation_id;
}

export async function fetchVisibleTransportRequests(): Promise<
  VisibleTransportRequest[]
> {
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("reservations")
    .select(
      "id,customer_id,listing_id,status,starts_at,guest_count,budget_mga,message,transport_snapshot",
    )
    .eq("service", "trip")
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) throw new Error(error.message);
  if (!Array.isArray(data) || data.length === 0) return [];

  const requests = data.flatMap((row) => {
    const record = asRecord(row);
    if (
      !record ||
      typeof record.id !== "string" ||
      typeof record.customer_id !== "string" ||
      typeof record.listing_id !== "string" ||
      typeof record.status !== "string" ||
      typeof record.starts_at !== "string"
    ) {
      return [];
    }
    const snapshot = asRecord(record.transport_snapshot);

    return [{
      id: record.id,
      customerId: record.customer_id,
      offerId: record.listing_id,
      operator:
        typeof snapshot?.operator === "string"
          ? snapshot.operator
          : "Transporteur",
      origin: typeof snapshot?.origin === "string" ? snapshot.origin : "",
      destination:
        typeof snapshot?.destination === "string" ? snapshot.destination : "",
      status: record.status,
      departureAt: record.starts_at,
      passengerCount: safeInteger(record.guest_count) ?? 0,
      budgetMGA: safeInteger(record.budget_mga) ?? 0,
      message: typeof record.message === "string" ? record.message : null,
    }];
  });
  return requests;
}

export async function respondToTransportRequest(
  reservationId: string,
  confirm: boolean,
): Promise<"confirmed" | "rejected"> {
  if (!supabase) throw new Error("Supabase n’est pas configuré.");

  const { data, error } = await supabase.rpc(
    "respond_transport_request",
    {
      p_reservation_id: reservationId,
      p_confirm: confirm,
    },
  );
  if (error) throw new Error(error.message);

  const record = asRecord(data);
  if (record?.status !== "confirmed" && record?.status !== "rejected") {
    throw new Error("La réponse du serveur à la demande est invalide.");
  }
  return record.status;
}
