import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyseLevelStructure } from "./difficulty-engine.js";

const here = dirname(fileURLToPath(import.meta.url));
const skilledNames = ["careful", "patient", "drainer"];
const randomFleetSize = 24;
let cachedCore = null;
let cachedIndex = null;
let cachedMtime = null;

export function findGameIndex() {
  const candidates = [
    process.env.VITRAZA_DIR && join(process.env.VITRAZA_DIR, "index.html"),
    join(here, "game", "index.html"),
    join(here, "..", "prism-pop-level-tool", "game", "index.html")
  ].filter(Boolean);
  const found = candidates.find(existsSync);
  if (!found) {
    throw new Error(
      "Prism Pop! spēles index.html nav atrasts. Novieto spēli mapē ./game vai iestati VITRAZA_DIR."
    );
  }
  return found;
}

export function loadGameCore(indexPath = findGameIndex(), { fresh = false } = {}) {
  const mtime = statSync(indexPath).mtimeMs;
  if (!fresh && cachedCore && cachedIndex === indexPath && cachedMtime === mtime) return cachedCore;
  const html = readFileSync(indexPath, "utf8");
  const grab = (start, end, name) => {
    const from = html.indexOf(start);
    const to = html.indexOf(end, from);
    if (from < 0 || to < 0) {
      throw new Error(`Spēles simulatora bloks “${name}” nav atrodams; spēles avota marķieri ir mainījušies.`);
    }
    return html.slice(from, to);
  };
  const rngSource = grab("function mulberry32", "const BELT_MAX", "mulberry32");
  const constantsSource = grab("const BELT_MAX", "/* ---------- level data", "simulatora konstantes");
  const simulatorSource = grab("function createSim", "function selfTest", "createSim..runPolicy");
  if (!/function\s+runPolicy/.test(simulatorSource) ||
      !/function\s+patientPolicy/.test(simulatorSource)) {
    throw new Error("Izvilktajā spēles simulatorā trūkst runPolicy vai patientPolicy.");
  }
  const factory = new Function(
    `${rngSource}\n${constantsSource}\n${simulatorSource}\n` +
    `return {
      createSim, casualPolicy, carefulPolicy, patientPolicy, runPolicy, BELT_MAX,
      drainerPolicy: typeof drainerPolicy === "function" ? drainerPolicy : null,
      assertPaletteLaw: typeof assertPaletteLaw === "function" ? assertPaletteLaw : null
    };`
  );
  cachedCore = factory();
  cachedIndex = indexPath;
  cachedMtime = mtime;
  return cachedCore;
}

