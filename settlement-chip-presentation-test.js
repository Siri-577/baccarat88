"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const app = require("./app");
const betting = require("./betting-engine");
const source = fs.readFileSync("app.js", "utf8");
const css = fs.readFileSync("style.css", "utf8");
let passed = 0;
let failed = 0;
function test(name, fn) { try { fn(); passed += 1; console.log(`PASS: ${name}`); } catch (error) { failed += 1; console.error(`FAIL: ${name} — ${error.message}`); } }
function snapshotFor(bets, result, presentation = app.createBetChipPresentation()) { return app.buildSettlementPresentationSnapshot(betting.settleBets(bets, result), presentation); }

test("PLAYER Win targets a presentation WIN with the exact total return", () => {
  const bets = { PLAYER: 500, BANKER: 0, TIE: 0, PLAYER_PAIR: 0, BANKER_PAIR: 0 };
  const snapshots = snapshotFor(bets, { winner: "PLAYER", playerPair: false, bankerPair: false });
  assert.deepEqual(snapshots.map((item) => [item.area, item.outcome, item.totalReturn]), [["PLAYER", "WIN", 1000]]);
});

test("BANKER commission stays settlement-engine exact and labels +1,950", () => {
  const bets = { PLAYER: 0, BANKER: 1000, TIE: 0, PLAYER_PAIR: 0, BANKER_PAIR: 0 };
  const snapshots = snapshotFor(bets, { winner: "BANKER", playerPair: false, bankerPair: false });
  assert.equal(snapshots[0].outcome, "WIN"); assert.equal(snapshots[0].totalReturn, 1950);
  assert.match(source, /\+\$\{formatMoney\(snapshot\.totalReturn\)\}/);
});

test("LOSS and PUSH derive only from existing settlement outcomes", () => {
  const loss = snapshotFor({ PLAYER: 500, BANKER: 0, TIE: 0, PLAYER_PAIR: 0, BANKER_PAIR: 0 }, { winner: "BANKER", playerPair: false, bankerPair: false })[0];
  const push = snapshotFor({ PLAYER: 500, BANKER: 0, TIE: 0, PLAYER_PAIR: 0, BANKER_PAIR: 0 }, { winner: "TIE", playerPair: false, bankerPair: false })[0];
  assert.equal(loss.outcome, "LOSS"); assert.equal(loss.totalReturn, 0);
  assert.equal(push.outcome, "PUSH"); assert.equal(push.totalReturn, 500);
  assert.match(source, /function classifyBetSettlement\(settlementItem\)/);
});

test("TIE and Pair wins keep exact returns while payout ghosts remain compressed", () => {
  const tie = snapshotFor({ PLAYER: 0, BANKER: 0, TIE: 500, PLAYER_PAIR: 0, BANKER_PAIR: 0 }, { winner: "TIE", playerPair: false, bankerPair: false })[0];
  const pair = snapshotFor({ PLAYER: 0, BANKER: 0, TIE: 0, PLAYER_PAIR: 1000, BANKER_PAIR: 0 }, { winner: "BANKER", playerPair: true, bankerPair: false })[0];
  assert.equal(tie.totalReturn, 4500); assert.equal(pair.totalReturn, 12000);
  assert.ok(app.choosePayoutDenominations({ ...pair, denominations: [1000] }).length <= app.MAX_PAYOUT_GHOST_CHIPS_PER_AREA);
});

test("Settlement batch snapshots visible chips before clearing table presentation and preserves Repeat snapshot", () => {
  const presentation = app.createBetChipPresentation(); presentation.BANKER.push(500, 1000);
  const snapshots = app.buildSettlementPresentationSnapshot({ settlements: { BANKER: { betType: "BANKER", stake: 1500, outcome: betting.OUTCOMES.WIN, returnAmount: 2925 } } }, presentation);
  assert.deepEqual(snapshots[0].denominations, [500, 1000]);
  assert.match(source, /const visibleByArea = getVisibleSettlementChipRects\(\)/);
  assert.match(source, /game\.clearBetChipPresentation\(\)/);
  assert.deepEqual(presentation.BANKER, [500, 1000]);
});

test("LOSS, WIN, and PUSH batches start in parallel and use the shared animation layer", () => {
  assert.match(source, /const tasks = snapshots\.flatMap/);
  assert.match(source, /await Promise\.allSettled\(tasks\)/);
  assert.doesNotMatch(source, /await animateLossChipCollection/);
  assert.match(source, /getDiscardTargetRect\(\)/);
  assert.match(source, /getBalanceTargetRect\(\)/);
  assert.match(source, /chipAnimationLayer/);
});

test("Settlement presentation has bounded timing, no loss/push label, and safe reduced-motion fallback", () => {
  assert.equal(app.CHIP_LOSS_COLLECTION_DURATION_MS, 240);
  assert.equal(app.CHIP_WIN_PAYOUT_DURATION_MS, 280);
  assert.equal(app.CHIP_PUSH_RETURN_DURATION_MS, 240);
  assert.equal(app.MAX_PAYOUT_GHOST_CHIPS_PER_AREA, 4);
  assert.match(source, /if \(isReducedMotion\(\) \|\| document\.hidden\) return/);
  assert.match(css, /\.settlement-payout-label/);
});

test("Last Hand Shoe Complete waits for the presentation callback after engine settlement", () => {
  const settlementIndex = source.indexOf("this.settlement = betting.settleRound");
  const presentationIndex = source.indexOf("await this.onSettlementPresentation");
  const cutFlowIndex = source.indexOf("this.completeCurrentRoundCutFlow");
  assert.ok(settlementIndex < presentationIndex && presentationIndex < cutFlowIndex);
  assert.match(source, /cleanupSettlementPresentation/);
});

console.log(`\nTEST SUMMARY: Passed: ${passed}; Failed: ${failed}`);
if (failed) process.exitCode = 1;
