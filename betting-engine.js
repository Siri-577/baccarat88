"use strict";

/**
 * Baccarat V0.3 betting engine. It is intentionally independent of the card
 * engine: callers supply V0.2's compact round result (winner and pair flags).
 */

const BET_TYPES = Object.freeze({
  PLAYER: "PLAYER",
  BANKER: "BANKER",
  TIE: "TIE",
  PLAYER_PAIR: "PLAYER_PAIR",
  BANKER_PAIR: "BANKER_PAIR",
});
const BET_TYPE_LIST = Object.freeze(Object.values(BET_TYPES));
const PAYTABLE = Object.freeze({
  [BET_TYPES.PLAYER]: 1,
  [BET_TYPES.BANKER]: 0.95,
  [BET_TYPES.TIE]: 8,
  [BET_TYPES.PLAYER_PAIR]: 11,
  [BET_TYPES.BANKER_PAIR]: 11,
});
const BETTING_STATES = Object.freeze({
  BETTING_OPEN: "BETTING_OPEN",
  BETTING_CLOSED: "BETTING_CLOSED",
  SETTLED: "SETTLED",
});
const OUTCOMES = Object.freeze({ WIN: "WIN", LOSE: "LOSE", PUSH: "PUSH", NO_BET: "NO_BET" });
const VALID_WINNERS = new Set(["PLAYER", "BANKER", "TIE"]);

function roundMoney(value) {
  if (!Number.isFinite(value)) throw new TypeError("Money value must be finite");
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function assertAccount(account) {
  if (!account || typeof account !== "object" || !Number.isFinite(account.balance) || account.balance < 0) {
    throw new TypeError("account must have a non-negative finite balance");
  }
}

function createPlayerAccount(initialBalance = 10000) {
  if (!Number.isFinite(initialBalance) || initialBalance < 0) {
    throw new TypeError("initialBalance must be a non-negative finite number");
  }
  return { balance: roundMoney(initialBalance) };
}

function createEmptyBets() {
  return Object.fromEntries(BET_TYPE_LIST.map((type) => [type, 0]));
}

function createBettingRound(roundId, account) {
  assertAccount(account);
  if (roundId === undefined || roundId === null || roundId === "") {
    throw new TypeError("roundId is required");
  }
  return {
    roundId,
    status: BETTING_STATES.BETTING_OPEN,
    bets: createEmptyBets(),
    balanceBeforeRound: account.balance,
    balanceAfterBet: account.balance,
    settled: false,
    settlement: null,
  };
}

function assertBetType(betType) {
  if (!BET_TYPE_LIST.includes(betType)) throw new RangeError(`Unknown bet type: ${String(betType)}`);
}

function placeBet(account, bettingRound, betType, amount) {
  assertAccount(account);
  if (!bettingRound || bettingRound.status !== BETTING_STATES.BETTING_OPEN || bettingRound.settled) {
    throw new Error("Bets can only be placed while betting is open");
  }
  assertBetType(betType);
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
    throw new TypeError("Bet amount must be a finite positive number");
  }
  const stake = roundMoney(amount);
  if (stake <= 0) throw new RangeError("Bet amount must round to at least 0.01");
  if (stake > account.balance) throw new RangeError("Insufficient balance for bet");

  bettingRound.bets[betType] = roundMoney(bettingRound.bets[betType] + stake);
  account.balance = roundMoney(account.balance - stake);
  bettingRound.balanceAfterBet = account.balance;
  return { betType, amount: stake, totalStake: bettingRound.bets[betType], balance: account.balance };
}

function closeBetting(bettingRound) {
  if (!bettingRound || bettingRound.status !== BETTING_STATES.BETTING_OPEN) {
    throw new Error("Only an open betting round can be closed");
  }
  bettingRound.status = BETTING_STATES.BETTING_CLOSED;
  return bettingRound;
}

function validateRoundResult(roundResult) {
  if (!roundResult || !VALID_WINNERS.has(roundResult.winner)) {
    throw new TypeError("roundResult must have a valid winner: PLAYER, BANKER, or TIE");
  }
  if (typeof roundResult.playerPair !== "boolean" || typeof roundResult.bankerPair !== "boolean") {
    throw new TypeError("roundResult must include boolean playerPair and bankerPair values");
  }
}

