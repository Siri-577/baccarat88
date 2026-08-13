"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const app = require("./app");
const html = fs.readFileSync("index.html", "utf8");
const css = fs.readFileSync("style.css", "utf8");

let passed = 0;
let failed = 0;
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
function game() { return new app.BaccaratGameController({ random: () => 0.5 }); }
function burnDom() { return { burnCard: { hidden: false, className: "burn-card" }, burnRank: { textContent: "" }, burnValue: { textContent: "" } }; }
function renderBurn(gameController, elements = burnDom()) { app.renderBurnPresentation(elements, gameController); return elements; }

test("Burn values use rank values, not Baccarat point values", () => {
  for (const [rank, expected] of Object.entries({ A: 1, 5: 5, 9: 9, 10: 10, J: 10, Q: 10, K: 10 })) {
    assert.equal(app.getBurnValue({ rank }), expected, rank);
  }
});

test("Invalid Burn Card ranks are rejected", () => assert.throws(() => app.getBurnValue({ rank: "X" }), RangeError));

test("Burn Card UI is a non-layout overlay in the table", () => {
  assert.match(html, /<section class="casino-table">[\s\S]*?id="burn-card"/);
  assert.match(css, /\.burn-card\s*\{[^}]*position:\s*absolute[^}]*pointer-events:\s*none/);
});

test("Burn Card overlay remains compact on mobile", () => assert.match(css, /@media \(max-width: 760px\)[\s\S]*?\.burn-card\s*\{[^}]*min-width:\s*126px/));

test("A new Shoe begins with the Burn Card presentation visible", () => {
  const controller = game();
  const elements = renderBurn(controller);
  assert.equal(controller.burnState.completed, true);
  assert.equal(controller.burnPresentationVisible, true);
  assert.equal(controller.totalBet, 0);
  assert.equal(elements.burnCard.hidden, false);
});

for (const betType of ["PLAYER", "BANKER", "TIE", "PLAYER_PAIR", "BANKER_PAIR"]) {
  test(`The first ${betType} bet hides the Burn Card presentation`, () => {
    const controller = game();
    assert.equal(controller.placeSelectedBet(betType), true);
    const elements = renderBurn(controller);
    assert.equal(controller.totalBet, 100);
    assert.equal(controller.burnPresentationVisible, false);
    assert.equal(elements.burnCard.hidden, true);
  });
}

test("Selecting a chip without placing a bet leaves the Burn Card presentation visible", () => {
  const controller = game();
  assert.equal(controller.selectChip(500), true);
  assert.equal(controller.totalBet, 0);
  assert.equal(controller.burnPresentationVisible, true);
});

test("Undo and Clear do not restore a Burn Card presentation once hidden", () => {
  const controller = game();
  controller.placeSelectedBet("PLAYER");
  assert.equal(controller.undoBet(), true);
  assert.equal(controller.totalBet, 0);
  assert.equal(controller.burnPresentationVisible, false);
  controller.placeSelectedBet("BANKER");
  assert.equal(controller.clearBets(), true);
  assert.equal(controller.totalBet, 0);
  assert.equal(controller.burnPresentationVisible, false);
});

test("A successful Repeat bet hides the Burn Card presentation", () => {
  const controller = game();
  controller.lastConfirmedBetSnapshot = { PLAYER: 100, BANKER: 0, TIE: 0, PLAYER_PAIR: 0, BANKER_PAIR: 0 };
  assert.equal(controller.repeatLastBet(), true);
  const elements = renderBurn(controller);
  assert.equal(controller.totalBet, 100);
  assert.equal(controller.burnPresentationVisible, false);
  assert.equal(elements.burnCard.hidden, true);
});

test("Re-rendering after a first bet or later round state keeps the overlay hidden", () => {
  const controller = game();
  controller.placeSelectedBet("PLAYER");
  const elements = burnDom();
  renderBurn(controller, elements);
  assert.equal(elements.burnCard.hidden, true);
  controller.state = app.GAME_STATES.AUTO_DEALING;
  renderBurn(controller, elements);
  assert.equal(elements.burnCard.hidden, true);
  controller.state = app.GAME_STATES.ROUND_END;
  renderBurn(controller, elements);
  assert.equal(elements.burnCard.hidden, true);
});

test("NEXT ROUND does not restore the hidden Burn Card presentation", async () => {
  const controller = game();
  controller.placeSelectedBet("PLAYER");
  controller.state = app.GAME_STATES.ROUND_END;
  await controller.nextRound();
  assert.equal(controller.state, app.GAME_STATES.BETTING);
  assert.equal(controller.burnPresentationVisible, false);
});

