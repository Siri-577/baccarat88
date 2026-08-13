"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const html = fs.readFileSync("index.html", "utf8");
const css = fs.readFileSync("style.css", "utf8");
const app = fs.readFileSync("app.js", "utf8");
let passed = 0; let failed = 0;
function test(name, fn) { try { fn(); passed++; console.log(`PASS: ${name}`); } catch (error) { failed++; console.error(`FAIL: ${name} — ${error.message}`); } }
function sectionIndex(id) { return html.indexOf(`id="${id}"`); }

test("Bead Plate DOM precedes Big Road", () => assert.ok(sectionIndex("bead-plate") < sectionIndex("big-road")));
test("Roadmap has two semantic road sections", () => assert.equal((html.match(/class="road-panel"/g) || []).length, 2));
test("Roadmap main content is a single column", () => assert.match(css, /\.roadmap-content\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/));
test("no legacy two-column Roadmap rule remains", () => assert.doesNotMatch(css, /\.roadmap-content\s*\{[^}]*grid-template-columns:\s*1fr\s+1fr/));
test("both Road grids retain six data rows", () => assert.match(css, /grid-template-rows:\s*repeat\(6,\s*var\(--road-cell-size\)\)/));
test("each Road section owns internal horizontal scrolling", () => assert.match(css, /\.road-scroll\s*\{[^}]*overflow-x:\s*auto/));
test("compact and expanded preserve content-driven Road sections", () => { assert.doesNotMatch(css, /\.roadmap-content\s*\{[^}]*max-height/); assert.match(css, /\.roadmap\.expanded \.roadmap-content\s*\{[^}]*display:\s*grid/); });
test("mobile defaults Roadmap content to collapsed", () => assert.match(css, /@media \(max-width: 760px\)[\s\S]*?\.roadmap-content\s*\{\s*display:\s*none/));
test("mobile expansion keeps the same stacked grid", () => assert.match(css, /\.roadmap\.expanded \.roadmap-content\s*\{\s*display:\s*grid/));
test("medium console wraps to a two-row layout", () => assert.match(css, /@media \(max-width: 1199px\)[\s\S]*?grid-template-areas:\s*"total chips"\s*"mode actions"/));
test("chips remain wrapping flex items, never a column", () => { assert.match(css, /\.chips, \.actions\s*\{[^}]*flex-wrap:\s*wrap/); assert.doesNotMatch(css, /\.chips\s*\{[^}]*flex-direction:\s*column/); });
test("mobile chip target is a compact multi-column grid-like wrap", () => assert.match(css, /\.chips\s*\{[^}]*max-width:\s*172px/));
test("Reveal mode and actions stay in one medium console row", () => assert.match(css, /grid-template-areas:\s*"total chips"\s*"mode actions"/));
test("Road grids autoscroll to the newest column", () => assert.match(app, /scroll\.scrollLeft\s*=\s*scroll\.scrollWidth/));
test("Bead and Big Road both participate in latest-result auto-scroll", () => assert.match(app, /\[elements\.beadPlate, elements\.bigRoad\]/));
test("mobile protects the page from horizontal Roadmap overflow", () => assert.match(css, /@media \(max-width: 760px\)[\s\S]*?body\s*\{[^}]*overflow-x:\s*hidden/));
test("card travel remains rect-based", () => assert.match(app, /getTargetSlotRect[\s\S]*?getBoundingClientRect\(\)/));
test("discard travel remains rect-based", () => assert.match(app, /getDiscardTargetRect[\s\S]*?getBoundingClientRect\(\)/));
test("AUTO settlement path remains present", () => { assert.match(app, /AUTO_REVEALING/); assert.match(app, /betting\.settleRound/); });

console.log(`\nTEST SUMMARY: Passed: ${passed}; Failed: ${failed}`);
if (failed) process.exitCode = 1;
