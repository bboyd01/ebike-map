import type { Eta } from '../eta/eta';
import { costFactors, type InfraClass, type Settings } from '../settings/settings';

const LAMBDA = 0.5;

/**
 * Score = ETA, nudged by the drag-to-rank tie-breaker and by distance on busy roads with
 * no bike lane (the same safety penalty routing uses); lower is better (SPEC §19).
 */
export function score(eta: Eta, s: Settings): number {
  const tie = costFactors(s);
  let pref = 0;
  for (const [cls, m] of Object.entries(eta.byClassM) as [InfraClass, number][]) pref += m * tie[cls];
  const tiePerM = eta.distanceM > 0 ? pref / eta.distanceM : 1;
  const busyShare = eta.distanceM > 0 ? eta.byClassM.arterial / eta.distanceM : 0;
  return eta.totalS * (1 + LAMBDA * (tiePerM - 1)) * (1 + busyShare * (s.busyRoadPenalty - 1));
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
