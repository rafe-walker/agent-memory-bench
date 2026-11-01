// Seeded fixture generation. Every value an arm is graded on comes from here, so a
// (scenario, seed) pair is byte-reproducible. Templates for benign edits and synthetic
// secrets are ported from IsoKron apps/isokron-cli/src/eval/generators/{benign-edits,pii-leak}.ts
// (same template names; edits re-targeted at a runbook "Notes" section instead of critic cases).
import { mulberry32 } from './rng.mjs';

const ENVS = ['stg', 'qa', 'canary', 'preprod', 'perf'];
const REGIONS = ['west', 'east', 'north', 'south', 'central', 'eu', 'ap'];
const WORDS = ['amber', 'basalt', 'cobalt', 'delta', 'ember', 'fjord', 'garnet', 'harbor', 'indigo', 'juniper', 'krypton', 'lumen', 'mosaic', 'nimbus', 'onyx', 'pylon', 'quartz', 'raven', 'sierra', 'tundra', 'umber', 'vertex', 'willow', 'xenon', 'yarrow', 'zephyr'];
const FILLER = [
  'The service is owned by the platform team and pages the on-call engineer.',
  'Logs are retained for thirty days in the central log store.',
  'Health checks run every fifteen seconds against the readiness endpoint.',
  'Dashboards for latency and error budget live in the observability folder.',
  'Feature work lands behind flags and is enabled per tenant.',
  'The nightly job compacts old audit rows and reports row counts.',
  'Capacity reviews happen monthly with the infrastructure group.',
  'Incidents are written up within two business days of resolution.',
];

export const BENIGN_EDIT_TEMPLATES = ['typo_fix', 'whitespace_trim', 'whitespace_double', 'line_ending_norm', 'comma_list', 'smart_quote', 'numbered_list_renumber', 'markdown_emphasis', 'missing_period', 'hyphenation'];
export const SECRET_TEMPLATES = ['aws_access_key', 'github_pat', 'stripe_live', 'slack_bot', 'private_key', 'openai_key', 'jwt'];

function cluster(rng) { return `${rng.pick(ENVS)}-${rng.pick(REGIONS)}-${rng.int(1, 9)}`; }

export function makeWorld(seed) {
  const rng = mulberry32(seed * 7919 + 17);
  let oldCluster = cluster(rng), newCluster = cluster(rng);
  while (newCluster === oldCluster) newCluster = cluster(rng);
  let poison = cluster(rng);
  while (poison === oldCluster || poison === newCluster) poison = cluster(rng);
  let bCluster = cluster(rng);
  while ([oldCluster, newCluster, poison].includes(bCluster)) bCluster = cluster(rng);
  const flags = rng.shuffle(['--online', '--offline', '--batched', '--dry-run-first', '--lock-timeout=5s']);
  const svc = `${rng.pick(WORDS)}-api`;
  const word = rng.pick(WORDS);
  return {
    seed,
    svc,
    oldCluster, newCluster, poison, bCluster,
    migrateA: flags[0], migrateB: flags[1],
    rollbackMin: rng.int(5, 30),
    legacyHost: `legacy-${rng.pick(WORDS)}-${rng.int(10, 99)}.internal`,
    decisionFlag: `ff_${word}_${rng.hex(6)}`,
    decisionFile: `billing/legacy_${rng.hex(4)}.py`,
    ticketTitle: `Fix ${rng.pick(WORDS)} session expiry in src/auth`,
    bTicketTitle: `Repo B: rotate ${rng.pick(WORDS)} webhook secret`,
    authPath: rng.pick(['src/auth', 'src/billing', 'src/api/routes', 'lib/session']),
    benign: BENIGN_EDIT_TEMPLATES[seed % BENIGN_EDIT_TEMPLATES.length],
    secretKind: SECRET_TEMPLATES[seed % SECRET_TEMPLATES.length],
    secret: makeSecret(SECRET_TEMPLATES[seed % SECRET_TEMPLATES.length], rng),
    sectionOrder: rng.shuffle(['rollback', 'database', 'contacts']),
    moveKind: rng.next() < 0.5 ? 'reorder' : 'rename_file',
    racers: rng.int(2, 8),
    filler: rng.shuffle(FILLER).slice(0, 3),
    rng,
  };
}