export function gradeWithGame(level, options = {}) {
  const structure = analyseLevelStructure(level);
  const core = options.core || loadGameCore(options.indexPath || findGameIndex());
  const maxTicks = options.maxTicks || 20000;
  const fleet = options.randomRuns ?? randomFleetSize;
  const critical = [...structure.critical];
  const publishBlockers = [...structure.publishBlockers];

  if (+(level.beltCap ?? core.BELT_MAX) !== +core.BELT_MAX) {
    publishBlockers.push(`Jostas limitam jābūt ${core.BELT_MAX}, bet līmenī ir ${level.beltCap}.`);
  }
  for (const container of level.containers || []) {
    if (+container.cap > +(level.beltCap ?? core.BELT_MAX)) {
      critical.push(`Trauka ${container.c} ietilpība ${container.cap} pārsniedz jostas limitu ${level.beltCap ?? core.BELT_MAX}.`);
    }
  }
  for (const link of level.links || []) {
    const capacity = (link.members || []).reduce(
      (sum, index) => sum + (level.containers?.[index]?.cap || 0), 0
    );
    if (capacity > +(level.beltCap ?? core.BELT_MAX)) {
      critical.push(`Links ${link.id || "?"} kopējā ietilpība ${capacity} pārsniedz jostas limitu.`);
    }
  }
  if (core.assertPaletteLaw) {
    try {
      core.assertPaletteLaw({ name: level.name || "level", palette: level.palette });
    } catch (error) {
      structure.warnings.push(`Paletes likums: ${String(error.message || error)}`);
    }
  }

  structure.critical = unique(critical);
  structure.publishBlockers = unique(publishBlockers);
  if (structure.critical.length) {
    return report("Broken", false, structure, {}, [], 0, structure.critical, {
      simulator: "Prism Pop! createSim",
      gameIndex: options.exposePath ? findGameIndex() : undefined
    });
  }

  const play = policy => {
    try {
      const outcome = core.runPolicy(level, policy, maxTicks);
      return {
        won: outcome.result === "win",
        result: outcome.result === "win" ? "win" : "lose",
        ticks: outcome.ticks,
        reason: outcome.result
      };
    } catch (error) {
      return { won: false, result: "error", ticks: 0, reason: String(error.message || error) };
    }
  };
  const policyMap = {
    casual: core.casualPolicy,
    careful: core.carefulPolicy,
    patient: core.patientPolicy,
    drainer: core.drainerPolicy
  };
  const strategies = {};
  for (const [name, policy] of Object.entries(policyMap)) {
    const outcome = policy ? play(policy) : { won: false, result: "lose", ticks: 0, reason: "policy-missing" };
    strategies[name] = summarise([outcome]);
  }

  const randomOutcomes = [];
  for (let index = 0; index < fleet; index++) {
    randomOutcomes.push(play(makeRandomPolicy(0xB00B5 + index * 7919)));
  }
  strategies.random = summarise(randomOutcomes);
  const simulatorErrors = unique(
    Object.values(strategies)
      .flatMap(item => item.outcomes || [])
      .filter(outcome => outcome.result === "error")
      .map(outcome => `Spēles simulators nevar izspēlēt līmeni: ${outcome.reason}`)
  );
  if (simulatorErrors.length) {
    structure.critical = unique([...structure.critical, ...simulatorErrors]);
    return report("Broken", false, structure, strategies, [], 0, simulatorErrors, {
      simulator: "Prism Pop! createSim",
      fleet,
      maxTicks
    });
  }

  const skilledWins = skilledNames.filter(name => strategies[name].won);
  const anyWin = Object.values(strategies).some(item => item.anyWin);
  const shippable = skilledWins.length > 0 && structure.publishBlockers.length === 0;
  let tier;
  if (!anyWin) tier = "Unwinnable";
  else if (!skilledWins.length) tier = "Fragile";
  else if (strategies.casual.won) tier = strategies.random.winRate >= 0.30 ? "Easy" : "Medium";
  else tier = skilledWins.length >= 2 ? "Hard" : "Brutal";

  const blockers = [...structure.publishBlockers];
  if (!skilledWins.length) blockers.push("Neviena no careful, patient vai drainer stratēģijām neuzvar.");
  if (tier === "Unwinnable") blockers.push("Spēles simulatorā netika atrasts uzvaras ceļš.");
  if (tier === "Fragile") blockers.push("Līmenis neiztur README publicēšanas vārtus.");

  return report(tier, shippable, structure, strategies, skilledWins, strategies.random.winRate, unique(blockers), {
    simulator: "Prism Pop! createSim",
    fleet,
    maxTicks,
    gameIndex: options.exposePath ? findGameIndex() : undefined
  });
}

function makeRandomPolicy(seed) {
  const random = mulberry32(seed >>> 0);
  return sim => {
    const actions = sim.actions().filter(action => sim.beltFree() >= action.need);
    if (!actions.length || random() < 0.15) return null;
    return actions[Math.floor(random() * actions.length)].id;
  };
}

function summarise(outcomes) {
  const wins = outcomes.filter(outcome => outcome.won).length;
  const wonOutcomes = outcomes.filter(outcome => outcome.won);
  return {
    won: wins === outcomes.length,
    anyWin: wins > 0,
    wins,
    runs: outcomes.length,
    winRate: outcomes.length ? wins / outcomes.length : 0,
    stable: wins === 0 || wins === outcomes.length,
    moves: wonOutcomes.length
      ? Math.round(wonOutcomes.reduce((sum, outcome) => sum + outcome.ticks, 0) / wonOutcomes.length)
      : null,
    mistakes: null,
    blockedSituations: null,
    outcomes
  };
}

function report(tier, publishable, structure, strategies, skilledWins, randomWinRate, blockers, certification) {
  return {
    tier,
    publishable,
    winnable: tier !== "Broken" && tier !== "Unwinnable",
    strategies,
    skilledWins,
    randomWinRate,
    blockers,
    structure,
    certification
  };
}

function unique(values) {
  return [...new Set(values)];
}

function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = seed + 0x6D2B79F5 | 0;
    let value = Math.imul(seed ^ seed >>> 15, 1 | seed);
    value = value + Math.imul(value ^ value >>> 7, 61 | value) ^ value;
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}
