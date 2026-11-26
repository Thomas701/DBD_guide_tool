import { KILLER_TIERS, type KillerTier } from "../domain/killer.js";
import type { PerkSide } from "../domain/perk.js";

export const PERK_TIER_REVIEW = {
  date: "2026-11-07",
  scope: "Parties normales 1 contre 4, perks au rang III, utilité générale sans imposer de tueur, d’objet ou de groupe coordonné. Classement éditorial fondé sur les descriptions de l’application ; les synergies spécialisées peuvent changer le rang.",
  sources: [
    { title: "BHVR · 10.3.0, chapitre Terrifier", url: "https://bugreport.deadbydaylight.com/projects/pr-5642738318/releases/7067" },
    { title: "BHVR · 10.2.0, version live", url: "https://forums.bhvr.com/dead-by-daylight/kb/articles/560-10-2-0-mid-chapter" },
    { title: "BHVR · 9.6.0, rendements décroissants et Voie rapide", url: "https://forums.bhvr.com/dead-by-daylight/kb/articles/544-9-6-0-patch-notes" }
  ]
};

// Les identifiants survivent aux traductions et aux changements de noms des perks.
export const PERK_TIER_GROUPS: Record<PerkSide, Record<KillerTier, readonly string[]>> = {
  killer: {
    "S+": ["corrupt-intervention", "scourge-hook-pain-resonance", "grim-embrace"],
    "S-": ["no-holds-barred", "no-way-out", "undone", "hex-pentimento"],
    "A+": ["pop-goes-the-weasel", "dead-mans-switch", "surge", "nowhere-to-hide", "bamboozle", "lethal-pursuer", "oppression", "keep-them-waiting", "hex-devour-hope", "whispers", "knock-out", "machine-learning"],
    "A-": ["agitation", "enduring", "discordance", "unrelenting", "dark-arrogance", "hex-blood-favor", "hex-crowd-control", "turn-back-the-clock", "scourge-hook-weeping-wounds", "scourge-hook-jagged-compass", "scourge-hook-monstrous-shrine", "overwhelming-presence", "mindbreaker", "languid-touch", "coup-de-grace", "friends-til-the-end", "unforeseen", "hex-ruin", "hex-undying", "help-wanted", "batteries-included"],
    "B+": ["brutal-strength", "tinkerer", "a-nurses-calling", "im-all-ears", "zanshin-tactics", "blood-echo", "gearhead", "darkness-revealed", "hex-face-the-darkness", "hubris", "ravenous", "all-shaking-thunder", "unbound", "genetic-limits", "forced-hesitation", "game-afoot", "thwack", "leverage", "superior-anatomy", "scourge-hook-floods-of-rage", "starstruck", "barbecue-and-chilli", "sloppy-butcher", "see-how-they-run", "bitter-murmur", "funny-business", "deerstalker", "hex-no-one-escapes-death", "hex-thrill-of-the-hunt", "fire-up", "infectious-fright", "dissolution", "furtive-chase", "hex-wretched-fate", "cruel-limits", "hex-scared-to-death"],
    "B-": ["monitor-and-abuse", "blood-warden", "remember-me", "coulrophobia", "spirit-fury", "hex-haunted-ground", "rancor", "thrilling-tremors", "hex-retribution", "dragons-grip", "hex-hive-mind", "celestial-witness", "lay-waste", "silent-shadow", "rampage", "forever-entwined", "none-are-free", "weave-attunement", "ultimate-weapon", "rapid-brutality", "alien-instinct", "awakened-awareness", "terminus", "merciless-storm", "hysteria", "eruption", "trail-of-torment", "make-your-choice", "franklins-demise", "spies-from-the-shadows", "distressing", "hex-fortunes-fool", "hex-under-your-thumb"],
    "C+": ["predator", "lightborn", "thanatophobia", "overcharge", "hex-the-third-seal", "iron-maiden", "nemesis", "septic-touch", "phantom-fear", "laughingstock", "no-quarter", "human-greed", "dominance", "call-of-brine", "forced-penance", "surveillance", "scourge-hook-hangmans-trick", "iron-grasp", "dying-light", "dark-devotion", "hex-overture-of-doom", "hex-nothing-but-misery", "insidious"],
    "C-": ["unnerving-presence", "bloodhound", "shadowborn", "stridor", "beast-of-prey", "hex-huntress-lullaby", "territorial-imperative", "mad-grit", "wandering-eye", "hex-two-can-play", "deathbound", "hoarder", "secret-project"],
    "D": ["haywire", "kill-spree", "shattered-hope"]
  },
  survivor: {
    "S+": ["lithe", "off-the-record", "decisive-strike", "resilience"],
    "S-": ["deja-vu", "unbreakable", "adrenaline", "sprint-burst", "we-ll-make-it", "fast-track", "kindred"],
    "A+": ["bond", "botany-knowledge", "windows-of-opportunity", "five-moves-ahead", "boon-steadfast", "reassurance", "deliverance", "shoulder-the-burden", "resurgence", "stake-out", "built-to-last", "empathic-connection", "finesse", "dead-hard", "balanced-landing", "lucky-break", "babysitter", "do-no-harm"],
    "A-": ["alert", "any-means-necessary", "background-player", "boon-circle-of-healing", "blood-rush", "chemical-trap", "dark-sense", "distortion", "exultation", "fogwise", "hyperfocus", "iron-will", "leader", "lucky-star", "overcome", "plot-twist", "prove-thyself", "smash-hit", "we-re-gonna-live-forever", "wiretap", "flow-state", "salvations-cry", "wide-open-throttle", "fruits-of-your-labor", "friendly-competition", "solidarity", "vigil", "buckle-up", "hope"],
    "B+": ["aftercare", "autodidact", "bada-bada-boom", "better-than-new", "blood-pact", "boon-shadow-step", "borrowed-time", "breakout", "clean-break", "conviction", "detective-s-hunch", "dramaturgy", "duty-of-care", "empathy", "extrasensory-perception", "eyes-of-belmont", "flashbang", "for-the-people", "hardened", "inner-focus", "inner-strength", "valkyries-rage", "light-footed", "lightweight", "no-one-left-behind", "object-of-obsession", "open-handed", "overzealous", "parental-guidance", "pharmacy", "poised", "best-gift-ever", "power-struggle", "reactive-healing", "repressed-alliance", "residual-manifest", "second-wind", "slippery-meat", "specialist", "spine-chill", "streetwise", "teamwork-power-of-two", "troubleshooter", "wake-up", "we-see-you", "wicked"],
    "B-": ["ace-in-the-hole", "apocalyptic-ingenuity", "appraisal", "bardic-inspiration", "better-together", "bite-the-bullet", "boon-exponential", "breakdown", "counterforce", "cut-loose", "dance-with-me", "deadline", "deception", "desperate-measures", "fixated", "ghost-notes", "head-on", "made-for-this", "moment-of-glory", "quick-and-quiet", "quick-gambit", "shared-trauma", "saboteur", "scavenger", "scene-partner", "soul-guard", "strength-in-shadows", "teamwork-full-circuit", "teamwork-soft-spoken", "teamwork-throw-down", "tenacity", "lend-a-hand", "a-place-for-us", "plunderer-s-instinct", "one-two-three-four", "blast-mine"],
    "C+": ["boil-over", "boon-dark-theory", "boon-illumination", "calm-spirit", "camaraderie", "champion-of-light", "change-of-plan", "clairvoyance", "come-and-get-me", "corrective-action", "diversion", "flip-flop", "invocation-weaving-spiders", "low-profile", "premonition", "road-life", "rookie-spirit", "self-preservation", "small-game", "still-sight", "teamwork-collective-stealth", "teamwork-toughen-up", "cross-examination", "sole-survivor"],
    "C-": ["invocation-treacherous-crows", "last-stand", "left-behind", "mettle-of-man", "mirrored-illusion", "potential-energy", "rapid-response", "red-herring", "self-care", "technician", "this-is-not-happening", "up-the-ante", "urban-evasion", "visionary"],
    "D": ["no-mither"]
  }
};

