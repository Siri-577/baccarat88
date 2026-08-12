"use strict";

const assert = require("node:assert/strict");
const app = require("./app");
const betting = require("./betting-engine");

let passed = 0; let failed = 0; const failures = [];
function test(name, fn) { try { fn(); passed += 1; console.log(`PASS: ${name}`); } catch (error) { failed += 1; failures.push({ name, error }); console.error(`FAIL: ${name} — ${error.message}`); } }

test("defaults match V0.5 economic parameters", () => {
  const game = new app.BaccaratGameController();
  assert.equal(game.account.balance, 100000); assert.equal(game.selectedChip, 100); assert.deepEqual(app.CHIP_VALUES, [10, 50, 100, 500, 1000, 5000]);
});
test("add bets, multiple areas, undo, and clear return balance correctly", () => {
  const game = new app.BaccaratGameController();
  game.placeSelectedBet("PLAYER"); game.selectChip(50); game.placeSelectedBet("TIE"); game.selectChip(500); game.placeSelectedBet("BANKER_PAIR");
  assert.equal(game.totalBet, 650); assert.equal(game.account.balance, 99350);
  game.undoBet(); assert.equal(game.bettingRound.bets.BANKER_PAIR, 0); assert.equal(game.account.balance, 99850);
  game.clearBets(); assert.equal(game.totalBet, 0); assert.equal(game.account.balance, 100000);
});
test("area and round limits reject whole chips", () => {
  const game = new app.BaccaratGameController(); game.selectChip(5000);
  for (let index = 0; index < 4; index += 1) assert.equal(game.placeSelectedBet("PLAYER"), true);
  assert.equal(game.placeSelectedBet("PLAYER"), false); assert.equal(game.bettingRound.bets.PLAYER, 20000);
  for (let index = 0; index < 4; index += 1) assert.equal(game.placeSelectedBet("BANKER"), true);
  assert.equal(game.placeSelectedBet("TIE"), true); assert.equal(game.placeSelectedBet("TIE"), true);
  assert.equal(game.totalBet, 50000); game.selectChip(10);
  assert.equal(game.placeSelectedBet("PLAYER_PAIR"), false); assert.equal(game.totalBet, 50000);
});
test("insufficient balance is rejected", () => {
  const game = new app.BaccaratGameController({ initialBalance: 100 }); game.selectChip(500);
  assert.equal(game.placeSelectedBet("PLAYER"), false); assert.equal(game.account.balance, 100); assert.equal(game.totalBet, 0);
});
test("deal locks bets, uses real round engines, then next round preserves balance", () => {
  const game = new app.BaccaratGameController(); game.placeSelectedBet("PLAYER"); const starting = game.account.balance;
  assert.equal(game.dealRound(), true); assert.equal(game.state, app.GAME_STATES.ROUND_END); assert.ok(game.roundResult.cardsUsed >= 4 && game.roundResult.cardsUsed <= 6); assert.ok(game.settlement);
  assert.equal(game.placeSelectedBet("PLAYER"), false); assert.equal(game.undoBet(), false); assert.notEqual(game.account.balance, starting - 100);
  assert.equal(game.nextRound(), true); assert.equal(game.roundId, 2); assert.equal(game.totalBet, 0); assert.equal(game.state, app.GAME_STATES.BETTING);
});
test("continuous shoe reshuffles only before a new round", () => {
  const game = new app.BaccaratGameController(); game.shoe.length = 59; game.placeSelectedBet("PLAYER"); assert.equal(game.dealRound(), true); assert.ok(game.shoe.length >= 410 && game.shoe.length <= 412);
});
test("100 consecutive playable rounds remain stable", () => {
  const game = new app.BaccaratGameController();
  for (let index = 1; index <= 100; index += 1) {
    game.selectChip(10); assert.equal(game.placeSelectedBet(index % 2 ? "PLAYER" : "BANKER"), true); assert.equal(game.dealRound(), true);
    assert.ok(Number.isFinite(game.account.balance) && game.account.balance >= 0); assert.ok(game.roundResult.cardsUsed >= 4 && game.roundResult.cardsUsed <= 6); assert.equal(game.roundId, index);
    assert.equal(game.nextRound(), true);
  }
  assert.equal(game.roundId, 101);
});
console.log(`\nTEST SUMMARY: Passed: ${passed}; Failed: ${failed}`);
if (failed > 0) { for (const item of failures) console.error(item.name, item.error.stack); process.exitCode = 1; }
