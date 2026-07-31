import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { findGameIndex, gradeWithGame, loadGameCore } from "../game-difficulty.js";

const levels = JSON.parse(
  readFileSync(new URL("../all-levels.json", import.meta.url), "utf8")
).levels;

test("grūtības pārbaude izvelk Prism Pop! īsto createSim un politikas", () => {
  const core = loadGameCore(findGameIndex(), { fresh: true });
  for (const name of [
    "createSim",
    "casualPolicy",
    "carefulPolicy",
    "patientPolicy",
    "drainerPolicy",
    "runPolicy"
  ]) {
    assert.equal(typeof core[name], "function", `${name} jābūt iegūtai no spēles`);
  }
});

test("sertifikācija izmanto README politiku kāpnes un 24 spēlētāju random fleet", () => {
  const grade = gradeWithGame(levels[0]);
  assert.equal(grade.certification.simulator, "Prism Pop! createSim");
  assert.equal(grade.strategies.random.runs, 24);
  assert.equal(grade.strategies.casual.runs, 1);
  assert.equal(grade.strategies.careful.runs, 1);
  assert.equal(grade.strategies.patient.runs, 1);
  assert.equal(grade.strategies.drainer.runs, 1);
  assert.equal(grade.publishable, true);
  assert.ok(["Easy", "Medium", "Hard", "Brutal"].includes(grade.tier));
});

test("vienas bumbiņas trauki ir atļauti, ja HP paritāte ir korekta", () => {
  const grade = gradeWithGame(levels[1], { randomRuns: 4 });
  assert.equal(grade.publishable, true);
  assert.ok(!grade.blockers.some(message => message.includes("vienas bumbiņas")));
});
