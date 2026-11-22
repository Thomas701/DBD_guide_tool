import { statisticsHandler } from "./handler.mjs";
Deno.serve(statisticsHandler({ url: Deno.env.get("SUPABASE_URL")!, serviceKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")! }));
