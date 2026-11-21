export function isAllowedSender(value, appUrl) {
  try {
    const url = new URL(value);
    const app = new URL(appUrl);
    return !url.username && !url.password && url.origin === app.origin && url.pathname.startsWith(app.pathname);
  } catch { return false; }
}

export function validPairing(value) {
  if (!value || typeof value !== "object") return false;
  try {
    const url = new URL(value.supabaseUrl);
    return url.protocol === "https:" && /^[a-z0-9-]+\.supabase\.co$/.test(url.hostname) && url.pathname === "/"
      && !url.username && !url.password && !url.port && !url.search && !url.hash
      && typeof value.publishableKey === "string" && value.publishableKey.length >= 20 && value.publishableKey.length <= 2048
      && /^[a-f0-9]{64}$/.test(value.collectorToken)
      && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value.userId);
  } catch { return false; }
}

export async function hashText(value, algorithm = "SHA-256") {
  return [...new Uint8Array(await crypto.subtle.digest(algorithm, new TextEncoder().encode(value)))].map(byte => byte.toString(16).padStart(2, "0")).join("");
}
