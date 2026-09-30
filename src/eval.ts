import { sameValue } from "./compare";
import type { Label } from "./labels";

export type EvalRow = { file: string; status: string; vendor: string | null; date: string | null; total: number | null; flagged_fields: string[] };

export type EvalReport = {
  field: { vendor: number; date: number; total: number; n: number };
  byStatus: Record<string, { n: number; correct: number }>; // all 3 fields right
  recall: { wrong: number; flagged: number; missed: string[] }; // flagged = anything but HIGH
  signals: Record<string, { fired: number; falseFlags: number }>; // false flag = fired on an all-correct row
};

export function evaluate(rows: EvalRow[], labels: Label[]): EvalReport {
  const byFile = new Map(rows.map((r) => [r.file, r]));
  const report: EvalReport = { field: { vendor: 0, date: 0, total: 0, n: 0 }, byStatus: {}, recall: { wrong: 0, flagged: 0, missed: [] }, signals: {} };

  for (const l of labels) {
    const r = byFile.get(l.file);
    const ok = {
      vendor: !!r && sameValue(r.vendor, l.vendor),
      date: !!r && r.date === l.date,
      total: !!r && sameValue(r.total, l.total),
    };
    const correct = ok.vendor && ok.date && ok.total;
    report.field.n++;
    for (const k of ["vendor", "date", "total"] as const) if (ok[k]) report.field[k]++;

    if (r) {
      const s = (report.byStatus[r.status] ??= { n: 0, correct: 0 });
      s.n++;
      if (correct) s.correct++;
      for (const f of r.flagged_fields) {
        const sig = (report.signals[f] ??= { fired: 0, falseFlags: 0 });
        sig.fired++;
        if (correct) sig.falseFlags++;
      }
    }
    if (!correct) {
      report.recall.wrong++;
      if (r && r.status !== "HIGH") report.recall.flagged++;
      else report.recall.missed.push(l.file);
    }
  }
  return report;
}
