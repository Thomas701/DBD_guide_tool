import type { PerkCategory } from "../domain/category.js";
import type { KnownConditionType } from "../domain/condition.js";
import type { KillerDifficulty, KillerSize } from "../domain/killer.js";

export const categoryLabels: Record<PerkCategory, string> = {
  speed: "Vitesse",
  terror_rayon: "Rayon de terreur",
  destruction: "Destruction",
  hability_test: "Tests d'habileté",
  blood_trace: "Traces de sang",
  chase: "Poursuite",
  aura: "Aura",
  recharge: "Recharge",
  generator: "Générateur",
  hook: "Crochet",
  blind: "Aveuglement",
  indetectable: "Indétectable",
  care: "Soins",
  action: "Action",
  sound: "Son",
  totem: "Totem",
  be_one_shot: "Exposé",
  exhausted: "Épuisement",
  bloodlust: "Soif de sang",
  cave: "Cave",
  exit_door: "Porte de sortie",
  obsession: "Obsession",
  locker: "Casier"
};

export const difficultyLabels: Record<KillerDifficulty, string> = {
  easy: "Facile",
  normal: "Normale",
  difficult: "Difficile",
  nightmare: "Cauchemar"
};

export const sizeLabels: Record<KillerSize, string> = {
  small: "Petite",
  normal: "Normale",
  big: "Grande"
};

export const conditionLabels: Record<KnownConditionType, string> = {
  in_chase: "En poursuite",
  not_in_chase: "Hors poursuite",
  carrying_survivor: "Transporte un survivant",
  after_hook: "Après avoir accroché un survivant",
  survivor_hooked: "Un survivant est accroché",
  obsession_hooked: "L’Obsession est accrochée",
  generator_completed: "Un générateur est terminé",
  near_completed_generator: "Près d’un générateur terminé",
  generator_damaged: "Un générateur vient d’être endommagé",
  bloodlust_active: "Soif de sang active",
  survivor_injured: "Un survivant est blessé",
  survivor_downed: "Un survivant est à terre",
  inside_terror_radius: "Dans le rayon de terreur",
  outside_terror_radius: "Hors du rayon de terreur",
  totem_active: "Totem actif",
  hex_active: "Maléfice actif",
  exit_gates_powered: "Portes de sortie alimentées",
  exit_gate_open: "Porte de sortie ouverte",
  after_basic_attack: "Après une attaque de base",
  after_blind: "Après avoir été aveuglé",
  after_break_action: "Après une action de destruction",
  after_fall: "Après une chute",
  after_pickup: "Après avoir ramassé un survivant",
  after_survivor_vault: "Après le franchissement d’un survivant",
  survivor_unhooked: "Après le décrochage d’un survivant",
  survivor_lost_health_state: "Après la perte d’un état de santé",
  generator_at_90_percent: "Générateur à 90 % de progression",
  skill_check_failed: "Après l’échec d’un test d’habileté",
  four_survivors_injured: "4 survivants blessés, à terre ou accrochés",
  lullaby_five_tokens: "Berceuse à 5 jetons",
  pentimento_five_tokens: "Repentir à 5 jetons",
  four_generators_completed: "4 générateurs terminés",
  target_is_obsession: "La cible est l’Obsession",
  after_killer_vault: "Après votre franchissement",
  compromised_generator_completed: "Générateur compromis terminé",
  survivor_within_32m: "Survivant à moins de 32 m",
  forever_entwined_max_tokens: "À jamais liés au maximum de jetons",
  exit_gate_progress_80: "Porte à au moins 80 %",
  perk_triggered: "Perk déclenchée"
};
