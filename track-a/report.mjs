#!/usr/bin/env node
// Re-render REPORT.md from existing results (after editing track-a/analysis.md) without re-running.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './lib/util.mjs';
import { writeReport } from './lib/report.mjs';
const dir = path.resolve(process.argv[2] ?? path.join(ROOT, 'results', 'track-a'));
const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
const summary = JSON.parse(fs.readFileSync(path.join(dir, 'summary.json'), 'utf8'));
await writeReport(dir, meta, summary);
console.error(`rendered ${path.join(dir, 'REPORT.md')}`);
