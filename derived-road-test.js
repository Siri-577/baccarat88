"use strict";
const assert = require("node:assert/strict");
const road = require("./roadmap-engine");
let passed = 0; let failed = 0;
function test(name, fn) { try { fn(); passed++; console.log(`PASS: ${name}`); } catch (error) { failed++; console.error(`FAIL: ${name} — ${error.message}`); } }
function history(sequence, options = {}) { return [...sequence].map((value, index) => ({ shoeId: 1, roundId: index + 1, winner: value === "B" ? "BANKER" : value === "P" ? "PLAYER" : "TIE", playerPair: Boolean(options.pairs), bankerPair: Boolean(options.pairs) })); }
function big(sequence, options) { return road.buildBigRoad(history(sequence, options)); }
function colors(result) { return result.signals.map((signal) => signal.color); }

test("Big Road provides chronological cells and source metadata", () => { const out = big("BBP"); assert.deepEqual(out.cellsInChronologicalOrder.map(c => c.sequenceIndex), [0,1,2]); assert.equal(out.cells[2].sourceRoundId, 3); assert.equal(out.streaks[0].logicalHeight, 2); });
test("Big Eye requires structure beyond the first column", () => assert.deepEqual(colors(road.buildBigEyeBoy(big("BBBB"))), []));
test("Small Road starts later than Big Eye", () => { const source=big("BBPPB"); assert.ok(road.buildBigEyeBoy(source).cells.length > 0); assert.equal(road.buildSmallRoad(source).cells.length, 0); });
test("Cockroach Pig starts later than Small Road", () => { const source=big("BBPBBP"); assert.ok(road.buildSmallRoad(source).cells.length > 0); assert.equal(road.buildCockroachPig(source).cells.length, 0); });
test("offsets are one, two, and three", () => { const source=big("BBPPBBPP"); assert.equal(road.buildBigEyeBoy(source).offset,1); assert.equal(road.buildSmallRoad(source).offset,2); assert.equal(road.buildCockroachPig(source).offset,3); });
test("new streak with matching prior heights is RED", () => { const source=big("BBPPB"); const cell=source.cells.at(-1); assert.equal(road.deriveColorForBigRoadCell(source,cell,1),"RED"); });
test("new streak with mismatched prior heights is BLUE", () => { const source=big("BBPPPB"); const cell=source.cells.at(-1); assert.equal(road.deriveColorForBigRoadCell(source,cell,1),"BLUE"); });
test("same streak has-pair is RED", () => { const source=big("BBPPBB"); const cell=source.cells.at(-1); assert.equal(road.deriveColorForBigRoadCell(source,cell,1),"RED"); });
test("same streak one-present-one-missing is BLUE", () => { const source=big("BBPPP"); const cell=source.cells.at(-1); assert.equal(road.deriveColorForBigRoadCell(source,cell,1),"BLUE"); });
test("same streak no-pair is RED", () => { const source=big("BBPPPPBBBBBBB"); const cell=source.cells[5]; assert.equal(road.deriveColorForBigRoadCell(source,cell,1),"RED"); });
test("Tie does not create a derived signal", () => { const withoutTie=road.buildBigEyeBoy(big("BBPPB")); const withTie=road.buildBigEyeBoy(big("BBTPPB")); assert.deepEqual(colors(withTie),colors(withoutTie)); });
test("consecutive Ties do not create derived signals", () => { const withoutTie=road.buildBigEyeBoy(big("BBPPB")); const withTie=road.buildBigEyeBoy(big("BBTTTPPB")); assert.deepEqual(colors(withTie),colors(withoutTie)); });
test("leading Ties do not create derived signals", () => { const out=road.buildBigEyeBoy(big("TTBBPPB")); assert.deepEqual(colors(out),["RED","RED"]); });
test("Pair flags do not change derived colors", () => { const plain=road.buildBigEyeBoy(big("BBPPBBPP")); const paired=road.buildBigEyeBoy(big("BBPPBBPP",{pairs:true})); assert.deepEqual(colors(plain),colors(paired)); });
test("derived cells have no Banker or Player winner", () => { const cell=road.buildBigEyeBoy(big("BBPPB")).cells[0]; assert.deepEqual(Object.keys(cell).includes("winner"),false); assert.equal(cell.color,"RED"); });
test("derived signals preserve Big Road source coordinates", () => { const signal=road.buildBigEyeBoy(big("BBPPB")).signals[0]; assert.deepEqual([signal.sourceBigRoadRow,signal.sourceBigRoadCol,signal.sourceRoundId],[1,1,4]); });
test("Derived layout places same colors downward", () => { const out=road.layoutDerivedRoad([{color:"RED"},{color:"RED"},{color:"RED"}]); assert.deepEqual(out.cells.map(c=>[c.row,c.col]),[[0,0],[1,0],[2,0]]); });
test("Derived layout starts a new column on color change", () => { const out=road.layoutDerivedRoad([{color:"RED"},{color:"BLUE"},{color:"BLUE"}]); assert.deepEqual(out.cells.map(c=>[c.color,c.row,c.col]),[["RED",0,0],["BLUE",0,1],["BLUE",1,1]]); });
test("Derived layout has a six-row Dragon Tail", () => { const out=road.layoutDerivedRoad(Array.from({length:8},()=>({color:"RED"}))); assert.deepEqual(out.cells.map(c=>[c.row,c.col]),[[0,0],[1,0],[2,0],[3,0],[4,0],[5,0],[5,1],[5,2]]); });
test("Derived layout collision turns right", () => { const out=road.layoutDerivedRoad([{color:"RED"},{color:"RED"},{color:"BLUE"},{color:"BLUE"},{color:"BLUE"},{color:"RED"},{color:"RED"},{color:"RED"}]); const red=out.cells.filter(c=>c.color==="RED"); assert.deepEqual(red.slice(-3).map(c=>[c.row,c.col]),[[0,2],[1,2],[2,2]]); });
test("Derived layout rejects invalid colors", () => assert.throws(()=>road.layoutDerivedRoad([{color:"GREEN"}])));
test("derived builders are pure and idempotent", () => { const source=big("BBPPPBBBPP"); assert.deepEqual(road.buildSmallRoad(source),road.buildSmallRoad(source)); });
test("three derived roads are independent objects", () => { const source=big("BBPPBBPP"); const a=road.buildBigEyeBoy(source), b=road.buildSmallRoad(source), c=road.buildCockroachPig(source); assert.notStrictEqual(a.cells,b.cells); assert.notStrictEqual(b.cells,c.cells); });
test("Dragon Tail source remains safe for all offsets", () => { const source=big("BBBBBBBPBBPPBBPP"); for(const build of [road.buildBigEyeBoy,road.buildSmallRoad,road.buildCockroachPig]) for(const cell of build(source).cells){assert.ok(cell.row>=0&&cell.row<6);assert.ok(cell.col>=0);} });
test("collision source remains safe for all offsets", () => { const source=big("BBPPPBBBPPBBPPPB"); for(const build of [road.buildBigEyeBoy,road.buildSmallRoad,road.buildCockroachPig]) for(const cell of build(source).cells){assert.ok(cell.row>=0&&cell.row<6);assert.ok(cell.col>=0);} });
test("chronology follows sequenceIndex rather than visual coordinates", () => { const source=big("BBBBBBBPPBBPP"); const out=road.buildBigEyeBoy(source); assert.deepEqual(out.signals.map(s=>s.sourceSequenceIndex),out.signals.map(s=>s.sourceSequenceIndex).slice().sort((a,b)=>a-b)); });
test("500-round simulation has no invalid derived cell or duplicate", () => { const values="BBPTPBT"; const source=big(Array.from({length:500},(_,i)=>values[i%values.length]).join("")); for(const build of [road.buildBigEyeBoy,road.buildSmallRoad,road.buildCockroachPig]){const out=build(source), seen=new Set();for(const cell of out.cells){assert.ok(cell.row>=0&&cell.row<6);assert.ok(cell.col>=0);const key=`${cell.row}:${cell.col}`;assert.equal(seen.has(key),false);seen.add(key);}assert.equal(out.cells.length,out.signals.length);} });
test("fixed sequence one has expected colors", () => assert.deepEqual(colors(road.buildBigEyeBoy(big("BBPPBBPP"))),["RED","RED","RED","RED","RED"]));
test("fixed sequence two has expected colors", () => { const source=big("BBPBBP"); assert.deepEqual(colors(road.buildBigEyeBoy(source)),["BLUE","BLUE","BLUE"]); assert.deepEqual(colors(road.buildSmallRoad(source)),["RED","RED"]); });
test("fixed sequence three has offset-specific outputs", () => { const source=big("BBPPPBBBPP"); assert.deepEqual(colors(road.buildBigEyeBoy(source)),["RED","BLUE","BLUE","RED","RED","RED","RED"]); assert.deepEqual(colors(road.buildSmallRoad(source)),["RED","BLUE","BLUE","RED"]); assert.deepEqual(colors(road.buildCockroachPig(source)),["RED"]); });

console.log(`\nTEST SUMMARY: Passed: ${passed}; Failed: ${failed}`);
if (failed) process.exitCode = 1;
