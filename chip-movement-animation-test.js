"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const app = require("./app");
const source = fs.readFileSync("app.js", "utf8");
const css = fs.readFileSync("style.css", "utf8");
const html = fs.readFileSync("index.html", "utf8");
let passed = 0;
let failed = 0;
function test(name, fn) { try { fn(); passed += 1; console.log(`PASS: ${name}`); } catch (error) { failed += 1; console.error(`FAIL: ${name} — ${error.message}`); } }

test("Movement layer is global, non-interactive, and not clipped by Bet Areas", () => {
  assert.match(html, /id="chip-animation-layer" aria-hidden="true"/);
  assert.match(css, /#chip-animation-layer \{ position: fixed; z-index: 80; inset: 0; overflow: hidden; pointer-events: none; \}/);
  assert.match(css, /\.chip-movement-ghost \{[\s\S]*?position: fixed[\s\S]*?pointer-events: none/);
});

test("Ghosts reuse existing chip tokens and denomination visuals", () => {
  assert.match(source, /createChipMovementGhost\(denomination, fromRect\)/);
  assert.match(source, /chip-movement-ghost chip--\$\{chipClass\}/);
  assert.match(css, /\.chips \.chip--500, \.chip-movement-ghost\.chip--500/);
  assert.match(css, /\.chips \.chip--5k, \.chip-movement-ghost\.chip--5k/);
  assert.match(source, /<span class="chip__spots"><\/span><span class="chip__inner">/);
});

test("Placement, Undo, and Clear timing stays within the specified presentation contract", () => {
  assert.equal(app.CHIP_PLACEMENT_DURATION_MS, 220);
  assert.equal(app.CHIP_RETURN_DURATION_MS, 220);
  assert.equal(app.CHIP_CLEAR_RETURN_DURATION_MS, 240);
  assert.match(source, /duration: CHIP_PLACEMENT_DURATION_MS/);
  assert.match(source, /CHIP_CLEAR_RETURN_DURATION_MS/);
});

test("Placement targets each final stack index rather than an area center", () => {
  const state = app.createBetChipPresentation();
  state.BANKER.push(100, 500, 100, 1000);
  assert.deepEqual(app.buildBetChipColumns(state, "BANKER").map((column) => [column.denomination, column.chips.length]), [[100, 2], [500, 1], [1000, 1]]);
  assert.match(source, /getBetChipTargetRect\(area, denomination, stackIndex\)/);
  assert.match(source, /data-stack-index="\$\{stackIndex\}"/);
  assert.match(source, /pendingBetChipArrivals\.add\(chipMovementKey\(area, denomination, stackIndex\)\)/);
});

test("Arriving final chips stay hidden until their independent ghost completes", () => {
  assert.match(source, /const pendingBetChipArrivals = new Set\(\)/);
  assert.match(source, /is-arrival-pending/);
  assert.match(css, /\.bet-chip\.is-arrival-pending \{ visibility: hidden; \}/);
  assert.match(source, /activeChipMovements = new Map\(\)/);
  assert.match(source, /const movementId = \+\+nextChipMovementId/);
});

test("Failed bets cannot create a placement movement or presentation chip", () => {
  const game = new app.BaccaratGameController({ initialBalance: 100 });
  game.selectChip(5000);
  assert.equal(game.placeSelectedBet("BANKER"), false);
  assert.deepEqual(game.betChipPresentation.BANKER, []);
  assert.match(source, /if \(!game\.placeSelectedBet\(area\)\) \{ render\(\); return; \}/);
});

test("Undo captures the last physical stack chip before business undo and returns to its selector", () => {
  assert.match(source, /function getLastPlacementSnapshot\(\)/);
  assert.match(source, /fromRect: getBetChipTargetRect\(action\.betType, action\.amount, stackIndex\)/);
  assert.match(source, /if \(!game\.undoBet\(\)\) \{ render\(\); return; \}/);
  assert.match(source, /animateChipReturn\(movement\.denomination, movement\.fromRect\)/);
});

test("Clear returns only visible stack chips in parallel while clearing full state", () => {
  const state = app.createBetChipPresentation();
  state.PLAYER.push(...Array(20).fill(100));
  assert.equal(app.buildBetChipColumns(state, "PLAYER")[0].chips.length, 20);
  assert.equal(app.BET_CHIP_RENDER_CAP, 8);
  assert.match(source, /function getVisibleBetChipSnapshots\(\)/);
  assert.match(source, /movements\.forEach\(\(movement\) => animateChipReturn/);
  assert.doesNotMatch(source, /await animateChipReturn/);
});

test("Repeat remains direct and reduced motion or missing geometry degrades safely", () => {
  assert.match(source, /if \(game\.repeatLastBet\(\)\) cancelPendingChipArrivals\(\); render\(\)/);
  assert.match(source, /if \(isReducedMotion\(\) \|\| !isViewportRect\(fromRect\) \|\| !isViewportRect\(toRect\)\) \{ onFinish\?\.\(\); return null; \}/);
  assert.match(source, /getBoundingClientRect\(\)/);
});

test("Mobile protects the fixed movement layer from interaction and page overflow", () => {
  assert.match(css, /body \{[^}]*overflow-x: hidden/);
  assert.match(css, /#chip-animation-layer \{[^}]*overflow: hidden/);
  assert.match(source, /isViewportRect/);
});

console.log(`\nTEST SUMMARY: Passed: ${passed}; Failed: ${failed}`);
if (failed) process.exitCode = 1;
