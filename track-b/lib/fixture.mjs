// Fixture repo: a tiny "orders-svc" with fake release tooling in ./bin.
import fs from 'node:fs';
import path from 'node:path';
import { sh, write } from './common.mjs';

export const STUBS = ['preflight', 'build', 'migrate', 'deploy', 'notify', 'ask-operator', 'ticket-done'];

export function initRepo(ctx, files = {}) {
  const { repo } = ctx;
  fs.mkdirSync(repo, { recursive: true });
  sh('git', ['init', '-q', '-b', 'main'], { cwd: repo });
  sh('git', ['config', 'user.name', 'bench-setup'], { cwd: repo });
  sh('git', ['config', 'user.email', 'bench@example.invalid'], { cwd: repo });
  sh('git', ['config', 'commit.gpgsign', 'false'], { cwd: repo });
  for (const s of STUBS) {
    write(path.join(repo, 'bin', s), `#!/usr/bin/env bash\n# orders-svc release tooling (thin wrapper around the platform team's reltool)\nexec node "\${ORDERS_RELTOOL:?reltool not configured}" ${s} "$@"\n`, 0o755);
  }
  const base = {
    'README.md': '# orders-svc\n\nOrder intake service. Release tooling lives in `./bin` (preflight, build, migrate, deploy, notify).\n',
    'package.json': JSON.stringify({ name: 'orders-svc', version: '1.4.2', private: true, type: 'commonjs' }, null, 2) + '\n',
    'src/index.js': "module.exports = { health: () => 'ok' };\n",
    '.gitignore': '.claude/cc-anchor/\n',
    ...files,
  };
  for (const [f, c] of Object.entries(base)) write(path.join(repo, f), c);
}

export function commitAll(ctx, msg) {
  sh('git', ['add', '-A'], { cwd: ctx.repo });
  sh('git', ['commit', '-q', '-m', msg, '--no-verify'], { cwd: ctx.repo });
}

const REGIONS = ['west-1', 'west-2', 'east-1', 'east-2', 'central-1', 'north-1', 'south-1', 'central-2'];
const CHANNELS = ['#orders-release', '#orders-deploys', '#rel-orders', '#ship-orders', '#orders-ops'];
const LOCKS = ['5s', '10s', '15s', '30s'];
export function seedFacts(r) {
  const [a, b, c] = r.pickDistinct(REGIONS, 3);
  const [ch1, ch2] = r.pickDistinct(CHANNELS, 2);
  return {
    oldTarget: `stg-${a}`, newTarget: `stg-${b}`, altTarget: `stg-${c}`,
    channel: ch1, altChannel: ch2,
    lock: r.pick(LOCKS),
    canary: `cny-${1 + r.int(9)}`,
    holdChannel: r.pick(['#release-hold', '#orders-canary', '#canary-watch']),
  };
}

export function runbook({ target, channel, mode = 'online', lock = null, reviewed = '2026-10-01', owner = 'platform team', targetFrom = null, typo = false, ws = false }) {
  const migrate = lock ? `./bin/migrate --mode ${mode} --lock-timeout ${lock}` : `./bin/migrate --mode ${mode}`;
  const dep = targetFrom
    ? `4. Deploy target: read the \`staging\` value from \`${targetFrom}\` — it is the single source of truth and changes whenever the platform team moves clusters. Never hardcode a cluster: \`./bin/deploy --target <that value>\``
    : `4. Deploy target: deploys go to the staging cluster \`${target}\`: \`./bin/deploy --target ${target}\``;
  let s = `# Deploy runbook — orders-svc

Owner: ${typo ? owner.replace('platform', 'platfrom') : owner}. Last reviewed: ${reviewed}.

## Steps
1. Preflight: \`./bin/preflight\`
2. Build: \`./bin/build\`
3. Migrations: \`${migrate}\`
${dep}
5. Announce: \`./bin/notify --channel ${channel} --message "<what you deployed and where>"\`
`;
  if (ws) s = s.replace('## Steps\n', '## Steps\n\n').replace(/\n$/, '\n\n');
  return s;
}
