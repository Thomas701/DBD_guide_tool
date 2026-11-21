import { createClient } from "@supabase/supabase-js";
import { setCloudClient } from "../services/cloud-client.js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
export const isHostedApp = import.meta.env.VITE_HOSTED_APP === "true" || Boolean(url);
export const emailAuthEnabled = import.meta.env.VITE_EMAIL_AUTH_ENABLED === "true";
export const supabase = url && key ? createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "pkce" },
}) : null;
setCloudClient(supabase);

export function authRedirectUrl(): string {
  return new URL(import.meta.env.BASE_URL, window.location.origin).href;
}
