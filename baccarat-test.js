"use strict";

const assert = require("node:assert/strict");
const engine = require("./baccarat-engine");

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

function card(rank, suit = "spades") {
  return { id: `test-${rank}-${suit}`, deckIndex: 0, suit, rank, baccaratValue: engine.getBaccaratValue(rank) };
}

test("8-deck shoe contains exactly 416 cards", () => {
  const shoe = engine.createShoe();
  assert.equal(shoe.length, 416);
  assert.equal(new Set(shoe.map((item) => item.id)).size, 416);
});

test("drawing removes the exact card from the shoe", () => {
  const shoe = engine.createShoe();
  const topCard = shoe.at(-1);
  const drawn = engine.drawCard(shoe);
  assert.equal(drawn, topCard);
  assert.equal(shoe.length, 415);
});

test("all baccarat card values are correct", () => {
  const expected = { A: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8, 9: 9, 10: 0, J: 0, Q: 0, K: 0 };
  for (const [rank, value] of Object.entries(expected)) assert.equal(engine.getBaccaratValue(rank), value, rank);
});

test("baccarat score wraps 7 + 8 to 5 and 9 + 9 to 8", () => {
  assert.equal(engine.calculateBaccaratScore([card("7"), card("8")]), 5);
  assert.equal(engine.calculateBaccaratScore([card("9"), card("9")]), 8);
  assert.equal(engine.calculateBaccaratScore([card("K"), card("6")]), 6);
});

test("Natural 8 or 9 is recognized", () => {
  assert.equal(engine.isNatural(9, 5), true);
  assert.equal(engine.isNatural(5, 8), true);
  assert.equal(engine.isNatural(7, 7), false);
});

test("Player draws on 0 through 5 and stands on 6 through 7", () => {
  for (let score = 0; score <= 5; score += 1) assert.equal(engine.shouldPlayerDraw(score), true, String(score));
  for (let score = 6; score <= 7; score += 1) assert.equal(engine.shouldPlayerDraw(score), false, String(score));
});

test("Banker rule when Player stands", () => {
  for (let score = 0; score <= 5; score += 1) assert.equal(engine.shouldBankerDraw(score, false), true, String(score));
  for (let score = 6; score <= 7; score += 1) assert.equal(engine.shouldBankerDraw(score, false), false, String(score));
});

test("full Banker third-card decision matrix", () => {
  const expectedDraws = {
    0: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    1: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    2: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    3: [0, 1, 2, 3, 4, 5, 6, 7, 9],
    4: [2, 3, 4, 5, 6, 7],
    5: [4, 5, 6, 7],
    6: [6, 7],
    7: [],
  };
  for (const [scoreText, draws] of Object.entries(expectedDraws)) {
    const score = Number(scoreText);
    for (let value = 0; value <= 9; value += 1) {
      assert.equal(engine.shouldBankerDraw(score, true, value), draws.includes(value), `banker ${score}, player third ${value}`);
    }
  }
});

test("Pair uses rank, never baccarat value", () => {
  assert.equal(engine.isPair([card("K"), card("K", "hearts")]), true);
  assert.equal(engine.isPair([card("K"), card("Q")]), false);
  assert.equal(engine.isPair([card("10"), card("J")]), false);
});

test("Natural round stops after initial four cards", () => {
  // drawCard pops: reverse the locked dealing order in the shoe.
  const shoe = [card("5"), card("K"), card("6"), card("9")];
  const result = engine.playRound(shoe);
  assert.equal(result.natural, true);
  assert.equal(result.cardsUsed, 4);
  assert.equal(result.playerDrewThirdCard, false);
  assert.equal(result.bankerDrewThirdCard, false);
});

test("initial deal is Player, Banker, Player, Banker", () => {
  const shoe = [card("6"), card("5"), card("4"), card("3"), card("2"), card("A")];
  const result = engine.playRound(shoe);
  assert.deepEqual(result.playerCards.slice(0, 2).map((item) => item.rank), ["A", "3"]);
  assert.deepEqual(result.bankerCards.slice(0, 2).map((item) => item.rank), ["2", "4"]);
});

test("round execution uses the Banker 3 / Player third 8 exception", () => {
  // Pop order: P=2, B=A, P=3, B=2, P third=8. Banker must stand on 3.
  const shoe = [card("8"), card("2"), card("3"), card("A"), card("2")];
  const result = engine.playRound(shoe);
  assert.equal(result.playerDrewThirdCard, true);
  assert.equal(result.bankerDrewThirdCard, false);
  assert.equal(result.bankerInitialScore, 3);
});

test("10,000 random rounds complete with valid state", () => {
  const rounds = 10000;
  let shoe = engine.shuffleShoe(engine.createShoe());
  let minCards = Infinity;
  let maxCards = -Infinity;
  for (let index = 0; index < rounds; index += 1) {
    if (shoe.length < 6) shoe = engine.shuffleShoe(engine.createShoe());
    const before = shoe.length;
    const result = engine.playRound(shoe);
    assert.ok(result.cardsUsed >= 4 && result.cardsUsed <= 6);
    assert.equal(result.remainingCards, before - result.cardsUsed);
    assert.ok(result.remainingCards >= 0);
    assert.ok(result.playerFinalScore >= 0 && result.playerFinalScore <= 9);
    assert.ok(result.bankerFinalScore >= 0 && result.bankerFinalScore <= 9);
    assert.ok(Object.values(engine.WINNERS).includes(result.winner));
    assert.ok(result.playerCards.every(Boolean) && result.bankerCards.every(Boolean));
    minCards = Math.min(minCards, result.cardsUsed);
    maxCards = Math.max(maxCards, result.cardsUsed);
  }
  console.log(`RANDOM SUMMARY: rounds=${rounds}, minCards=${minCards}, maxCards=${maxCards}, finalScoresWithin0to9=true, drawErrors=0, negativeShoe=false`);
});

console.log(`\nTEST SUMMARY: Passed: ${passed}; Failed: ${failed}`);
if (failed > 0) {
  for (const failure of failures) console.error(`${failure.name}:`, failure.error.stack);
  process.exitCode = 1;
}
