#!/usr/bin/env node
// Adversarial corpus for kronicle-lite's cosmetic-vs-semantic classifier, end to end:
// put v1 -> orient (cursor) -> put v2 -> orient --cursor --focus retractions.
// A SEMANTIC case that lands only in cosmetic_edits (not in retractions) is a
// false-cosmetic: the push hook stays silent about a real change. Must be 0.
// A COSMETIC case that lands in retractions is a false alarm (noise).
//
// usage: KL=/path/to/kronicle-lite-checkout node stress/kl/classifier-corpus.mjs [--json] [--only ID]
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const KL = process.env.KL;
if (!KL) { console.error('set KL=<kronicle-lite checkout with dist/>'); process.exit(2); }
const { KronicleLite } = await import(pathToFileURL(join(KL, 'dist/index.js')).href);

// [id, label, old, new, note]   label: S = semantic (must retract), C = cosmetic (should stay quiet)
export const CASES = [
  // --- known bug under fix (hyphen-joined identifier, one letter) ---
  ['S01', 'S', 'Run the deploy with --target staging-a first.', 'Run the deploy with --target staging-b first.', 'hyphenated target id a->b'],
  ['S02', 'S', 'Send traffic to node-a during the window.', 'Send traffic to node-b during the window.', 'hyphenated host a->b'],
  ['S03', 'S', 'Fail over to the staging-east cluster.', 'Fail over to the staging-west cluster.', 'east/west inside hyphenated name'],
  ['S04', 'S', 'Pin the bucket to the europe-west location.', 'Pin the bucket to the europe-east location.', 'region inside hyphenated name'],
  ['S05', 'S', 'Deploy to the northeast region only.', 'Deploy to the northwest region only.', 'compound region word'],
  ['S06', 'S', 'Run backups from the southeast datacenter.', 'Run backups from the southwest datacenter.', 'compound region word'],
  // --- units / magnitudes in words ---
  ['S07', 'S', 'Cap uploads at 100 megabytes per request.', 'Cap uploads at 100 megabits per request.', 'bytes->bits (8x)'],
  ['S08', 'S', 'Throttle the link to 10 gigabytes per second.', 'Throttle the link to 10 gigabits per second.', 'bytes->bits'],
  ['S09', 'S', 'Retain audit logs for eight days.', 'Retain audit logs for eighty days.', 'number word eight->eighty'],
  ['S10', 'S', 'Allow up to 2³ retries per job.', 'Allow up to 23 retries per job.', 'NFKC superscript: 8 -> 23'],
  ['S11', 'S', 'Max body size is 10⁶ bytes.', 'Max body size is 106 bytes.', 'NFKC superscript: 1e6 -> 106'],
  // --- protocol / product names ---
  ['S12', 'S', 'The health check must use http on the internal port.', 'The health check must use https on the internal port.', 'http->https'],
  ['S13', 'S', 'Relay outbound mail over smtp only.', 'Relay outbound mail over smtps only.', 'smtp->smtps'],
  ['S14', 'S', 'Point the reporting job at the mysql replica.', 'Point the reporting job at the mssql replica.', 'different DBMS'],
  ['S15', 'S', 'Export the audit trail as json for the auditors.', 'Export the audit trail as jsonl for the auditors.', 'format change'],
  // --- names / identifiers without punctuation ---
  ['S16', 'S', 'Escalate incidents to Mark before paging anyone else.', 'Escalate incidents to Mary before paging anyone else.', 'different person'],
  ['S17', 'S', 'Page Karen for database incidents.', 'Page Karin for database incidents.', 'different person'],
  ['S18', 'S', 'Deploy into the payments namespace.', 'Deploy into the payment namespace.', 'different k8s namespace'],
  ['S19', 'S', 'Truncate the sessions table nightly.', 'Truncate the session table nightly.', 'different table'],
  ['S20', 'S', 'Cut releases from the stable branch.', 'Cut releases from the stale branch.', 'different branch'],
  ['S21', 'S', 'Delete the backup after the restore test.', 'Delete the backups after the restore test.', 'one vs all'],
  // --- review-stamp masking hides real dates ---
  ['S22', 'S', 'As of 2026-12-01 deploys to production are frozen.', 'As of 2026-11-01 deploys to production are frozen.', 'effective date of a freeze (as-of line)'],
  ['S23', 'S', 'Last reviewed 2026-10-01; the signing certificate expires 2026-12-01.', 'Last reviewed 2026-10-01; the signing certificate expires 2026-11-02.', 'expiry date on a stamp line'],
  ['S24', 'S', 'Revised cutover date: 2026-12-01.', 'Revised cutover date: 2026-11-15.', 'cutover date on a "Revised" line'],
  ['S25', 'S', '- Updated retention: delete backups after Nov 30, 2026', '- Updated retention: delete backups after Nov 3, 2026', 'list item starting with Updated'],
  ['S26', 'S', 'Reviewed on 2026-10-01. Maintenance window: Dec 5, 2026.', 'Reviewed on 2026-10-01. Maintenance window: Nov 5, 2026.', 'window date shares the stamp line'],
  // --- punctuation that carries meaning ---
  ['S27', 'S', 'Is a migration needed? No. Deploy directly.', 'Is a migration needed? No deploy directly.', 'sentence break flips meaning (borderline)'],
  // --- controls: things the classifier must already catch ---
  ['S28', 'S', 'Deploys go to the staging cluster `stg-west-2` first.', 'Deploys go to the staging cluster `stg-east-1` first.', 'code span (control)'],
  ['S29', 'S', 'Never deploy on Fridays.', 'Always deploy on Fridays.', 'negation word (control)'],
  ['S30', 'S', 'Timeouts are 30 ms.', 'Timeouts are 30 s.', 'unit ms->s (control)'],
  ['S31', 'S', 'Use us-east for the primary.', 'Use us-west for the primary.', 'us-east->us-west (control)'],
  ['S32', 'S', 'Set the offset to +5 hours.', 'Set the offset to -5 hours.', 'sign flip (control)'],
  ['S33', 'S', 'Alert when load > 80 percent.', 'Alert when load < 80 percent.', 'comparison flip (control)'],
  ['S34', 'S', 'Do not deploy on Friday.', 'Do now deploy on Friday.', 'not->now (control)'],
  ['S35', 'S', 'Order: build, test, deploy.', 'Order: deploy, test, build.', 'order swap (control)'],
  ['S36', 'S', 'Run with sudo.', 'Run without sudo.', 'with/without (control)'],
  ['S37', 'S', 'Connect to db01.internal on port 5432.', 'Connect to db01.internal on port 5433.', 'port (control)'],
  ['S38', 'S', 'Use pnpm, not npm.', 'Use npm, not pnpm.', 'swap (control)'],
  // --- cosmetic set (should be quiet) ---
  ['C01', 'C', 'Deploys go to the staging cluster first.', 'Deploys go to the staging cluster first.  ', 'trailing whitespace'],
  ['C02', 'C', 'Deploys go to the staging cluster first.', 'Deploys go  to the staging\ncluster first.', 'reflow'],
  ['C03', 'C', 'Use the "blue" pool for canaries.', 'Use the “blue” pool for canaries.', 'smart quotes'],
  ['C04', 'C', 'Rotate keys quarterly.', 'Rotate keys quarterly!', 'punctuation'],
  ['C05', 'C', 'Rotate the keys every quater.', 'Rotate the keys every quarter.', 'typo fix'],
  ['C06', 'C', 'Last reviewed: 2026-09-01', 'Last reviewed: 2026-10-01', 'review stamp'],
  ['C07', 'C', '**Never** deploy on Fridays.', 'Never deploy on Fridays.', 'emphasis'],
  ['C08', 'C', 'Use a non-blocking client.', 'Use a nonblocking client.', 'hyphenation'],
  ['C09', 'C', 'deploys go to the staging cluster first.', 'Deploys go to the staging cluster first.', 'case'],
  ['C10', 'C', 'Recieve alerts in the oncall channel.', 'Receive alerts in the oncall channel.', 'transposition typo'],
  ['C11', 'C', 'Check the dashbaord before you merge.', 'Check the dashboard before you merge.', 'typo'],
  ['C12', 'C', 'Wait for the green build, then merge.', 'Wait for the green build; then merge.', 'comma->semicolon'],
  ['C13', 'C', 'Reviewed on 2026-09-01.', 'Reviewed on 2026-10-15.', 'review stamp variant'],
  ['C14', 'C', 'The runbook lives in the ops wiki.', 'The runbook lives in the ops wiki .', 'space before period'],
  ['C15', 'C', 'Use the staging cluster - then prod.', 'Use the staging cluster — then prod.', 'dash style'],
  ['C16', 'C', 'Wait 1,000 ms between retries.', 'Wait 1000 ms between retries.', 'thousands separator (false alarm is acceptable)'],
  ['C17', 'C', 'Ask in the #ops channel.', 'Ask in the #ops channel!', 'punctuation next to protected token'],
  ['C18', 'C', 'Deploys go to the staging cluster first.', 'Deploys go to the Staging cluster first.', 'case on meaning word'],
];

