"use strict";

const assert = require("node:assert/strict");
const betting = require("./betting-engine");
const baccarat = require("./baccarat-engine");

let passed = 0;
let failed = 0;
const failures = [];
const result = (winner, playerPair = false, bankerPair = false) => ({ winner, playerPair, bankerPair });

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

function openRound(balance = 10000, roundId = 1) {
  const account = betting.createPlayerAccount(balance);
  return { account, round: betting.createBettingRound(roundId, account) };
}

function settle(account, round, roundResult) {
  betting.closeBetting(round);
  return betting.settleRound(account, round, roundResult);
}

test("PLAYER win pays 1:1", () => {
  const { account, round } = openRound();
  betting.placeBet(account, round, betting.BET_TYPES.PLAYER, 100);
  const settlement = settle(account, round, result("PLAYER"));
  assert.deepEqual(settlement.settlements.PLAYER, { betType: "PLAYER", stake: 100, outcome: "WIN", odds: 1, profit: 100, returnAmount: 200 });
  assert.equal(settlement.netResult, 100);
});

test("PLAYER loses when BANKER wins", () => {
  const { account, round } = openRound();
  betting.placeBet(account, round, betting.BET_TYPES.PLAYER, 100);
  const settlement = settle(account, round, result("BANKER"));
  assert.equal(settlement.settlements.PLAYER.returnAmount, 0);
  assert.equal(settlement.netResult, -100);
});

test("BANKER win includes 5% commission through 0.95 odds", () => {
  const { account, round } = openRound();
  betting.placeBet(account, round, betting.BET_TYPES.BANKER, 100);
  const settlement = settle(account, round, result("BANKER"));
  assert.equal(settlement.settlements.BANKER.profit, 95);
  assert.equal(settlement.settlements.BANKER.returnAmount, 195);
});

test("BANKER loses when PLAYER wins", () => {
  const { account, round } = openRound();
  betting.placeBet(account, round, betting.BET_TYPES.BANKER, 100);
  assert.equal(settle(account, round, result("PLAYER")).settlements.BANKER.returnAmount, 0);
});

test("TIE pays 8:1 profit", () => {
  const { account, round } = openRound();
  betting.placeBet(account, round, betting.BET_TYPES.TIE, 100);
  const item = settle(account, round, result("TIE")).settlements.TIE;
  assert.equal(item.profit, 800);
  assert.equal(item.returnAmount, 900);
});

test("PLAYER and BANKER are pushes on a Tie", () => {
  const { account, round } = openRound();
  betting.placeBet(account, round, betting.BET_TYPES.PLAYER, 100);
  betting.placeBet(account, round, betting.BET_TYPES.BANKER, 200);
  const settlement = settle(account, round, result("TIE"));
  assert.equal(settlement.settlements.PLAYER.outcome, "PUSH");
  assert.equal(settlement.settlements.PLAYER.returnAmount, 100);
  assert.equal(settlement.settlements.BANKER.outcome, "PUSH");
  assert.equal(settlement.settlements.BANKER.returnAmount, 200);
});

test("PLAYER_PAIR and BANKER_PAIR settle independently", () => {
  const { account, round } = openRound();
  betting.placeBet(account, round, betting.BET_TYPES.PLAYER_PAIR, 100);
  betting.placeBet(account, round, betting.BET_TYPES.BANKER_PAIR, 100);
  const settlement = settle(account, round, result("BANKER", true, false));
  assert.equal(settlement.settlements.PLAYER_PAIR.returnAmount, 1200);
  assert.equal(settlement.settlements.BANKER_PAIR.returnAmount, 0);
});

test("multiple winning bets all pay", () => {
  const { account, round } = openRound();
  betting.placeBet(account, round, betting.BET_TYPES.BANKER, 100);
  betting.placeBet(account, round, betting.BET_TYPES.PLAYER_PAIR, 20);
  betting.placeBet(account, round, betting.BET_TYPES.BANKER_PAIR, 30);
  const settlement = settle(account, round, result("BANKER", true, true));
  assert.equal(settlement.settlements.BANKER.returnAmount, 195);
  assert.equal(settlement.settlements.PLAYER_PAIR.returnAmount, 240);
  assert.equal(settlement.settlements.BANKER_PAIR.returnAmount, 360);
  assert.equal(settlement.totalBet, 150);
  assert.equal(settlement.totalReturn, 795);
  assert.equal(settlement.netResult, 645);
});

test("PLAYER and BANKER bets may coexist", () => {
  const { account, round } = openRound();
  betting.placeBet(account, round, betting.BET_TYPES.PLAYER, 100);
  betting.placeBet(account, round, betting.BET_TYPES.BANKER, 200);
  const settlement = settle(account, round, result("PLAYER"));
  assert.equal(settlement.totalBet, 300);
  assert.equal(settlement.totalReturn, 200);
  assert.equal(settlement.netResult, -100);
});

