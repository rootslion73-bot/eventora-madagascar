import { supabase } from "./supabase";

export type TicketOption = {
  id: string;
  name: string;
  priceMGA: number;
  availableQuantity: number;
};

export type PublishedEvent = {
  id: string;
  title: string;
  category: string;
  city: string;
  venue?: string;
  date: string;
  eventDate: string;
  price: number;
  image: string;
  tag: string;
  kind: "event";
  description: string;
  source: "database";
  ticketOptions: TicketOption[];
};

export type PendingTicketOrder = {
  orderId: string;
  expiresAt: string;
  totalMGA: number;
};

export type PapiCheckout = {
  checkoutUrl: string;
  expiresAt: string | null;
};

export type PapiPaymentStatus = {
  status: string;
  message: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function safeImageUrl(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "";
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

function nonnegativeSafeInteger(value: unknown): number | null {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function localEventDate(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Indian/Antananarivo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function parseTicketOption(value: unknown): TicketOption | null {
  const row = asRecord(value);
  if (!row || typeof row.id !== "string" || typeof row.name !== "string") {
    return null;
  }

  const priceMGA = nonnegativeSafeInteger(row.price_mga);
  const capacity = nonnegativeSafeInteger(row.capacity);
  const sold = nonnegativeSafeInteger(row.sold_count);
  const reserved = nonnegativeSafeInteger(row.reserved_count);
  if (
    priceMGA === null ||
    capacity === null ||
    sold === null ||
    reserved === null
  ) {
    return null;
  }

  return {
    id: row.id,
    name: row.name,
    priceMGA,
    availableQuantity: Math.max(0, capacity - sold - reserved),
  };
}

function parseEvent(value: unknown): PublishedEvent | null {
  const row = asRecord(value);
  if (
    !row ||
    typeof row.id !== "string" ||
    typeof row.title !== "string" ||
    typeof row.city !== "string" ||
    typeof row.starts_at !== "string"
  ) {
    return null;
  }

  const startsAt = new Date(row.starts_at);
  if (Number.isNaN(startsAt.getTime())) return null;

  const rawTicketOptions = Array.isArray(row.ticket_types)
    ? row.ticket_types
    : [];
  const ticketOptions = rawTicketOptions
    .map(parseTicketOption)
    .filter((option): option is TicketOption => option !== null)
    .sort((first, second) => first.priceMGA - second.priceMGA);
  if (ticketOptions.length === 0) return null;

  const date = new Intl.DateTimeFormat("fr-FR", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Indian/Antananarivo",
  })
    .format(startsAt)
    .toLocaleUpperCase("fr");

  return {
    id: row.id,
    title: row.title,
    category: typeof row.category === "string" ? row.category : "Événement",
    city: row.city,
    venue:
      typeof row.venue_name === "string" && row.venue_name.trim()
        ? row.venue_name
        : undefined,
    date,
    eventDate: localEventDate(startsAt),
    price: ticketOptions[0].priceMGA,
    image: safeImageUrl(row.image_url),
    tag: "PARTENAIRE",
    kind: "event",
    description:
      typeof row.description === "string" && row.description.trim()
        ? row.description
        : "Événement publié par un partenaire Eventora.",
    source: "database",
    ticketOptions,
  };
}

export async function fetchPublishedEvents(): Promise<PublishedEvent[]> {
  if (!supabase) throw new Error("Supabase n’est pas configuré.");

  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession();
  if (sessionError) throw new Error(sessionError.message);
  if (session) {
    const { error: cleanupError } = await supabase.rpc(
      "release_expired_ticket_holds",
    );
    if (cleanupError) throw new Error(cleanupError.message);
  }

  const { data, error } = await supabase
    .from("events")
    .select(
      "id,title,description,city,venue_name,starts_at,category,image_url,ticket_types(id,name,price_mga,capacity,sold_count,reserved_count)",
    )
    .eq("status", "published")
    .order("starts_at", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  const rows: unknown = data;
  if (!Array.isArray(rows)) {
    throw new Error("La réponse du catalogue d’événements est invalide.");
  }

  return rows
    .map(parseEvent)
    .filter((event): event is PublishedEvent => event !== null);
}

export async function createPendingTicketOrder(
  ticketTypeId: string,
  quantity: number,
): Promise<PendingTicketOrder> {
  if (!supabase) throw new Error("Supabase n’est pas configuré.");
  if (
    !ticketTypeId ||
    !Number.isInteger(quantity) ||
    quantity < 1 ||
    quantity > 20
  ) {
    throw new Error("La sélection de billets est invalide.");
  }

  const { data, error } = await supabase.rpc("create_pending_ticket_order", {
    p_items: [{ ticket_type_id: ticketTypeId, quantity }],
  });
  if (error) throw new Error(error.message);

  const result = asRecord(data);
  if (
    !result ||
    typeof result.order_id !== "string" ||
    typeof result.hold_expires_at !== "string"
  ) {
    throw new Error("La réponse de création de commande est invalide.");
  }

  const totalMGA = nonnegativeSafeInteger(result.total_mga);
  if (totalMGA === null) {
    throw new Error("Le montant total retourné par le serveur est invalide.");
  }

  return {
    orderId: result.order_id,
    expiresAt: result.hold_expires_at,
    totalMGA,
  };
}

async function invokePaymentFunction(
  functionName: string,
  orderId: string,
): Promise<Record<string, unknown>> {
  if (!supabase) throw new Error("Supabase n’est pas configuré.");

  const { data, error } = await supabase.functions.invoke(functionName, {
    body: { orderId },
  });
  if (error) {
    const context: unknown = error.context;
    if (context instanceof Response) {
      const body: unknown = await context.json().catch(() => null);
      const response = asRecord(body);
      if (typeof response?.error === "string") {
        throw new Error(response.error);
      }
    }
    throw new Error(error.message);
  }
  const result = asRecord(data);
  if (!result) {
    throw new Error("Le serveur de paiement a retourné une réponse invalide.");
  }
  return result;
}

export async function createPapiCheckout(
  orderId: string,
): Promise<PapiCheckout> {
  const result = await invokePaymentFunction("papi-create-payment", orderId);
  if (typeof result.checkoutUrl !== "string") {
    throw new Error(
      typeof result.error === "string"
        ? result.error
        : "Le lien de paiement sandbox est absent de la réponse.",
    );
  }

  let url: URL;
  try {
    url = new URL(result.checkoutUrl);
  } catch {
    throw new Error("Le lien de paiement retourné est invalide.");
  }
  if (
    url.protocol !== "https:" ||
    !["payment-form.papi.mg", "link.papi.mg"].includes(url.hostname)
  ) {
    throw new Error("Le domaine du lien de paiement n’est pas autorisé.");
  }

  return {
    checkoutUrl: url.toString(),
    expiresAt:
      typeof result.expiresAt === "string" ? result.expiresAt : null,
  };
}

export async function syncPapiPaymentStatus(
  orderId: string,
): Promise<PapiPaymentStatus> {
  const result = await invokePaymentFunction("papi-sync-payment", orderId);
  if (typeof result.status !== "string" || typeof result.message !== "string") {
    throw new Error(
      typeof result.error === "string"
        ? result.error
        : "Le statut du paiement est invalide.",
    );
  }
  return { status: result.status, message: result.message };
}
