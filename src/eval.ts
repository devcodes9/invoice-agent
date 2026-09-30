import { sameValue } from "./compare";
import type { Label } from "./labels";

export type EvalRow = { file: string; status: string; vendor: string | null; date: string | null; total: number | null; flagged_fields: string[] };

type Outcome = { right: number; empty: number; wrong: number };
export type EvalReport = {
  n: number;
  field: { vendor: Outcome; date: Outcome; total: Outcome }; // wrong = filled (trusted) but not the label
  byStatus: Record<string, { n: number; wrong: number }>; // rows with any filled-but-wrong key field
  recall: { wrong: number; flagged: number; missed: string[] }; // flagged = anything but HIGH
  signals: Record<string, number>; // how often each flagged field fired on labelled rows
};

const FIELDS = ["vendor", "date", "total"] as const;

export function evaluate(rows: EvalRow[], labels: Label[]): EvalReport {
  const byFile = new Map(rows.map((r) => [r.file, r]));
  const report: EvalReport = {
    n: 0,
    field: { vendor: { right: 0, empty: 0, wrong: 0 }, date: { right: 0, empty: 0, wrong: 0 }, total: { right: 0, empty: 0, wrong: 0 } },
    byStatus: {},
    recall: { wrong: 0, flagged: 0, missed: [] },
    signals: {},
  };

  for (const l of labels) {
    report.n++;
    const r = byFile.get(l.file);
    let rowWrong = false;
    for (const f of FIELDS) {
      const v = r?.[f] ?? null;
      if (v === null) report.field[f].empty++;
      else if (f === "date" ? v === l.date : sameValue(v, l[f])) report.field[f].right++;
      else (report.field[f].wrong++, (rowWrong = true));
    }
    if (!r) continue;
    const s = (report.byStatus[r.status] ??= { n: 0, wrong: 0 });
    s.n++;
    if (rowWrong) s.wrong++;
    for (const f of r.flagged_fields) report.signals[f] = (report.signals[f] ?? 0) + 1;
    if (rowWrong) {
      report.recall.wrong++;
      if (r.status !== "HIGH") report.recall.flagged++;
      else report.recall.missed.push(l.file);
    }
  }
  return report;
}
