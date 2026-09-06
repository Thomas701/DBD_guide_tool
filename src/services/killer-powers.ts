import killerPowersText from "../../killers.txt?raw";

import type { Killer } from "../domain/killer.js";

const sections = killerPowersText.split(/^##\s+\d+\.\s+/m).slice(1).map((section) => {
  const [heading, ...body] = section.trim().split("\n");
  return { heading: normalize(heading ?? ""), description: body.join("\n").trim() };
});

const aliases: Record<string, string> = { myers: "michael myers", cenobite: "cenobite", shape: "the shape", ghostface: "ghost face", "good-guy": "le good guy chucky", slasher: "jason voorhees", darklord: "dracula", onryo: "onryo" };
const sectionHeadings: Record<string, string> = { "good-guy": "le good guy", slasher: "le mort-vivant" };

export function killerPowerDescription(killer: Killer): string {
  const terms = [killer.id, aliases[killer.id], killer.name.fr, killer.name.en].filter((value): value is string => Boolean(value)).map(normalize);
  const knownHeading = sectionHeadings[killer.id];
  const section = sections.find((candidate) => knownHeading ? candidate.heading.includes(knownHeading) : terms.some((term) => candidate.heading.includes(term)));
  return section?.description.replace(/\*\*(.*?)\*\*/g, "$1")
    ?? "La description de ce pouvoir n’est pas encore disponible dans la base de connaissances.";
}

function normalize(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}
