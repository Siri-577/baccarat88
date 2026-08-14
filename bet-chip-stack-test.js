"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const app = require("./app");
const css = fs.readFileSync("style.css", "utf8");
const source = fs.readFileSync("app.js", "utf8");
let passed = 0;
let failed = 0;
function test(name, fn) { try { fn(); passed += 1; console.log(`PASS: ${name}`); } catch (error) { failed += 1; console.error(`FAIL: ${name} — ${error.message}`); } }
function place(game, area, denomination) { game.selectChip(denomination); assert.equal(game.placeSelectedBet(area), true); }

test("First-seen denomination order creates independent columns without sorting", () => {
  const state = app.createBetChipPresentation();
  state.BANKER.push(100, 500, 100, 1000);
  assert.deepEqual(app.buildBetChipColumns(state, "BANKER"), [{ denomination: 100, chips: [100, 100] }, { denomination: 500, chips: [500] }, { denomination: 1000, chips: [1000] }]);
  state.TIE.push(5000, 50, 500);
  assert.deepEqual(app.buildBetChipColumns(state, "TIE").map((column) => column.denomination), [5000, 50, 500]);
});

test("Each betting area owns its own first-seen order", () => {
  const state = app.createBetChipPresentation();
  state.PLAYER.push(500, 100); state.BANKER.push(100, 500);
  assert.deepEqual(app.buildBetChipColumns(state, "PLAYER").map((column) => column.denomination), [500, 100]);
  assert.deepEqual(app.buildBetChipColumns(state, "BANKER").map((column) => column.denomination), [100, 500]);
});

test("Successful betting records one presentation chip and a failed bet records none", () => {
  const game = new app.BaccaratGameController({ initialBalance: 100 });
  const beforeBalance = game.account.balance;
  place(game, "BANKER", 10);
  assert.deepEqual(game.betChipPresentation.BANKER, [10]);
  assert.equal(game.account.balance, beforeBalance - 10);
  game.selectChip(5000);
  assert.equal(game.placeSelectedBet("BANKER"), false);
  assert.deepEqual(game.betChipPresentation.BANKER, [10]);
});

test("Undo removes the last matching physical chip and deletes its empty column", () => {
  const game = new app.BaccaratGameController();
  for (const denomination of [100, 500, 100, 1000]) place(game, "BANKER", denomination);
  assert.equal(game.undoBet(), true);
  assert.deepEqual(app.buildBetChipColumns(game.betChipPresentation, "BANKER").map((column) => [column.denomination, column.chips.length]), [[100, 2], [500, 1]]);
  assert.equal(game.undoBet(), true);
  assert.deepEqual(app.buildBetChipColumns(game.betChipPresentation, "BANKER").map((column) => [column.denomination, column.chips.length]), [[100, 1], [500, 1]]);
});

test("Clear resets every presentation area without changing Repeat snapshot semantics", () => {
  const game = new app.BaccaratGameController();
  place(game, "PLAYER", 100); place(game, "BANKER_PAIR", 50);
  game.lastBetChipPresentation = app.cloneBetChipPresentation(game.betChipPresentation);
  game.lastConfirmedBetSnapshot = game.captureCurrentBetSnapshot();
  assert.equal(game.clearBets(), true);
  for (const area of Object.values(require("./betting-engine").BET_TYPES)) assert.deepEqual(game.betChipPresentation[area], []);
  assert.deepEqual(game.lastBetChipPresentation.PLAYER, [100]);
});

test("Repeat restores the last presentation composition and original first-seen order", () => {
  const game = new app.BaccaratGameController();
  const previous = app.createBetChipPresentation(); previous.BANKER.push(500, 100, 500, 1000);
  game.lastBetChipPresentation = app.cloneBetChipPresentation(previous);
  game.lastConfirmedBetSnapshot = { PLAYER: 0, BANKER: 2100, TIE: 0, PLAYER_PAIR: 0, BANKER_PAIR: 0 };
  assert.equal(game.repeatLastBet(), true);
  assert.deepEqual(app.buildBetChipColumns(game.betChipPresentation, "BANKER"), [{ denomination: 500, chips: [500, 500] }, { denomination: 100, chips: [100] }, { denomination: 1000, chips: [1000] }]);
  assert.equal(game.undoBet(), true);
  assert.deepEqual(game.betChipPresentation.BANKER, []);
});

