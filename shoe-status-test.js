"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const app = require("./app");
const html = fs.readFileSync("index.html", "utf8");
const css = fs.readFileSync("style.css", "utf8");
let passed=0; let failed=0; const tests=[];
function test(name, fn) { tests.push({name,fn}); }
function game() { return new app.BaccaratGameController({random:()=>0.5}); }
function elements() { return {shoeStatus:{dataset:{},innerHTML:"",textContent:""}}; }
function render(controller, target=elements()) { app.renderShoeStatus(target,controller); target.shoeStatus.textContent=target.shoeStatus.innerHTML; return target; }

test("New Shoe derives SHOE IN PLAY",()=>{const controller=game();assert.equal(app.getShoePresentationState(controller),app.SHOE_STATUS.IN_PLAY);assert.match(render(controller).shoeStatus.textContent,/SHOE IN PLAY/);});
test("Cut Card reached derives persistent LAST HAND NEXT",()=>{const controller=game();controller.cutCard.reached=true;assert.equal(app.getShoePresentationState(controller),app.SHOE_STATUS.LAST_HAND_NEXT);assert.match(render(controller).shoeStatus.textContent,/LAST HAND NEXT/);});
test("Last Hand betting derives LAST HAND before DEAL",()=>{const controller=game();controller.cutCard.lastHandPending=true;controller.state=app.GAME_STATES.BETTING;assert.equal(app.getShoePresentationState(controller),app.SHOE_STATUS.LAST_HAND);assert.match(render(controller).shoeStatus.textContent,/LAST HAND/);});
test("Active Last Hand remains LAST HAND through dealing",()=>{const controller=game();controller.cutCard.lastHandActive=true;controller.state=app.GAME_STATES.REVEAL_READY;assert.equal(app.getShoePresentationState(controller),app.SHOE_STATUS.LAST_HAND);});
test("Shoe Complete takes priority and shows completion copy",()=>{const controller=game();controller.cutCard.shoeEnding=true;assert.equal(app.getShoePresentationState(controller),app.SHOE_STATUS.COMPLETE);assert.match(render(controller).shoeStatus.textContent,/SHOE COMPLETE/);});
test("Ordinary betting and Repeat do not change LAST HAND status",()=>{const controller=game();controller.cutCard.lastHandPending=true;controller.lastConfirmedBetSnapshot={PLAYER:100,BANKER:0,TIE:0,PLAYER_PAIR:0,BANKER_PAIR:0};controller.repeatLastBet();assert.equal(app.getShoePresentationState(controller),app.SHOE_STATUS.LAST_HAND);});
test("New Shoe resets all old Cut presentation states",()=>{const controller=game();controller.cutCard.shoeEnding=true;controller.state=app.GAME_STATES.ROUND_END;controller.startNewShoe();controller.completeBurnPresentation();assert.equal(app.getShoePresentationState(controller),app.SHOE_STATUS.IN_PLAY);});
test("Shoe status and Cut event each have exactly one DOM source",()=>{assert.equal((html.match(/id="shoe-status"/g)||[]).length,1);assert.equal((html.match(/id="cut-card-event"/g)||[]).length,1);});
test("Cut event and status hidden attributes are guaranteed to hide",()=>{assert.match(css,/\.cut-card-event\[hidden\], \.shoe-status\[hidden\] \{ display: none !important; \}/);});
test("Shoe Status remains separate from NEXT REVEAL prompt",()=>{assert.ok(html.indexOf('id="shoe-status"')<html.indexOf('class="hands-stage"'));assert.ok(html.indexOf('id="next-card-label"')>html.indexOf('class="hands-stage"'));});
test("Cut event timeout is guarded by Shoe generation token",()=>{const source=fs.readFileSync("app.js","utf8");assert.match(source,/const runId = \+\+game\.cutEventRunId/);assert.match(source,/if \(runId === game\.cutEventRunId\) event\.hidden = true/);assert.match(source,/this\.cutEventRunId \+= 1/);});

(async()=>{for(const {name,fn} of tests){try{await fn();passed++;console.log(`PASS: ${name}`)}catch(error){failed++;console.error(`FAIL: ${name} — ${error.message}`)}}console.log(`\nTEST SUMMARY: Passed: ${passed}; Failed: ${failed}`);if(failed)process.exitCode=1;})();
