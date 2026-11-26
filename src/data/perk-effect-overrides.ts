import type { EffectCondition } from "../domain/condition.js";
import type { EffectUnit, PerkEffect } from "../domain/effect.js";
import { GLOBAL_MECHANICS } from "./global-mechanics.js";

const condition = (type: string): EffectCondition => ({ type });
const all = (...conditions: EffectCondition[]): EffectCondition => ({ operator: "all", conditions });
const not = (value: EffectCondition): EffectCondition => ({ operator: "not", condition: value });
const carrying = condition("carrying_survivor");
const radius = condition("inside_terror_radius");
const hook = condition("after_hook");
const kick = condition("generator_damaged");
const trigger = condition("perk_triggered");
const hex = condition("hex_active");
const injured = condition("survivor_injured");
const down = condition("survivor_downed");
const hit = condition("after_basic_attack");
const completed = condition("generator_completed");
const endgame = condition("exit_gates_powered");

/** Revue des descriptions natives au rang III, d’après statistiques_fixe.txt et les notes de patch BHVR. */
export const PERK_EFFECT_OVERRIDES: Readonly<Record<string, readonly PerkEffect[]>> = {
  "laughingstock": [
    info("generator.aura", "Auras des générateurs terminés", "Visibles en permanence une fois le générateur terminé."),
    status("survivor.status.exhausted", null, trigger, "Dans les 12 m d’un générateur terminé, puis 5 s après la sortie de la zone."),
    status("survivor.status.oblivious", null, trigger, "Même portée et même durée que l’Épuisement.")
  ],
  "funny-business": [
    note(mul("killer.speed", 1.1, kick, 10), "Rapidité garantie après le coup sur un générateur, avec 40 s de recharge."),
    info("generator.lock", "Effet supplémentaire aléatoire", "5 s de Rapidité supplémentaires, 2 s d’étourdissement, blocage du générateur pendant 30 s ou confettis. Un résultat ne peut pas se répéter immédiatement.", kick)
  ],
  "kill-spree": [
    status("survivor.kill_available", null, all(endgame, trigger), "Tous les survivants encore en vie doivent avoir atteint leur deuxième phase de crochet."),
    block("exit_gate.open_time", 20, all(endgame, trigger), "Les deux interrupteurs sont bloqués pendant l’exécution, puis 20 s après sa fin.")
  ],
  "agitation": [mul("killer.carry_speed", 1.18, carrying), add("killer.terror_radius", 12, "meters", carrying)],
  "brutal-strength": [mul("killer.pallet_break_time", 1.2), mul("killer.wall_break_time", 1.2), mul("generator.damage_time", 1.2)],
  "unnerving-presence": [add("generator.skill_check_chance", 10, "percentage_points", radius), add("healing.skill_check_chance", 10, "percentage_points", radius), mul("generator.skill_check_good_zone", .4, radius), mul("healing.skill_check_good_zone", .4, radius)],
  "bloodhound": [note(add("tracking.blood_pool_lifetime", 4, "seconds", condition("blood_pool_present")), "Base de 4 s estimée ; +4 s au rang III. Les flaques deviennent plus visibles.")],
  "predator": [info("survivor.aura", "Aura de la cible perdue", "Après abandon de poursuite ; 4 s par activation, sans moyenne artificielle par partie.", condition("chase_abandoned"), 4, 40)],
  "shadowborn": [mul("killer.speed", 1.1, condition("after_blind"), 10)],
  "enduring": [mul("killer.pallet_stun_duration", .5, all(condition("pallet_stunned"), not(carrying)))],
  "lightborn": [info("survivor.aura", "Aura lors d’une tentative d’aveuglement", "Lampes, pétards, grenades et mine : aura de l’auteur.", condition("blind_attempted"), 10), info("killer.blind_immunity", "Immunité à l’aveuglement", "Les sources d’aveuglement ne masquent plus votre vision.")],
  "tinkerer": [status("killer.status.undetectable", 16, condition("generator_at_70_percent"), "Une activation par générateur à 70 % ; notification sonore et 16 s par activation.")],
  "thanatophobia": [["generator.repair_time", "hook.sabotage_time", "totem.dull_cleanse_time", "totem.hex_cleanse_time"].map(stat => note(mul(stat, .8, condition("four_survivors_injured")), "Scénario à 4 survivants blessés, à terre ou accrochés : 4 × 2 % + 12 % = 20 % de pénalité. À 1/2/3 survivants : 2/4/6 %."))].flat(),
  "a-nurses-calling": [info("survivor.aura", "Aura des survivants qui soignent à 32 m", "Révélation pendant le soin à portée, sans durée totale ni valeur infinie artificielle.", condition("healing_within_32m"))],
  "stridor": [mul("sound.grunt_volume", 1.5), mul("sound.breathing_volume", 1.25)],
  "hex-devour-hope": [mul("killer.speed", 1.05, all(hex, hook, condition("devour_hope_2_tokens")), 10), status("survivor.status.exposed", null, all(hex, condition("devour_hope_3_tokens")), "À 3 jetons. Un décrochage à au moins 24 m rapporte un jeton ; totem actif requis."), info("survivor.kill_available", "Exécution des survivants à terre", "À 5 jetons ; la cible doit être en état critique.", all(hex, down, condition("devour_hope_5_tokens")))],
  "hex-ruin": [note(mul("generator.regression_rate", 1.5, hex), "Générateurs non réparés : 150 % du rythme normal, soit 0,375 charge/s. La formulation locale est ambiguë ; cette interprétation suit la règle de référence.")],
  "hex-the-third-seal": [status("survivor.status.blindness", null, all(hex, trigger), "Les 4 derniers survivants touchés par une attaque de base ou spéciale ; cesse avec le totem.")],
  "overwhelming-presence": [status("survivor.status.exhausted", 15, all(radius, trigger)), info("survivor.aura", "Survivant épuisé le plus proche", "Dans le rayon de terreur ; recharge 25 s.", all(radius, trigger), 4, 25)],
  "monitor-and-abuse": [mul("killer.terror_radius", 1.15, condition("in_chase")), mul("killer.terror_radius", .75, condition("not_in_chase"))],
  "overcharge": [loss(4, all(kick, condition("skill_check_failed")), "Pénalité du test raté, distincte des 5 % du kick."), note(mul("generator.regression_rate", 1.3, all(kick, condition("skill_check_failed")), 30), "Palier final : de 85 % à 130 % du rythme normal sur 30 s, pas une vitesse constante sur toute la période."), info("generator.skill_check", "Test difficile au prochain contact", "Un échec est nécessaire pour la pénalité supplémentaire.", kick)],
  "beast-of-prey": [status("killer.status.undetectable", 40, condition("bloodlust_active"), "Lorsque la Soif de sang démarre.")],
  "hex-huntress-lullaby": [add("generator.skill_check_failure_penalty", 6, "percentage_points", hex), add("healing.skill_check_failure_penalty", 6, "percentage_points", hex), note(set("skill_check.warning_delay", 0, "percent", all(hex, condition("lullaby_five_tokens"))), "1/2/3/4 jetons : délai sonore réduit de 14/28/42/56 %. À 5 jetons : plus de signal sonore.")],
  "territorial-imperative": [info("survivor.aura", "Intrusion dans la cave", "Vous devez être à plus de 24 m de la cave.", trigger, 6, 45)],
  "blood-warden": [block("exit_gate.lock", 60, all(condition("exit_gate_open"), hook), "Une activation, après ouverture d’une porte puis accrochage."), info("survivor.aura", "Survivants dans les zones de sortie", "Tant qu’ils restent dans la zone de la porte ouverte.", condition("exit_gate_open"))],
  "fire-up": [["killer.window_vault_time", "killer.pallet_break_time", "killer.wall_break_time", "generator.damage_time", "hook.pickup_time", "hook.drop_time"].map(stat => note(mul(stat, 1.4, condition("fire_up_five_tokens")), "Scénario à 5 générateurs : +8 % par jeton, +40 % maximum. Bonus de vitesse d’action ; la durée est divisée par 1,4."))].flat(),
  "remember-me": [note(add("exit_gate.open_time", 30, "seconds", all(trigger, not(condition("target_is_obsession")))), "Scénario à 5 jetons : 20 + 5 × 6 = 50 s. L’obsession conserve 20 s ; chaque perte de santé donne un jeton.")],
  "coulrophobia": [mul("healing.time", .7, radius), mul("healing.skill_check_pointer_speed", 1.5, radius)],
  "pop-goes-the-weasel": [note(add("generator.damage_penalty", 15, "percentage_points", all(hook, kick), 45), "Version locale : 5 % de kick + 15 points = 20 % de 90 charges, soit 18 charges / 18 s de réparation solo. Une utilisation dans les 45 s après le crochet.")],
  "bamboozle": [mul("killer.window_vault_time", 1.15), block("chase.window_lock", 16, condition("after_killer_vault"), "Une seule fenêtre ; un autre franchissement déplace le blocage.")],
  "spirit-fury": [info("chase.instant_pallet_break", "Palette brisée instantanément", "Après 2 palettes détruites manuellement : la prochaine palette qui vous étourdit se brise. L’étourdissement reste appliqué.", all(trigger, condition("pallet_stunned")))],
  "hex-haunted-ground": [status("survivor.status.exposed", 60, trigger, "Purification d’un des 2 totems piégés : l’autre s’éteint. Une activation.")],
  "rancor": [info("tracking.locations", "Positions de tous les survivants", "3 s par générateur terminé ; l’obsession voit votre aura 3 s. Une position n’est pas une lecture d’aura.", completed, 3), status("survivor.status.exposed", null, all(endgame, condition("target_is_obsession"))), info("survivor.kill_available", "Exécution de l’obsession à terre", "Après achèvement des générateurs.", all(endgame, down, condition("target_is_obsession")))],
  "discordance": [info("generator.aura", "Générateur réparé par au moins 2 survivants", "Portée 128 m ; alerte et aura. Persiste 4 s après la fin de la réparation à plusieurs.", trigger)],
  "mad-grit": [set("killer.missed_attack_recovery_time", 0, "seconds", carrying), status("hook.wiggle_paused", 4, all(carrying, hit), "Chaque coup réussi interrompt la libération pendant 4 s.")],
  "iron-maiden": [mul("locker.search_time", 1.5), status("survivor.status.exposed", 30, trigger, "Sortie de casier : cri et position signalée pendant 4 s.")],
  "corrupt-intervention": [block("generator.lock", 120, all(condition("trial_start"), not(down)), "Les 3 générateurs les plus éloignés au départ ; cesse au premier survivant à terre.")],
  "infectious-fright": [info("tracking.locations", "Cris dans le rayon de terreur", "Mise à terre : positions signalées 6 s, sans aura.", all(down, radius), 6)],
  "dark-devotion": [status("killer.status.undetectable", 40, all(injured, condition("target_is_obsession")), "Un rayon de 40 m émane de l’obsession blessée, pas du tueur ; le rayon propre du tueur n’est pas augmenté.")],
  "im-all-ears": [info("survivor.aura", "Action précipitée à moins de 48 m", "Casier ou point de saut franchi en courant.", trigger, 8, 30)],
  "thrilling-tremors": [block("generator.lock", 16, condition("after_pickup"), "Générateurs non réparés ; leurs auras deviennent blanches.", 30)],
  "furtive-chase": [mul("killer.speed", 1.1, condition("obsession_hooked"), 18), status("killer.status.undetectable", 18, condition("obsession_hooked"), "Au décrochage, le sauveteur devient l’obsession.")],
  "zanshin-tactics": [info("tracking.vaults", "Palettes et fenêtres à 32 m", "Auras visibles en permanence à portée."), info("survivor.aura", "Survivant qui renverse une palette", "Révélation lors du renversement.", trigger, 5)],
  "blood-echo": [status("survivor.status.exhausted", 30, all(hook, injured)), status("survivor.status.hemorrhage", 30, all(hook, injured), "Survivants blessés lors de l’accrochage.")],
  "nemesis": [info("tracking.obsession", "Changement d’obsession", "Le survivant qui vous aveugle ou vous étourdit devient obsession.", trigger), status("survivor.status.oblivious", 60, trigger), info("survivor.aura", "Aura de la nouvelle obsession", "Lors du changement.", trigger, 8)],
  "gearhead": [info("survivor.aura", "Aura après un bon test de réparation", "Pendant les 30 s après une blessure : un test standard réussi révèle son auteur 8 s.", all(injured, trigger), 8)],
  "dead-mans-switch": [block("generator.lock", 40, all(hook, trigger), "Premier survivant à arrêter de réparer au moins 2 s ; un seul générateur bloqué.", 40)],
  "hex-retribution": [status("survivor.status.oblivious", 60, all(hex, trigger), "Survivant qui bénit ou purifie un totem."), info("survivor.aura", "Auras après destruction d’un maléfice", "Tous les survivants pendant 20 s.", trigger, 20)],
  "dragons-grip": [status("survivor.status.exposed", 60, all(kick, trigger), "Premier contact avec le générateur dans les 30 s après le kick ; cri et position 4 s."), info("tracking.locations", "Cri sur le générateur piégé", "Recharge 30 s.", all(kick, trigger), 4, 30)],
  "hex-undying": [info("totem.transfer", "Protection d’un autre maléfice", "Le premier maléfice détruit est transféré sur Immortel, détruit à sa place.", hex), info("survivor.aura", "Survivant près d’un totem terne", "Portée de 4 m retenue comme référence externe ; absente de la description locale. Totem Immortel actif requis.", all(hex, trigger))],
  "hex-blood-favor": [block("chase.palette_lock", 15, all(hex, hit), "Palettes debout à moins de 32 m du survivant touché.")],
  "dissolution": [info("chase.instant_pallet_break", "Destruction après un saut de palette", "3 s après une attaque de base réussie, fenêtre de 15 s : le prochain saut rapide dans votre rayon détruit la palette.", all(hit, radius, condition("after_survivor_vault")), 15)],
  "darkness-revealed": [info("survivor.aura", "Survivants proches d’un casier", "Après fouille d’un casier ; tous les survivants à moins de 8 m de n’importe quel casier.", trigger, 8, 30)],
  "septic-touch": [status("survivor.status.blindness", 30, all(radius, trigger)), status("survivor.status.exhausted", 30, all(radius, trigger), "Pendant les soins dans le rayon, puis 30 s après leur interruption.")],
  "nowhere-to-hide": [info("survivor.aura", "Survivants autour du générateur endommagé", "Rayon de 24 m autour du générateur selon la description locale.", kick, 5)],
  "hex-face-the-darkness": [info("survivor.aura", "Cris et auras hors rayon de terreur", "Après blessure, tant que le survivant maudit n’est ni soigné ni à terre et que le totem reste actif : un cri toutes les 25 s, révélation 2 s.", all(hex, trigger, condition("outside_terror_radius")), 2)],
  "hubris": [status("survivor.status.exposed", 30, trigger, "Survivant qui vous étourdit ; recharge de 20 s." )],
  "help-wanted": [note(mul("killer.successful_attack_recovery_time", .75, condition("compromised_generator_completed"), 90), "Réduction directe de durée : 2,7 × 0,75 = 2,025 s pendant 90 s. Jusqu’à 3 générateurs compromis."), note(mul("generator.regression_rate", 1.5, condition("compromised_generator_completed"), 90), "Générateurs non réparés : 150 % du rythme normal pendant 90 s ; les autres marques compromis disparaissent.")],
  "phantom-fear": [info("survivor.aura", "Survivant qui vous regarde dans le rayon", "Le survivant hurle, puis son aura est révélée.", all(radius, trigger), 2, 60)],
  "haywire": [note(set("exit_gate.regression_rate", 100, "percent", condition("exit_gate_progress_80")), "Au relâchement d’une porte à au moins 80 % : régression à la vitesse d’ouverture, soit 5 points/s ; 16 s pour vider une porte à 80 %. Ce n’est pas une perte instantanée de 100 %.")],
  "turn-back-the-clock": [loss(10, all(hook, trigger), "Activation manuelle dans les 60 s après le crochet ; générateur visé à moins de 20 m, puis régression passive.")],
  "secret-project": [block("generator.lock", 30, trigger, "Totem béni ou purifié : un générateur aléatoire non bloqué."), status("killer.status.undetectable", 30, trigger, "Lorsqu’un ou plusieurs générateurs sont bloqués.")],
  "hex-hive-mind": [info("generator.aura", "Lecture de progression des générateurs", "Le premier crochet allume le totem si un emplacement terne existe ; intensité d’aura selon progression.", hex), loss(10, all(hex, condition("four_generators_completed")), "Tous les générateurs restants après le quatrième terminé ; le totem s’éteint ensuite.")],
  "celestial-witness": [info("survivor.aura", "Obsession éloignée d’au moins 40 m", "Toutes les 30 s ; sinon le survivant le plus éloigné devient l’obsession.", trigger, 3, 30)],
  "hex-under-your-thumb": [info("survivor.haste_cap", "Rapidité des survivants limitée à 15 %", "Après le premier état de crochet, tant que le maléfice reste actif : plafond sur la Rapidité de course. N’impose pas un malus aux survivants sans bonus.", hex), info("tracking.alert", "Alerte lors d’un gain de Rapidité", "Survivant qui court à moins de 32 m.", all(hex, trigger))],
  "lay-waste": [{ ...note(mul("generator.regression_rate", 2.8, all(kick, trigger)), "Exemple estimé à 90 charges présentes au déclenchement : +2 % par charge = +180 %, soit 0,7 charge/s. À 45 charges : 0,475 charge/s. La recharge de 45 s n’est pas la durée de l’effet ; la progression réelle est nécessaire pour un résultat exact."), interpretation: "inferred" }],
  "hex-scared-to-death": [mul("survivor.run_speed", .87, all(hex, condition("in_chase"), condition("after_break_action")), 3), info("tracking.locations", "Cris après destruction d’une palette", "Totem activé après 3 survivants différents accrochés ; survivants à moins de 13 m pendant la poursuite.", all(hex, condition("in_chase"), condition("after_break_action")))],
  "silent-shadow": [status("killer.status.undetectable", 13, hook), status("killer.status.undetectable", null, endgame, "Après le dernier générateur : jusqu’à la fin de la partie.")],
  "rampage": [note(mul("killer.speed", 1.13, trigger, 13), "Scénario à 13 jetons : +1 % par palette/mur détruit, +13 % maximum. Déclenchement après aveuglement ou étourdissement ; recharge 20 s.")],
  "ravenous": [note(mul("killer.carry_speed", 1.16, all(carrying, condition("ravenous_four_tokens"))), "Scénario à 4 survivants différents accrochés : +4 % de vitesse de transport par jeton, +16 % au maximum."), status("survivor.status.exposed", 90, condition("ravenous_four_tokens"), "Quand le quatrième jeton est gagné, tous les survivants hurlent et deviennent Exposés pour 90 s.")],
  "wandering-eye": [info("survivor.aura", "Autres survivants blessés au début d’une poursuite", "Rayon de 20 m autour de vous ; ne révèle pas la cible actuellement poursuivie.", all(condition("in_chase"), trigger), 5, 30)],
  "hex-overture-of-doom": [status("killer.status.undetectable", 30, all(hex, trigger), "Après 5 s de réparation du générateur maudit : votre rayon est transféré au générateur. Après sa finition, le générateur le plus éloigné devient maudit.")],
  "hex-nothing-but-misery": [mul("survivor.run_speed", .95, all(hex, hit), 15), mul("survivor.window_vault_time", .9, all(hex, hit), 15), info("totem.activation", "Maléfice après 4 attaques de base réussies", "Le ralentissement s’applique aux survivants touchés, pendant 15 s, tant que le totem reste actif.", hex)],
  "forever-entwined": [["hook.hook_time", "hook.pickup_time", "hook.drop_time"].map(stat => note(mul(stat, 1.32, condition("forever_entwined_max_tokens")), "Scénario à 8 jetons : +4 % par blessure, +32 % de vitesse d’action au maximum."))].flat(),
  "none-are-free": [block("chase.palette_lock", 64, all(endgame, trigger), "Scénario à 4 survivants différents accrochés : 16 s par jeton = 64 s sur toutes les palettes debout."), block("chase.window_lock", 64, all(endgame, trigger), "Même durée sur les points de saut ; 0/16/32/48/64 s pour 0/1/2/3/4 jetons.")],
  "all-shaking-thunder": [note(mul("killer.lunge_range", 1.75, condition("after_fall"), 25), "Chute d’au moins 1,25 m ; recharge 5 s. Sur la référence approximative de 6 m : portée ≈10,5 m.")],
  "scourge-hook-jagged-compass": [info("survivor.hook_conversion", "Crochets flagellateurs supplémentaires", "4 crochets au départ ; chaque décrochage convertit le crochet utilisé."), info("generator.aura", "Générateur le plus avancé", "Après accrochage sur un crochet flagellateur.", all(hook, condition("scourge_hook")), 10)],
  "no-quarter": [info("healing.skill_checks", "Tests continus à partir de 75 % d’auto-soin", "Échec ou interruption : Brisé 30 s ; ne ralentit pas automatiquement tous les soins.", trigger), status("survivor.status.broken", 30, all(trigger, condition("skill_check_failed")))],
  "hex-wretched-fate": [mul("generator.repair_time", .67, all(hex, condition("target_is_obsession"))), info("totem.visibility", "L’obsession voit le totem dans les 12 m", "S’allume au premier générateur terminé ; seuls les soins/réparations explicitement visés sont modifiés, ici la réparation de l’obsession.", hex)],
  "human-greed": [info("survivor.aura", "Survivant à moins de 8 m d’un coffre verrouillé", "Aura 5 s ; les auras des coffres verrouillés sont visibles. La fermeture manuelle a une recharge de 10 s.", trigger, 5)],
  "dominance": [block("totem.lock", 25, trigger, "Première interaction de purification/bénédiction avec chaque totem ; cri et aura 5 s."), info("survivor.aura", "Auteur de la première interaction avec un totem", "La fenêtre de blocage retarde l’interaction ; elle ne rallonge pas sa durée de base.", trigger, 5)],
  "weave-attunement": [info("item.forced_drop", "Objet épuisé lâché automatiquement", "Lorsqu’il n’a plus de charges."), info("survivor.aura", "Survivants près d’un objet au sol", "Rayon de 12 m ; ils voient l’objet en retour.", trigger), status("survivor.status.oblivious", 30, trigger, "Lors du ramassage d’un objet.")],
  "languid-touch": [status("survivor.status.exhausted", 10, trigger, "Corbeau effrayé à moins de 36 m ; recharge 5 s.")],
  "dark-arrogance": [mul("killer.window_vault_time", 1.25), note(mul("killer.missed_attack_recovery_time", .75), "Réduction de durée de l’attaque de base RATÉE seulement, conformément au patch live 10.2 (la description locale est moins précise)."), mul("killer.pallet_stun_duration", 1.25, condition("pallet_stunned")), mul("killer.blind_duration", 1.25, condition("after_blind"))],
  "unbound": [mul("killer.speed", 1.05, all(injured, condition("after_killer_vault")), 25), info("chase.activation_window", "Fenêtre d’activation de 30 s après une blessure", "Un saut dans cette fenêtre donne +5 % pendant 25 s ; pas de cumul avec soi-même.", injured, 30)],
  "unforeseen": [status("killer.status.undetectable", 30, kick, "Rayon de terreur de 32 m transféré au générateur ; le tueur reste Indétectable. Recharge 30 s.")],
  "undone": [loss(30, all(kick, trigger), "Scénario à 3 jetons gagnés par accrochages : 10 % par jeton consommé. Aucune dépendance à un test raté ; hors perte du kick de base."), block("generator.lock", 30, all(kick, trigger), "10 s de blocage par jeton consommé : 10/20/30 s pour 1/2/3 jetons.")],
  "hex-two-can-play": [info("survivor.visual_blind", "Aveuglement visuel en retour", "Totem activé après 2 aveuglements/étourdissements ; hors transport, l’auteur est aveuglé visuellement 1,5 s. Ce n’est pas le statut empêchant la lecture d’aura.", all(hex, trigger, not(carrying)), 1.5)],
  "friends-til-the-end": [info("survivor.aura", "Aura de l’obsession après un autre crochet", "Un survivant non obsession doit être accroché.", all(hook, not(condition("target_is_obsession"))), 10), status("survivor.status.exposed", 20, all(hook, not(condition("target_is_obsession")))), info("tracking.obsession", "Nouvelle obsession après son accrochage", "Un autre survivant aléatoire hurle et devient obsession.", condition("obsession_hooked"))],
  "batteries-included": [note(mul("killer.speed", 1.05, condition("near_completed_generator"), 5), "À moins de 16 m d’un générateur terminé ; persiste 5 s après sortie de zone.")],
  "ultimate-weapon": [status("survivor.status.blindness", 30, trigger, "Fouille de casier : tous les survivants à moins de 40 m hurlent et subissent Aveuglement ; recharge 45 s.")],
  "rapid-brutality": [mul("killer.speed", 1.05, hit, 10), info("killer.no_bloodlust", "Soif de sang désactivée", "Contrepartie permanente : ne pas ajouter de bonus de Soif de sang à ce build.")],
  "alien-instinct": [info("survivor.aura", "Survivant blessé le plus éloigné", "Révélé après un accrochage.", hook, 8), status("survivor.status.oblivious", 60, hook)],
  "genetic-limits": [status("survivor.status.exhausted", 8, condition("survivor_lost_health_state"), "S’applique au survivant qui vient de perdre un état de santé.")],
  "forced-hesitation": [note(mul("survivor.run_speed", .8, down, 10), "Survivants à moins de 16 m de la mise à terre ; recharge 30 s.")],
  "machine-learning": [mul("killer.speed", 1.08, condition("compromised_generator_completed"), 60), status("killer.status.undetectable", 60, condition("compromised_generator_completed"), "Le générateur doit être compromis avant d’être achevé. Jusqu’à 3 marqués ; les autres marques disparaissent lors du déclenchement.")],
  "game-afoot": [mul("killer.speed", 1.1, all(condition("in_chase"), condition("target_is_obsession"), condition("after_break_action")), 10), info("tracking.obsession", "La cible la plus poursuivie devient obsession", "Lorsqu’elle subit une blessure.", injured)],
  "thwack": [info("survivor.aura", "Cris et auras après destruction", "Dépense 1 des 3 jetons ; +1 par crochet. Palette/mur détruit, survivants à moins de 36 m.", condition("after_break_action"), 6)],
  "leverage": [note(mul("healing.time", .7, condition("survivor_unhooked"), 60), "Pénalité sur le survivant qui effectue le sauvetage, pas automatiquement sur toute l’équipe.")],
  "superior-anatomy": [note(mul("killer.window_vault_time", 1.4, condition("after_survivor_vault"), 10), "Saut moyen/rapide d’un survivant à moins de 12 m : sauts de base du tueur +40 % pendant 10 s ; recharge 20 s.")],
  "awakened-awareness": [info("survivor.aura", "Survivants à 20 m pendant le transport", "Révélation continue tant que le transport et la portée sont respectés.", carrying)],
  "terminus": [status("survivor.status.broken", null, all(endgame, injured), "Survivants blessés, à terre ou accrochés : jusqu’à ouverture d’une porte, puis 45 s supplémentaires.")],
  "scourge-hook-floods-of-rage": [info("survivor.aura", "Autres survivants après décrochage flagellateur", "4 crochets flagellateurs au départ ; le survivant décroché est exclu de la révélation.", all(condition("survivor_unhooked"), condition("scourge_hook")), 7)],
  "call-of-brine": [mul("generator.regression_rate", 1.5, kick, 90), info("generator.skill_check_alert", "Notification après un test standard réussi", "Sur le générateur endommagé pendant les 90 s ; pas de révélation d’aura de survivant.", kick, 90)],
  "merciless-storm": [block("generator.lock", 20, all(condition("generator_at_90_percent"), trigger), "Première arrivée à 90 % par générateur : tests continus. Blocage uniquement si un test est raté ou si la réparation est interrompue.")],
  "grim-embrace": [block("generator.lock", 40, condition("grim_embrace_four_tokens"), "Scénario à 4 premiers accrochages différents : 40 s. Les 3 premiers bloquent 10 s chacun après éloignement de 16 m."), info("survivor.aura", "Aura de l’obsession au quatrième jeton", "L’obsession est révélée en plus du blocage.", condition("grim_embrace_four_tokens"), 6)],
  "scourge-hook-pain-resonance": [loss(20, all(hook, condition("scourge_hook"), trigger), "18 charges sur le générateur le plus avancé. 4 jetons au départ, un seul premier accrochage flagellateur par survivant ; cri des réparateurs.")],
  "hex-pentimento": [note(mul("healing.time", .68, all(hex, condition("pentimento_five_tokens"))), "Scénario à 5 totems ravivés : 20 % + 4 × 3 % = 32 % de pénalité. Dès le premier : 20 %."), note(mul("generator.repair_time", .68, all(hex, condition("pentimento_five_tokens"))), "1/2/3/4/5 totems : pénalité de 20/23/26/29/32 %. Purification normale : 14 s ; bénédiction ensorcelée : 28 s."), info("totem.rekindled_blocked", "Totems ravivés bloqués au cinquième", "Chaque totem détruit ne peut être ravivé qu’une fois ; les survivants voient les auras des ravivés à 16 m.", all(hex, condition("pentimento_five_tokens")))],
  "lethal-pursuer": [info("survivor.aura", "Auras au début de partie", "9 s de base + son propre bonus de 2 s = 11 s au total.", condition("trial_start"), 9), info("tracking.aura_extension", "Révélations d’auras temporisées : +2 s", "Prolonge aussi sa propre révélation initiale. Ne prolonge pas une simple position/cri ou une aura continue sans temporisation.")],
  "hysteria": [status("survivor.status.oblivious", 40, injured, "Après blessure d’un survivant sain : tous les survivants blessés, y compris la cible ; recharge 20 s.")],
  "eruption": [loss(10, all(down, trigger), "Générateurs préalablement endommagés/marqués, puis régression. Recharge 30 s."), info("survivor.aura", "Réparateurs des générateurs marqués", "À la mise à terre, les réparateurs hurlent et leur aura est révélée.", all(down, trigger), 10)],
  "starstruck": [status("survivor.status.exposed", 30, all(carrying, radius), "Pendant le transport puis 30 s après sortie du rayon ou fin du transport ; recharge 60 s.")],
  "hex-crowd-control": [mul("killer.window_vault_time", 1.15, hex), info("chase.window_lock", "Les 6 derniers points de saut sont bloqués", "Activation au premier franchissement ; blocage maintenu par le totem, pas une ancienne durée fixe de 15 s. Auras des points bloqués à 24 m.", hex)],
  "no-way-out": [block("exit_gate.lock", 60, all(endgame, trigger), "Au premier contact avec un interrupteur : 12 s + 12 s par premier survivant accroché ; scénario à 4 jetons = 60 s, sinon 12/24/36/48 s.")],
  "hoarder": [note(add("chest.count", 2, "count"), "3 coffres de base + 2 = 5 coffres, hors offrandes/carte."), info("tracking.item_alert", "Ramassage d’objet ou ouverture d’un coffre", "Notification à moins de 64 m ; ce n’est pas une lecture d’aura.", trigger)],
  "oppression": [info("generator.additional_regression", "Régression de 4 générateurs supplémentaires", "Ils régressent au rythme normal de 0,25 charge/s ; les réparateurs reçoivent un test difficile. Pas de perte instantanée ajoutée.", kick, undefined, 35)],
  "coup-de-grace": [note(mul("killer.lunge_range", 1.8, trigger), "+2 jetons par générateur terminé, maximum 5 ; une fente consomme un jeton. Référence approximative : 6 × 1,8 ≈ 10,8 m.")],
  "forced-penance": [status("survivor.status.broken", 80, trigger, "Survivant qui reçoit un coup de protection.")],
  "trail-of-torment": [status("killer.status.undetectable", null, kick, "Jusqu’à ce que le générateur endommagé cesse de régresser ; les survivants voient son aura. Recharge 30 s.")],
  "deathbound": [status("survivor.status.oblivious", null, trigger, "Après avoir fini de soigner un autre survivant : le soigneur hurle, puis reste Inconscient à moins de 4 m de la personne soignée, jusqu’à sa prochaine blessure. Il voit l’aura de cette personne.")],
  "surge": [loss(8, all(down, hit), "Générateurs à moins de 32 m de la mise à terre par attaque de base : explosion, régression et cri des réparateurs.")],
  "mindbreaker": [status("survivor.status.blindness", 5, condition("repairing_generator")), status("survivor.status.exhausted", 5, condition("repairing_generator"), "Pendant la réparation puis 5 s après l’arrêt ; durée d’effet, pas cooldown de la perk.")],
  "cruel-limits": [block("chase.window_lock", 30, completed, "Tous les points de saut sont bloqués à chaque générateur terminé ; leurs auras sont visibles pendant 30 s.")],
  "scourge-hook-hangmans-trick": [info("survivor.aura", "Survivants près des crochets flagellateurs", "Pendant le transport, survivants à moins de 16 m d’un de ces crochets ; 4 crochets initiaux. Alerte lors d’un sabotage.", all(carrying, condition("scourge_hook")))],
  "surveillance": [info("generator.aura", "Générateurs en régression", "Aura continue pendant la régression, puis surlignage pendant 16 s à son interruption. Description locale : réparations audibles à 8 m ; aucun malus de vitesse de réparation.", trigger)],
  "make-your-choice": [status("survivor.status.exposed", 60, all(condition("survivor_unhooked"), trigger), "Le sauveteur, si vous êtes à plus de 32 m ; cri et Exposé 60 s. Recharge 60 s.")],
  "barbecue-and-chilli": [info("survivor.aura", "Survivants éloignés du crochet", "Survivants à au moins 40 m après un accrochage.", hook, 5)],
  "knock-out": [note(mul("survivor.run_speed", .8, trigger, 4), "Dans les 6 s après renversement d’une palette, si la cible s’en éloigne de plus de 10 m. Fin anticipée dès que le tueur commence à briser la palette. Plus aucun effet de slug de l’ancienne version.")],
  "franklins-demise": [info("item.forced_drop", "Objet tenu lâché au sol", "À l’impact d’une attaque de base ; aucune réduction de charges n’est décrite dans cette version.", hit), info("item.aura", "Objets lâchés visibles à 64 m", "Les objets perdus sont révélés après le coup.", hit)],
  "sloppy-butcher": [mul("healing.time", GLOBAL_MECHANICS.statuses.mangledHealingSpeedMultiplier, hit, 90), status("survivor.status.mangled", 90, hit), status("survivor.status.hemorrhage", 90, hit), note(mul("healing.regression_rate", 1.25, hit, 90), "Hémorragie normale : 7 points/s ; bonus de 25 % au rythme de régression = 8,75 points/s, pas 32 points/s.")],
  "scourge-hook-weeping-wounds": [status("survivor.status.hemorrhage", 90, all(condition("survivor_unhooked"), condition("scourge_hook"), not(condition("weeping_wounds_healed")))), mul("healing.time", .8, all(condition("survivor_unhooked"), condition("scourge_hook"), not(condition("weeping_wounds_healed"))), 90), ...["healing.time", "generator.repair_time"].map(stat => note(mul(stat, .84, condition("weeping_wounds_healed")), "Après soin du survivant décroché d’un crochet flagellateur, jusqu’à sa prochaine blessure : ses soins et réparations sont 16 % plus lents. Distinct de l’Estropiement initial."))],
  "scourge-hook-monstrous-shrine": [note(mul("generator.regression_rate", 2, all(condition("survivor_hooked"), condition("scourge_hook"), condition("far_from_hook"))), "À plus de 24 m du survivant accroché à un crochet flagellateur : générateurs non réparés à 200 %, soit 0,5 charge/s. N’accélère plus le sacrifice. 4 crochets aléatoires et crochets de cave concernés.")],
  "spies-from-the-shadows": [info("tracking.crow_alert", "Corbeau effrayé à moins de 40 m", "Notification sonore, pas aura de survivant.", trigger, undefined, 3)],
  "shattered-hope": [block("totem.lock", 20, trigger, "Totem béni, purifié ou détruit : tous les totems bloqués 20 s ; éteindre une bénédiction détruit son totem."), info("totem.aura", "Auras des totems de bénédiction", "Lors du même déclenchement.", trigger, 20)],
  "keep-them-waiting": [note(mul("killer.successful_attack_recovery_time", .6, trigger), "Scénario à 8 jetons : 8 × 5 % = 40 % de durée en moins, soit 1,62 s. Coup sur non-obsession : +1 ; blessure de l’obsession : −2. Plus de gain de jetons si l’obsession meurt.")],
  "unrelenting": [mul("killer.missed_attack_recovery_time", .6), mul("killer.obstructed_attack_recovery_time", .6), mul("killer.successful_attack_recovery_time", .9)],
  "distressing": [mul("killer.terror_radius", 1.3), mul("generator.repair_time", .92, radius)],
  "insidious": [status("killer.status.undetectable", null, trigger, "Après 2 s immobile ; persiste 8 s après reprise d’une action.")],
  "bitter-murmur": [info("survivor.aura", "Survivants près d’un générateur terminé", "Rayon de 20 m autour du générateur ; durée de 10 s par activation.", all(completed, not(endgame)), 10), info("survivor.aura", "Tous les survivants après le dernier générateur", "Une seule révélation globale de 20 s, sans addition artificielle avec la révélation locale.", endgame, 20)],
  "whispers": [info("tracking.whispers", "Présence d’un survivant dans les 24 m", "Information sonore, pas aura. Peut être déclenchée par un survivant accroché.", condition("survivor_within_24m")), mul("killer.speed", 1.05, not(condition("survivor_within_24m")))],
  "deerstalker": [info("survivor.aura", "Révélation réciproque des auras", "Tant qu’un survivant voit votre aura, vous voyez la sienne ; pas l’ancienne recherche de survivants à terre.", trigger), info("tracking.self_aura", "Votre aura donnée au survivant le moins poursuivi", "Toutes les 30 s, pendant 4 s ; déclenche donc aussi la réciprocité.", trigger, 4, 30)],
  "iron-grasp": [note(mul("hook.wiggle_time", 1.12, carrying), "Augmentation directe de durée : 16 × 1,12 = 17,92 s pour se libérer."), mul("hook.wiggle_strength", .25, carrying)],
  "see-how-they-run": [note(mul("killer.speed", 1.15, trigger), "Scénario à 3 jetons : +5 % chacun, +15 % au maximum ; abandonner l’obsession donne 1 jeton, une attaque en retire 1. Aucun totem n’est requis.")],
  "hex-thrill-of-the-hunt": [block("totem.lock", 30, all(hex, hook), "Scénario à 5 totems ensorcelés allumés : 6 s chacun, soit 30 s maximum. Un premier accrochage allume ce maléfice ; l’effet concerne les totems ensorcelés.")],
  "hex-fortunes-fool": [status("survivor.status.oblivious", null, all(hex, trigger), "Premier accrochage : cible maudite. Le totem est protégé 90 s contre les autres survivants ; la cible voit son aura à 16 m."), block("totem.lock", 90, all(hex, trigger), "Protection contre les autres survivants seulement ; la cible maudite peut interagir.")],
  "hex-no-one-escapes-death": [mul("killer.speed", 1.04, all(endgame, hex)), status("survivor.status.exposed", null, all(endgame, hex), "Totem allumé après achèvement des générateurs ; son aura passe de 4 à 24 m de visibilité en 30 s. Cesse avec le totem.")],
  "no-holds-barred": [block("generator.lock", 25, completed, "Le générateur restant le plus avancé ; aura blanche. N’enlève pas de progression.")],
  "dying-light": [...["healing.time", "generator.repair_time", "hook.sabotage_time"].map(stat => note(mul(stat, .91, all(condition("dying_light_three_tokens"), not(condition("target_is_obsession")))), "Exemple à 3 jetons : −9 % de vitesse sur les non-obsessions, tant que l’obsession vit. −3 % par crochet non obsession ; ne pas traiter cette pénalité comme une perte instantanée de progression.")), ...["healing.time", "hook.unhook_time"].map(stat => note(mul(stat, 1.33, condition("target_is_obsession")), "Bonus propre à l’obsession : soins altruistes et décrochages +33 %. Ce bonus et la pénalité concernent des survivants différents."))],
};

