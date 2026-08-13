"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const app = require("./app");
const html = fs.readFileSync("index.html", "utf8");
const css = fs.readFileSync("style.css", "utf8");
const source = fs.readFileSync("app.js", "utf8");
let passed=0; let failed=0;
function test(name, fn) { try { fn(); passed++; console.log(`PASS: ${name}`); } catch (error) { failed++; console.error(`FAIL: ${name} — ${error.message}`); } }
function game() { return new app.BaccaratGameController({random:()=>0.5}); }

test("Visual Cut Card is a single presentation DOM child of Shoe",()=>{assert.equal((html.match(/id="visual-cut-card"/g)||[]).length,1);assert.match(html,/class="[^"]*shoe-visual[^"]*"[\s\S]*?id="visual-cut-card"/);});
test("Visual Cut Card defaults hidden and CSS enforces display none",()=>{assert.match(html,/id="visual-cut-card" class="visual-cut-card" hidden/);assert.match(css,/\.visual-cut-card\[hidden\] \{ display: none !important; \}/);});
test("Visual Cut Card and Cut Event never intercept interactions",()=>{assert.match(css,/\.visual-cut-card\s*\{[^}]*pointer-events:\s*none/);assert.match(css,/\.cut-card-event\s*\{[^}]*pointer-events:\s*none/);});
test("Shoe equipment visual state derives exclusively from existing Cut state",()=>{const controller=game();assert.equal(app.getShoeEquipmentState(controller),"in-play");controller.cutCard.reached=true;assert.equal(app.getShoeEquipmentState(controller),"cut");controller.cutCard.lastHandPending=true;controller.state=app.GAME_STATES.ROUND_END;assert.equal(app.getShoeEquipmentState(controller),"last-hand-next");controller.state=app.GAME_STATES.BETTING;assert.equal(app.getShoeEquipmentState(controller),"last-hand");controller.cutCard.shoeEnding=true;assert.equal(app.getShoeEquipmentState(controller),"complete");});
test("Shoe has restrained normal, Cut, Last Hand, and Complete visual states",()=>{assert.match(css,/\.shoe-visual\[data-state="cut"\]/);assert.match(css,/\.shoe-visual\[data-state="last-hand"\]/);assert.match(css,/\.shoe-visual\[data-state="complete"\]/);});
test("Cut animation is event-driven rather than render-driven",()=>{assert.match(source,/game\.onCutCardReached = \(\) =>/);assert.match(source,/playCutCardPresentation\(\)/);assert.doesNotMatch(source,/if \(game\.shoe\.length <=/);});
test("Visual Cut Card plays once per visible run and hides after its short presentation",()=>{assert.match(source,/if \(!card \|\| !card\.hidden\) return/);assert.match(source,/setTimeout\([\s\S]*?1600\)/);assert.match(source,/card\.hidden = true/);});
test("New Shoe invalidates old Cut visual callbacks and resets the visual",()=>{assert.match(source,/let cutVisualRunId = 0/);assert.match(source,/cutVisualRunId \+= 1/);assert.match(source,/if \(!game\.cutCard\.reached\) resetCutCardPresentation\(\)/);});
test("Mobile Cut Card remains near Shoe and preserves V0.7.4 equipment safety variables",()=>{const mobile=css.slice(css.indexOf("@media (max-width: 600px)"));assert.match(mobile,/\.visual-cut-card\s*\{[^}]*width:\s*29px[^}]*height:\s*46px/);assert.match(mobile,/visual-cut-card-present-mobile/);assert.match(mobile,/--mobile-equipment-height:\s*70px/);assert.match(mobile,/--mobile-player-clearance:\s*82px/);});
test("Visual Cut Card is not a game or discard card",()=>{assert.doesNotMatch(html,/rank="CUT"|data-card-key="CUT"/);assert.doesNotMatch(source,/discardRoundCards\([^)]*visualCutCard/);});
test("Burn presentation remains independently controlled",()=>{assert.match(source,/burnPresentationVisible/);assert.match(source,/renderBurnPresentation\(elements, game\)/);});

console.log(`\nTEST SUMMARY: Passed: ${passed}; Failed: ${failed}`);
if(failed)process.exitCode=1;