function getOutcome(betType, roundResult) {
  if (betType === BET_TYPES.PLAYER) {
    return roundResult.winner === "TIE" ? OUTCOMES.PUSH : roundResult.winner === "PLAYER" ? OUTCOMES.WIN : OUTCOMES.LOSE;
  }
  if (betType === BET_TYPES.BANKER) {
    return roundResult.winner === "TIE" ? OUTCOMES.PUSH : roundResult.winner === "BANKER" ? OUTCOMES.WIN : OUTCOMES.LOSE;
  }
  if (betType === BET_TYPES.TIE) return roundResult.winner === "TIE" ? OUTCOMES.WIN : OUTCOMES.LOSE;
  if (betType === BET_TYPES.PLAYER_PAIR) return roundResult.playerPair ? OUTCOMES.WIN : OUTCOMES.LOSE;
  return roundResult.bankerPair ? OUTCOMES.WIN : OUTCOMES.LOSE;
}

function settleBet(betType, stake, roundResult) {
  assertBetType(betType);
  if (!Number.isFinite(stake) || stake < 0) throw new TypeError("Stake must be a non-negative finite number");
  const normalizedStake = roundMoney(stake);
  const odds = PAYTABLE[betType];
  if (normalizedStake === 0) return { betType, stake: 0, outcome: OUTCOMES.NO_BET, odds, profit: 0, returnAmount: 0 };

  const outcome = getOutcome(betType, roundResult);
  if (outcome === OUTCOMES.PUSH) {
    return { betType, stake: normalizedStake, outcome, odds, profit: 0, returnAmount: normalizedStake };
  }
  if (outcome === OUTCOMES.LOSE) {
    return { betType, stake: normalizedStake, outcome, odds, profit: 0, returnAmount: 0 };
  }
  const profit = roundMoney(normalizedStake * odds);
  return { betType, stake: normalizedStake, outcome, odds, profit, returnAmount: roundMoney(normalizedStake + profit) };
}

/** Pure settlement calculation: does not mutate balances, bets, or session state. */
function settleBets(bets, roundResult) {
  validateRoundResult(roundResult);
  if (!bets || typeof bets !== "object") throw new TypeError("bets must be an object");
  const betsSnapshot = createEmptyBets();
  const settlements = {};
  for (const type of BET_TYPE_LIST) {
    const stake = bets[type] === undefined ? 0 : bets[type];
    settlements[type] = settleBet(type, stake, roundResult);
    betsSnapshot[type] = settlements[type].stake;
  }
  const totalBet = roundMoney(BET_TYPE_LIST.reduce((sum, type) => sum + betsSnapshot[type], 0));
  const totalReturn = roundMoney(BET_TYPE_LIST.reduce((sum, type) => sum + settlements[type].returnAmount, 0));
  const totalProfit = roundMoney(BET_TYPE_LIST.reduce((sum, type) => sum + settlements[type].profit, 0));
  return { bets: betsSnapshot, settlements, totalBet, totalReturn, totalProfit, netResult: roundMoney(totalReturn - totalBet) };
}

function settleRound(account, bettingRound, roundResult) {
  assertAccount(account);
  if (!bettingRound || bettingRound.settled || bettingRound.status === BETTING_STATES.SETTLED) {
    throw new Error("This betting round has already been settled");
  }
  if (bettingRound.status !== BETTING_STATES.BETTING_CLOSED) {
    throw new Error("Betting must be closed before settlement");
  }
  const calculation = settleBets(bettingRound.bets, roundResult);
  const settlement = {
    roundId: bettingRound.roundId,
    ...calculation,
    balanceBeforeRound: bettingRound.balanceBeforeRound,
    balanceAfterBet: bettingRound.balanceAfterBet,
    balanceAfterSettlement: roundMoney(account.balance + calculation.totalReturn),
    roundResult: { winner: roundResult.winner, playerPair: roundResult.playerPair, bankerPair: roundResult.bankerPair },
  };
  account.balance = settlement.balanceAfterSettlement;
  bettingRound.settled = true;
  bettingRound.status = BETTING_STATES.SETTLED;
  bettingRound.settlement = settlement;
  return settlement;
}

function resetBets(bettingRound) {
  if (!bettingRound || bettingRound.status !== BETTING_STATES.SETTLED) {
    throw new Error("Bets can only be reset after settlement");
  }
  bettingRound.bets = createEmptyBets();
  return bettingRound.bets;
}

const bettingEngineApi = {
  BET_TYPES, PAYTABLE, BETTING_STATES, OUTCOMES,
  roundMoney, createPlayerAccount, createEmptyBets, createBettingRound,
  placeBet, closeBetting, settleBet, settleBets, settleRound, resetBets,
};

if (typeof module !== "undefined" && module.exports) module.exports = bettingEngineApi;
if (typeof globalThis !== "undefined") globalThis.BettingEngine = bettingEngineApi;
