"use strict";

/**
 * Baccarat V0.2 math engine. This module deliberately has no DOM or betting
 * dependencies, so it can be tested or consumed by a later betting layer.
 */

const SUITS = Object.freeze(["spades", "hearts", "diamonds", "clubs"]);
const RANKS = Object.freeze(["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"]);
const BURN_VALUE_RANKS = new Set(["10", "J", "Q", "K"]);
const DEFAULT_DECK_COUNT = 8;
const PLAYER_DRAW_MAX_SCORE = 5;
const NATURAL_SCORES = new Set([8, 9]);
const WINNERS = Object.freeze({ PLAYER: "PLAYER", BANKER: "BANKER", TIE: "TIE" });

function getBaccaratValue(cardOrRank) {
  const rank = typeof cardOrRank === "string" ? cardOrRank : cardOrRank && cardOrRank.rank;
  if (!RANKS.includes(rank)) {
    throw new TypeError(`Unknown baccarat rank: ${String(rank)}`);
  }
  if (rank === "A") return 1;
  if (BURN_VALUE_RANKS.has(rank)) return 0;
  return Number(rank);
}

function createDeck(deckIndex = 0) {
  if (!Number.isInteger(deckIndex) || deckIndex < 0) {
    throw new TypeError("deckIndex must be a non-negative integer");
  }
  return SUITS.flatMap((suit) => RANKS.map((rank, rankIndex) => ({
    id: `deck-${deckIndex}-${suit}-${rank}`,
    deckIndex,
    suit,
    rank,
    baccaratValue: getBaccaratValue(rank),
    // Keeps IDs unique even if a consumer constructs more than one shoe.
    sequence: deckIndex * 52 + SUITS.indexOf(suit) * RANKS.length + rankIndex,
  })));
}

function createShoe(deckCount = DEFAULT_DECK_COUNT) {
  if (!Number.isInteger(deckCount) || deckCount <= 0) {
    throw new TypeError("deckCount must be a positive integer");
  }
  return Array.from({ length: deckCount }, (_, deckIndex) => createDeck(deckIndex)).flat();
}

/** In-place unbiased Fisher-Yates shuffle; returns shoe for convenient chaining. */
function shuffleShoe(shoe, random = Math.random) {
  if (!Array.isArray(shoe)) throw new TypeError("shoe must be an array");
  if (typeof random !== "function") throw new TypeError("random must be a function");
  for (let index = shoe.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shoe[index], shoe[swapIndex]] = [shoe[swapIndex], shoe[index]];
  }
  return shoe;
}

function drawCard(shoe) {
  if (!Array.isArray(shoe)) throw new TypeError("shoe must be an array");
  if (shoe.length === 0) throw new RangeError("Cannot draw from an empty shoe");
  return shoe.pop();
}

function calculateBaccaratScore(cards) {
  if (!Array.isArray(cards)) throw new TypeError("cards must be an array");
  return cards.reduce((total, card) => total + getBaccaratValue(card), 0) % 10;
}

function isNatural(playerScore, bankerScore) {
  return NATURAL_SCORES.has(playerScore) || NATURAL_SCORES.has(bankerScore);
}

function shouldPlayerDraw(playerScore) {
  return playerScore >= 0 && playerScore <= PLAYER_DRAW_MAX_SCORE;
}

/**
 * Standard banker third-card table. bankerScore is always its original
 * two-card score; playerThirdCardValue is a baccarat value (0 through 9).
 */
function shouldBankerDraw(bankerScore, playerDrewThirdCard, playerThirdCardValue) {
  if (!Number.isInteger(bankerScore) || bankerScore < 0 || bankerScore > 7) {
    throw new RangeError("bankerScore must be an integer from 0 through 7");
  }
  if (!playerDrewThirdCard) return bankerScore <= 5;
  if (!Number.isInteger(playerThirdCardValue) || playerThirdCardValue < 0 || playerThirdCardValue > 9) {
    throw new RangeError("playerThirdCardValue must be an integer from 0 through 9 when Player draws");
  }

  switch (bankerScore) {
    case 0: case 1: case 2: return true;
    case 3: return playerThirdCardValue !== 8;
    case 4: return playerThirdCardValue >= 2 && playerThirdCardValue <= 7;
    case 5: return playerThirdCardValue >= 4 && playerThirdCardValue <= 7;
    case 6: return playerThirdCardValue === 6 || playerThirdCardValue === 7;
    case 7: return false;
    default: return false;
  }
}

