import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

const isValidSupabaseUrl = (value: string | undefined) => {
  if (!value) return false;
  try {
    const url = new URL(value.trim());
    return (
      url.protocol === "https:" ||
      (url.protocol === "http:" &&
        (url.hostname === "localhost" || url.hostname === "127.0.0.1"))
    );
  } catch {
    return false;
  }
};

const validSupabaseUrl = isValidSupabaseUrl(supabaseUrl)
  ? supabaseUrl.trim()
  : null;
const validPublishableKey = supabasePublishableKey?.trim() || null;

export const isSupabaseConfigured = Boolean(
  validSupabaseUrl && validPublishableKey,
);

export const supabase =
  validSupabaseUrl && validPublishableKey
    ? createClient(validSupabaseUrl, validPublishableKey, {
      auth: {
        autoRefreshToken: true,
        detectSessionInUrl: true,
        persistSession: true,
      },
    })
    : null;