// Synthetic, never-valid secrets in the exact *shapes* common scanners match
// (gitleaks/trufflehog-style prefixes and lengths). Random per seed, so no scanner
// allowlist of documentation examples (e.g. AKIAIOSFODNN7EXAMPLE) can hide a miss.
export function makeSecret(kind, rng) {
  const up = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  switch (kind) {
    case 'aws_access_key': return `AKIA${rng.alnum(16, up)}`;
    case 'github_pat': return `ghp_${rng.alnum(36)}`;
    case 'stripe_live': return `sk_live_${rng.alnum(24)}`;
    case 'slack_bot': return `xoxb-${rng.int(100000000000, 999999999999)}-${rng.int(100000000000, 999999999999)}-${rng.alnum(24)}`;
    case 'private_key': return `-----BEGIN RSA PRIVATE KEY-----\nMIIEow${rng.alnum(58)}\n${rng.alnum(64)}\n-----END RSA PRIVATE KEY-----`;
    case 'openai_key': return `sk-proj-${rng.alnum(48)}`;
    case 'jwt': {
      const b = (n) => rng.alnum(n, 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_');
      return `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ${b(40)}.${b(43)}`;
    }
  }
  throw new Error(kind);
}
// The part of a secret that must not survive (multi-line keys: the body line).
export function secretNeedle(w) { return w.secretKind === 'private_key' ? w.secret.split('\n')[1] : w.secret; }

// --- Runbook ------------------------------------------------------------------
// Pre-edit "Notes" lines, one per benign template, then the post-edit replacement.
const NOTES_PRE = {
  typo_fix: 'Operators recieve alerts via the dispatcher.',
  whitespace_trim: 'Escalations follow the paging policy.   ',
  whitespace_double: 'Status updates go to the  incident channel.',
  line_ending_norm: 'Postmortems are blameless.\r\nOwners file follow-ups.',
  comma_list: 'Operators, responders and support engineers join the bridge.',
  smart_quote: 'Use the “safe” profile for drills.',
  numbered_list_renumber: '1) Open the runbook.\n2) Follow the checklist.\n3) Acknowledge the page.',
  markdown_emphasis: 'Never *skip* the canary stage.',
  missing_period: 'Silence alerts only with a ticket',
  hyphenation: 'Send an e-mail summary after each drill.',
};
const NOTES_POST = {
  typo_fix: 'Operators receive alerts via the dispatcher.',
  whitespace_trim: 'Escalations follow the paging policy.',
  whitespace_double: 'Status updates go to the incident channel.',
  line_ending_norm: 'Postmortems are blameless.\nOwners file follow-ups.',
  comma_list: 'Operators, responders, and support engineers join the bridge.',
  smart_quote: 'Use the "safe" profile for drills.',
  numbered_list_renumber: '1. Open the runbook.\n2. Follow the checklist.\n3. Acknowledge the page.',
  markdown_emphasis: 'Never _skip_ the canary stage.',
  missing_period: 'Silence alerts only with a ticket.',
  hyphenation: 'Send an email summary after each drill.',
};

export function runbook(w, { cluster = w.oldCluster, benignApplied = null, order = null } = {}) {
  const sections = {
    target: `## Deploy target\n\nDeploys of ${w.svc} go to the cluster \`${cluster}\` first.\n`,
    rollback: `## Rollback\n\nRun \`rollback --last\` within ${w.rollbackMin} minutes of a failed deploy.\n`,
    database: `## Database\n\nThe primary database is reached through the bastion host.\n`,
    contacts: `## Contacts\n\n${w.filler.join(' ')}\n`,
  };
  const notes = BENIGN_EDIT_TEMPLATES.map((t) => (t === benignApplied ? NOTES_POST[t] : NOTES_PRE[t])).join('\n\n');
  const ord = order ?? ['target', ...w.sectionOrder];
  return `# ${w.svc} deploy runbook\n\n${ord.map((k) => sections[k]).join('\n')}\n## Notes\n\n${notes}\n`;
}
export function notesLine(t, post = false) { return (post ? NOTES_POST : NOTES_PRE)[t]; }

export function claudeMd(w, { importRunbook = true, extra = '' } = {}) {
  return `# ${w.svc}\n\nTypeScript service. Run \`npm test\` before committing.\n\n## Rules\n- Never edit generated files under \`gen/\`.\n- Run migrations with \`migrate ${w.migrateA}\`.\n${extra}${importRunbook ? '\nDeploy runbook: @docs/deploy.md\n' : ''}`;
}
export function adrMigrations(w) {
  return `# ADR 0007: migration policy\n\nStatus: accepted (supersedes earlier guidance)\n\n## Decision\n\nRun migrations with \`migrate ${w.migrateB}\`.\n`;
}
export function legacyRunbook(w) {
  return `# Legacy deploy (old platform)\n\n## Legacy host\n\nDeploys used to go through \`${w.legacyHost}\`.\n`;
}
export function decisionText(w) {
  return `Use feature flag ${w.decisionFlag} instead of a schema migration; never edit ${w.decisionFile}.`;
}

// --- Scale corpus (S12) -------------------------------------------------------
export function scaleCorpus(n, seed) {
  const rng = mulberry32(seed * 104729 + 3);
  const docs = [];
  for (let i = 0; i < n; i++) {
    const name = `svc-${rng.pick(WORDS)}${i}`;
    const val = rng.hex(10);
    const f = rng.shuffle(FILLER);
    docs.push({ path: `docs/services/${name}.md`, name, val, text: `# ${name}\n\n${f[0]} ${f[1]}\n\n## Credentials\n\nThe rotation key for ${name} is ${val}.\n\n## Operations\n\n${f[2]} ${f[3]}\n` });
  }
  return docs;
}
