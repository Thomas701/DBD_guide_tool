export const GLOBAL_MECHANICS = {
  survivor: {
    runSpeed: 4,
    walkSpeed: 2.26,
    crouchSpeed: 1.13,
    crawlInitialSpeed: 0.7,
    crawlFinalSpeed: 1.05,
    postHitSprintSpeed: 6.6,
    postHitSprintDuration: 1.8,
    acceleration: 10,
    staggerMinimum: 0.5,
    staggerMaximum: 2
  },
  killer: {
    carrySpeed: 3.68,
    lungeRangeApproximate: 6,
    successfulAttackRecovery: 2.7,
    missedAttackRecovery: 1.5,
    obstacleAttackRecovery: 1.5,
    bloodlust: [
      { after: 15, bonus: 0.2 },
      { after: 25, bonus: 0.4 },
      { after: 35, bonus: 0.6 }
    ]
  },
  generator: {
    count: 7,
    required: 5,
    charges: 90,
    repairRate: 1,
    soloRepairTime: 90,
    repairTimes: { two: 52.94, three: 42.86, four: 40.91 },
    additionalSurvivorEfficiencyPenalty: 15,
    damageTime: 1.8,
    damagePenaltyPercent: 5,
    regressionRate: 0.25,
    regressionEventLimit: 8,
    skillCheck: {
      triggerChance: 8,
      toolboxTriggerChance: 40,
      greatZone: 3,
      goodZone: 13,
      duration: 1.1,
      greatProgressPercent: 1,
      failurePenaltyPercent: 10,
      failureLockDuration: 3
    }
  },
  healing: {
    charges: 16,
    rate: 1,
    altruisticTime: 16,
    medkitSelfCareTime: 24,
    dyingRecoveryTime: 30.4,
    bleedoutTime: 240,
    selfMendTime: 10,
    altruisticMendTime: 6,
    deepWoundDuration: 20,
    skillCheck: {
      altruisticChance: 15,
      medkitSelfCareChance: 12.5,
      perkSelfCareChance: 10.5,
      greatZone: 3,
      goodZone: 15,
      greatProgressPercent: 3,
      failurePenaltyPercent: 10,
      failureLockDuration: 3
    }
  },
  statuses: {
    mangledHealingSpeedMultiplier: 0.8,
    hemorrhageRegressionPercentPerSecond: 7,
    defaultHinderedSpeedMultiplier: 0.97,
    unhookProtectionDuration: 10,
    unhookHastePercent: 10,
    unhookEnduranceDuration: 10,
    unhookElusiveDuration: 10
  },
  hook: {
    carrySpeed: 3.68,
    wiggleTime: 16,
    wiggleCharges: 16,
    dropWiggleProgressPercent: 25,
    hookTime: 1.5,
    unhookTime: 1,
    selfUnhookAttemptTime: 1.5,
    selfUnhookChance: 4,
    phaseDuration: 70,
    totalDuration: 140,
    sabotageTime: 3,
    sabotageCharges: 6,
    sabotagedRespawnTime: 30,
    sacrificedRespawnTime: 60,
    safeUnhookWindow: 15
  },
  chase: {
    survivorWindowVault: { fast: 0.5, medium: 0.9, slow: 1.5 },
    survivorPalletVault: { fast: 1.1, slow: 2 },
    killerWindowVaultTime: 1.7,
    palletBreakTime: 2.34,
    wallBreakTime: 2.34,
    palletStunDuration: 2
  },
  totem: {
    dullCleanseTime: 14,
    hexCleanseTime: 14,
    dullBlessTime: 14,
    hexBlessTime: 28,
    boonSnuffTime: 1,
    count: 5
  },
  flashlight: {
    range: 10,
    blindTime: 1,
    blindDuration: 2,
    beamAngle: 20,
    standardCharges: 8,
    utilityCharges: 12
  },
  chest: { openTime: 8, charges: 8, count: 3, soundRange: 20 },
  item: { pickupTime: 1, dropTime: 1 },
  exit: {
    survivorGateOpenTime: 20,
    killerGateOpenTime: 0.75,
    hatchKeyOpenTime: 2.5,
    collapseDuration: 120,
    slowedCollapseDuration: 240
  },
  tracking: {
    scratchMarkLifetime: 10,
    scratchMarkPeakTime: 1,
    scratchMarkPeakDuration: 8,
    scratchMarkFadeTime: 1,
    crowReturnTime: 15,
    bloodPoolLifetime: null
  },
  locker: { killerSearchTime: 2.333 },
  medkits: {
    charges: 24,
    allyHealingSpeedBonuses: { camping: 35, firstAid: 40, emergency: 45, ranger: 50 },
    selfCareSpeedMultiplier: 2 / 3
  },
  toolboxes: {
    wornOut: { charges: 16, repairBonus: 50, sabotageBonus: 0 },
    toolbox: { charges: 20, repairBonus: 50, sabotageBonus: 15 },
    commodious: { charges: 32, repairBonus: 50, sabotageBonus: 50 },
    mechanics: { charges: 16, repairBonus: 75, sabotageBonus: 25 },
    engineers: { charges: 16, repairBonus: 100, sabotageBonus: 10 },
    alexs: { charges: 18, repairBonus: 10, sabotageBonus: 100 }
  }
} as const;

