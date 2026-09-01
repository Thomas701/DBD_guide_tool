import { generateDbdKnowledge } from "./local-data-files.mjs";

const result = await generateDbdKnowledge();
console.log(`Connaissances DBD générées : ${result.file}`);
console.log(`${result.counts.killers} tueurs · ${result.counts.perks} perks · ${result.counts.categories} catégories`);
