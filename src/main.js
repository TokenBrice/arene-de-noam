import { ctx } from './app/context.js';
import './app/quality.js';
import { installScreenTransitions } from './app/shell.js';
import './screens/title.js';
import './input/keyboard.js';

installScreenTransitions();
ctx.routes.startInput();
ctx.routes.renderTitle();

// Once the title is idle, prefetch the other screens (src/app/screens.js), then the arena chunk
// (Three.js): navigation stays instant, and a route call or renderBattle that comes first awaits
// the same promise and reports a failed load itself. Music waits for both: on a slow line the first
// tap's title/selection themes (~300 KB each) would otherwise share it with the arena chunk and
// delay an early tap's battle by over a second. The built dist/ then registers the offline
// service worker: tools/build.mjs defines __DIST__, so development never gets one, and neither
// do automated browsers.
let releaseMusic;
ctx.sound.deferMusic(new Promise((resolve) => (releaseMusic = resolve)));
const whenIdle = globalThis.requestIdleCallback ?? ((callback) => setTimeout(callback, 200));
whenIdle(
  () => {
    const prefetched = ctx
      .loadScreens()
      .then(() => ctx.loadArena())
      .catch(() => {});
    prefetched.then(releaseMusic);
    if (typeof __DIST__ === 'boolean' && 'serviceWorker' in navigator && !navigator.webdriver)
      prefetched
        .then(() => navigator.serviceWorker.register('./sw.js'))
        .catch((error) => console.warn('Service worker registration failed', error));
  },
  { timeout: 2000 }
);