function mul(stat: string, value: number, condition?: EffectCondition, duration?: number | null): PerkEffect {
  return { stat, operation: "multiply", interpretation: "verified", value, unit: "multiplier", ...(condition ? { condition } : {}), ...(duration == null ? {} : { duration }) };
}
function add(stat: string, value: number, unit: EffectUnit, condition?: EffectCondition, duration?: number): PerkEffect {
  return { stat, operation: "add", interpretation: "verified", value, unit, ...(condition ? { condition } : {}), ...(duration === undefined ? {} : { duration }) };
}
function set(stat: string, value: number, unit: EffectUnit, condition?: EffectCondition): PerkEffect {
  return { stat, operation: "set", interpretation: "verified", value, unit, ...(condition ? { condition } : {}) };
}
function note(effect: PerkEffect, detail: string): PerkEffect { return { ...effect, detail }; }
function info(stat: string, label: string, detail: string, condition?: EffectCondition, duration?: number, cooldown?: number): PerkEffect {
  return { stat, label, detail, operation: "reveal", interpretation: "verified", value: true, unit: "boolean", ...(condition ? { condition } : {}), ...(duration === undefined ? {} : { duration }), ...(cooldown === undefined ? {} : { cooldown }) };
}
function status(stat: string, duration: number | null, condition?: EffectCondition, detail?: string): PerkEffect {
  return { stat, operation: "apply_status", interpretation: "verified", value: true, unit: "boolean", duration, ...(condition ? { condition } : {}), ...(detail ? { detail } : {}) };
}
function block(stat: string, duration: number, condition: EffectCondition, detail: string, cooldown?: number): PerkEffect {
  return { stat, operation: "block", interpretation: "verified", duration, unit: "seconds", condition, detail, ...(cooldown === undefined ? {} : { cooldown }) };
}
function loss(percent: number, condition: EffectCondition, detail: string): PerkEffect {
  return note(add("generator.instant_regression", GLOBAL_MECHANICS.generator.charges * percent / 100, "count", condition), percent + " % de 90 charges = " + GLOBAL_MECHANICS.generator.charges * percent / 100 + " charges, soit autant de secondes de réparation solo (plafonnées à la progression présente). " + detail);
}
