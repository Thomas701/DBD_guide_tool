import fs from "node:fs";

import {
  calculateBuild,
  collectBuildConditions
} from "../dist/src/services/build-calculator.js";

const perks = ["perks.json", "survivor-perks.json"].flatMap((file) => JSON.parse(fs.readFileSync(new URL(`../src/data/generated/${file}`, import.meta.url), "utf8")));
const killer = {
  id: "audit",
  name: { fr: "Audit", en: "Audit" },
  speed: 4.6,
  terrorRadius: 32,
  size: "normal",
  tier: "B+",
  difficulty: "normal",
  portrait: null
};
const rows = [];
const reasons = new Map();

for (const perk of perks) {
  const conditions = Object.fromEntries(collectBuildConditions([perk]).map((key) => [key, true]));
  if (conditions.in_chase && conditions.not_in_chase) conditions.not_in_chase = false;
  if (conditions.inside_terror_radius && conditions.outside_terror_radius) conditions.outside_terror_radius = false;
  const result = calculateBuild({
    killer,
    perks: [perk],
    scenario: { conditions, perkStates: { [perk.id]: "active" } }
  });
  const calculations = [
    ...result.activeEffects,
    ...result.inactiveEffects,
    ...result.cooldownEffects,
    ...result.unresolvedEffects
  ];
  result.unresolvedEffects.forEach((effect) => {
    const reason = effect.reasons.at(-1) ?? "Raison inconnue";
    reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
  });
  rows.push({
    id: perk.id,
    name: perk.name.fr ?? perk.name.en ?? perk.id,
    effects: perk.effects.length,
    calculations: calculations.length,
    numeric: result.affectedStats.length,
    qualitative: result.qualitativeEffects.length,
    unresolved: result.unresolvedEffects.length,
    estimated: result.affectedStats.some((stat) => stat.approximate) || perk.effects.some((effect) => effect.interpretation === "inferred"),
    side: perk.side
  });
}

const summary = {
  perks: rows.length,
  withoutEffects: rows.filter((row) => row.effects === 0).length,
  fullyExplained: rows.filter((row) => row.effects > 0 && row.unresolved === 0).length,
  withEstimates: rows.filter((row) => row.estimated).length,
  partial: rows.filter((row) => row.unresolved > 0 && (row.numeric > 0 || row.qualitative > 0)).length,
  unresolvedOnly: rows.filter((row) => row.effects > 0 && row.unresolved > 0 && row.numeric === 0 && row.qualitative === 0).length,
  accountingMismatch: rows.filter((row) => row.effects > 0 && row.calculations < row.effects).length
};

console.log("Audit Build Analyzer");
console.table(summary);
console.table(["killer", "survivor"].map((side) => ({ side, perks: rows.filter((row) => row.side === side).length, withoutEffects: rows.filter((row) => row.side === side && !row.effects).length, unresolved: rows.filter((row) => row.side === side && row.unresolved).length, estimated: rows.filter((row) => row.side === side && row.estimated).length })));
printRows("Perks sans effet structuré", rows.filter((row) => row.effects === 0));
printRows("Analyses partielles ou non résolues", rows.filter((row) => row.unresolved > 0));
console.log("\nRaisons non résolues");
for (const [reason, count] of [...reasons].sort((left, right) => right[1] - left[1])) {
  console.log(`- ${count} × ${reason}`);
}

if (summary.accountingMismatch > 0) process.exitCode = 1;

function printRows(title, entries) {
  console.log(`\n${title} (${entries.length})`);
  entries.forEach((row) => console.log(`- ${row.id} | ${row.name} | effets=${row.effects}, stats=${row.numeric}, qualitatifs=${row.qualitative}, non résolus=${row.unresolved}`));
}
