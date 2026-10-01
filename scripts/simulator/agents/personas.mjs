// personas.mjs — behavioural profiles for soak agents.
//
// A persona decides HOW a simulated player plays: how strong (bot search
// difficulty), WHEN in the turn they commit (timing phase weights), and how
// "human" the turn looks (previews, dictionary lookups, reactions, mistakes).
// Weights are relative; timing.mjs / decide.mjs / humanBehavior.mjs read them.
//
// `chaos` (0..1, from --chaos) scales the disruptive actions (illegal words,
// resigns, socket drops, …) so a run can be dialled from "polite players" to
// "adversarial players" without editing personas.

export const PERSONAS = Object.freeze({
  // Plays quickly, chats a lot, rarely near the deadline.
  fastChatty: Object.freeze({
    id: 'fastChatty', difficulty: 1,
    timing: { early: 0.55, mid: 0.30, late: 0.08, deadline: 0.07 },
    untimedThinkMs: [1500, 9000],
    previewsPerTurn: [0, 3], lookupsPerTurn: [0, 1],
    reactionChance: 0.45, illegalWordChance: 0.04, exchangeWhenPoorRack: 0.6,
    lockChance: 0.05, walkAwayChance: 0.005, resignChance: 0.001,
  }),
  // Thinks long, checks the dictionary often, commits late.
  slowCareful: Object.freeze({
    id: 'slowCareful', difficulty: 2,
    timing: { early: 0.10, mid: 0.45, late: 0.25, deadline: 0.20 },
    untimedThinkMs: [6000, 40000],
    previewsPerTurn: [1, 5], lookupsPerTurn: [1, 3],
    reactionChance: 0.12, illegalWordChance: 0.02, exchangeWhenPoorRack: 0.8,
    lockChance: 0.12, walkAwayChance: 0.01, resignChance: 0.0005,
  }),
  // Deadline-heavy, undoes a lot, makes mistakes. The race hunter.
  erratic: Object.freeze({
    id: 'erratic', difficulty: 1,
    timing: { early: 0.15, mid: 0.20, late: 0.25, deadline: 0.40 },
    untimedThinkMs: [500, 30000],
    previewsPerTurn: [2, 7], lookupsPerTurn: [0, 2],
    reactionChance: 0.30, illegalWordChance: 0.10, exchangeWhenPoorRack: 0.4,
    lockChance: 0.15, walkAwayChance: 0.04, resignChance: 0.003,
  }),
  // Weak words, many rejects, slow-ish.
  novice: Object.freeze({
    id: 'novice', difficulty: 0,
    timing: { early: 0.25, mid: 0.40, late: 0.20, deadline: 0.15 },
    untimedThinkMs: [3000, 25000],
    previewsPerTurn: [1, 4], lookupsPerTurn: [1, 3],
    reactionChance: 0.25, illegalWordChance: 0.15, exchangeWhenPoorRack: 0.3,
    lockChance: 0.03, walkAwayChance: 0.02, resignChance: 0.002,
  }),
});

export const PERSONA_IDS = Object.freeze(Object.keys(PERSONAS));

export function pickPersona(rng, allowed = PERSONA_IDS) {
  const ids = allowed.filter(id => PERSONAS[id]);
  return PERSONAS[ids[Math.floor(rng() * ids.length)] ?? 'fastChatty'];
}

// Apply the run-wide chaos dial to a persona's disruptive rates.
export function withChaos(persona, chaos = 0.3) {
  const k = Math.max(0, Math.min(1, Number(chaos))) / 0.3; // 0.3 = persona as authored
  return Object.freeze({
    ...persona,
    illegalWordChance: Math.min(0.5, persona.illegalWordChance * k),
    walkAwayChance: Math.min(0.3, persona.walkAwayChance * k),
    resignChance: Math.min(0.05, persona.resignChance * k),
    chaos: Number(chaos),
  });
}
