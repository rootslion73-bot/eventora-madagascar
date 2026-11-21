import { createClient, type User } from "npm:@supabase/supabase-js@2.119.0";

const appOrigin = Deno.env.get("APP_BASE_URL");

export function corsHeaders(request: Request): HeadersInit {
  const origin = request.headers.get("origin");
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers":
      "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
  if (origin && appOrigin && origin === appOrigin.replace(/\/$/, "")) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

export function jsonResponse(
  request: Request,
  status: number,
  body: Record<string, unknown>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(request),
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

export function optionsResponse(request: Request): Response {
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

export function getAdminClient() {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const legacySecret = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const secretMap = Deno.env.get("SUPABASE_SECRET_KEYS");
  let secretKey = legacySecret;

  if (secretMap) {
    try {
      const keys: unknown = JSON.parse(secretMap);
      if (
        typeof keys === "object" &&
        keys !== null &&
        "default" in keys &&
        typeof keys.default === "string"
      ) {
        secretKey = keys.default;
      }
    } catch {
      throw new Error("SUPABASE_SECRET_KEYS ne contient pas un JSON valide.");
    }
  }

  if (!supabaseUrl || !secretKey) {
    throw new Error(
      "Les secrets serveur Supabase requis ne sont pas configurés.",
    );
  }

  return createClient(supabaseUrl, secretKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

export async function requireUser(
  request: Request,
  admin: ReturnType<typeof getAdminClient>,
): Promise<User> {
  const authorization = request.headers.get("authorization");
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  if (!match) throw new Error("AUTH_REQUIRED");

  const { data, error } = await admin.auth.getUser(match[1]);
  if (error || !data.user) throw new Error("AUTH_INVALID");
  return data.user;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseUuid(value: unknown): string | null {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
    ? value
    : null;
}

export function userErrorStatus(error: unknown): number {
  if (error instanceof Error) {
    if (error.message === "AUTH_REQUIRED") return 401;
    if (error.message === "AUTH_INVALID") return 401;
    if (
      error.message.startsWith("SUPABASE_") ||
      error.message.includes("secrets serveur")
    ) {
      return 503;
    }
  }
  return 500;
}
