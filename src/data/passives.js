// Innate talents are deliberately creature-specific. The engine owns their
// deterministic hooks; this table is presentation metadata and a completeness
// contract for the roster.
export const PASSIVES = Object.freeze({
  foresight: { icon: '◎' },
  encore: { icon: '♫' },
  memory_silk: { icon: '⌁' },
  prism_skin: { icon: '◇' },
  duel_oath: { icon: '⚔' },
  last_bastion: { icon: '⬢' },
  razor_engine: { icon: '»' },
  foundation: { icon: '▣' },
  deep_pressure: { icon: '⌖' },
  blood_in_water: { icon: '⌁' },
  spring_tide: { icon: '✚' },
  conductor: { icon: 'ϟ' },
  living_furnace: { icon: '♨' },
  nine_lives: { icon: '⑨' },
  ember_cocoon: { icon: '◍' },
  sunborn: { icon: '☀' },
  photosynthesis: { icon: '❈' },
  ancient_roots: { icon: '♜' },
  dream_dust: { icon: '✧' },
  bramblehide: { icon: '✥' },
  living_shadow: { icon: '◐' },
  night_terror: { icon: '★' },
  apex_stalker: { icon: '⌃' },
  ill_omen: { icon: '☿' },
});

export const PASSIVE_IDS = Object.freeze(Object.keys(PASSIVES));
