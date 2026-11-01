// kronicle-lite 0.6.0 (unreleased) with `serve --core` (6-tool profile for small contexts).
import KronicleLite06 from './kronicle-lite-0.6.mjs';

export default class KronicleLite06Core extends KronicleLite06 {
  static serveArgs = ['--core'];
  static meta = { ...KronicleLite06.meta, id: 'kronicle-lite-0.6-core', label: 'kronicle-lite 0.6.0 --core (unreleased)', setupSteps: [...KronicleLite06.meta.setupSteps.slice(0, 1), 'claude mcp add kronicle-lite -- kronicle-lite serve --core', ...KronicleLite06.meta.setupSteps.slice(2)] };
}