test("Tie plus multiple main bets returns pushes and Tie profit", () => {
  const { account, round } = openRound();
  betting.placeBet(account, round, betting.BET_TYPES.PLAYER, 100);
  betting.placeBet(account, round, betting.BET_TYPES.BANKER, 200);
  betting.placeBet(account, round, betting.BET_TYPES.TIE, 50);
  const settlement = settle(account, round, result("TIE"));
  assert.equal(settlement.totalBet, 350);
  assert.equal(settlement.totalReturn, 750);
  assert.equal(settlement.netResult, 400);
});

test("balance is debited on bet and credited exactly once on settlement", () => {
  const { account, round } = openRound(10000);
  betting.placeBet(account, round, betting.BET_TYPES.PLAYER, 100);
  assert.equal(account.balance, 9900);
  const settlement = settle(account, round, result("PLAYER"));
  assert.equal(settlement.balanceBeforeRound, 10000);
  assert.equal(settlement.balanceAfterBet, 9900);
  assert.equal(account.balance, 10100);
});

test("adding to a bet area accumulates rather than overwrites", () => {
  const { account, round } = openRound();
  betting.placeBet(account, round, betting.BET_TYPES.PLAYER, 100);
  betting.placeBet(account, round, betting.BET_TYPES.PLAYER, 500);
  assert.equal(round.bets.PLAYER, 600);
  assert.equal(account.balance, 9400);
});

test("insufficient funds and invalid amounts are rejected without mutation", () => {
  const { account, round } = openRound(100);
  assert.throws(() => betting.placeBet(account, round, betting.BET_TYPES.PLAYER, 500));
  for (const amount of [0, -100, NaN, Infinity, "100", null, undefined]) {
    assert.throws(() => betting.placeBet(account, round, betting.BET_TYPES.PLAYER, amount));
  }
  assert.throws(() => betting.placeBet(account, round, "DRAGON", 10));
  assert.equal(account.balance, 100);
  assert.equal(round.bets.PLAYER, 0);
});

test("closed betting rejects changes and duplicate settlement is blocked", () => {
  const { account, round } = openRound();
  betting.placeBet(account, round, betting.BET_TYPES.PLAYER, 100);
  betting.closeBetting(round);
  assert.throws(() => betting.placeBet(account, round, betting.BET_TYPES.PLAYER, 1));
  const first = betting.settleRound(account, round, result("PLAYER"));
  const balance = account.balance;
  assert.throws(() => betting.settleRound(account, round, result("PLAYER")));
  assert.equal(account.balance, balance);
  assert.equal(first.totalReturn, 200);
});

test("Banker decimal money is normalized to two decimals", () => {
  const { account, round } = openRound(100);
  betting.placeBet(account, round, betting.BET_TYPES.BANKER, 10);
  const item = settle(account, round, result("BANKER")).settlements.BANKER;
  assert.equal(item.profit, 9.5);
  assert.equal(item.returnAmount, 19.5);
  assert.equal(account.balance, 109.5);
});

test("reset preserves settlement snapshot while clearing current bets", () => {
  const { account, round } = openRound();
  betting.placeBet(account, round, betting.BET_TYPES.PLAYER, 100);
  const settlement = settle(account, round, result("PLAYER"));
  betting.resetBets(round);
  assert.equal(round.bets.PLAYER, 0);
  assert.equal(settlement.bets.PLAYER, 100);
});

test("10,000 integrated random rounds remain financially consistent", () => {
  const account = betting.createPlayerAccount(1000000);
  let shoe = baccarat.shuffleShoe(baccarat.createShoe());
  const types = Object.values(betting.BET_TYPES);
  for (let roundId = 1; roundId <= 10000; roundId += 1) {
    if (shoe.length < 6) shoe = baccarat.shuffleShoe(baccarat.createShoe());
    const round = betting.createBettingRound(roundId, account);
    for (const type of types) {
      if (Math.random() < 0.45) betting.placeBet(account, round, type, 1 + Math.floor(Math.random() * 25));
    }
    betting.closeBetting(round);
    const baccaratResult = baccarat.playRound(shoe);
    const settlement = betting.settleRound(account, round, baccaratResult);
    const items = Object.values(settlement.settlements);
    assert.ok(Number.isFinite(account.balance) && account.balance >= 0);
    assert.ok(items.every((item) => item.stake >= 0 && item.returnAmount >= 0));
    assert.equal(settlement.totalBet, betting.roundMoney(items.reduce((sum, item) => sum + item.stake, 0)));
    assert.equal(settlement.totalReturn, betting.roundMoney(items.reduce((sum, item) => sum + item.returnAmount, 0)));
    assert.equal(settlement.netResult, betting.roundMoney(settlement.totalReturn - settlement.totalBet));
    assert.throws(() => betting.settleRound(account, round, baccaratResult));
  }
  console.log("RANDOM SUMMARY: rounds=10000, exceptions=0, NaN=false, Infinity=false, negativeBalance=false, duplicateSettlement=false, moneyErrors=false, unknownBetType=false");
});

console.log(`\nTEST SUMMARY: Passed: ${passed}; Failed: ${failed}`);
if (failed > 0) {
  for (const failure of failures) console.error(`${failure.name}:`, failure.error.stack);
  process.exitCode = 1;
}
