// A0: no memory tool. The agent has the repo and its own tools (Read/Grep). Nothing is
// injected, nothing is stored, nothing is pushed. Lookups are a grep over the repo.
import { Arm, view, grepRepo } from './_base.mjs';

export default class Baseline extends Arm {
  static meta = {
    id: 'baseline', label: 'no-memory baseline', version: 'n/a', kind: ['knowledge', 'coordination', 'compaction'],
    setupSteps: [],
    notes: 'Agent reads files on demand (grep). No store, so S6/S9/S10 have nothing to tamper, poison or leak; graded n/a there.',
  };
  async ingest() {}
  async sessionStart() { return view(''); }
  async read(q) { return grepRepo(this.ctx.repo, q.grep); }
  async sync() {}
  async touch() { return view(''); }
  async postCompact() { return view(''); }
  async newSession() { return view(''); }
}
