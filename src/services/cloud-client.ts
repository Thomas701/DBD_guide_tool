import type { SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;
let viewedUserId: string | null = null;
export function setViewedUserId(value: string | null): void { viewedUserId = value; }
export function getViewedUserId(): string | null { return viewedUserId; }
export function setCloudClient(value: SupabaseClient | null): void { client = value; }
export function getCloudClient(): SupabaseClient | null { return client; }
