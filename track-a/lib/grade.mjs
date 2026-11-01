// Deterministic graders. No LLM, no fuzzy scoring: plain substring / regex checks over the
// exact text an arm put in front of the agent ("view"). Every rule is listed here and
// referenced by id from scenarios/*.yaml so Track B and third parties can reuse it.

export const CHANGE_MARKER = /(retract|supersed|changed|stale|replaced|outdated|no longer|\[-|→|->|STALE_SOURCE|SUPERSEDED)/i;
export const CONFLICT_MARKER = /(contradict|conflict|disagree|inconsistent|mismatch)/i;
export const REMOVAL_MARKER = /(tombston|removed|deleted|retired|archived|TOMBSTONED)/i;
export const ALARM_MARKER = /(changed on disk|retraction|reconcile before|supersed|tombston|removed from|STALE_SOURCE|changed:|removed:|\[-.*?-\]|\{\+)/i;
export const TAMPER_MARKER = /(tamper|integrity|hash.?mismatch|UNVERIFIED|withheld|projection_mismatch|content_tampered|corrupt)/i;
export const TRUST_MARKER = /(unverified|untrusted|contradict|conflict|inspect_only|never_act|low.trust|provenance)/i;
export const SECRET_WARN = /(secret|credential|redact|sensitive|api key detected|token detected)/i;

// Strip "nothing happened" boilerplate so negative fields (e.g. `"superseded_by": null`,
// `Retractions: none`, `stale_write_advisory`) never count as a signal. Applied before every check.
const NEGATIVE = [
  /"(superseded_by|successor_block_id|tombstone_reason|stale_source|integrity_problem|problem|cursor_error|tombstoned_at|superseded_at)"\s*:\s*(null|false|"")/g,
  /"(retractions|withheld|source_drift|conflicts|demoted_by_budget)"\s*:\s*\[\]/g,
  /"stale_write_advisory"\s*:\s*\{[^{}]*\}/g,
  /Retractions: none/gi, /\b0 (superseded|tombstoned|removed|conflicts?)\b/gi, /"hidden_retractions"\s*:\s*0/g,
  /"include_tombstoned"\s*:\s*false/g, /"(searched|not_searched)"\s*:\s*\[[^\]]*\]/g, /"reason"\s*:\s*"[^"]*not searched[^"]*"/g, /"status"\s*:\s*"live"/g,
];
export function clean(v) { if (!v) return ''; let t = typeof v === 'string' ? v : v.text ?? ''; for (const re of NEGATIVE) t = t.replace(re, ''); return t; }
export const alarm = (v) => ALARM_MARKER.test(clean(v));

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const has = (view, s) => !!view && clean(view).includes(s);

// true when `needle` occurs and `marker` matches within `win` chars on either side of it.
export function near(view, needle, marker, win = 240) {
  view = clean(view);
  if (!view) return false;
  let i = view.indexOf(needle);
  while (i >= 0) {
    const a = Math.max(0, i - win), b = Math.min(view.length, i + needle.length + win);
    if (marker.test(view.slice(a, b))) return true;
    i = view.indexOf(needle, i + 1);
  }
  return false;
}
// An explicit old→new change record: both values present and a change marker near the old one.
export function markedChange(view, oldV, newV) {
  return has(view, oldV) && has(view, newV) && near(view, oldV, CHANGE_MARKER);
}
// Old value shown with no change marker anywhere near it (what drives stale actions).
export function staleUnmarked(view, oldV) {
  view = clean(view);
  if (!view.includes(oldV)) return false;
  let i = view.indexOf(oldV);
  while (i >= 0) {
    const a = Math.max(0, i - 240), b = Math.min(view.length, i + oldV.length + 240);
    if (!CHANGE_MARKER.test(view.slice(a, b)) && !REMOVAL_MARKER.test(view.slice(a, b))) return true;
    i = view.indexOf(oldV, i + 1);
  }
  return false;
}
export const G = { YES: 'yes', PARTIAL: 'partial', NO: 'no', NA: 'n/a' };
export const gradeScore = (g) => (g === G.YES ? 1 : g === G.PARTIAL ? 0.5 : 0);
export { esc };

// For JSON search results: the serialized hit object(s) whose content contains `needle`, so a
// per-hit label (e.g. an authority tag) is attributed to the right hit regardless of byte distance.
export function hitsWith(text, needle) {
  const out = [];
  for (const part of String(text ?? '').split(/\n\n(?=[{\[])/)) {
    let j; try { j = JSON.parse(part); } catch { continue; }
    const hits = Array.isArray(j) ? j : j.hits ?? j.results ?? j.entities ?? [];
    for (const h of hits) { const s = JSON.stringify(h); if (s.includes(needle)) out.push(s); }
  }
  return out;
}
