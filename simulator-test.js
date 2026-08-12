"use strict";

const assert = require("node:assert/strict");
const simulator = require("./baccarat-simulator");
const betting = require("./betting-engine");

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`PASS: ${name}`);
  } catch (error) {
    failed += 1;
    failures.push({ name, error });
    console.error(`FAIL: ${name} — ${error.message}`);
  }
}

test("seeded simulation is reproducible", () => {
  const first = simulator.runSimulation({ rounds: 1000, seed: 20260812 });
  const second = simulator.runSimulation({ rounds: 1000, seed: 20260812 });
  assert.deepEqual(first.mainResults, second.mainResults);
  assert.deepEqual(first.pairs, second.pairs);
  assert.deepEqual(first.naturals, second.naturals);
  assert.deepEqual(first.cardUsage, second.cardUsage);
  assert.deepEqual(first.rtp, second.rtp);
});

test("1,000-round real-shoe simulation has complete, valid accounting", () => {
  const rounds = 1000;
  const report = simulator.runSimulation({ rounds, seed: 88 });
  assert.equal(report.config.rounds, rounds);
  assert.equal(report.validation.totalRoundCountCorrect, true);
  assert.equal(report.validation.resultProbabilitySumCorrect, true);
  assert.equal(report.validation.cardUsageCountCorrect, true);
  assert.equal(report.validation.pairCountsCorrect, true);
  assert.equal(report.validation.rtpStakeCorrect, true);
  assert.ok(report.shoes.shoeCount > 1);
  assert.equal(report.shoes.reshuffleCount, report.shoes.shoeCount - 1);
  assert.equal(report.errors.invalidWinner, 0);
  assert.equal(report.errors.invalidCardsUsed, 0);
  assert.equal(report.errors.nan, 0);
  assert.equal(report.errors.infinity, 0);
  assert.equal(report.errors.negativeReturn, 0);
  assert.equal(report.errors.uncaughtError, 0);
  assert.ok(["PASS", "WARNING"].includes(report.status));
  for (const entry of Object.values(report.rtp)) {
    assert.equal(entry.totalStake, rounds);
    assert.equal(entry.playerNet, betting.roundMoney(entry.totalReturn - entry.totalStake));
    assert.ok(Number.isFinite(entry.rtp));
  }
});

test("report formatter exposes summary sections", () => {
  const report = simulator.runSimulation({ rounds: 100, seed: 7 });
  const output = simulator.formatReport(report);
  assert.match(output, /MAIN RESULTS/);
  assert.match(output, /RTP \/ HOUSE EDGE/);
  assert.match(output, /VALIDATION/);
});

console.log(`\nTEST SUMMARY: Passed: ${passed}; Failed: ${failed}`);
if (failed > 0) {
  for (const failure of failures) console.error(`${failure.name}:`, failure.error.stack);
  process.exitCode = 1;
}
