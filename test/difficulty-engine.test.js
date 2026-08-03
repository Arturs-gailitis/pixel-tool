import test from "node:test";
import assert from "node:assert/strict";
import {
  analyseDifficulty,
  analyseLevelStructure,
  simulateLevel
} from "../difficulty-engine.js";

function level(overrides = {}) {
  return {
    grid: ["AA", "AA"],
    palette: { A: "#E34B4B" },
    containers: [{ c: "A", cap: 4, r: 0, col: 0 }],
    links: [],
    mystery: null,
    thick: null,
    regions: null,
    shutters: null,
    beltCap: 24,
    seed: 42,
    ...overrides
  };
}

test("stabils, visām stratēģijām uzvarams līmenis ir Easy", () => {
  const report = analyseDifficulty(level(), { repeats: 3, randomRuns: 12 });
  assert.equal(report.tier, "Easy");
  assert.equal(report.publishable, true);
  assert.equal(report.strategies.casual.won, true);
  assert.equal(report.randomWinRate, 1);
});

test("HP un trauku ietilpības neatbilstība ir Broken", () => {
  const report = analyseDifficulty(level({
    thick: { "0,0": 2 }
  }));
  assert.equal(report.tier, "Broken");
  assert.equal(report.publishable, false);
  assert.match(report.blockers.join(" "), /HP paritāte/);
});

test("simulators atgriež gājienus, kļūdas un bloķējumus", () => {
  const outcome = simulateLevel(level(), "careful", 7);
  assert.equal(outcome.won, true);
  assert.equal(outcome.moves, 1);
  assert.equal(outcome.mistakes, 0);
  assert.equal(outcome.blockedSituations, 0);
});

test("neviena stratēģija nevar pārpildīt jostu un līmenis ir Unwinnable", () => {
  const impossible = level({
    grid: ["A", "B"],
    palette: { A: "#E34B4B", B: "#4B72E3" },
    thick: { "0,0": 2, "1,0": 2 },
    containers: [
      { c: "A", cap: 2, r: 0, col: 0 },
      { c: "B", cap: 2, r: 1, col: 0 }
    ],
    beltCap: 1
  });
  const report = analyseDifficulty(impossible, { repeats: 3, randomRuns: 12 });
  assert.equal(report.tier, "Unwinnable");
  assert.equal(report.publishable, false);
});

test("vienas bumbiņas trauks un gara krāsu siena ir atļauti", () => {
  const structure = analyseLevelStructure(level({
    grid: ["AAAAA"],
    containers: [
      { c: "A", cap: 1, r: 0, col: 0 },
      { c: "A", cap: 1, r: 1, col: 0 },
      { c: "A", cap: 1, r: 2, col: 0 },
      { c: "A", cap: 1, r: 3, col: 0 },
      { c: "A", cap: 1, r: 4, col: 0 }
    ]
  }));
  assert.equal(structure.maxContainerRun, 5);
  assert.ok(!structure.publishBlockers.some(message => message.includes("vienas bumbiņas")));
  assert.ok(!structure.publishBlockers.some(message => message.includes("ne vairāk par 4")));
});

