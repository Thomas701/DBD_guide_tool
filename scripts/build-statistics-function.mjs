import { build } from "esbuild";
await build({ entryPoints: ["supabase/functions/sync-statistics/index.ts"], outfile: ".tmp-cloud-function/index.ts", bundle: true, format: "esm", platform: "neutral", target: "es2022" });
console.log("Supabase function bundled: .tmp-cloud-function/index.ts");
