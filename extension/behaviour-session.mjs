export function readBehaviourIdentity(raw) {
  try {
    const token = JSON.parse(raw)?.state?.authToken?.token;
    if (typeof token !== "string") return null;
    const payload = token.split(".")[1];
    if (!payload) return null;
    const subject = JSON.parse(atob(payload.replaceAll("-", "+").replaceAll("_", "/"))).sub;
    return typeof subject === "string" && subject ? subject : null;
  } catch { return null; }
}
