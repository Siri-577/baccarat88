"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const css = fs.readFileSync("style.css", "utf8");
const html = fs.readFileSync("index.html", "utf8");
let passed = 0; let failed = 0;
function test(name, fn) { try { fn(); passed++; console.log(`PASS: ${name}`); } catch (error) { failed++; console.error(`FAIL: ${name} — ${error.message}`); } }

const mobile = css.slice(css.indexOf("@media (max-width: 600px)"));

test("Mobile layout has a dedicated equipment-height safety contract", () => {
  assert.match(mobile, /--mobile-equipment-height:\s*70px/);
  assert.match(mobile, /--mobile-player-clearance:\s*82px/);
});
test("Mobile equipment is balanced at opposite table edges without card offsets", () => {
  assert.match(mobile, /\.discard-tray\s*\{\s*left:\s*var\(--mobile-equipment-inset\)/);
  assert.match(mobile, /\.shoe-visual\s*\{\s*right:\s*var\(--mobile-equipment-inset\)/);
  assert.match(mobile, /\.table-utility\s*\{[^}]*width:\s*82px[^}]*height:\s*var\(--mobile-equipment-height\)[^}]*transform:\s*none/);
});
test("Player hand starts below the mobile equipment zone", () => assert.match(mobile, /\.hands-stage\s*\{\s*margin-top:\s*var\(--mobile-player-clearance\)/));
test("Player and Banker card groups retain centered fixed-width slots", () => {
  assert.match(mobile, /\.cards\s*\{\s*justify-content:\s*center/);
  assert.match(mobile, /\.card-slots\s*\{[^}]*flex:\s*0 0 210px[^}]*margin-right:\s*auto[^}]*margin-left:\s*auto/);
});
test("Third-card transforms remain untouched", () => {
  assert.match(css, /\.is-third-card\s*\{\s*transform:\s*translateY\(5px\) rotate\(-6deg\)/);
  assert.match(css, /\.banker-hand \.is-third-card\s*\{\s*transform:\s*translateY\(5px\) rotate\(6deg\)/);
});
test("Equipment and hands remain siblings in the existing table structure", () => {
  assert.match(html, /discard-tray[\s\S]*?shoe-visual[\s\S]*?hands-stage/);
});
test("Mobile page continues to prevent horizontal overflow", () => assert.match(css, /@media \(max-width: 760px\)[\s\S]*?body\s*\{[^}]*overflow-x:\s*hidden/));
test("Desktop equipment rules remain outside the mobile-only override", () => assert.match(css, /\.table-utility\s*\{[^}]*width:\s*92px[^}]*height:\s*72px/));

console.log(`\nTEST SUMMARY: Passed: ${passed}; Failed: ${failed}`);
if (failed) process.exitCode = 1;
