"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const app = require("./app");
const html = fs.readFileSync("index.html", "utf8");
const css = fs.readFileSync("style.css", "utf8");
const source = fs.readFileSync("app.js", "utf8");
let passed = 0;
let failed = 0;
function test(name, fn) { try { fn(); passed += 1; console.log(`PASS: ${name}`); } catch (error) { failed += 1; console.error(`FAIL: ${name} — ${error.message}`); } }

test("Six chip denominations retain their correct display labels and numeric values", () => {
  const expected = [["10", "10", "10"], ["50", "50", "50"], ["100", "100", "100"], ["500", "500", "500"], ["1k", "1000", "1000"], ["5k", "5000", "5000"]];
  assert.deepEqual(app.CHIP_VALUES, [10, 50, 100, 500, 1000, 5000]);
  for (const [name, value, label] of expected) {
    assert.match(html, new RegExp(`class="chip chip--${name}" data-chip="${value}"`));
    assert.match(html, new RegExp(`chip--${name}[\\s\\S]*?chip__value">${label}<`));
  }
});
test("Each chip has an explicit denomination class rather than positional styling", () => {
  for (const name of ["10", "50", "100", "500", "1k", "5k"]) assert.match(css, new RegExp(`\\.chips \\.chip--${name}(?:, \\.chip-movement-ghost\\.chip--${name})? \\{`));
  assert.doesNotMatch(css, /\.chips button:nth-child/);
});
test("Casino edge spots use eight clear accent segments without a mask", () => {
  assert.match(css, /\.chips \.chip__spots[\s\S]*?background: conic-gradient\(from 8deg,[\s\S]*?var\(--chip-spot\) 315deg 327deg, transparent 327deg 360deg\)/);
  const chipSection = css.slice(css.indexOf("/* V0.7.7"));
  assert.doesNotMatch(chipSection, /(?:-webkit-)?mask:/);
});
test("Every runtime chip receives a dedicated spots layer beneath its ivory center", () => {
  assert.match(source, /chip\.querySelector\("\.chip__spots"\)[\s\S]*?chip\.insertAdjacentHTML\("afterbegin", '<span class="chip__spots"/);
  assert.match(css, /\.chips \.chip__spots \{[\s\S]*?z-index: 1;/);
  assert.match(css, /\.chips \.chip__inner \{[\s\S]*?z-index: 2;/);
  assert.match(css, /\.chips \.chip__value \{ position: relative; z-index: 3;/);
});
test("Every chip has a larger ivory center and high denominations remain color-separated", () => {
  assert.match(css, /\.chips \.chip__inner[\s\S]*?width: 70%;[\s\S]*?height: 70%;[\s\S]*?#efe6d2/);
  assert.match(css, /\.chip--500(?:, \.chip-movement-ghost\.chip--500)? \{ --chip-main: #252728/);
  assert.match(css, /\.chip--1k(?:, \.chip-movement-ghost\.chip--1k)? \{ --chip-main: #5a2f8d/);
  assert.match(css, /\.chip--5k(?:, \.chip-movement-ghost\.chip--5k)? \{ --chip-main: #1b4f9a/);
});
test("Chip labels contain denominations only, without branding or currency", () => {
  const chips = [...html.matchAll(/<button class="chip[\s\S]*?<\/button>/g)].map((match) => match[0]);
  assert.equal(chips.length, 6);
  for (const chip of chips) assert.doesNotMatch(chip, /BACCARAT|B88|\$|HKD|VIP/);
});
test("Chip selection uses existing selectedChip values and an accessible visual hook", () => {
  const game = new app.BaccaratGameController();
  const balance = game.account.balance;
  for (const amount of app.CHIP_VALUES) { assert.equal(game.selectChip(amount), true); assert.equal(game.selectedChip, amount); assert.equal(game.account.balance, balance); }
  assert.match(source, /button\.classList\.toggle\("selected", selected\); button\.setAttribute\("aria-pressed", String\(selected\)\)/);
});
test("Selecting 100 still places a 100 BANKER bet through the existing engine", () => {
  const game = new app.BaccaratGameController(); game.selectChip(100);
  assert.equal(game.placeSelectedBet("BANKER"), true); assert.equal(game.bettingRound.bets.BANKER, 100);
});
test("Selecting 1000 and 5000 preserves their numeric betting values", () => {
  for (const amount of [1000, 5000]) {
    const game = new app.BaccaratGameController(); game.selectChip(amount);
    assert.equal(game.placeSelectedBet("BANKER"), true); assert.equal(game.bettingRound.bets.BANKER, amount);
  }
});
test("Repeat, Undo, Clear, and Balance behavior remain engine-owned", () => {
  const game = new app.BaccaratGameController(); game.selectChip(50); game.placeSelectedBet("PLAYER"); const balanceAfterBet = game.account.balance;
  assert.equal(game.undoBet(), true); assert.equal(game.account.balance, balanceAfterBet + 50);
  game.placeSelectedBet("PLAYER"); assert.equal(game.clearBets(), true); assert.equal(game.account.balance, balanceAfterBet + 50);
});
test("Normal, hover, selected, press, focus, and disabled states are visually distinct", () => {
  assert.match(css, /\.chips \.chip:hover:not\(:disabled\)/); assert.match(css, /\.chips \.chip\.selected/); assert.match(css, /scale\(1\.05\)/);
  assert.match(css, /\.chips \.chip:active:not\(:disabled\)/); assert.match(css, /\.chips \.chip:focus-visible/); assert.match(css, /\.chips \.chip:disabled/);
});
test("Selected halo sits outside the chip without replacing its denomination color", () => {
  const selectedRule = css.match(/\.chips \.chip\.selected \{([^}]*)\}/)[1];
  assert.match(css, /\.chips \.chip\.selected \{[\s\S]*?transform: translateY\(-3px\) scale\(1\.05\)/);
  assert.doesNotMatch(selectedRule, /(?:border|background)(?:-color)?:/);
  assert.match(css, /\.chips \.chip\.selected::after[\s\S]*?inset: -4px;[\s\S]*?border: 1px solid rgba\(247, 233, 194, \.9\);[\s\S]*?pointer-events: none/);
  assert.match(css, /\.chips \.chip\[data-chip\] \{[\s\S]*?border: 1px solid[\s\S]*?background: radial-gradient/);
  assert.match(css, /\.chips \.chip--500, \.chip-movement-ghost\.chip--500 \{ --chip-main: #252728/);
  assert.match(css, /\.chips \.chip--1k, \.chip-movement-ghost\.chip--1k \{ --chip-main: #5a2f8d/);
  assert.match(css, /\.chips \.chip--5k, \.chip-movement-ghost\.chip--5k \{ --chip-main: #1b4f9a/);
});
test("Computed-style debug snapshot reports spots, inner label, and external halo layers", () => {
  const spots = {}; const inner = {};
  const button = { querySelector: (selector) => selector === ".chip__spots" ? spots : selector === ".chip__inner" ? inner : null };
  const styles = {
    button: { border: "1px solid rgb(1, 2, 3)", outline: "0px none", boxShadow: "none", background: "rgb(4, 5, 6)", inset: "auto", content: "normal", pointerEvents: "auto" },
    spots: { border: "0px none", outline: "0px none", boxShadow: "none", background: "conic-gradient(...) ", backgroundImage: "conic-gradient(...) ", inset: "1px", content: "normal", pointerEvents: "none", width: "47px", height: "47px", zIndex: "1", position: "absolute" },
    inner: { border: "1px solid rgb(1, 2, 3)", outline: "0px none", boxShadow: "none", background: "rgb(239, 230, 210)", inset: "auto", content: "normal", pointerEvents: "auto", width: "34px", height: "34px", zIndex: "2", position: "relative" },
    halo: { border: "1px solid rgb(247, 233, 194)", outline: "0px none", boxShadow: "rgb(247, 233, 194) 0px 0px 8px", background: "none", inset: "-4px", content: '\"\"', pointerEvents: "none" }
  };
  const snapshot = app.getChipComputedStyleSnapshot(button, (element, pseudo) => pseudo === "::after" ? styles.halo : element === spots ? styles.spots : element === inner ? styles.inner : styles.button);
  assert.equal(snapshot.button.border, styles.button.border);
  assert.equal(snapshot.button.outline, "0px none");
  assert.equal(snapshot.spots.background, styles.spots.background);
  assert.equal(snapshot.spots.backgroundImage, styles.spots.backgroundImage);
  assert.equal(snapshot.spots.zIndex, "1");
  assert.equal(snapshot.inner.zIndex, "2");
  assert.equal(snapshot.halo.inset, "-4px");
  assert.equal(snapshot.halo.pointerEvents, "none");
  assert.match(source, /__BACCARAT_DEBUG_CHIP_UI__/);
});
test("Mobile keeps six chips in one compact row and Repeat separate without page scrolling", () => {
  const mobile = css.slice(css.lastIndexOf("@media (max-width: 760px)"));
  assert.match(mobile, /grid-template-columns: repeat\(6, 38px\)/); assert.match(mobile, /\.chips \.chip \{ width: 38px; height: 38px; flex-basis: 38px; padding: 0; \}/); assert.match(mobile, /\.chips \.chip__spots \{ inset: \.75px; \}/); assert.match(mobile, /\.chips \.repeat-bet \{ grid-column: 1 \/ -1/);
  assert.match(css, /body \{[^}]*overflow-x: hidden/);
});
test("Card deck and Shoe/Cut presentation selectors remain isolated from chip styling", () => {
  const chipSection = css.slice(css.indexOf("/* V0.7.7"));
  assert.doesNotMatch(chipSection, /card-front|card-back|playing-card__back-crown|shoe-visual|cut-card/);
});

console.log(`\nTEST SUMMARY: Passed: ${passed}; Failed: ${failed}`);
if (failed) process.exitCode = 1;
