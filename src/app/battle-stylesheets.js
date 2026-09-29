/* Battle-only stylesheets, in cascade order, each paired with the first
   always-loaded sheet (index.html) that follows it in the full cascade, or null
   for the end. ctx.ensureBattleStyles() inserts each one before its anchor, so
   the cascade stays identical to eager loading. tools/build.mjs splits the
   eager CSS bundle at these anchors for the same reason. */
export const BATTLE_STYLESHEETS = [
  ['./styles/screens/battle-fx.css', './styles/screens/progression.css'],
  ['./styles/screens/battle-presentation.css', './styles/screens/draft.css'],
  ['./styles/screens/battle-combos.css', './styles/screens/accessibility.css'],
  ['./styles/screens/battle-ace-log.css', './styles/screens/accessibility.css'],
  ['./styles/overrides/battle-moves.css', './styles/screens/results.css'],
  ['./styles/overrides/battle-command.css', './styles/screens/results.css'],
  ['./styles/overrides/battle-preview.css', './styles/screens/results.css'],
  ['./styles/screens/battle-layout.css', null],
];