export const ANALYSIS_THEMES = [
  "Déplacement",
  "Poursuite",
  "Générateurs",
  "Soins",
  "Hook / Transport",
  "Totems",
  "Traque",
  "Portes",
  "Effets de statut"
] as const;

export type AnalysisTheme = (typeof ANALYSIS_THEMES)[number];
export type StatCalculationMode = "action_speed" | "scalar" | "duration" | "points";

export interface AnalyzableStatDefinition {
  label: string;
  theme: AnalysisTheme;
  base: number | null;
  baseFromKiller?: "speed" | "terrorRadius";
  unit: string;
  mode: StatCalculationMode;
  benefit: "higher" | "lower" | "neutral";
  approximate?: boolean;
  unknownReason?: string;
}

export const ANALYZABLE_STATS = {
  "killer.speed": dynamicStat("Vitesse du tueur", "Déplacement", "speed", "m/s", "scalar", "higher"),
  "killer.terror_radius": dynamicStat("Rayon de terreur", "Traque", "terrorRadius", "m", "scalar", "neutral"),
  "killer.carry_speed": fixedStat("Vitesse de transport", "Hook / Transport", GLOBAL_MECHANICS.killer.carrySpeed, "m/s", "scalar", "higher"),
  "survivor.run_speed": fixedStat("Vitesse de course des survivants", "Déplacement", GLOBAL_MECHANICS.survivor.runSpeed, "m/s", "scalar", "lower"),
  "killer.lunge_range": { ...fixedStat("Portée de la fente", "Poursuite", GLOBAL_MECHANICS.killer.lungeRangeApproximate, "m", "scalar", "higher"), approximate: true },
  "killer.missed_attack_recovery_time": fixedStat("Récupération après attaque ratée", "Poursuite", GLOBAL_MECHANICS.killer.missedAttackRecovery, "s", "action_speed", "lower"),
  "killer.successful_attack_recovery_time": fixedStat("Récupération après attaque réussie", "Poursuite", GLOBAL_MECHANICS.killer.successfulAttackRecovery, "s", "duration", "lower"),
  "killer.pallet_stun_duration": fixedStat("Étourdissement par palette", "Poursuite", GLOBAL_MECHANICS.chase.palletStunDuration, "s", "duration", "lower"),
  "killer.window_vault_time": fixedStat("Franchissement d’une fenêtre", "Poursuite", GLOBAL_MECHANICS.chase.killerWindowVaultTime, "s", "action_speed", "lower"),
  "killer.pallet_break_time": fixedStat("Destruction d’une palette", "Poursuite", GLOBAL_MECHANICS.chase.palletBreakTime, "s", "action_speed", "lower"),
  "killer.wall_break_time": fixedStat("Destruction d’un mur cassable", "Poursuite", GLOBAL_MECHANICS.chase.wallBreakTime, "s", "action_speed", "lower"),
  "generator.damage_time": fixedStat("Endommagement d’un générateur", "Générateurs", GLOBAL_MECHANICS.generator.damageTime, "s", "action_speed", "lower"),
  "generator.repair_time": fixedStat("Réparation d’un générateur (1 survivant)", "Générateurs", GLOBAL_MECHANICS.generator.soloRepairTime, "s", "action_speed", "higher"),
  "generator.regression_rate": fixedStat("Régression passive d’un générateur", "Générateurs", GLOBAL_MECHANICS.generator.regressionRate, "charges/s", "scalar", "higher"),
  "generator.damage_penalty": fixedStat("Régression immédiate après kick", "Générateurs", GLOBAL_MECHANICS.generator.damagePenaltyPercent, "%", "points", "higher"),
  "generator.progress": fixedStat("Progression ciblée (référence complète)", "Générateurs", GLOBAL_MECHANICS.generator.charges, "charges", "scalar", "lower"),
  "generator.skill_check_chance": fixedStat("Probabilité de test sur générateur", "Générateurs", GLOBAL_MECHANICS.generator.skillCheck.triggerChance, "%/s", "points", "higher"),
  "generator.skill_check_failure_penalty": fixedStat("Pénalité d’échec sur générateur", "Générateurs", GLOBAL_MECHANICS.generator.skillCheck.failurePenaltyPercent, "% de progression", "points", "higher"),
  "healing.skill_check_failure_penalty": fixedStat("Pénalité d’échec pendant un soin", "Soins", GLOBAL_MECHANICS.healing.skillCheck.failurePenaltyPercent, "% de progression", "points", "higher"),
  "skill_check.warning_delay": fixedStat("Délai relatif de l’avertissement sonore", "Traque", 100, "%", "duration", "lower"),
  "generator.skill_check_good_zone": fixedStat("Zone Bon sur générateur", "Générateurs", GLOBAL_MECHANICS.generator.skillCheck.goodZone, "% du cadran", "scalar", "lower"),
  "healing.skill_check_good_zone": fixedStat("Zone Bon pendant un soin", "Soins", GLOBAL_MECHANICS.healing.skillCheck.goodZone, "% du cadran", "scalar", "lower"),
  "healing.skill_check_pointer_speed": fixedStat("Vitesse relative du pointeur de soin", "Soins", 100, "%", "scalar", "higher"),
  "healing.time": fixedStat("Soin d’un survivant", "Soins", GLOBAL_MECHANICS.healing.altruisticTime, "s", "action_speed", "higher"),
  "hook.wiggle_time": fixedStat("Temps pour se libérer", "Hook / Transport", GLOBAL_MECHANICS.hook.wiggleTime, "s", "action_speed", "higher"),
  "hook.wiggle_strength": fixedStat("Intensité du gigotement", "Hook / Transport", 100, "%", "scalar", "lower"),
  "hook.hook_time": fixedStat("Accrochage d’un survivant", "Hook / Transport", GLOBAL_MECHANICS.hook.hookTime, "s", "action_speed", "lower"),
  "hook.sabotage_time": fixedStat("Sabotage d’un crochet", "Hook / Transport", GLOBAL_MECHANICS.hook.sabotageTime, "s", "action_speed", "higher"),
  "hook.phase_duration": fixedStat("Durée d’une phase de crochet", "Hook / Transport", GLOBAL_MECHANICS.hook.phaseDuration, "s", "action_speed", "lower"),
  "locker.search_time": fixedStat("Fouille d’un casier vide", "Traque", GLOBAL_MECHANICS.locker.killerSearchTime, "s", "action_speed", "lower"),
  "sound.grunt_volume": fixedStat("Volume relatif des gémissements", "Traque", 100, "%", "scalar", "higher"),
  "sound.breathing_volume": fixedStat("Volume relatif de la respiration", "Traque", 100, "%", "scalar", "higher"),
  "exit_gate.open_time": fixedStat("Ouverture d’une porte de sortie", "Portes", GLOBAL_MECHANICS.exit.survivorGateOpenTime, "s", "duration", "higher"),
  "exit_gate.regression_rate": fixedStat("Régression relative d’une porte", "Portes", 0, "% vitesse d’ouverture", "scalar", "higher"),
  "totem.dull_cleanse_time": fixedStat("Purification d’un totem passif", "Totems", GLOBAL_MECHANICS.totem.dullCleanseTime, "s", "action_speed", "higher"),
  "totem.hex_cleanse_time": fixedStat("Purification d’un totem ensorcelé", "Totems", GLOBAL_MECHANICS.totem.hexCleanseTime, "s", "action_speed", "higher"),
  "totem.dull_bless_time": fixedStat("Bénédiction d’un totem passif", "Totems", GLOBAL_MECHANICS.totem.dullBlessTime, "s", "action_speed", "higher"),
  "totem.hex_bless_time": fixedStat("Bénédiction d’un totem ensorcelé", "Totems", GLOBAL_MECHANICS.totem.hexBlessTime, "s", "action_speed", "higher"),
  "tracking.scratch_mark_lifetime": fixedStat("Durée des marques de griffures", "Traque", GLOBAL_MECHANICS.tracking.scratchMarkLifetime, "s", "duration", "higher"),
  "tracking.blood_pool_lifetime": {
    ...fixedStat("Durée des flaques de sang", "Traque", null, "s", "duration", "higher"),
    unknownReason: "Valeur de base non vérifiée dans statistiques_fixe.txt"
  }
} as const satisfies Record<string, AnalyzableStatDefinition>;

export type AnalyzableStatKey = keyof typeof ANALYZABLE_STATS;

function fixedStat(
  label: string,
  theme: AnalysisTheme,
  base: number | null,
  unit: string,
  mode: StatCalculationMode,
  benefit: AnalyzableStatDefinition["benefit"]
): AnalyzableStatDefinition {
  return { label, theme, base, unit, mode, benefit };
}

function dynamicStat(
  label: string,
  theme: AnalysisTheme,
  baseFromKiller: "speed" | "terrorRadius",
  unit: string,
  mode: StatCalculationMode,
  benefit: AnalyzableStatDefinition["benefit"]
): AnalyzableStatDefinition {
  return { label, theme, base: null, baseFromKiller, unit, mode, benefit };
}
