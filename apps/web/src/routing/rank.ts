import type { Eta } from '../eta/eta';
import { costFactors, type InfraClass, type Settings } from '../settings/settings';

const LAMBDA = 0.5;

/** Score = ETA × (1 + λ·(preference cost per meter − 1)); lower is better (SPEC §5.5). */
export function score(eta: Eta, s: Settings): number {
  const cf = costFactors(s);
  let pref = 0;
  for (const [cls, m] of Object.entries(eta.byClassM) as [InfraClass, number][]) pref += m * cf[cls];
  const perM = eta.distanceM > 0 ? pref / eta.distanceM : 1;
  return eta.totalS * (1 + LAMBDA * (perM - 1));
}

/**
 * Orders alternatives by score. Alternatives longer than the shortest by more
 * than `maxDetour` are flagged and listed after the rest.
 */
export function rankAlternatives<T extends { eta: Eta }>(alts: T[], s: Settings): (T & { overDetour: boolean })[] {
  if (alts.length === 0) return [];
  const shortest = Math.min(...alts.map((a) => a.eta.distanceM));
  const flagged = alts.map((a) => ({ ...a, overDetour: a.eta.distanceM > shortest * (1 + s.maxDetour) }));
  const ok = flagged.filter((a) => !a.overDetour).sort((a, b) => score(a.eta, s) - score(b.eta, s));
  const over = flagged.filter((a) => a.overDetour).sort((a, b) => score(a.eta, s) - score(b.eta, s));
  return [...ok, ...over];
}
