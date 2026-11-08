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
  "killer.missed_attack_recovery_time": fixedStat("Récupération après attaque ratée", "Poursuite", GLOBAL_MECHANICS.killer.missedAttackRecovery, "s", "duration", "lower"),
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
  "generator.skill_check_chance": fixedStat("Probabilité de test sur générateur", "Générateurs", GLOBAL_MECHANICS.generator.skillCheck.triggerChance, "%/s", "points", "neutral"),
  "generator.skill_check_failure_penalty": fixedStat("Pénalité d’échec sur générateur", "Générateurs", GLOBAL_MECHANICS.generator.skillCheck.failurePenaltyPercent, "% de progression", "points", "higher"),
  "healing.skill_check_failure_penalty": fixedStat("Pénalité d’échec pendant un soin", "Soins", GLOBAL_MECHANICS.healing.skillCheck.failurePenaltyPercent, "% de progression", "points", "higher"),
  "skill_check.warning_delay": fixedStat("Délai relatif de l’avertissement sonore", "Traque", 100, "%", "duration", "lower"),
  "generator.skill_check_good_zone": fixedStat("Zone Bon sur générateur", "Générateurs", GLOBAL_MECHANICS.generator.skillCheck.goodZone, "% du cadran", "scalar", "lower"),
  "healing.skill_check_good_zone": fixedStat("Zone Bon pendant un soin", "Soins", GLOBAL_MECHANICS.healing.skillCheck.goodZone, "% du cadran", "scalar", "lower"),
  "healing.skill_check_pointer_speed": fixedStat("Vitesse relative du pointeur de soin", "Soins", 100, "%", "scalar", "higher"),
  "healing.time": fixedStat("Soin d’un survivant", "Soins", GLOBAL_MECHANICS.healing.altruisticTime, "s", "action_speed", "higher"),
  "hook.wiggle_time": fixedStat("Temps pour se libérer", "Hook / Transport", GLOBAL_MECHANICS.hook.wiggleTime, "s", "duration", "higher"),
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
  "tracking.blood_pool_lifetime": { ...fixedStat("Durée estimée des flaques de sang", "Traque", 4, "s", "duration", "higher"), approximate: true },
  "killer.obstructed_attack_recovery_time": fixedStat("Récupération après attaque contre un obstacle", "Poursuite", 1.5, "s", "duration", "lower"),
  "killer.blind_duration": fixedStat("Durée d’aveuglement par lampe", "Poursuite", GLOBAL_MECHANICS.flashlight.blindDuration, "s", "duration", "lower"),
  "healing.skill_check_chance": fixedStat("Probabilité de test pendant un soin altruiste", "Soins", GLOBAL_MECHANICS.healing.skillCheck.altruisticChance, "%/s", "points", "neutral"),
  "healing.regression_rate": fixedStat("Régression du soin incomplet sous Hémorragie", "Soins", GLOBAL_MECHANICS.statuses.hemorrhageRegressionPercentPerSecond, "%/s", "scalar", "higher"),
  "generator.instant_regression": fixedStat("Charges retirées instantanément au générateur", "Générateurs", 0, "charges", "scalar", "higher"),
  "hook.pickup_time": { ...fixedStat("Ramassage d’un survivant (estimé)", "Hook / Transport", 3, "s", "action_speed", "lower"), approximate: true },
  "hook.drop_time": { ...fixedStat("Lâcher d’un survivant (estimé)", "Hook / Transport", 1, "s", "action_speed", "lower"), approximate: true },
  "hook.unhook_time": fixedStat("Décrochage d’un survivant", "Hook / Transport", GLOBAL_MECHANICS.hook.unhookTime, "s", "action_speed", "higher"),
  "chest.count": fixedStat("Coffres présents", "Traque", GLOBAL_MECHANICS.chest.count, "coffres", "scalar", "higher"),
  "survivor.window_vault_time": fixedStat("Saut rapide de fenêtre du survivant", "Poursuite", GLOBAL_MECHANICS.chase.survivorWindowVault.fast, "s", "action_speed", "higher"),
  "survivor.medium_vault_time": fixedStat("Saut moyen de fenêtre", "Poursuite", GLOBAL_MECHANICS.chase.survivorWindowVault.medium, "s", "action_speed", "higher"),
  "survivor.slow_vault_time": fixedStat("Saut lent de fenêtre", "Poursuite", GLOBAL_MECHANICS.chase.survivorWindowVault.slow, "s", "action_speed", "higher"),
  "survivor.pallet_vault_time": fixedStat("Saut rapide de palette", "Poursuite", GLOBAL_MECHANICS.chase.survivorPalletVault.fast, "s", "action_speed", "higher"),
  "survivor.walk_speed": fixedStat("Vitesse de marche", "Déplacement", GLOBAL_MECHANICS.survivor.walkSpeed, "m/s", "scalar", "lower"),
  "survivor.crouch_speed": fixedStat("Vitesse accroupie", "Déplacement", GLOBAL_MECHANICS.survivor.crouchSpeed, "m/s", "scalar", "lower"),
  "survivor.crawl_speed": fixedStat("Rampement initial", "Déplacement", GLOBAL_MECHANICS.survivor.crawlInitialSpeed, "m/s", "scalar", "lower"),
  "survivor.crawl_final_speed": fixedStat("Rampement après accélération", "Déplacement", GLOBAL_MECHANICS.survivor.crawlFinalSpeed, "m/s", "scalar", "lower"),
  "survivor.post_hit_sprint_time": fixedStat("Sprint après une blessure", "Déplacement", GLOBAL_MECHANICS.survivor.postHitSprintDuration, "s", "duration", "lower"),
  "survivor.stagger_time": { ...fixedStat("Titubement après une chute (estimation haute)", "Poursuite", GLOBAL_MECHANICS.survivor.staggerMaximum, "s", "duration", "higher"), approximate: true },
  "survivor.pallet_drop_recovery": { ...fixedStat("Reprise après une palette (estimée)", "Poursuite", 1, "s", "duration", "higher"), approximate: true },
  "survivor.flashlight_move_speed": fixedStat("Déplacement avec lampe allumée", "Déplacement", GLOBAL_MECHANICS.survivor.walkSpeed, "m/s", "scalar", "lower"),
  "survivor.recovery_time": fixedStat("Récupération en état critique", "Soins", GLOBAL_MECHANICS.healing.dyingRecoveryTime, "s", "action_speed", "higher"),
  "survivor.self_heal_time": fixedStat("Auto-soin sans trousse (référence 100 %)", "Soins", GLOBAL_MECHANICS.healing.altruisticTime, "s", "action_speed", "higher"),
  "survivor.healing_progress": fixedStat("Progression de soin accordée", "Soins", 0, "%", "points", "lower"),
  "survivor.exhaustion_recovery_time": { ...fixedStat("Récupération d’Épuisement (référence 40 s)", "Effets de statut", 40, "s", "action_speed", "higher"), approximate: true },
  "survivor.endurance_after_unhook": fixedStat("Endurance après décrochage", "Effets de statut", GLOBAL_MECHANICS.statuses.unhookEnduranceDuration, "s", "duration", "lower"),
  "survivor.haste_after_unhook": fixedStat("Rapidité après décrochage", "Effets de statut", GLOBAL_MECHANICS.statuses.unhookProtectionDuration, "s", "duration", "lower"),
  "survivor.self_unhook_chance": fixedStat("Chance d’auto-décrochage (si disponible)", "Hook / Transport", GLOBAL_MECHANICS.hook.selfUnhookChance, "%", "points", "lower"),
  "survivor.luck": fixedStat("Bonus de chance", "Hook / Transport", 0, "%", "points", "lower"),
  "generator.permanent_progress": fixedStat("Progression permanente du générateur", "Générateurs", 0, "charges", "scalar", "lower"),
  "generator.progress_granted": fixedStat("Progression du générateur accordée", "Générateurs", 0, "charges", "scalar", "lower"),
  "generator.required_charges": fixedStat("Charges nécessaires au générateur", "Générateurs", GLOBAL_MECHANICS.generator.charges, "charges", "scalar", "higher"),
  "generator.coop_repair_time": fixedStat("Réparation à 2 survivants (tous deux bénéficiaires)", "Générateurs", GLOBAL_MECHANICS.generator.charges / (2 * GLOBAL_MECHANICS.generator.repairRate * (1 - GLOBAL_MECHANICS.generator.additionalSurvivorEfficiencyPenalty / 100)), "s", "action_speed", "higher"),
  "generator.personal_coop_rate": fixedStat("Votre contribution à 2 réparateurs", "Générateurs", GLOBAL_MECHANICS.generator.repairRate * (1 - GLOBAL_MECHANICS.generator.additionalSurvivorEfficiencyPenalty / 100), "charges/s", "scalar", "lower"),
  "generator.great_skill_check_progress": fixedStat("Progression d’un excellent test de réparation", "Générateurs", GLOBAL_MECHANICS.generator.skillCheck.greatProgressPercent, "%", "points", "lower"),
  "generator.skill_check_pointer_speed": fixedStat("Vitesse relative du pointeur de réparation", "Générateurs", 100, "%", "scalar", "higher"),
  "healing.great_skill_check_progress": fixedStat("Progression d’un excellent test de soin", "Soins", GLOBAL_MECHANICS.healing.skillCheck.greatProgressPercent, "%", "points", "lower"),
  "chest.open_time": fixedStat("Déverrouillage d’un coffre", "Traque", GLOBAL_MECHANICS.chest.openTime, "s", "action_speed", "higher"),
  "chest.noise_range": fixedStat("Portée sonore de l’ouverture d’un coffre", "Traque", GLOBAL_MECHANICS.chest.soundRange, "m", "scalar", "higher"),
  "ally.run_speed": fixedStat("Vitesse de course du bénéficiaire allié", "Déplacement", GLOBAL_MECHANICS.survivor.runSpeed, "m/s", "scalar", "lower"),
  "ally.healing_time": fixedStat("Soin effectué par l’allié bénéficiaire", "Soins", GLOBAL_MECHANICS.healing.altruisticTime, "s", "action_speed", "higher"),
  "ally.repair_time": fixedStat("Réparation solo par l’allié bénéficiaire", "Générateurs", GLOBAL_MECHANICS.generator.soloRepairTime, "s", "action_speed", "higher"),
  "ally.unhook_time": fixedStat("Décrochage effectué par l’allié", "Hook / Transport", GLOBAL_MECHANICS.hook.unhookTime, "s", "action_speed", "higher"),
  "ally.gate_open_time": fixedStat("Ouverture de porte par l’allié", "Portes", GLOBAL_MECHANICS.exit.survivorGateOpenTime, "s", "action_speed", "higher"),
  "ally.sabotage_time": fixedStat("Sabotage par l’allié", "Hook / Transport", GLOBAL_MECHANICS.hook.sabotageTime, "s", "action_speed", "higher"),
  "ally.chest_open_time": fixedStat("Déverrouillage d’un coffre par l’allié", "Traque", GLOBAL_MECHANICS.chest.openTime, "s", "action_speed", "higher"),
  "ally.totem_cleanse_time": fixedStat("Purification d’un totem par l’allié", "Totems", GLOBAL_MECHANICS.totem.dullCleanseTime, "s", "action_speed", "higher"),
  "ally.totem_bless_time": fixedStat("Bénédiction passive par l’allié", "Totems", GLOBAL_MECHANICS.totem.dullBlessTime, "s", "action_speed", "higher"),
  "ally.healing_progress_charges": fixedStat("Charges de soin permanentes pour l’allié", "Soins", 0, "charges", "scalar", "lower"),
  "opponent.speed": { ...fixedStat("Vitesse du tueur adverse (base supposée 4,6)", "Poursuite", 4.6, "m/s", "scalar", "higher"), approximate: true },
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
