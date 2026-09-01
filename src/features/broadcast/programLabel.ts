/**
 * Default label for a phone joining a live event as an extra program. The backend
 * titles the program "<primary title> (<stream_name or program_type>)" and stores
 * `program_type` verbatim with no uniqueness, so three joining phones would all be
 * "Mobile" — the label is derived from the signed-in user and de-duplicated
 * against the programs already on the event (LIVE-008). The user can still edit it.
 * The backend keeps deciding program_type semantics (it only defaults to "Mobile").
 */
export function defaultProgramLabel(
  user: { first_name?: string | null; username?: string | null } | null | undefined,
  taken: string[],
): string {
  const who = user?.first_name?.trim() || user?.username?.trim() || 'Phone';
  const base = `Mobile · ${who}`;
  const used = new Set(taken.map((t) => t.trim().toLowerCase()));
  if (!used.has(base.toLowerCase())) return base;
  for (let n = 2; n < 100; n++) {
    const candidate = `${base} ${n}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
  return `${base} ${Date.now() % 1000}`;
}

/** Route param → labels (JSON array of strings; anything else → []). Bounded so a deep link can't stuff state. */
export function parseProgramLabels(raw: string | string[] | null | undefined): string[] {
  const s = Array.isArray(raw) ? raw[0] : raw;
  if (typeof s !== 'string' || !s) return [];
  try {
    const parsed: unknown = JSON.parse(s);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === 'string').map((x) => x.slice(0, 80)).slice(0, 50);
  } catch {
    return [];
  }
}
