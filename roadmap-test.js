"use strict";
const assert = require("node:assert/strict");
const road = require("./roadmap-engine");
let passed = 0; let failed = 0;
function test(name, fn) { try { fn(); passed++; console.log(`PASS: ${name}`); } catch (error) { failed++; console.error(`FAIL: ${name} — ${error.message}`); } }
const entry = (winner, extra = {}) => ({ shoeId: 1, roundId: extra.roundId || 1, winner, playerPair: false, bankerPair: false, playerScore: 0, bankerScore: 0, ...extra });
const history = (values) => values.map((winner, index) => entry(winner, { roundId: index + 1 }));

test("history entry is immutable settlement data", () => { const value = road.createRoadHistoryEntry({ winner: "BANKER", playerPair: true, bankerPair: false, playerFinalScore: 8, bankerFinalScore: 6 }, { shoeId: 2, roundId: 7 }); assert.equal(value.shoeId, 2); assert.equal(value.playerPair, true); assert.equal(Object.isFrozen(value), true); });
test("Bead Plate is six rows, top-to-bottom then right", () => { const cells = road.buildBeadPlate(history(["BANKER", "PLAYER", "TIE", "BANKER", "PLAYER", "TIE", "BANKER"])); assert.deepEqual(cells.map(({ row, col }) => [row, col]), [[0,0],[1,0],[2,0],[3,0],[4,0],[5,0],[0,1]]); });
test("Bead Plate preserves pair markers", () => { const cells = road.buildBeadPlate([entry("BANKER", { bankerPair: true }), entry("PLAYER", { playerPair: true }), entry("TIE", { playerPair: true, bankerPair: true })]); assert.deepEqual(cells.map(cell => [cell.winner, cell.playerPair, cell.bankerPair]), [["BANKER",false,true],["PLAYER",true,false],["TIE",true,true]]); });
test("Roadmap statistics derive only from Road History", () => { assert.deepEqual(road.getRoadmapStatistics([entry("BANKER",{bankerPair:true}),entry("PLAYER",{playerPair:true}),entry("TIE",{playerPair:true,bankerPair:true})]), { hands:3, banker:1, player:1, tie:1, playerPair:2, bankerPair:2 }); assert.deepEqual(road.getRoadmapStatistics([]), { hands:0, banker:0, player:0, tie:0, playerPair:0, bankerPair:0 }); });
test("single Banker starts at zero", () => { const c = road.buildBigRoad(history(["BANKER"])).cells[0]; assert.deepEqual([c.row,c.col,c.winner], [0,0,"BANKER"]); });
test("same winner moves down", () => { assert.deepEqual(road.buildBigRoad(history(["BANKER","BANKER","BANKER"])).cells.map(c=>[c.row,c.col]), [[0,0],[1,0],[2,0]]); });
test("winner switch starts a new column", () => { const cells=road.buildBigRoad(history(["BANKER","BANKER","PLAYER","PLAYER","BANKER"])).cells; assert.deepEqual(cells.map(c=>[c.winner,c.row,c.col]), [["BANKER",0,0],["BANKER",1,0],["PLAYER",0,1],["PLAYER",1,1],["BANKER",0,2]]); });
test("Tie attaches to last decisive result", () => { const out=road.buildBigRoad(history(["BANKER","TIE"])); assert.equal(out.cells.length,1); assert.equal(out.cells[0].tieCount,1); });
test("consecutive Ties increment a single cell", () => { const out=road.buildBigRoad(history(["BANKER","TIE","TIE","TIE"])); assert.equal(out.cells[0].tieCount,3); assert.equal(out.cells[0].sourceRoundIds.length,4); });
test("Tie does not split a streak", () => { const out=road.buildBigRoad(history(["BANKER","BANKER","TIE","BANKER"])); assert.deepEqual(out.cells.map(c=>[c.row,c.col,c.tieCount]), [[0,0,0],[1,0,1],[2,0,0]]); });
test("leading Tie is retained without a fake winner", () => { const out=road.buildBigRoad(history(["TIE"])); assert.equal(out.cells.length,0); assert.equal(out.leadingTieCount,1); });
test("leading Ties attach to first Banker", () => { const out=road.buildBigRoad(history(["TIE","TIE","BANKER"])); assert.equal(out.cells.length,1); assert.equal(out.cells[0].tieCount,2); });
test("leading Ties attach to first Player", () => { const out=road.buildBigRoad(history(["TIE","PLAYER"])); assert.equal(out.cells[0].winner,"PLAYER"); assert.equal(out.cells[0].tieCount,1); });
test("Dragon Tail remains on row five", () => { const cells=road.buildBigRoad(history(Array(8).fill("BANKER"))).cells; assert.deepEqual(cells.map(c=>[c.row,c.col]), [[0,0],[1,0],[2,0],[3,0],[4,0],[5,0],[5,1],[5,2]]); });
test("a right-turned streak continues right", () => { const cells=road.buildBigRoad(history(Array(9).fill("PLAYER"))).cells; assert.deepEqual(cells.slice(5).map(c=>[c.row,c.col]), [[5,0],[5,1],[5,2],[5,3]]); });
test("collision below turns the active streak right", () => { const out=road.buildBigRoad(history(["BANKER","BANKER","PLAYER","PLAYER","PLAYER","BANKER","BANKER","BANKER"])); const b=out.cells.filter(c=>c.streakId===2); assert.deepEqual(b.map(c=>[c.row,c.col]), [[0,2],[1,2],[2,2]]); });
test("new streak finds an unoccupied start column", () => { const out=road.buildBigRoad(history(["BANKER","BANKER","BANKER","BANKER","BANKER","BANKER","BANKER","PLAYER","BANKER"])); assert.deepEqual(out.cells.slice(-2).map(c=>[c.winner,c.row,c.col]), [["PLAYER",0,1],["BANKER",0,2]]); });
test("Pair metadata does not alter Big Road", () => { const out=road.buildBigRoad([entry("BANKER",{playerPair:true}), entry("BANKER",{bankerPair:true}), entry("BANKER")]); assert.deepEqual(out.cells.map(c=>[c.row,c.col]),[[0,0],[1,0],[2,0]]); });
test("logical coordinates are independent from any viewport", () => { const out=road.buildBigRoad(history(Array(20).fill("BANKER"))); assert.equal(out.cells.at(-1).logicalRow,5); assert.equal(out.cells.at(-1).logicalCol,14); });
test("invalid histories reject explicitly", () => { assert.throws(()=>road.buildBigRoad([entry("NOPE")])); assert.throws(()=>road.buildBeadPlate(null)); });
test("500-round deterministic history has no collision or invalid row", () => { const winners=["BANKER","PLAYER","TIE","BANKER","BANKER","TIE","PLAYER"]; const out=road.buildBigRoad(history(Array.from({length:500},(_,i)=>winners[i%winners.length]))); const positions=new Set(); for(const c of out.cells){assert.ok(c.row>=0&&c.row<6);assert.ok(c.col>=0);const key=`${c.row}:${c.col}`;assert.equal(positions.has(key),false);positions.add(key);} assert.equal(out.cells.reduce((n,c)=>n+1+c.tieCount,0),500); });

console.log(`\nTEST SUMMARY: Passed: ${passed}; Failed: ${failed}`);
if (failed) process.exitCode = 1;
