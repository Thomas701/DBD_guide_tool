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

export function validBehaviourSession(session) {
  return Boolean(session && readBehaviourIdentity(JSON.stringify({ state: session }))
    && [session.authToken, session.refreshToken].every(token => typeof token?.token === "string" && token.token.length < 16_384 && Number.isFinite(token.expirationDate)));
}
