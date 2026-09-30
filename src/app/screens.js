/* Every screen the title does not show, and the battle UI: one lazy chunk, loaded through
   ctx.loadScreens() (prefetched once the title is idle, or by the first route call that needs it).
   Each module registers its routes as it is imported. The title, the shell and global input stay
   in main.js; anything they call from here goes through `route`. */
import '../screens/academy.js';
import '../screens/league.js';
import '../screens/team-select.js';
import '../screens/draft.js';
import '../screens/gauntlet.js';
import '../screens/trials.js';
import '../screens/tutorial.js';
import '../battle-ui/controller.js';
import '../battle-ui/hud.js';
import '../battle-ui/playback.js';
import '../screens/results.js';
import '../screens/bestiary.js';
import '../screens/settings.js';
