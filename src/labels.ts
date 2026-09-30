import { readFileSync } from "node:fs";

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') cell += '"', i++;
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") row.push(cell), (cell = "");
    else if (c === "\n") row.push(cell), rows.push(row), (row = []), (cell = "");
    else if (c !== "\r") cell += c;
  }
  if (cell || row.length) row.push(cell), rows.push(row);
  return rows;
}

export type Label = { file: string; vendor: string; date: string; total: number; set: string; notes: string };

export function loadLabels(path = "labels/labels.csv"): Label[] {
  const [header, ...rows] = parseCsv(readFileSync(path, "utf8"));
  return rows.map((r) => {
    const o = Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""]));
    return { ...o, total: Number(o.total) } as Label;
  });
}
