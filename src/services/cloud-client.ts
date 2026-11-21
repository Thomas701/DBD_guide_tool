import type { SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;
export function setCloudClient(value: SupabaseClient | null): void { client = value; }
export function getCloudClient(): SupabaseClient | null { return client; }