function isPair(cards) {
  return Array.isArray(cards) && cards.length >= 2 && cards[0].rank === cards[1].rank;
}

function determineWinner(playerScore, bankerScore) {
  if (playerScore === bankerScore) return WINNERS.TIE;
  return playerScore > bankerScore ? WINNERS.PLAYER : WINNERS.BANKER;
}

function formatCard(card) {
  return `${card.rank} (${card.suit})`;
}

function logRound(result, logger = console.log) {
  logger("--- Baccarat Round ---");
  logger(`Player: ${result.playerCards.map(formatCard).join(", ")}`);
  logger(`Final Score: ${result.playerFinalScore}`);
  logger(`Banker: ${result.bankerCards.map(formatCard).join(", ")}`);
  logger(`Final Score: ${result.bankerFinalScore}`);
  logger(`Player Pair: ${result.playerPair}`);
  logger(`Banker Pair: ${result.bankerPair}`);
  logger(`Winner: ${result.winner}`);
  logger(`Cards Used: ${result.cardsUsed}`);
  logger(`Remaining Shoe: ${result.remainingCards}`);
}

function playRound(shoe, { debug = false, logger = console.log } = {}) {
  if (!Array.isArray(shoe)) throw new TypeError("shoe must be an array");
  const cardsBefore = shoe.length;
  const playerCards = [];
  const bankerCards = [];

  // Locked dealing order: Player 1, Banker 1, Player 2, Banker 2.
  playerCards.push(drawCard(shoe));
  bankerCards.push(drawCard(shoe));
  playerCards.push(drawCard(shoe));
  bankerCards.push(drawCard(shoe));

  const playerInitialScore = calculateBaccaratScore(playerCards);
  const bankerInitialScore = calculateBaccaratScore(bankerCards);
  const natural = isNatural(playerInitialScore, bankerInitialScore);
  let playerDrewThirdCard = false;
  let bankerDrewThirdCard = false;

  if (!natural && shouldPlayerDraw(playerInitialScore)) {
    playerCards.push(drawCard(shoe));
    playerDrewThirdCard = true;
  }

  const playerThirdCardValue = playerDrewThirdCard
    ? playerCards[2].baccaratValue
    : undefined;
  if (!natural && shouldBankerDraw(bankerInitialScore, playerDrewThirdCard, playerThirdCardValue)) {
    bankerCards.push(drawCard(shoe));
    bankerDrewThirdCard = true;
  }

  const result = {
    playerCards,
    bankerCards,
    playerInitialScore,
    bankerInitialScore,
    natural,
    playerDrewThirdCard,
    bankerDrewThirdCard,
    playerFinalScore: calculateBaccaratScore(playerCards),
    bankerFinalScore: calculateBaccaratScore(bankerCards),
    playerPair: isPair(playerCards),
    bankerPair: isPair(bankerCards),
    winner: null,
    cardsUsed: cardsBefore - shoe.length,
    remainingCards: shoe.length,
  };
  result.winner = determineWinner(result.playerFinalScore, result.bankerFinalScore);
  if (debug) logRound(result, logger);
  return result;
}

const baccaratEngineApi = {
  SUITS, RANKS, DEFAULT_DECK_COUNT, WINNERS,
  getBaccaratValue, createDeck, createShoe, shuffleShoe, drawCard,
  calculateBaccaratScore, isNatural, shouldPlayerDraw, shouldBankerDraw,
  isPair, determineWinner, logRound, playRound,
};

if (typeof module !== "undefined" && module.exports) module.exports = baccaratEngineApi;
if (typeof globalThis !== "undefined") globalThis.BaccaratEngine = baccaratEngineApi;
