"use strict";

const assert = require("node:assert/strict");
const app = require("./app");

let passed = 0; let failed = 0; const failures = [];
function test(name, fn) { try { fn(); passed += 1; console.log(`PASS: ${name}`); } catch (error) { failed += 1; failures.push({ name, error }); console.error(`FAIL: ${name} — ${error.message}`); } }
const card = (rank) => ({ rank, suit: "spades", baccaratValue: rank === "A" ? 1 : ["10", "J", "Q", "K"].includes(rank) ? 0 : Number(rank) });
const lockedResult = (playerRanks, bankerRanks) => ({ playerCards: playerRanks.map(card), bankerCards: bankerRanks.map(card) });
function revealAll(game) { while ([app.GAME_STATES.DEAL_READY, app.GAME_STATES.DEALING].includes(game.state)) assert.equal(game.revealNextCard(), true); }

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
test("DEAL locks full real result before any card is revealed", () => {
  const game = new app.BaccaratGameController(); game.placeSelectedBet("PLAYER"); const balanceAfterBet = game.account.balance;
  assert.equal(game.dealRound(), true); assert.equal(game.state, app.GAME_STATES.DEAL_READY); assert.ok(game.roundResult.cardsUsed >= 4 && game.roundResult.cardsUsed <= 6); assert.equal(game.settlement, null); assert.equal(game.revealedCards.PLAYER.length, 0);
  assert.equal(game.placeSelectedBet("PLAYER"), false); assert.equal(game.undoBet(), false); assert.equal(game.account.balance, balanceAfterBet);
  revealAll(game); assert.equal(game.state, app.GAME_STATES.ROUND_END); assert.ok(game.settlement);
  assert.equal(game.nextRound(), true); assert.equal(game.roundId, 2); assert.equal(game.totalBet, 0); assert.equal(game.state, app.GAME_STATES.BETTING);
});
test("deal queues use mandatory four-card order plus dynamic third cards", () => {
  const order = (result) => app.buildDealQueue(result).map((item) => `${item.side}${item.cardIndex + 1}`);
  assert.deepEqual(order(lockedResult(["6", "K"], ["J", "Q"])), ["PLAYER1", "BANKER1", "PLAYER2", "BANKER2"]);
  assert.deepEqual(order(lockedResult(["2", "3", "4"], ["5", "6"])), ["PLAYER1", "BANKER1", "PLAYER2", "BANKER2", "PLAYER3"]);
  assert.deepEqual(order(lockedResult(["6", "K"], ["J", "Q", "4"])), ["PLAYER1", "BANKER1", "PLAYER2", "BANKER2", "BANKER3"]);
  assert.deepEqual(order(lockedResult(["2", "3", "4"], ["5", "6", "7"])), ["PLAYER1", "BANKER1", "PLAYER2", "BANKER2", "PLAYER3", "BANKER3"]);
});
test("Natural 8 and Natural 9 presentation queues stop after four cards", () => {
  const order = (result) => app.buildDealQueue(result).map((item) => `${item.side}${item.cardIndex + 1}`);
  assert.deepEqual(order(lockedResult(["9", "K"], ["4", "3"])), ["PLAYER1", "BANKER1", "PLAYER2", "BANKER2"]);
  assert.deepEqual(order(lockedResult(["4", "4"], ["9", "K"])), ["PLAYER1", "BANKER1", "PLAYER2", "BANKER2"]);
});
test("third-card queue labels explicitly identify draw cards", () => {
  const queue = app.buildDealQueue(lockedResult(["2", "3", "4"], ["5", "6", "7"]));
  assert.match(queue[4].label, /PLAYER 第3张（补牌）/); assert.match(queue[5].label, /BANKER 第3张（补牌）/);
});
test("manual reveal advances one card only and settles once at the final card", () => {
  const game = new app.BaccaratGameController(); game.placeSelectedBet("PLAYER"); game.prepareDeal(); const expected = game.dealQueue.length;
  for (let index = 0; index < expected; index += 1) { const before = game.currentDealIndex; assert.equal(game.revealNextCard(), true); assert.equal(game.currentDealIndex, before + 1); if (index < expected - 1) assert.equal(game.settlement, null); }
  assert.equal(game.state, app.GAME_STATES.ROUND_END); const balance = game.account.balance; assert.equal(game.revealNextCard(), false); assert.equal(game.account.balance, balance);
});
test("continuous shoe reshuffles only before a new round", () => {
  const game = new app.BaccaratGameController(); game.shoe.length = 59; game.placeSelectedBet("PLAYER"); assert.equal(game.dealRound(), true); assert.ok(game.shoe.length >= 410 && game.shoe.length <= 412); revealAll(game);
});
test("30 consecutive manual rounds remain stable", () => {
  const game = new app.BaccaratGameController();
  for (let index = 1; index <= 30; index += 1) {
    game.selectChip(10); assert.equal(game.placeSelectedBet(index % 2 ? "PLAYER" : "BANKER"), true); assert.equal(game.dealRound(), true);
    revealAll(game); assert.ok(Number.isFinite(game.account.balance) && game.account.balance >= 0); assert.ok(game.roundResult.cardsUsed >= 4 && game.roundResult.cardsUsed <= 6); assert.equal(game.roundId, index);
    assert.equal(game.nextRound(), true);
  }
  assert.equal(game.roundId, 31);
});
console.log(`\nTEST SUMMARY: Passed: ${passed}; Failed: ${failed}`);
if (failed > 0) { for (const item of failures) console.error(item.name, item.error.stack); process.exitCode = 1; }
