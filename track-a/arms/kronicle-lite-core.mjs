// kronicle-lite 0.7.0 (npm) with `serve --core` (6-tool profile for small contexts). Same adapter as the
// full arm, so score differences come from the profile.
import KronicleLite from './kronicle-lite.mjs';

export default class KronicleLiteCore extends KronicleLite {
  static serveArgs = ['--core'];
  static meta = { ...KronicleLite.meta, id: 'kronicle-lite-core', label: 'kronicle-lite --core', setupSteps: [...KronicleLite.meta.setupSteps.slice(0, 1), 'claude mcp add kronicle-lite -- kronicle-lite serve --core', ...KronicleLite.meta.setupSteps.slice(2)] };
}
