import { useState } from "react";

import { killerPropertyIconUrl } from "../../app/assets.js";
import type { Perk } from "../../domain/perk.js";
import type {
  BuildCalculation,
  CalculatedStat,
  EffectCalculation
} from "../../services/build-calculator.js";
import { conditionLabel } from "./BuildConditions.js";

interface BuildAnalyzerProps {
  calculation: BuildCalculation;
  perks: readonly Perk[];
}

const propertyIcons: Readonly<Record<string, string | null>> = {
  "killer.speed": killerPropertyIconUrl("speed.png"),
  "killer.terror_radius": killerPropertyIconUrl("terror_rayon.png")
};

export function BuildAnalyzer({ calculation, perks }: BuildAnalyzerProps) {
  const [view, setView] = useState<"list" | "chart">("list");
  const unavailablePerks = perks.filter((perk) => perk.effects.length === 0);
  const hasPartialData = calculation.unresolvedEffects.length > 0
    || unavailablePerks.length > 0
    || perks.some((perk) => perk.effects.some((effect) => effect.interpretation === "inferred"));

  return (
    <section className="analyzer-panel impact-analysis" aria-labelledby="build-analyzer-title">
      <h2 className="sr-only" id="build-analyzer-title">Impact Analysis</h2>
      <div className="impact-tabs-row">
        <div className="impact-tabs" role="tablist" aria-label="Affichage de l’analyse">
          <button type="button" role="tab" aria-selected={view === "list"} onClick={() => setView("list")}>Liste</button>
          <button type="button" role="tab" aria-selected={view === "chart"} onClick={() => setView("chart")}>Graphique</button>
        </div>
        <span className={`analysis-state${hasPartialData ? " partial" : ""}`}>
          {hasPartialData ? "Analyse partielle" : "Données vérifiées"}
        </span>
      </div>

      {perks.length === 0 ? (
        <p className="panel-empty impact-empty">Ajoutez une perk pour afficher son impact réel.</p>
      ) : (
        <>
          {view === "list" ? (
            <div className="impact-table" role="table" aria-label="Statistiques affectées par le build sous forme de liste">
              <div className="impact-table-head" role="row">
                <span role="columnheader">Statistic</span>
                <span role="columnheader">Base Value</span>
                <span aria-hidden="true" />
                <span role="columnheader">Modified Value</span>
                <span role="columnheader">Delta</span>
              </div>
              {calculation.affectedStats.map((stat) => <StatRow stat={stat} key={stat.key} />)}
            </div>
          ) : <ImpactChart stats={calculation.affectedStats} />}

          {calculation.affectedStats.length === 0 && calculation.qualitativeEffects.length === 0 && (
            <p className="panel-empty impact-empty">Aucune référence fiable n’est affectée dans ce scénario.</p>
          )}

          {calculation.qualitativeEffects.length > 0 && (
            <div className="qualitative-impact-list" aria-label="Effets non numériques">
              {calculation.qualitativeEffects.map((effect, index) => (
                <QualitativeRow effect={effect} key={`${effect.perkId}-${effect.stat}-${index}`} />
              ))}
            </div>
          )}

          {(calculation.unresolvedEffects.length > 0 || unavailablePerks.length > 0) && (
            <details className="analysis-warning">
              <summary>{calculation.unresolvedEffects.length + unavailablePerks.length} effet(s) non calculable(s)</summary>
              <ul>
                {unavailablePerks.map((perk) => (
                  <li key={`missing-${perk.id}`}><strong>{perk.name.fr ?? perk.id}</strong> : aucun effet structuré.</li>
                ))}
                {calculation.unresolvedEffects.map((effect, index) => (
                  <li key={`${effect.perkId}-${effect.stat}-${index}`}>
                    <strong>{effect.perkName}</strong> — {effect.statLabel} : {readableReason(effect.reasons.at(-1) ?? "Donnée insuffisante")}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </section>
  );
}

function ImpactChart({ stats }: { stats: readonly CalculatedStat[] }) {
  return (
    <div className="impact-chart" role="tabpanel" aria-label="Statistiques affectées par le build sous forme de graphique">
      {stats.map((stat) => {
        const maximum = Math.max(Math.abs(stat.base), Math.abs(stat.final), 1);
        return (
          <article className="impact-chart-row" key={stat.key}>
            <header>
              <span className="stat-identity"><StatIcon stat={stat} /><span><strong>{stat.label}</strong><small>{stat.theme}</small></span></span>
              <strong className={stat.delta === 0 || stat.benefit === null ? "neutral" : stat.benefit > 0 ? "positive" : "negative"}>{deltaPrimary(stat, false)}</strong>
            </header>
            <ChartBar label="Base" value={stat.base} unit={stat.unit} maximum={maximum} />
            <ChartBar label="Modifiée" value={stat.final} unit={stat.unit} maximum={maximum} modified />
          </article>
        );
      })}
    </div>
  );
}

function ChartBar({ label, value, unit, maximum, modified = false }: { label: string; value: number; unit: string; maximum: number; modified?: boolean }) {
  return (
    <div className={`impact-chart-bar${modified ? " modified" : ""}`}>
      <span>{label}</span>
      <span className="impact-chart-track"><span style={{ width: `${Math.max(4, Math.abs(value) / maximum * 100)}%` }} /></span>
      <strong>{formatValue(value, unit)}</strong>
    </div>
  );
}

function StatRow({ stat }: { stat: CalculatedStat }) {
  const activeEffects = stat.effects.filter((effect) => effect.status === "active");
  const inactiveEffects = stat.effects.filter((effect) => effect.status === "inactive" || effect.status === "cooldown");
  const conditional = stat.effects.some((effect) => effect.reasons.some((reason) => reason.startsWith("Condition")));
  const tone = stat.delta === 0 ? conditional ? "conditional" : "neutral"
    : stat.benefit !== null && stat.benefit > 0 ? "positive"
      : stat.benefit !== null && stat.benefit < 0 ? "negative" : "neutral";

  return (
    <details className={`stat-impact-row ${tone}`} role="row">
      <summary>
        <span className="stat-identity" role="cell">
          <StatIcon stat={stat} />
          <span>
            <strong>{stat.label}</strong>
            <small>{stat.theme}{conditional ? " · Conditionnel" : ""}</small>
          </span>
        </span>
        <span className="impact-value base" role="cell">{stat.approximate ? "≈ " : ""}{formatValue(stat.base, stat.unit)}</span>
        <span className="impact-arrow" aria-hidden="true">→</span>
        <span className="impact-value modified" role="cell">{formatValue(stat.final, stat.unit)}</span>
        <span className={`impact-delta ${tone}`} role="cell">
          <strong>{deltaPrimary(stat, conditional)}</strong>
          <small>{deltaSecondary(stat)}</small>
        </span>
      </summary>
      <div className="stat-row-details">
        {activeEffects.map((effect, index) => (
          <div className="effect-explanation" key={`${effect.perkId}-active-${index}`}>
            <div><strong>{effect.perkName}</strong><span className="status-badge active">Actif</span></div>
            <p>{effectLabel(effect, stat)}</p>
            <code>{effectFormula(effect, stat)}</code>
            {effect.reasons.filter((reason) => reason.startsWith("Condition")).map((reason) => (
              <small key={reason}>{readableReason(reason)}</small>
            ))}
          </div>
        ))}
        {inactiveEffects.map((effect, index) => (
          <div className="effect-explanation inactive" key={`${effect.perkId}-inactive-${index}`}>
            <div><strong>{effect.perkName}</strong><span className="status-badge conditional">{effect.status === "cooldown" ? "Cooldown" : "Inactif"}</span></div>
            <small>{effect.reasons.map(readableReason).join(" · ")}</small>
          </div>
        ))}
      </div>
    </details>
  );
}

function QualitativeRow({ effect }: { effect: EffectCalculation }) {
  const active = effect.status === "active";
  return (
    <article className={`qualitative-impact-row ${effect.status}`}>
      <span className="qualitative-symbol" aria-hidden="true">◇</span>
      <span>
        <strong>{effect.statLabel}</strong>
        <small>{effect.perkName} · {qualitativeLabel(effect)}</small>
      </span>
      <span className={`status-badge ${active ? "active" : "conditional"}`}>
        {active ? "Actif" : effect.status === "cooldown" ? "Cooldown" : "Inactif"}
      </span>
    </article>
  );
}

function StatIcon({ stat }: { stat: CalculatedStat }) {
  const icon = propertyIcons[stat.key];
  if (icon) return <span className="stat-row-icon"><img src={icon} alt="" /></span>;
  return <span className="stat-row-icon fallback" aria-hidden="true">{themeSymbol(stat.theme)}</span>;
}

function themeSymbol(theme: string): string {
  if (theme === "Générateurs") return "G";
  if (theme === "Poursuite") return "P";
  if (theme === "Soins") return "+";
  if (theme === "Hook / Transport") return "H";
  if (theme === "Totems") return "T";
  if (theme === "Portes") return "E";
  return "◈";
}

function deltaPrimary(stat: CalculatedStat, conditional: boolean): string {
  if (stat.delta === 0) return conditional ? "Inactive" : "—";
  if (stat.mode === "points") return `${signed(stat.delta)} pts`;
  if (stat.deltaPercent !== null) return `${signed(stat.deltaPercent)} %`;
  return `${signed(stat.delta)} ${stat.unit}`;
}

function deltaSecondary(stat: CalculatedStat): string {
  if (stat.delta === 0) return "Valeur de base";
  const amount = `${formatNumber(Math.abs(stat.delta))} ${stat.unit}`;
  if (stat.benefit === null) return amount;
  return stat.benefit > 0 ? `${amount} gagné` : `${amount} perdu`;
}

function effectLabel(effect: EffectCalculation, stat: CalculatedStat): string {
  const confidence = effect.interpretation === "inferred" ? " · donnée inférée" : "";
  if (effect.operation === "set") return `Remplacement par ${formatValue(Number(effect.value), stat.unit)}${confidence}`;
  if (effect.operation === "add") {
    const suffix = effect.unit === "percentage_points" ? " points" : ` ${stat.unit}`;
    return `${signed(Number(effect.value))}${suffix}${confidence}`;
  }
  const percent = (multiplier(effect) - 1) * 100;
  const mode = effect.calculationMode ?? stat.mode;
  const kind = mode === "action_speed" ? "vitesse d’action" : mode === "duration" ? "durée" : "valeur";
  return `${signed(percent)} % ${kind}${confidence}`;
}

function effectFormula(effect: EffectCalculation, stat: CalculatedStat): string {
  const before = formatNumber(effect.before ?? stat.base);
  const after = formatNumber(effect.after ?? stat.final);
  if (effect.operation === "multiply") {
    const factor = formatNumber(multiplier(effect));
    return (effect.calculationMode ?? stat.mode) === "action_speed" ? `${before} ÷ ${factor} = ${after}` : `${before} × ${factor} = ${after}`;
  }
  if (effect.operation === "add") return `${before} ${Number(effect.value) >= 0 ? "+" : "−"} ${formatNumber(Math.abs(Number(effect.value)))} = ${after}`;
  return `${before} → ${after}`;
}

function qualitativeLabel(effect: EffectCalculation): string {
  const duration = effect.duration == null ? "" : ` pendant ${formatNumber(effect.duration)} s`;
  if (effect.operation === "block") return `blocage${duration}`;
  if (effect.operation === "reveal") return `révélation${duration}`;
  if (effect.operation === "apply_status") return `statut appliqué${duration}`;
  return effect.operation;
}

function readableReason(reason: string): string {
  return reason.replace(/(Condition (?:remplie|manquante) : )([a-z0-9_]+)/g, (_, prefix: string, condition: string) => `${prefix}${conditionLabel(condition)}`);
}

function multiplier(effect: EffectCalculation): number {
  return effect.unit === "percent" ? 1 + Number(effect.value) / 100 : Number(effect.value);
}

function formatValue(value: number, unit: string): string {
  return `${formatNumber(value)} ${unit}`;
}

function signed(value: number): string {
  const rounded = formatNumber(value);
  return value > 0 ? `+${rounded}` : rounded;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("fr", { maximumFractionDigits: 3 }).format(value);
}