export const PERK_BASE_TIERS: Readonly<Record<string, KillerTier>> = Object.fromEntries(
  (Object.keys(PERK_TIER_GROUPS) as PerkSide[]).flatMap((side) => KILLER_TIERS.flatMap((tier) => PERK_TIER_GROUPS[side][tier].map((id) => [side === "survivor" ? `survivor-${id}` : id, tier])))
);

export const PERK_TIER_REASONS: Readonly<Record<string, string>> = {
  "laughingstock": "L’Épuisement et Inconscient gênent les survivants près des générateurs terminés. Le placement des poursuites détermine sa valeur.",
  "funny-business": "La Rapidité est garantie et aide à reprendre une poursuite après un coup de pied. L’étourdissement et la recharge limitent sa fiabilité.",
  "kill-spree": "Le blocage des sorties peut sauver une fin de partie serrée. Atteindre deux phases de crochet sur chaque survivant restant et lancer une exécution à temps est rare.",
  "survivor-best-gift-ever": "Plusieurs bonus durent toute l’Épreuve. Leur intérêt dépend des objets sacrifiés et le coût est immédiat.",
  "survivor-shared-trauma": "Utile pour relancer les perks d’Épuisement d’un groupe proche. En solo, réunir le groupe au moment du coup de protection reste difficile.",
  "survivor-valkyries-rage": "Un étourdissement prolongé aide à changer de zone après une longue poursuite. Le tueur peut éviter la palette.",
  "undone": "La description actuelle donne des jetons à l’accrochage : régression et blocage deviennent fiables, sans dépendre de tests ratés.",
  "whispers": "Le gain de déplacement hors de portée complète maintenant la détection ; son ancien classement purement informatif est dépassé.",
  "knock-out": "Le ralentissement après une palette remplace ici l’ancienne logique de mise à terre et aide directement à raccourcir les poursuites.",
  "unrelenting": "La récupération des attaques réussies s’ajoute aux attaques ratées : bénéfice régulier sans préparation.",
  "dark-arrogance": "Franchissement accéléré et récupération d’attaque, contre une vulnérabilité accrue aux étourdissements. Ne pas extrapoler le cumul avec d’autres bonus.",
  "machine-learning": "Pouvoir marquer plusieurs générateurs rend l’activation plus accessible ; la rapidité reste dépendante d’un générateur terminé.",
  "help-wanted": "Les générateurs compromis facilitent l’activation, mais il faut d’abord céder un objectif et exploiter la fenêtre de bonus.",
  "deerstalker": "La révélation réciproque des auras est plus polyvalente que l’ancienne recherche des survivants à terre.",
  "bitter-murmur": "Les longues révélations après les générateurs apportent une information exploitable, mais ne ralentissent pas directement les réparations.",
  "fire-up": "Les actions sont nettement renforcées dans la description actuelle, mais le bonus monte tard, au prix des générateurs perdus.",
  "overwhelming-presence": "La version affichée apporte épuisement et aura, bien plus utiles qu’une simple consommation d’objets.",
  "scourge-hook-monstrous-shrine": "La régression globale pendant les accrochages éloignés mérite un rang supérieur à l’ancien effet limité au sacrifice.",
  "dead-mans-switch": "Le délai d’arrêt et le blocage du premier générateur demandent une pression réelle ; ce n’est pas un blocage garanti de tous les objectifs.",
  "pop-goes-the-weasel": "Régression contrôlable après un crochet, avec déplacement et coup sur le générateur : moins universelle que les effets automatiques.",
  "hex-pentimento": "Fort ralentissement collectif, limité par la purification préalable et la possibilité de détruire les totems ravivés.",
  "shattered-hope": "L’intérêt dépend encore des bénédictions et de la protection de totems ; faible valeur dans un build généraliste.",
  "survivor-fast-track": "Les décrochages alimentent maintenant la progression permanente : excellent gain sur les générateurs, avec un coût d’altruisme réel.",
  "survivor-stake-out": "La version affichée utilise des tests spéciaux ; ne pas lui attribuer automatiquement les anciennes synergies de tests excellents standards.",
  "survivor-this-is-not-happening": "La description agrandit les bons tests, sans bonus de zone excellente : peu d’intérêt pour accélérer une réparation maîtrisée.",
  "survivor-windows-of-opportunity": "Repérage des points de saut et accélération ponctuelle du franchissement ; ne pas supposer l’ancien repérage permanent de toutes les palettes.",
  "survivor-five-moves-ahead": "Repérage des palettes et reprise de déplacement après leur utilisation : solide outil de poursuite sans épuisement.",
  "survivor-wide-open-throttle": "Permet de créer de la distance, mais le blocage de la palette réduit les ressources disponibles pendant la recharge.",
  "survivor-boon-steadfast": "Zone de réparation et réduction de régression utiles à plusieurs survivants ; le placement et le temps de bénédiction limitent la polyvalence.",
  "survivor-flow-state": "Bon soutien progressif pour soigner et secourir ; la description ne donne aucun bonus de réparation.",
  "survivor-fruits-of-your-labor": "Récompense la finition des générateurs par du déplacement et du soin, sans accélérer directement leur réparation.",
  "survivor-salvations-cry": "Information collective à l’entrée en poursuite, utile pour répartir les réparations et les secours.",
  "survivor-lend-a-hand": "Les charges de soin permanentes aident, mais nécessitent un totem par nouvelle utilisation et restent limitées par bénéficiaire.",
  "survivor-a-place-for-us": "Protection discrète pendant les soins et après un soin de l’obsession ; bénéfice spécialisé plutôt qu’un outil universel de poursuite.",
  "survivor-cross-examination": "Lecture et discrétion hors poursuite ; impact limité pour réparer plus vite ou survivre à une poursuite déjà engagée.",
  "survivor-shoulder-the-burden": "Redistribue les états de crochet et protège un partenaire, au prix d’une blessure et d’une longue période Brisé.",
  "survivor-deja-vu": "Information sur les générateurs regroupés et bonus de réparation sans préparation : excellente base pour jouer les objectifs.",
  "survivor-resilience": "Bonus à de nombreuses interactions dans la description actuelle ; utile à la réparation comme aux poursuites.",
  "survivor-hyperfocus": "Potentiel élevé avec une très bonne précision, mais les interruptions et les tests non excellents font perdre la progression du bonus.",
  "survivor-prove-thyself": "Utile pour finir un objectif à plusieurs, sans remplacer la pression créée par des survivants répartis sur plusieurs générateurs.",
  "survivor-boon-illumination": "Information et préparation des bénédictions ; la description ne lui donne pas directement de bonus aux générateurs.",
  "survivor-no-mither": "La blessure permanente est un désavantage majeur, malgré les outils de récupération : choix de défi ou de stratégie spécialisée."
};
