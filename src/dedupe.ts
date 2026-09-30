import { createHash } from "node:crypto";

// Exact byte duplicates: maps each later copy (in sorted file order) to the first.
export function findDuplicates(files: { file: string; bytes: Buffer }[]): Map<string, string> {
  const first = new Map<string, string>();
  const dupes = new Map<string, string>();
  for (const { file, bytes } of [...files].sort((x, y) => x.file.localeCompare(y.file))) {
    const hash = createHash("sha256").update(bytes).digest("hex");
    const seen = first.get(hash);
    if (seen) dupes.set(file, seen);
    else first.set(hash, file);
  }
  return dupes;
}
