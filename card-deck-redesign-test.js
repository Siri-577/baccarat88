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

test("Every front card uses two rank-only corners and one central Suit", () => {
  for (const [rank, suit] of [["7", "hearts"], ["A", "hearts"], ["J", "clubs"], ["Q", "diamonds"], ["K", "spades"]]) {
    const card = app.flipCardHtml({ rank, suit }, 0, true, "PLAYER-0");
    const symbol = { hearts: "♥", clubs: "♣", diamonds: "♦", spades: "♠" }[suit];
    assert.match(card, /playing-card--front/);
    assert.equal((card.match(new RegExp(symbol, "g")) || []).length, 1);
    assert.equal((card.match(new RegExp(`<strong>${rank}</strong>`, "g")) || []).length, 2);
    assert.doesNotMatch(card, /playing-card__corner[^>]*>[\s\S]*?<small>/);
  }
});
test("Back cards use the same premium back in dealt and flying cards", () => {
  const back = app.playingCardBackHtml();
  assert.match(back, /playing-card--back/);
  assert.match(back, /playing-card__back-pattern/);
  assert.match(back, /playing-card__back-crown/);
  assert.match(source, /flying\.innerHTML = playingCardBackHtml\(\)/);
});
test("J, Q, and K use the same single-Suit layout as number cards", () => {
  for (const rank of ["J", "Q", "K"]) {
    const card = app.flipCardHtml({ rank, suit: "spades" }, 0, true);
    assert.match(card, /playing-card__center">♠<\/span>/);
    assert.doesNotMatch(card, /playing-card__center--court/);
    assert.equal((card.match(/♠/g) || []).length, 1);
  }
  assert.doesNotMatch(source, /isCourt|king portrait|queen portrait|jack portrait/i);
});
test("Back crown is a three-tip SVG with a center diamond and no card-back 88 logo", () => {
  const back = app.playingCardBackHtml();
  assert.match(back, /M11 30 15 13l12 10L32 8l5 15 12-10 4 17H11Z/);
  assert.match(back, /class="crown-diamond"/);
  assert.doesNotMatch(back, />88<|B88/i);
});
test("Premium front uses ivory, wine red, charcoal, and restrained gold borders", () => {
  assert.match(css, /#fffdf4/);
  assert.match(css, /#7f1f2b/);
  assert.match(css, /#222522/);
  assert.match(css, /#d8ccb0/);
});
test("Back uses burgundy, dual gold borders, and symmetric geometric pattern", () => {
  assert.match(css, /#6f1b2b/);
  assert.match(css, /playing-card--back::before,[\s\S]*?playing-card--back::after/);
  assert.match(css, /playing-card__back-pattern/);
});
test("Front and back faces are explicitly isolated for WebKit 3D compositing", () => {
  assert.match(css, /\.card-face \{[\s\S]*?-webkit-backface-visibility: hidden;[\s\S]*?backface-visibility: hidden;/);
  assert.match(css, /\.card-shell \{ -webkit-perspective: 620px; \}/);
  assert.match(css, /\.card-inner \{ -webkit-transform-style: preserve-3d; \}/);
  assert.match(css, /\.card-inner\.is-face-up:not\(\.is-flipping\) \.playing-card--back \{ visibility: hidden; \}/);
  assert.match(css, /\.card-inner\.is-face-down:not\(\.is-flipping\) \.playing-card--front \{ visibility: hidden; \}/);
});
test("Face-specific defensive rules never allow back crown or pattern on a front", () => {
  assert.match(css, /\.playing-card--front \.playing-card__back-crown,[\s\S]*?\.playing-card--front \.playing-card__back-pattern \{ display: none !important; \}/);
  assert.match(css, /\.playing-card--back \.playing-card__corner,[\s\S]*?\.playing-card--back \.playing-card__center \{ display: none !important; \}/);
  const frontOnly = app.flipCardHtml({ rank: "K", suit: "spades" }, 0, true).match(/<span class="card-face card-front[\s\S]*?<\/span><\/span><\/span>$/)[0];
  assert.doesNotMatch(frontOnly, /playing-card__back-crown|playing-card__back-pattern/);
});
test("Burn presentation uses the premium card-face system", () => {
  assert.match(html, /id="burn-card-face" class="burn-card__face playing-card--front/);
  assert.match(html, /id="burn-card-center" class="playing-card__center"/);
  assert.match(source, /elements\.burnCardFace\.className = `burn-card__face playing-card--front/);
  assert.match(source, /elements\.burnRank\.textContent = burn\.revealedCard\.rank/);
  assert.match(source, /elements\.burnCenter\.textContent = symbol/);
  assert.doesNotMatch(html.match(/<div id="burn-card-face"[\s\S]*?<\/div>/)[0], /playing-card__back-crown|playing-card__back-pattern/);
});
test("Discard clones and Shoe card stack retain compatibility", () => {
  assert.match(source, /cloneNode\(true\)/);
  assert.match(css, /\.discard-clone \.playing-card--front/);
  assert.match(css, /\.shoe-stack \{/);
});
test("Mobile readability uses dedicated single-Suit premium-card media overrides", () => {
  const mobile = css.slice(css.lastIndexOf("@media (max-width: 600px)"));
  assert.match(mobile, /\.playing-card__corner strong \{ font-size: 1rem/);
  assert.match(mobile, /\.playing-card__center \{ font-size: 1\.44rem/);
  assert.match(mobile, /\.playing-card__back-crown \{ width: 44px/);
});
test("Card redesign preserves existing slots, third-card angle, and chip UI isolation", () => {
  assert.match(css, /\.card-slots \{ position: relative; width: 210px; height: 100px; \}/);
  assert.match(css, /\.is-third-card \{ transform: translateY\(5px\) rotate\(-6deg\)/);
  assert.doesNotMatch(source, /selectedChip\s*=\s*["']REPEAT/);
});
test("Third-card fronts, discard fronts, and Shoe backs retain their intended face-only content", () => {
  const third = app.flipCardHtml({ rank: "Q", suit: "diamonds" }, 2, true);
  assert.match(third, /is-third-card/);
  assert.match(css, /\.discard-clone \.playing-card--front/);
  assert.match(app.playingCardBackHtml(), /playing-card__back-crown/);
});

console.log(`\nTEST SUMMARY: Passed: ${passed}; Failed: ${failed}`);
if (failed) process.exitCode = 1;
