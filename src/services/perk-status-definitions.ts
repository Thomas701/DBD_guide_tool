import type { Perk } from "../domain/perk.js";
import { perkDescriptionToText } from "./openai-build-assistant.js";

// Références : https://deadbydaylight.wiki.gg/wiki/Status_Effect et https://deadbydaylight.wiki.gg/wiki/Health_States
// Insaisissable : https://store.steampowered.com/news/posts/?appids=381210&enddate=1759242649&feed=steam_community_announcements
const DEFINITIONS = [
  { term: "Épuisement", pattern: /\b(?:epuisement|epuise[es]?|exhausted|exhaustion)\b/, definition: "Empêche d’utiliser les compétences liées à l’épuisement. La récupération se fait normalement lorsque le survivant ne court pas." },
  { term: "Brisé", pattern: /\b(?:brise|broken status effect)\b/, definition: "Empêche le survivant d’être soigné au-delà de l’état blessé tant que cet effet est actif." },
  { term: "État critique", pattern: /\b(?:etat critique|mourant[es]?|dying(?: state)?)\b/, definition: "Le survivant est à terre et ne peut que ramper ou récupérer. Il doit généralement être relevé par un allié." },
  { term: "Insaisissable", pattern: /\b(?:insaisissables?|elusive)\b/, definition: "Masque l’aura, les marques de griffures, les flaques de sang et les gémissements de douleur du survivant. N’empêche pas l’Instinct de tueur." },
  { term: "Blessure profonde", pattern: /\b(?:blessures? profondes?|deep wound)\b/, definition: "Oblige le survivant à se ressaisir avant la fin du délai, sous peine de tomber à terre. Se ressaisir ne soigne pas la blessure." },
  { term: "Endurance", pattern: /\bendurance\b/, definition: "Permet de résister à un coup qui mettrait un survivant blessé à terre, en infligeant une Blessure profonde. Ne protège pas si celle-ci est déjà active." },
  { term: "Exposé", pattern: /\b(?:expose[es]?|exposition|vulnerables?|a decouvert|exposed)\b/, definition: "Une attaque de base peut mettre le survivant à terre en un coup, même s’il est en bonne santé." },
  { term: "Indétectable", pattern: /\b(?:indetectables?|undetectable)\b/, definition: "Masque le rayon de terreur, la tache rouge et l’aura du tueur. Le tueur reste visible physiquement." },
  { term: "Inconscient", pattern: /\b(?:inconscient[es]?|oblivious)\b/, definition: "Le survivant n’entend plus le rayon de terreur du tueur. Certains effets qui demandent de percevoir ce rayon ne s’appliquent plus." },
  { term: "Entravé", pattern: /\b(?:entrave[es]?|hindered)\b/, definition: "Réduit la vitesse de déplacement pendant la durée indiquée." },
  { term: "Rapidité", pattern: /\b(?:rapidite|hate|haste)\b/, definition: "Augmente la vitesse de déplacement. Ce bonus n’accélère pas automatiquement les réparations, les soins ou les autres actions." },
  { term: "Hémorragie", pattern: /\b(?:hemorragie|ha?emorrhage)\b/, definition: "Augmente les traces de sang et fait régresser les soins incomplets lorsqu’ils sont interrompus." },
  { term: "Mutilation", pattern: /\b(?:mutilation|mutile[es]?|mangled)\b/, definition: "Ralentit les soins nécessaires pour soigner le survivant affecté." },
  { term: "Aveuglement", pattern: /\b(?:aveuglement|cecite|blindness)\b/, definition: "Comme statut, empêche de lire la plupart des auras. L’aveuglement visuel par une lampe ou une grenade masque temporairement la vision." },
  { term: "Incapacité", pattern: /\b(?:incapacite|incapacitated)\b/, definition: "Empêche certaines interactions, notamment réparer un générateur et soigner, tant que l’effet est actif." },
  { term: "Soif de sang", pattern: /\b(?:soif de sang|bloodlust)\b/, definition: "Accélération progressive du tueur au cours d’une poursuite prolongée, perdue notamment lorsqu’il blesse le survivant ou brise une palette." },
  { term: "Aura", pattern: /\bauras?\b/, definition: "Silhouette colorée visible à travers les obstacles, qui révèle temporairement une personne ou un élément de la carte." },
  { term: "Instinct de tueur", pattern: /\b(?:instinct (?:de|du) tueur|killer instinct)\b/, definition: "Signal pulsant qui localise un survivant. Ce repérage est distinct d’une aura et n’est pas bloqué par les protections contre sa lecture." },
  { term: "Obsession", pattern: /\bobsession\b/, definition: "Survivant désigné comme cible de certains effets. Une seule obsession existe à la fois ; elle peut changer en cours de partie." },
  { term: "Rayon de terreur", pattern: /\b(?:rayon de terreur|terror radius)\b/, definition: "Zone autour du tueur dans laquelle les survivants entendent ses battements de cœur, avec une intensité liée à la proximité." },
  { term: "Action ostensible", pattern: /\b(?:actions? ostensibles?|conspicuous actions?)\b/, definition: "Action de progression ou d’entraide, comme réparer, soigner ou décrocher, qui peut interrompre certaines protections après un décrochage." }
] as const;

export function perkStatusDefinitions(perk: Perk, descriptionHtml?: string) {
  const text = perkDescriptionToText(perk, descriptionHtml).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ");
  return DEFINITIONS.filter(({ pattern }) => pattern.test(text));
}
