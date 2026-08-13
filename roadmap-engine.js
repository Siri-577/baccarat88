"use strict";

(function initializeRoadmapEngine(root) {
  const ROAD_ROWS = 6;
  const DECISIVE_WINNERS = new Set(["BANKER", "PLAYER"]);

  function assertHistory(history) {
    if (!Array.isArray(history)) throw new TypeError("history must be an array");
  }

  function createRoadHistoryEntry(roundResult, context = {}) {
    if (!roundResult || !["BANKER", "PLAYER", "TIE"].includes(roundResult.winner)) {
      throw new TypeError("roundResult must contain a valid winner");
    }
    return Object.freeze({
      shoeId: context.shoeId,
      roundId: context.roundId,
      winner: roundResult.winner,
      playerPair: Boolean(roundResult.playerPair),
      bankerPair: Boolean(roundResult.bankerPair),
      playerScore: roundResult.playerFinalScore,
      bankerScore: roundResult.bankerFinalScore,
    });
  }

  function buildBeadPlate(history) {
    assertHistory(history);
    return history.map((entry, index) => ({
      row: index % ROAD_ROWS,
      col: Math.floor(index / ROAD_ROWS),
      winner: entry.winner,
      playerPair: Boolean(entry.playerPair),
      bankerPair: Boolean(entry.bankerPair),
      roundId: entry.roundId,
      shoeId: entry.shoeId,
    }));
  }

  function getRoadmapStatistics(history) {
    assertHistory(history);
    return history.reduce((stats, entry) => {
      stats.hands += 1;
      if (entry.winner === "BANKER") stats.banker += 1;
      else if (entry.winner === "PLAYER") stats.player += 1;
      else if (entry.winner === "TIE") stats.tie += 1;
      if (entry.playerPair) stats.playerPair += 1;
      if (entry.bankerPair) stats.bankerPair += 1;
      return stats;
    }, { hands: 0, banker: 0, player: 0, tie: 0, playerPair: 0, bankerPair: 0 });
  }

  function gridKey(row, col) { return `${row}:${col}`; }

  function nextOpenInRow(occupied, row, startCol) {
    let col = startCol;
    while (occupied.has(gridKey(row, col))) col += 1;
    return col;
  }

  function buildBigRoad(history) {
    assertHistory(history);
    const cells = [];
    const streaks = [];
    const occupied = new Map();
    let currentStreak = null;
    let leadingTieCount = 0;

    function addCell(winner, entry, row, col, streak) {
      const cell = {
        row, col, logicalRow: row, logicalCol: col, winner,
        tieCount: 0, sourceRoundIds: [entry.roundId], sourceRoundId: entry.roundId,
        streakId: streak.id, sequenceIndex: cells.length,
      };
      cells.push(cell);
      occupied.set(gridKey(row, col), cell);
      streak.lastRow = row;
      streak.lastCol = col;
      streak.cells.push(cell);
      streak.logicalHeight = streak.cells.length;
      return cell;
    }

    function startStreak(winner, entry) {
      const requestedCol = currentStreak ? currentStreak.startCol + 1 : 0;
      const startCol = nextOpenInRow(occupied, 0, requestedCol);
      const streak = { id: streaks.length, winner, startCol, lastRow: 0, lastCol: startCol, turnedRight: false, cells: [], logicalHeight: 0 };
      streaks.push(streak);
      currentStreak = streak;
      const cell = addCell(winner, entry, 0, startCol, streak);
      if (leadingTieCount) {
        cell.tieCount = leadingTieCount;
        leadingTieCount = 0;
      }
      return cell;
    }

    function appendToStreak(entry) {
      const canMoveDown = !currentStreak.turnedRight
        && currentStreak.lastRow + 1 < ROAD_ROWS
        && !occupied.has(gridKey(currentStreak.lastRow + 1, currentStreak.lastCol));
      if (canMoveDown) return addCell(currentStreak.winner, entry, currentStreak.lastRow + 1, currentStreak.lastCol, currentStreak);
      currentStreak.turnedRight = true;
      const col = nextOpenInRow(occupied, currentStreak.lastRow, currentStreak.lastCol + 1);
      return addCell(currentStreak.winner, entry, currentStreak.lastRow, col, currentStreak);
    }

    for (const entry of history) {
      if (!entry || !["BANKER", "PLAYER", "TIE"].includes(entry.winner)) throw new TypeError("history contains an invalid winner");
      if (entry.winner === "TIE") {
        if (currentStreak) {
          const cell = occupied.get(gridKey(currentStreak.lastRow, currentStreak.lastCol));
          cell.tieCount += 1;
          cell.sourceRoundIds.push(entry.roundId);
        } else {
          leadingTieCount += 1;
        }
        continue;
      }
      if (!currentStreak || currentStreak.winner !== entry.winner) startStreak(entry.winner, entry);
      else appendToStreak(entry);
    }

    return { cells, cellsInChronologicalOrder: cells.slice(), leadingTieCount, streaks, rows: ROAD_ROWS };
  }

  function getBigRoadCellMap(bigRoad) {
    if (!bigRoad || !Array.isArray(bigRoad.cells)) throw new TypeError("bigRoad must contain cells");
    return new Map(bigRoad.cells.map((cell) => [gridKey(cell.logicalRow ?? cell.row, cell.logicalCol ?? cell.col), cell]));
  }

  function deriveColorForBigRoadCell(bigRoad, cell, offset) {
    if (!Number.isInteger(offset) || offset < 1) throw new RangeError("offset must be a positive integer");
    if (!cell || !Number.isInteger(cell.streakId)) return null;
    const streaks = bigRoad.streaks || [];
    if (cell.row === 0) {
      if (cell.streakId < offset + 1) return null;
      const previous = streaks[cell.streakId - 1];
      const comparison = streaks[cell.streakId - offset - 1];
      if (!previous || !comparison) return null;
      return previous.logicalHeight === comparison.logicalHeight ? "RED" : "BLUE";
    }
    if (cell.streakId < offset) return null;
    const referenceCol = (cell.logicalCol ?? cell.col) - offset;
    if (referenceCol < 0) return null;
    const occupied = getBigRoadCellMap(bigRoad);
    const row = cell.logicalRow ?? cell.row;
    const currentExists = occupied.has(gridKey(row, referenceCol));
    const previousExists = occupied.has(gridKey(row - 1, referenceCol));
    return currentExists === previousExists ? "RED" : "BLUE";
  }

  function layoutDerivedRoad(signals) {
    if (!Array.isArray(signals)) throw new TypeError("signals must be an array");
    const cells = [];
    const occupied = new Map();
    let current = null;
    function add(signal, row, col) {
      const cell = { ...signal, row, col, logicalRow: row, logicalCol: col, sequenceIndex: cells.length };
      cells.push(cell); occupied.set(gridKey(row, col), cell); current.lastRow = row; current.lastCol = col; return cell;
    }
    for (const signal of signals) {
      if (!signal || !["RED", "BLUE"].includes(signal.color)) throw new TypeError("derived signals must be RED or BLUE");
      if (!current || current.color !== signal.color) {
        const startCol = nextOpenInRow(occupied, 0, current ? current.startCol + 1 : 0);
        current = { color: signal.color, startCol, lastRow: 0, lastCol: startCol, turnedRight: false };
        add(signal, 0, startCol);
        continue;
      }
      const canMoveDown = !current.turnedRight && current.lastRow + 1 < ROAD_ROWS && !occupied.has(gridKey(current.lastRow + 1, current.lastCol));
      if (canMoveDown) add(signal, current.lastRow + 1, current.lastCol);
      else { current.turnedRight = true; add(signal, current.lastRow, nextOpenInRow(occupied, current.lastRow, current.lastCol + 1)); }
    }
    return { cells, signals: signals.map((signal) => ({ ...signal })), rows: ROAD_ROWS };
  }

  function buildDerivedRoad(bigRoad, offset) {
    const chronological = (bigRoad?.cellsInChronologicalOrder || bigRoad?.cells || []).slice().sort((a, b) => a.sequenceIndex - b.sequenceIndex);
    const signals = chronological.map((cell) => {
      const color = deriveColorForBigRoadCell(bigRoad, cell, offset);
      return color ? { color, sourceBigRoadRow: cell.logicalRow ?? cell.row, sourceBigRoadCol: cell.logicalCol ?? cell.col, sourceRoundId: cell.sourceRoundId ?? cell.sourceRoundIds?.[0], sourceSequenceIndex: cell.sequenceIndex } : null;
    }).filter(Boolean);
    return { ...layoutDerivedRoad(signals), offset };
  }

  function buildBigEyeBoy(bigRoad) { return buildDerivedRoad(bigRoad, 1); }
  function buildSmallRoad(bigRoad) { return buildDerivedRoad(bigRoad, 2); }
  function buildCockroachPig(bigRoad) { return buildDerivedRoad(bigRoad, 3); }

  const api = { ROAD_ROWS, DECISIVE_WINNERS, createRoadHistoryEntry, buildBeadPlate, buildBigRoad, getRoadmapStatistics, getBigRoadCellMap, deriveColorForBigRoadCell, layoutDerivedRoad, buildDerivedRoad, buildBigEyeBoy, buildSmallRoad, buildCockroachPig };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.RoadmapEngine = api;
}(typeof globalThis !== "undefined" ? globalThis : this));
