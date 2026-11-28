// A "strong pick" is a football model prediction whose favourite is at 70% or more.
// The label is shown only together with the measured record of such favourites on
// matches the model had not seen (ml-service/artifacts/football/weakness.json); with
// no measurement there is no label. It never changes a probability.
import { modelReports } from './modelReportService.js';

export const STRONG_PICK = 70; // percent; keep in step with STRONG_PICK in weakness.py
const MIN_TESTED = 50;

export const isStrongPick = ({ probA, probB, probDraw }) => Math.max(probA, probB, probDraw ?? 0) >= STRONG_PICK;

export function testedRecord(report = modelReports().weakness) {
  const s = report?.strong_picks;
  if (!s || Math.round(s.threshold * 100) !== STRONG_PICK || !(s.matches >= MIN_TESTED)) return null;
  return {
    threshold: STRONG_PICK,
    matches: s.matches,
    won: Math.round(s.observed * 100),
    share: Math.round(s.share * 100),
    from: report.cutoff,
    to: report.to,
  };
}

/** For one prediction as sent to an entitled viewer: the tested record, or null. */
export function strongPick(prediction, sportSlug, report) {
  if (sportSlug !== 'football' || prediction.source !== 'MODEL' || prediction.isDemo || !isStrongPick(prediction)) return null;
  return testedRecord(report);
}