test("Presentation helpers are pure, clone safely, and cap only rendered nodes", () => {
  const state = app.createBetChipPresentation(); state.PLAYER.push(...Array(20).fill(100));
  const clone = app.cloneBetChipPresentation(state); clone.PLAYER.pop();
  assert.equal(state.PLAYER.length, 20); assert.equal(app.buildBetChipColumns(state, "PLAYER")[0].chips.length, 20);
  assert.equal(app.BET_CHIP_RENDER_CAP, 8);
  const chip = app.betChipHtml(5000);
  assert.match(chip, /bet-chip--5k/); assert.match(chip, /bet-chip__spots/); assert.doesNotMatch(chip, /<button/);
  assert.match(source, /visibleChips\.length > 4 \? " is-dense" : ""/);
  assert.match(css, /\.bet-chip-column\.is-dense \{ --bet-chip-stack-step: 5px; \}/);
});

test("Presentation CSS reuses chip tokens, preserves BET text space, and is non-interactive", () => {
  assert.match(css, /\.bet-chip-stack-zone[\s\S]*?pointer-events: none/);
  assert.match(css, /\.bet-chip \{[\s\S]*?--chip-main:[\s\S]*?pointer-events: none/);
  assert.match(css, /\.bet-chip--500 \{ --chip-main: #252728/);
  assert.match(css, /\.bet-chip--1k \{ --chip-main: #5a2f8d/);
  assert.match(css, /\.bet-chip--5k \{ --chip-main: #1b4f9a/);
  assert.match(css, /\.bet-area > i \{ grid-row: 5; margin-top: 0; \}/);
  assert.match(source, /renderBetChipStacks\(\)/);
});

test("Table-chip typography scales by denomination length without changing selector typography", () => {
  assert.match(css, /\.bet-chip--10 \.bet-chip__value, \.bet-chip--50 \.bet-chip__value \{ font-size: 10px; \}/);
  assert.match(css, /\.bet-chip--100 \.bet-chip__value, \.bet-chip--500 \.bet-chip__value \{ font-size: 8px; \}/);
  assert.match(css, /\.bet-chip--1k \.bet-chip__value, \.bet-chip--5k \.bet-chip__value \{ font-size: 6\.5px/);
  assert.match(css, /\.pair-bet \.bet-chip--100 \.bet-chip__value, \.pair-bet \.bet-chip--500 \.bet-chip__value \{ font-size: 7px; \}/);
  assert.match(css, /\.pair-bet \.bet-chip--1k \.bet-chip__value, \.pair-bet \.bet-chip--5k \.bet-chip__value \{ font-size: 6px; \}/);
  assert.match(css, /\.bet-chip__value \{[\s\S]*?white-space: nowrap;[\s\S]*?text-align: center/);
  assert.match(css, /\.chips \.chip__value \{[^}]*font: 700 \.72rem\/1/);
});

test("Mobile keeps compact table chips and avoids page horizontal overflow", () => {
  const mobile = css.slice(css.lastIndexOf("@media (max-width: 760px)"));
  assert.match(mobile, /\.bet-chip-stack-zone \{ --bet-chip-size: 25px; gap: 3px; \}/);
  assert.match(mobile, /\.pair-bet \.bet-chip-stack-zone \{ --bet-chip-size: 22px; gap: 2px; \}/);
  assert.match(mobile, /\.bet-chip--100 \.bet-chip__value, \.bet-chip--500 \.bet-chip__value \{ font-size: 7px; \}/);
  assert.match(mobile, /\.pair-bet \.bet-chip--1k \.bet-chip__value, \.pair-bet \.bet-chip--5k \.bet-chip__value \{ font-size: 5\.5px; \}/);
  assert.match(css, /body \{[^}]*overflow-x: hidden/);
});

console.log(`\nTEST SUMMARY: Passed: ${passed}; Failed: ${failed}`);
if (failed) process.exitCode = 1;
