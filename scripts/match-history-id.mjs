import { createHash } from "node:crypto";
import { matchHistoryIdentity } from "../shared/match-history-identity.mjs";

// Only immutable card fields: participant details must not change a match's identity.
export function buildMatchHistoryEntryId(entry) {
  return createHash("sha1").update(matchHistoryIdentity(entry)).digest("hex");
}