test("New Shoe resets the Burn Card presentation without changing Burn data semantics", () => {
  const controller = game();
  controller.placeSelectedBet("PLAYER");
  assert.equal(controller.burnPresentationVisible, false);
  assert.equal(controller.startNewShoe({ debugForcedRank: "7" }), true);
  const elements = renderBurn(controller);
  assert.equal(controller.burnPresentationVisible, true);
  assert.equal(controller.burnState.completed, true);
  assert.equal(controller.burnState.burnValue, 7);
  assert.equal(elements.burnCard.hidden, false);
});

for (const [rank, burnValue] of Object.entries({ A: 1, 5: 5, 9: 9, 10: 10, J: 10, Q: 10, K: 10 })) {
  test(`${rank} burns the revealed card plus ${burnValue} additional cards`, () => {
    const controller = game();
    assert.equal(controller.startNewShoe({ debugForcedRank: rank }), true);
    const burn = controller.burnState;
    assert.equal(burn.completed, true);
    assert.equal(burn.revealedCard.rank, rank);
    assert.equal(burn.burnValue, burnValue);
    assert.equal(burn.additionalCards.length, burnValue);
    assert.equal(burn.totalBurned, burnValue + 1);
    assert.equal(controller.shoe.length, 416 - burn.totalBurned);
  });
}

test("Burned card objects are genuinely removed from the Shoe", () => {
  const controller = game();
  controller.startNewShoe({ debugForcedRank: "7" });
  const burned = new Set([controller.burnState.revealedCard, ...controller.burnState.additionalCards]);
  assert.equal([...burned].some((card) => controller.shoe.includes(card)), false);
});

test("A completed Shoe cannot burn twice", () => {
  const controller = game();
  const before = controller.shoe.length;
  const prior = controller.burnState;
  assert.strictEqual(controller.performBurn(), prior);
  assert.equal(controller.shoe.length, before);
});

test("Burning is not a Roadmap result or a Round", () => {
  const controller = game();
  assert.equal(controller.roundId, 1);
  assert.equal(controller.roadHistory.length, 0);
  assert.equal(controller.hasRecordedRoadForCurrentRound, false);
});

test("BURNING locks betting and formal dealing until presentation completes", async () => {
  const controller = game();
  controller.startNewShoe({ debugForcedRank: "A" });
  assert.equal(controller.state, app.GAME_STATES.BURNING);
  assert.equal(controller.placeSelectedBet("PLAYER"), false);
  assert.equal(await controller.prepareDeal(async () => {}), false);
  assert.equal(controller.completeBurnPresentation(), true);
  assert.equal(controller.state, app.GAME_STATES.BETTING);
});

test("A formal round cannot receive a burned card", async () => {
  const controller = game();
  const burned = new Set([controller.burnState.revealedCard, ...controller.burnState.additionalCards]);
  controller.selectedChip = 100;
  assert.equal(controller.placeSelectedBet("PLAYER"), true);
  assert.equal(await controller.prepareDeal(async () => {}), true);
  const roundCards = [...controller.roundResult.playerCards, ...controller.roundResult.bankerCards];
  assert.equal(roundCards.some((card) => burned.has(card)), false);
});

test("Starting a new Shoe burns anew while retaining confirmed Repeat data", () => {
  const controller = game();
  controller.lastConfirmedBetSnapshot = { PLAYER: 100, BANKER: 0, TIE: 0, PLAYER_PAIR: 0, BANKER_PAIR: 0 };
  const balance = controller.account.balance;
  const oldShoeId = controller.shoeId;
  assert.equal(controller.startNewShoe({ debugForcedRank: "K" }), true);
  assert.equal(controller.shoeId, oldShoeId + 1);
  assert.equal(controller.burnState.burnValue, 10);
  assert.equal(controller.roadHistory.length, 0);
  assert.equal(controller.account.balance, balance);
  assert.equal(controller.lastConfirmedBetSnapshot.PLAYER, 100);
});

(async () => {
  for (const { name, fn } of tests) {
    try { await fn(); passed += 1; console.log(`PASS: ${name}`); }
    catch (error) { failed += 1; console.error(`FAIL: ${name} — ${error.message}`); }
  }
  console.log(`\nTEST SUMMARY: Passed: ${passed}; Failed: ${failed}`);
  if (failed) process.exitCode = 1;
})();
