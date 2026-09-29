import { ctx } from './app/context.js';
import './app/quality.js';
import { installScreenTransitions } from './app/shell.js';
import './screens/title.js';
import './screens/academy.js';
import './screens/league.js';
import './screens/team-select.js';
import './screens/draft.js';
import './screens/gauntlet.js';
import './screens/trials.js';
import './screens/tutorial.js';
import './battle-ui/controller.js';
import './battle-ui/hud.js';
import './battle-ui/fx.js';
import './battle-ui/playback.js';
import './screens/results.js';
import './screens/bestiary.js';
import './screens/settings.js';
import './input/keyboard.js';

installScreenTransitions();
ctx.routes.startInput();
ctx.routes.renderTitle();

// Once the title is idle, prefetch the arena chunk (Three.js); renderBattle
// awaits the same promise and reports a failed load itself. The built dist/
// then registers the offline service worker: tools/build.mjs defines
// __DIST__, so development never gets one, and neither do automated browsers.
const whenIdle = globalThis.requestIdleCallback ?? ((callback) => setTimeout(callback, 200));
whenIdle(
  () => {
    const arenaSettled = ctx.loadArena().catch(() => {});
    if (typeof __DIST__ === 'boolean' && 'serviceWorker' in navigator && !navigator.webdriver)
      arenaSettled
        .then(() => navigator.serviceWorker.register('./sw.js'))
        .catch((error) => console.warn('Service worker registration failed', error));
  },
  { timeout: 2000 }
);
