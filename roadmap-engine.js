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
        tieCount: 0, sourceRoundIds: [entry.roundId], streakId: streak.id,
      };
      cells.push(cell);
      occupied.set(gridKey(row, col), cell);
      streak.lastRow = row;
      streak.lastCol = col;
      return cell;
    }

    function startStreak(winner, entry) {
      const requestedCol = currentStreak ? currentStreak.startCol + 1 : 0;
      const startCol = nextOpenInRow(occupied, 0, requestedCol);
      const streak = { id: streaks.length, winner, startCol, lastRow: 0, lastCol: startCol, turnedRight: false };
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

    return { cells, leadingTieCount, streaks, rows: ROAD_ROWS };
  }

  const api = { ROAD_ROWS, DECISIVE_WINNERS, createRoadHistoryEntry, buildBeadPlate, buildBigRoad, getRoadmapStatistics };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.RoadmapEngine = api;
}(typeof globalThis !== "undefined" ? globalThis : this));