function runCase([id, label, oldT, newT, note]) {
  const dir = mkdtempSync(join(tmpdir(), 'klc-'));
  const kl = new KronicleLite({ dataDir: dir });
  try {
    const md = (t) => `# Runbook\n\n## Section\n\n${t}\n`;
    kl.docs.putDocument({ slug: 'runbook', title: 'Runbook', markdown: md(oldT), actor_id: 'writer' });
    const c0 = kl.orient.getSystemState({ actor_id: 'agent', focus: 'pulse' }).cursor;
    kl.docs.putDocument({ slug: 'runbook', title: 'Runbook', markdown: md(newT), actor_id: 'writer' });
    const s = kl.orient.getSystemState({ actor_id: 'agent', since_cursor: c0, focus: 'retractions' });
    const retr = s.retractions.length;
    const cos = (s.cosmetic_edits ?? []).length;
    const verdict = retr > 0 ? 'semantic' : cos > 0 ? 'cosmetic' : 'silent';
    const ok = label === 'S' ? retr > 0 : retr === 0;
    return { id, label, verdict, ok, note, rules: (s.cosmetic_edits ?? []).flatMap((e) => e.rules), old: oldT, new: newT };
  } finally {
    kl.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null;
const results = CASES.filter((c) => !only || c[0] === only).map(runCase);
const S = results.filter((r) => r.label === 'S');
const C = results.filter((r) => r.label === 'C');
const falseCos = S.filter((r) => !r.ok);
const falseAlarm = C.filter((r) => !r.ok);
if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ results, false_cosmetic: falseCos.length, semantic: S.length, false_alarm: falseAlarm.length, cosmetic: C.length }, null, 2));
} else {
  for (const r of results) console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.id} [${r.label}] -> ${r.verdict}${r.rules.length ? ` (${r.rules.join(',')})` : ''}  ${r.note}`);
  console.log(`\nfalse-cosmetic: ${falseCos.length}/${S.length} semantic cases (${falseCos.map((r) => r.id).join(' ')})`);
  console.log(`false-alarm:    ${falseAlarm.length}/${C.length} cosmetic cases (${falseAlarm.map((r) => r.id).join(' ')})`);
}
process.exit(falseCos.length > 0 ? 1 : 0);