test("links ievēro dažādas kolonnas, pēdējās rindas un 18 cap limitu", () => {
  const containers = [
    { c: "A", cap: 1, r: 0, col: 0 }, { c: "A", cap: 1, r: 1, col: 0 },
    { c: "A", cap: 1, r: 2, col: 0 }, { c: "A", cap: 1, r: 3, col: 0 },
    { c: "A", cap: 1, r: 0, col: 1 }, { c: "A", cap: 1, r: 1, col: 1 },
    { c: "A", cap: 1, r: 2, col: 1 }, { c: "A", cap: 1, r: 3, col: 1 }
  ];
  const invalid = analyseLevelStructure(level({
    grid: ["AAAAAAAA"],
    containers,
    links: [{ id: "L1", members: [0, 1] }, { id: "L2", members: [3, 7] }]
  }));
  assert.ok(invalid.critical.some(message => message.includes("dažādās kolonnās")));
  assert.ok(invalid.critical.some(message => message.includes("pēdējām 3 rindām")));

  const oversized = analyseLevelStructure(level({
    grid: ["AAAAAAAAAAAAAAAAAAAA"],
    containers: [{ c: "A", cap: 10, r: 0, col: 0 }, { c: "A", cap: 10, r: 0, col: 1 }],
    links: [{ id: "L3", members: [0, 1] }]
  }));
  assert.ok(oversized.critical.some(message => message.includes("pārsniedz 18")));

  const tooMany = analyseLevelStructure(level({
    grid: ["AAAA"],
    containers: [
      { c: "A", cap: 1, r: 0, col: 0 }, { c: "A", cap: 1, r: 0, col: 1 },
      { c: "A", cap: 1, r: 0, col: 2 }, { c: "A", cap: 1, r: 0, col: 3 },
      { c: "A", cap: 0, r: 1, col: 0 }
    ],
    links: [{ id: "L4", members: [0, 1, 2, 3, 4] }]
  }));
  assert.ok(tooMany.critical.some(message => message.includes("nederīgus trauku indeksus")));
});

test("shutter atslēga zem paša aizsega ir publicēšanas bloķētājs", () => {
  const structure = analyseLevelStructure(level({
    regions: { cover: [[0, 0]], key: [[0, 0]] },
    shutters: [{ covers: "cover", key: "key" }]
  }));
  assert.ok(structure.publishBlockers.some(message => message.includes("pārklājas")));
});

test("Hard prasa casual zaudējumu un vismaz divu prasmīgo stratēģiju uzvaru", () => {
  const report = analyseDifficulty(level({
    grid: ["CCA", "ABC", "BCC", "CAB"],
    palette: { A: "#FF0000", B: "#00FF00", C: "#0000FF" },
    containers: [
      { c: "A", cap: 3, col: 1, r: 0 },
      { c: "C", cap: 3, col: 0, r: 0 },
      { c: "C", cap: 3, col: 3, r: 0 },
      { c: "B", cap: 3, col: 0, r: 1 }
    ],
    beltCap: 5
  }), { repeats: 3, randomRuns: 12 });
  assert.equal(report.strategies.casual.won, false);
  assert.ok(report.skilledWins.length >= 2);
  assert.equal(report.tier, "Hard");
});

test("Brutal tiek piešķirts, ja uzvar tikai viena prasmīgā stratēģija", () => {
  const report = analyseDifficulty(level({
    grid: ["BBC", "AAC", "ABA", "BBB"],
    palette: { A: "#FF0000", B: "#00FF00", C: "#0000FF" },
    containers: [
      { c: "B", cap: 3, col: 3, r: 0 },
      { c: "C", cap: 2, col: 0, r: 0 },
      { c: "A", cap: 1, col: 2, r: 0 },
      { c: "B", cap: 3, col: 2, r: 1 },
      { c: "A", cap: 3, col: 0, r: 1 }
    ],
    beltCap: 3
  }), { repeats: 3, randomRuns: 12 });
  assert.deepEqual(report.skilledWins, ["drainer"]);
  assert.equal(report.tier, "Brutal");
});

test("mystery izraisīta vienas stratēģijas nestabilitāte dod Fragile", () => {
  const report = analyseDifficulty(level({
    grid: ["ABA", "ACB", "BBA", "CCC"],
    palette: { A: "#FF0000", B: "#00FF00", C: "#0000FF" },
    containers: [
      { c: "A", cap: 2, col: 3, r: 0 },
      { c: "A", cap: 2, col: 2, r: 0 },
      { c: "B", cap: 4, col: 1, r: 0 },
      { c: "C", cap: 4, col: 3, r: 1 }
    ],
    mystery: { proportion: 0.7, revealAt: "top" },
    beltCap: 4
  }), { repeats: 5, randomRuns: 12 });
  assert.equal(report.strategies.casual.stable, false);
  assert.equal(report.tier, "Fragile");
  assert.equal(report.publishable, false);
});
