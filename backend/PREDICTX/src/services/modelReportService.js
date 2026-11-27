// What the ML service measured about its models, read from its artifact files, for
// the admin dashboard. Nothing is computed or estimated here. A server without the
// ML folder simply reports nothing.
import { readFileSync } from 'node:fs';

const ARTIFACTS = new URL('../../../../ml-service/artifacts/', import.meta.url);
const CRICKET = ['T20', 'ODI', 'Test'];

function read(path, base) {
  try {
    return JSON.parse(readFileSync(new URL(path, base), 'utf8'));
  } catch {
    return null;
  }
}

const metrics = (m) => (m ? { matches: m.n, accuracy: m.accuracy, logLoss: m.log_loss, rps: m.rps, brier: m.brier } : null);

export function modelReports(base = ARTIFACTS) {
  const f = read('football/report.json', base);
  return {
    football: f && {
      version: f.version,
      kind: f.kind,
      trainedAt: f.trained_at,
      dataThrough: f.data_through,
      validationFrom: f.validation_from,
      validation: metrics(f.validation?.[f.kind]),
      baseline: metrics(f.baseline_validation),
    },
    cricket: CRICKET.map((format) => {
      const r = read(`cricket/${format}/report.json`, base);
      return r && { format, version: r.version, dataThrough: r.data_through };
    }).filter(Boolean),
    weakness: read('football/weakness.json', base),
  };
}
