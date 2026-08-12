"use strict";

const fs = require("node:fs");
const path = require("node:path");
const baccarat = require("./baccarat-engine");
const betting = require("./betting-engine");

const DEFAULT_ROUNDS = 1000000;
const DEFAULT_DECK_COUNT = 8;
const DEFAULT_RESHUFFLE_THRESHOLD = 60;
const REFERENCE_PROBABILITIES = Object.freeze({ PLAYER: 0.446247, BANKER: 0.458597, TIE: 0.095156, PLAYER_PAIR: 0.074699, BANKER_PAIR: 0.074699 });

function createSeededRandom(seed) {
  if (!Number.isInteger(seed)) throw new TypeError("seed must be an integer");
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function emptyRtp() {
  return Object.fromEntries(Object.values(betting.BET_TYPES).map((type) => [type, { totalStake: 0, totalReturn: 0, rtp: 0, houseEdge: 0, playerNet: 0 }]));
}

function percentage(value, digits = 4) {
  return `${(value * 100).toFixed(digits)}%`;
}

function buildValidation(report) {
  const mainTotal = Object.values(report.mainResults.counts).reduce((sum, count) => sum + count, 0);
  const cardTotal = Object.values(report.cardUsage.counts).reduce((sum, count) => sum + count, 0);
  const probabilitySum = Object.values(report.mainResults.probabilities).reduce((sum, value) => sum + value, 0);
  const rtpStakeCorrect = Object.values(report.rtp).every((entry) => entry.totalStake === report.config.rounds);
  const referenceWarnings = Object.entries(REFERENCE_PROBABILITIES)
    .filter(([key, expected]) => Math.abs((report.mainResults.probabilities[key] ?? report.pairs.probabilities[key]) - expected) > 0.005)
    .map(([key]) => `${key} probability differs from reference by more than 0.5 percentage point`);
  return {
    totalRoundCountCorrect: mainTotal === report.config.rounds,
    resultProbabilitySumCorrect: Math.abs(probabilitySum - 1) < 1e-12,
    cardUsageCountCorrect: cardTotal === report.config.rounds,
    pairCountsCorrect: report.pairs.counts.PLAYER_PAIR <= report.config.rounds && report.pairs.counts.BANKER_PAIR <= report.config.rounds && report.pairs.counts.BOTH_PAIR <= report.pairs.counts.PLAYER_PAIR && report.pairs.counts.BOTH_PAIR <= report.pairs.counts.BANKER_PAIR,
    rtpStakeCorrect,
    invalidWinner: report.errors.invalidWinner,
    invalidCardsUsed: report.errors.invalidCardsUsed,
    nan: report.errors.nan,
    infinity: report.errors.infinity,
    negativeReturn: report.errors.negativeReturn,
    settlementError: report.errors.settlementError,
    reshuffleError: report.errors.reshuffleError,
    uncaughtError: report.errors.uncaughtError,
    referenceWarnings,
  };
}

function simulationStatus(validation) {
  const hardFailure = !validation.totalRoundCountCorrect || !validation.resultProbabilitySumCorrect || !validation.cardUsageCountCorrect || !validation.pairCountsCorrect || !validation.rtpStakeCorrect || validation.invalidWinner || validation.invalidCardsUsed || validation.nan || validation.infinity || validation.negativeReturn || validation.settlementError || validation.reshuffleError || validation.uncaughtError;
  if (hardFailure) return "FAIL";
  return validation.referenceWarnings.length ? "WARNING" : "PASS";
}

function runSimulation({ rounds = DEFAULT_ROUNDS, deckCount = DEFAULT_DECK_COUNT, reshuffleThreshold = DEFAULT_RESHUFFLE_THRESHOLD, seed, progressEvery = 0, onProgress } = {}) {
  if (!Number.isInteger(rounds) || rounds <= 0) throw new TypeError("rounds must be a positive integer");
  if (!Number.isInteger(deckCount) || deckCount <= 0) throw new TypeError("deckCount must be a positive integer");
  if (!Number.isInteger(reshuffleThreshold) || reshuffleThreshold < 0) throw new TypeError("reshuffleThreshold must be a non-negative integer");
  const random = seed === undefined ? Math.random : createSeededRandom(seed);
  const startedAt = Date.now();
  let shoe = baccarat.shuffleShoe(baccarat.createShoe(deckCount), random);
  let shoeCount = 1;
  let reshuffleCount = 0;
  const counts = { PLAYER: 0, BANKER: 0, TIE: 0 };
  const pairCounts = { PLAYER_PAIR: 0, BANKER_PAIR: 0, BOTH_PAIR: 0 };
  const naturalCounts = { ANY: 0, PLAYER: 0, BANKER: 0, BOTH: 0 };
  const cardCounts = { 4: 0, 5: 0, 6: 0 };
  const rtp = emptyRtp();
  const errors = { invalidWinner: 0, invalidCardsUsed: 0, nan: 0, infinity: 0, negativeReturn: 0, settlementError: 0, reshuffleError: 0, uncaughtError: 0 };
  let totalCardsUsed = 0;

  for (let roundNumber = 1; roundNumber <= rounds; roundNumber += 1) {
    // A shoe is only replaced before a new round—never while a round is dealt.
    if (shoe.length < reshuffleThreshold) {
      shoe = baccarat.shuffleShoe(baccarat.createShoe(deckCount), random);
      shoeCount += 1;
      reshuffleCount += 1;
    }
    try {
      const roundResult = baccarat.playRound(shoe);
      if (!Object.hasOwn(counts, roundResult.winner)) errors.invalidWinner += 1;
      else counts[roundResult.winner] += 1;
      if (roundResult.playerPair) pairCounts.PLAYER_PAIR += 1;
      if (roundResult.bankerPair) pairCounts.BANKER_PAIR += 1;
      if (roundResult.playerPair && roundResult.bankerPair) pairCounts.BOTH_PAIR += 1;
      const playerNatural = roundResult.playerInitialScore === 8 || roundResult.playerInitialScore === 9;
      const bankerNatural = roundResult.bankerInitialScore === 8 || roundResult.bankerInitialScore === 9;
      if (playerNatural || bankerNatural) naturalCounts.ANY += 1;
      if (playerNatural) naturalCounts.PLAYER += 1;
      if (bankerNatural) naturalCounts.BANKER += 1;
      if (playerNatural && bankerNatural) naturalCounts.BOTH += 1;
      if (!Object.hasOwn(cardCounts, roundResult.cardsUsed)) errors.invalidCardsUsed += 1;
      else cardCounts[roundResult.cardsUsed] += 1;
      totalCardsUsed += roundResult.cardsUsed;

      for (const type of Object.values(betting.BET_TYPES)) {
        const item = betting.settleBet(type, 1, roundResult);
        rtp[type].totalStake += 1;
        rtp[type].totalReturn = betting.roundMoney(rtp[type].totalReturn + item.returnAmount);
        if (!Number.isFinite(item.returnAmount) || item.returnAmount < 0) errors.negativeReturn += 1;
      }
    } catch (error) {
      errors.uncaughtError += 1;
      throw error;
    }
    if (progressEvery > 0 && roundNumber % progressEvery === 0 && onProgress) onProgress(roundNumber, rounds);
  }

  for (const entry of Object.values(rtp)) {
    entry.rtp = entry.totalReturn / entry.totalStake;
    entry.houseEdge = 1 - entry.rtp;
    entry.playerNet = betting.roundMoney(entry.totalReturn - entry.totalStake);
    if (Number.isNaN(entry.rtp)) errors.nan += 1;
    if (!Number.isFinite(entry.rtp)) errors.infinity += 1;
  }
  const report = {
    version: "0.4.0",
    status: null,
    config: { rounds, deckCount, cardsPerShoe: deckCount * 52, reshuffleThreshold, ...(seed === undefined ? {} : { seed }) },
    shoes: { shoeCount, reshuffleCount },
    mainResults: { counts, probabilities: Object.fromEntries(Object.entries(counts).map(([type, count]) => [type, count / rounds])) },
    pairs: { counts: pairCounts, probabilities: { PLAYER_PAIR: pairCounts.PLAYER_PAIR / rounds, BANKER_PAIR: pairCounts.BANKER_PAIR / rounds, BOTH_PAIR: pairCounts.BOTH_PAIR / rounds } },
    naturals: { counts: naturalCounts, rate: naturalCounts.ANY / rounds },
    cardUsage: { counts: cardCounts, proportions: Object.fromEntries(Object.entries(cardCounts).map(([cards, count]) => [cards, count / rounds])), totalCardsUsed, averageCardsPerRound: totalCardsUsed / rounds },
    rtp,
    errors,
    validation: null,
    runtime: { milliseconds: Date.now() - startedAt, seconds: (Date.now() - startedAt) / 1000 },
  };
  report.validation = buildValidation(report);
  report.status = simulationStatus(report.validation);
  return report;
}

function formatReport(report) {
  const lines = ["=====================================", " Baccarat88 V0.4 Simulation Report", "=====================================", "", `Status: ${report.status}`, `Rounds: ${report.config.rounds.toLocaleString()}`, `Decks Per Shoe: ${report.config.deckCount}`, `Reshuffle Threshold: ${report.config.reshuffleThreshold}`, `Shoes Used: ${report.shoes.shoeCount}`, `Runtime: ${report.runtime.seconds.toFixed(3)} seconds`, "", "MAIN RESULTS"];
  for (const type of ["PLAYER", "BANKER", "TIE"]) lines.push(`${type}: ${report.mainResults.counts[type].toLocaleString()} (${percentage(report.mainResults.probabilities[type])})`);
  lines.push("", "PAIR");
  for (const type of ["PLAYER_PAIR", "BANKER_PAIR", "BOTH_PAIR"]) lines.push(`${type}: ${report.pairs.counts[type].toLocaleString()} (${percentage(report.pairs.probabilities[type])})`);
  lines.push("", "NATURAL", `Any Natural: ${report.naturals.counts.ANY.toLocaleString()} (${percentage(report.naturals.rate)})`, "", "CARDS USED");
  for (const cards of [4, 5, 6]) lines.push(`${cards} Cards: ${report.cardUsage.counts[cards].toLocaleString()} (${percentage(report.cardUsage.proportions[cards])})`);
  lines.push(`Average Cards Per Round: ${report.cardUsage.averageCardsPerRound.toFixed(4)}`, "", "RTP / HOUSE EDGE");
  for (const type of Object.values(betting.BET_TYPES)) {
    const entry = report.rtp[type];
    lines.push(`${type}: Stake ${entry.totalStake.toLocaleString()}, Return ${entry.totalReturn.toFixed(2)}, RTP ${percentage(entry.rtp)}, House Edge ${percentage(entry.houseEdge)}`);
  }
  lines.push("", "VALIDATION");
  for (const [key, value] of Object.entries(report.validation)) lines.push(`${key}: ${Array.isArray(value) ? (value.length ? value.join("; ") : "none") : value}`);
  lines.push("=====================================");
  return lines.join("\n");
}

function saveReport(report, outputDirectory = __dirname) {
  fs.writeFileSync(path.join(outputDirectory, "simulation-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(path.join(outputDirectory, "simulation-report.txt"), `${formatReport(report)}\n`);
}

if (require.main === module) {
  const report = runSimulation({ rounds: DEFAULT_ROUNDS, progressEvery: 100000, onProgress: (done, total) => console.log(`Simulation Progress: ${Math.round((done / total) * 100)}%`) });
  saveReport(report);
  console.log(formatReport(report));
}

module.exports = { DEFAULT_ROUNDS, DEFAULT_DECK_COUNT, DEFAULT_RESHUFFLE_THRESHOLD, REFERENCE_PROBABILITIES, createSeededRandom, runSimulation, formatReport, saveReport };
