import { supabase } from "./supabase";

export type PublishedAccommodation = {
  id: string;
  name: string;
  description: string | null;
  city: string;
  address: string | null;
  pricePerNightMGA: number;
};

export type AccommodationRequestResult = {
  reservationId: string;
  status: "requested";
};

export type VisibleAccommodationRequest = {
  id: string;
  customerId: string;
  accommodationId: string;
  accommodationName: string;
  city: string;
  status: string;
  startsAt: string;
  endsAt: string;
  guestCount: number;
  budgetMGA: number;
  message: string | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export async function fetchPublishedAccommodations(): Promise<
  PublishedAccommodation[]
> {
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("accommodations")
    .select("id,name,description,city,address,price_per_night_mga")
    .eq("status", "published")
    .order("city")
    .limit(100);

  if (error) throw new Error(error.message);
  if (!Array.isArray(data)) return [];

  return data.flatMap((row) => {
    const record = asRecord(row);
    const price = Number(record?.price_per_night_mga);
    if (
      !record ||
      typeof record.id !== "string" ||
      typeof record.name !== "string" ||
      typeof record.city !== "string" ||
      !Number.isSafeInteger(price) ||
      price < 0
    ) {
      return [];
    }

    return [
      {
        id: record.id,
        name: record.name,
        description:
          typeof record.description === "string" ? record.description : null,
        city: record.city,
        address: typeof record.address === "string" ? record.address : null,
        pricePerNightMGA: price,
      },
    ];
  });
}

export async function createAccommodationRequest(input: {
  accommodationId: string;
  checkIn: string;
  checkOut: string;
  guestCount: number;
  budgetMGA: number;
  message: string;
}): Promise<AccommodationRequestResult> {
  if (!supabase) {
    throw new Error("Supabase n’est pas configuré.");
  }

  const { data, error } = await supabase.rpc(
    "create_accommodation_request",
    {
      p_accommodation_id: input.accommodationId,
      p_starts_at: `${input.checkIn}T00:00:00Z`,
      p_ends_at: `${input.checkOut}T00:00:00Z`,
      p_guest_count: input.guestCount,
      p_budget_mga: input.budgetMGA,
      p_message: input.message,
    },
  );

  if (error) throw new Error(error.message);
  const record = asRecord(data);
  if (
    !record ||
    typeof record.reservation_id !== "string" ||
    record.status !== "requested"
  ) {
    throw new Error("La demande d’hébergement n’a pas pu être créée.");
  }

  return {
    reservationId: record.reservation_id,
    status: "requested",
  };
}

export async function fetchVisibleAccommodationRequests(): Promise<
  VisibleAccommodationRequest[]
> {
  if (!supabase) return [];

  const { data: requestRows, error: requestError } = await supabase
    .from("reservations")
    .select(
      "id,customer_id,listing_id,status,starts_at,ends_at,guest_count,budget_mga,message",
    )
    .eq("service", "stay")
    .order("created_at", { ascending: false })
    .limit(50);

  if (requestError) throw new Error(requestError.message);
  if (!Array.isArray(requestRows) || requestRows.length === 0) return [];

  const rows = requestRows.flatMap((row) => {
    const record = asRecord(row);
    if (
      !record ||
      typeof record.id !== "string" ||
      typeof record.customer_id !== "string" ||
      typeof record.listing_id !== "string" ||
      typeof record.status !== "string" ||
      typeof record.starts_at !== "string" ||
      typeof record.ends_at !== "string"
    ) {
      return [];
    }

    return [{
      id: record.id,
      customerId: record.customer_id,
      accommodationId: record.listing_id,
      accommodationName: "Hébergement",
      city: "",
      status: record.status,
      startsAt: record.starts_at,
      endsAt: record.ends_at,
      guestCount: Number(record.guest_count) || 0,
      budgetMGA: Number(record.budget_mga) || 0,
      message: typeof record.message === "string" ? record.message : null,
    }];
  });
  const accommodationIds = [...new Set(rows.map((row) => row.accommodationId))];
  const { data: accommodations, error: accommodationError } = await supabase
    .from("accommodations")
    .select("id,name,city")
    .in("id", accommodationIds);

  if (accommodationError) throw new Error(accommodationError.message);
  const names = new Map(
    (accommodations ?? []).flatMap((row) => {
      const record = asRecord(row);
      return record &&
          typeof record.id === "string" &&
          typeof record.name === "string" &&
          typeof record.city === "string"
        ? [[record.id, { name: record.name, city: record.city }] as const]
        : [];
    }),
  );

  return rows.map((row) => ({
    ...row,
    accommodationName:
      names.get(row.accommodationId)?.name ?? row.accommodationName,
    city: names.get(row.accommodationId)?.city ?? row.city,
  }));
}

export async function respondToAccommodationRequest(
  reservationId: string,
  confirm: boolean,
): Promise<"confirmed" | "rejected"> {
  if (!supabase) throw new Error("Supabase n’est pas configuré.");

  const { data, error } = await supabase.rpc(
    "respond_accommodation_request",
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
