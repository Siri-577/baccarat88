"use strict";

(function initializeApp(root) {
  const baccarat = root.BaccaratEngine || (typeof require !== "undefined" ? require("./baccarat-engine") : null);
  const betting = root.BettingEngine || (typeof require !== "undefined" ? require("./betting-engine") : null);
  const roadmapEngine = root.RoadmapEngine || (typeof require !== "undefined" ? require("./roadmap-engine") : null);
  if (!baccarat || !betting || !roadmapEngine) throw new Error("Baccarat, betting, and roadmap engines must be loaded before app.js");

  const INITIAL_BALANCE = 100000;
  const CHIP_VALUES = Object.freeze([10, 50, 100, 500, 1000, 5000]);
  const DEFAULT_CHIP = 100;
  const AREA_MIN_BET = 10;
  const AREA_MAX_BET = 20000;
  const ROUND_MAX_BET = 50000;
  const MIN_CUT_REMAINING = 14;
  const MAX_CUT_REMAINING = 26;
  const GAME_STATES = Object.freeze({ BURNING: "BURNING", BETTING: "BETTING", ROUND_LOCKED: "ROUND_LOCKED", AUTO_DEALING: "AUTO_DEALING", REVEAL_READY: "REVEAL_READY", REVEALING: "REVEALING", AUTO_REVEALING: "AUTO_REVEALING", AUTO_DRAWING: "AUTO_DRAWING", SETTLING: "SETTLING", ROUND_END: "ROUND_END", DISCARDING: "DISCARDING" });
  const BET_LABELS = Object.freeze({ PLAYER: "闲 / PLAYER", BANKER: "庄 / BANKER", TIE: "和 / TIE", PLAYER_PAIR: "闲对 / PLAYER PAIR", BANKER_PAIR: "庄对 / BANKER PAIR" });
  const SUIT_SYMBOLS = Object.freeze({ spades: "♠", hearts: "♥", diamonds: "♦", clubs: "♣" });
  const DEBUG_DEAL_ANIMATION = false;
  const DEBUG_BURN = root.__BACCARAT_DEBUG_BURN__ === true;
  const DEBUG_BURN_UI = root.__BACCARAT_DEBUG_BURN_UI__ === true;
  const REVEAL_MODES = Object.freeze({ MANUAL: "MANUAL", AUTO: "AUTO" });
  const AUTO_REVEAL_INTERVAL_MS = 1000;
  const AUTO_REVEAL_START_DELAY_MS = 500;
  const BURN_PRESENTATION_MS = 850;
  const CUT_CARD_ENTER_MS = 400;
  const CUT_CARD_HOLD_MS = 2000;
  const CUT_CARD_EXIT_MS = 400;
  const CUT_CARD_EVENT_MS = CUT_CARD_ENTER_MS + CUT_CARD_HOLD_MS + CUT_CARD_EXIT_MS;
  const CHIP_PLACEMENT_DURATION_MS = 220;
  const CHIP_RETURN_DURATION_MS = 220;
  const CHIP_CLEAR_RETURN_DURATION_MS = 240;
  const SHOE_STATUS = Object.freeze({ IN_PLAY: "IN_PLAY", CUT_REACHED: "CUT_REACHED", LAST_HAND_NEXT: "LAST_HAND_NEXT", LAST_HAND: "LAST_HAND", COMPLETE: "COMPLETE" });
  const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

  function formatMoney(value) {
    const number = betting.roundMoney(value);
    return new Intl.NumberFormat("en-US", { minimumFractionDigits: Number.isInteger(number) ? 0 : 2, maximumFractionDigits: 2 }).format(number);
  }

  /** Presentation-only queue based on an Engine-locked result; it never draws cards. */
  function buildDealQueue(roundResult) {
    const item = (side, cardIndex) => ({ side, cardIndex, card: roundResult[side === "PLAYER" ? "playerCards" : "bankerCards"][cardIndex], label: `${side} 第${cardIndex + 1}张${cardIndex === 2 ? "（补牌）" : ""}`, isThirdCard: cardIndex === 2 });
    const queue = [item("PLAYER", 0), item("BANKER", 0), item("PLAYER", 1), item("BANKER", 1)];
    if (roundResult.playerCards.length === 3) queue.push(item("PLAYER", 2));
    if (roundResult.bankerCards.length === 3) queue.push(item("BANKER", 2));
    return queue;
  }

  function getDealDuration(source, target, reducedMotion = false) {
    const distance = Math.hypot(target.left - source.left, target.top - source.top);
    const duration = Math.max(240, Math.min(380, 240 + distance * 0.14));
    return reducedMotion ? 80 : Math.round(duration);
  }

  function getDiscardSequence(dealQueue, dealtKeys) {
    return ["PLAYER-0", "PLAYER-1", "PLAYER-2", "BANKER-0", "BANKER-1", "BANKER-2"]
      .filter((key) => dealtKeys.has(key))
      .map((key) => dealQueue.find((item) => `${item.side}-${item.cardIndex}` === key));
  }

  function getBurnValue(card) {
    if (!card || !card.rank) throw new TypeError("Burn Card requires a rank");
    const value = ["10", "J", "Q", "K"].includes(card.rank) ? 10 : Number(card.rank === "A" ? 1 : card.rank);
    if (!Number.isInteger(value) || value < 1 || value > 10) throw new RangeError(`Unsupported Burn Card rank: ${card.rank}`);
    return value;
  }

  function createBurnState() {
    return { completed: false, revealedCard: null, burnValue: 0, additionalCards: [], totalBurned: 0 };
  }

  function randomInteger(min, max, random = Math.random) {
    return min + Math.floor(random() * (max - min + 1));
  }

  function createCutCardState(random = Math.random, forcedThreshold) {
    const remainingThreshold = forcedThreshold ?? randomInteger(MIN_CUT_REMAINING, MAX_CUT_REMAINING, random);
    if (!Number.isInteger(remainingThreshold) || remainingThreshold < MIN_CUT_REMAINING || remainingThreshold > MAX_CUT_REMAINING) throw new RangeError("Cut Card threshold is outside the supported range");
    return { remainingThreshold, reached: false, reachedDuringRound: false, lastHandPending: false, lastHandActive: false, shoeEnding: false };
  }

  /** The only DOM visibility authority for the Burn Card overlay. */
  function renderBurnPresentation(elements, game) {
    const overlay = elements.burnCard;
    if (!overlay) return;
    const visible = game.burnPresentationVisible === true;
    overlay.hidden = !visible;
    const burn = game.burnState;
    if (burn.revealedCard) {
      const symbol = SUIT_SYMBOLS[burn.revealedCard.suit];
      const color = burn.revealedCard.suit === "hearts" || burn.revealedCard.suit === "diamonds" ? "red" : "black";
      elements.burnRank.textContent = burn.revealedCard.rank;
      if (elements.burnCenter) elements.burnCenter.textContent = symbol;
      if (elements.burnCardFace) elements.burnCardFace.className = `burn-card__face playing-card--front ${color}`;
      elements.burnValue.textContent = `BURN VALUE ${burn.burnValue} · TOTAL ${burn.totalBurned}`;
    }
    if (DEBUG_BURN_UI) {
      const style = typeof root.getComputedStyle === "function" ? root.getComputedStyle(overlay) : null;
      console.log("[Burn UI] DOM state", { hidden: overlay.hidden, display: style?.display ?? null, opacity: style?.opacity ?? null, className: overlay.className });
    }
  }

  function getShoePresentationState(game) {
    const cut = game.cutCard;
    if (cut.shoeEnding) return SHOE_STATUS.COMPLETE;
    if (cut.lastHandActive || (cut.lastHandPending && game.state === GAME_STATES.BETTING)) return SHOE_STATUS.LAST_HAND;
    if (cut.lastHandPending || cut.reached) return SHOE_STATUS.LAST_HAND_NEXT;
    return SHOE_STATUS.IN_PLAY;
  }

  function renderShoeStatus(elements, game) {
    const status = elements.shoeStatus;
    if (!status) return;
    const state = getShoePresentationState(game);
    const copy = {
      [SHOE_STATUS.IN_PLAY]: ["SHOE IN PLAY", "牌靴进行中"],
      [SHOE_STATUS.LAST_HAND_NEXT]: ["LAST HAND NEXT", "下一局为本靴最后一局"],
      [SHOE_STATUS.LAST_HAND]: ["LAST HAND", "本靴最后一局"],
      [SHOE_STATUS.COMPLETE]: ["SHOE COMPLETE", "本靴结束 · 点击 NEW SHOE 开始新牌靴"],
    }[state];
    if (status.dataset.state !== state) {
      status.dataset.state = state.toLowerCase();
      status.innerHTML = `<strong>${copy[0]}</strong><span>${copy[1]}</span>`;
      if (root.__BACCARAT_DEBUG_CUT__ === true) console.log(`[Cut UI] status = ${state}`);
    }
  }

  function getShoeEquipmentState(game) {
    const cut = game.cutCard;
    if (cut.shoeEnding) return "complete";
    if (cut.lastHandActive || (cut.lastHandPending && game.state === GAME_STATES.BETTING)) return "last-hand";
    if (cut.lastHandPending) return "last-hand-next";
    if (cut.reached) return "cut";
    return "in-play";
  }

  const BET_CHIP_RENDER_CAP = 8;

  function createBetChipPresentation() {
    return Object.fromEntries(Object.values(betting.BET_TYPES).map((type) => [type, []]));
  }

  function cloneBetChipPresentation(presentation) {
    const clone = createBetChipPresentation();
    for (const type of Object.values(betting.BET_TYPES)) clone[type] = [...(presentation?.[type] || [])];
    return clone;
  }

  function buildBetChipColumns(presentation, betType) {
    const order = [];
    const stacks = new Map();
    for (const denomination of presentation?.[betType] || []) {
      if (!stacks.has(denomination)) { order.push(denomination); stacks.set(denomination, []); }
      stacks.get(denomination).push(denomination);
    }
    return order.map((denomination) => ({ denomination, chips: stacks.get(denomination) }));
  }

  function getChipDenominationClass(denomination) {
    return denomination === 1000 ? "1k" : denomination === 5000 ? "5k" : String(denomination);
  }

  function betChipHtml(denomination, stackIndex = null, extraClass = "") {
    const chipClass = getChipDenominationClass(denomination);
    const stackAttribute = stackIndex === null ? "" : ` data-stack-index="${stackIndex}"`;
    return `<span class="bet-chip bet-chip--${chipClass}${extraClass}" data-denomination="${denomination}"${stackAttribute} aria-hidden="true"><span class="bet-chip__spots"></span><span class="bet-chip__inner"><span class="bet-chip__value">${denomination}</span></span></span>`;
  }

  class BaccaratGameController {
    constructor({ initialBalance = INITIAL_BALANCE, random = Math.random, autoRevealInterval = AUTO_REVEAL_INTERVAL_MS, autoRevealStartDelay = AUTO_REVEAL_START_DELAY_MS, debugForcedCutThreshold } = {}) {
      this.random = random;
      this.account = betting.createPlayerAccount(initialBalance);
      this.roundId = 1;
      this.shoeId = 1;
      this.selectedChip = DEFAULT_CHIP;
      this.shoe = this.createShuffledShoe();
      this.cutCard = createCutCardState(this.random, debugForcedCutThreshold);
      this.cutEventRunId = 0;
      this.onCutCardReached = null;
      this.burnState = createBurnState();
      this.performBurn();
      this.burnPresentationVisible = true;
      this.state = GAME_STATES.BETTING;
      this.bettingRound = betting.createBettingRound(this.roundId, this.account);
      this.betActionHistory = [];
      this.lastConfirmedBetSnapshot = null;
      this.betChipPresentation = createBetChipPresentation();
      this.lastBetChipPresentation = null;
      this.roundResult = null;
      this.settlement = null;
      this.dealQueue = [];
      this.roundDealPlan = this.dealQueue;
      this.revealQueue = [];
      this.currentRevealIndex = 0;
      this.dealtKeys = new Set();
      this.revealedKeys = new Set();
      this.autoDealRunning = false;
      this.isRevealInputLocked = false;
      this.dealFaceDown = null;
      this.currentDealIndex = 0;
      this.revealedCards = { PLAYER: [], BANKER: [] };
      this.isDealInputLocked = false;
      this.message = "请选择筹码并下注";
      this.revealMode = REVEAL_MODES.MANUAL;
      this.currentRoundRevealMode = null;
      this.autoRevealRunId = 0;
      this.autoRevealRunning = false;
      this.autoRevealInterval = autoRevealInterval;
      this.autoRevealStartDelay = autoRevealStartDelay;
      this.roadHistory = [];
      this.hasRecordedRoadForCurrentRound = false;
      this.isCurrentRoundLastHand = false;
    }

    createShuffledShoe() {
      return baccarat.shuffleShoe(baccarat.createShoe(8), this.random);
    }

    performBurn({ debugForcedRank } = {}) {
      if (this.burnState.completed) return this.burnState;
      if (debugForcedRank) {
        const forcedIndex = this.shoe.findIndex((card) => card.rank === debugForcedRank);
        if (forcedIndex < 0) throw new RangeError(`No ${debugForcedRank} card exists in Shoe`);
        [this.shoe[forcedIndex], this.shoe[this.shoe.length - 1]] = [this.shoe[this.shoe.length - 1], this.shoe[forcedIndex]];
      }
      const revealedCard = baccarat.drawCard(this.shoe);
      const burnValue = getBurnValue(revealedCard);
      if (this.shoe.length < burnValue) throw new RangeError("Shoe does not contain enough cards for Burn");
      const additionalCards = Array.from({ length: burnValue }, () => baccarat.drawCard(this.shoe));
      this.burnState = { completed: true, revealedCard, burnValue, additionalCards, totalBurned: 1 + additionalCards.length };
      if (DEBUG_BURN) console.log("[Burn] Revealed Card:", revealedCard, "[Burn] Burn Value:", burnValue, "[Burn] Additional Cards:", additionalCards.length, "[Burn] Total Burned:", this.burnState.totalBurned, "[Burn] Remaining Shoe:", this.shoe.length);
      return this.burnState;
    }

    beginBurnPresentation() {
      if (!this.burnState.completed || this.state !== GAME_STATES.BETTING) return false;
      this.state = GAME_STATES.BURNING;
      this.message = "BURN CARD · PREPARING SHOE";
      return true;
    }

    completeBurnPresentation() {
      if (this.state !== GAME_STATES.BURNING) return false;
      this.state = GAME_STATES.BETTING;
      this.message = "PLACE YOUR BETS";
      return true;
    }

    startNewShoe({ debugForcedRank, debugForcedCutThreshold } = {}) {
      if (![GAME_STATES.BETTING, GAME_STATES.ROUND_END].includes(this.state)) return this.reject("New Shoe is unavailable during a round");
      this.shoe = this.createShuffledShoe();
      this.shoeId += 1;
      this.resetRoadmapForNewShoe();
      this.clearBetChipPresentation();
      this.cutCard = createCutCardState(this.random, debugForcedCutThreshold);
      this.cutEventRunId += 1;
      this.burnState = createBurnState();
      this.performBurn({ debugForcedRank });
      this.burnPresentationVisible = true;
      this.state = GAME_STATES.BURNING;
      this.message = "BURN CARD · PREPARING NEW SHOE";
      return true;
    }

    checkCutCardAfterFormalDeal() {
      if (this.cutCard.reached || this.shoe.length > this.cutCard.remainingThreshold) return false;
      this.cutCard.reached = true;
      this.cutCard.reachedDuringRound = true;
      if (root.__BACCARAT_DEBUG_CUT__ === true) console.log("[Cut] CUT CARD REACHED", { threshold: this.cutCard.remainingThreshold, remaining: this.shoe.length });
      this.onCutCardReached?.();
      return true;
    }

    completeCurrentRoundCutFlow() {
      if (this.isCurrentRoundLastHand) {
        this.cutCard.lastHandActive = false;
        this.cutCard.shoeEnding = true;
        if (root.__BACCARAT_DEBUG_CUT__ === true) console.log("[Cut] SHOE COMPLETE");
        return;
      }
      if (this.cutCard.reachedDuringRound) {
        this.cutCard.reachedDuringRound = false;
        this.cutCard.lastHandPending = true;
        if (root.__BACCARAT_DEBUG_CUT__ === true) console.log("[Cut] lastHandPending: true");
      }
    }

    resetRoadmapForNewShoe() {
      this.roadHistory = [];
      this.hasRecordedRoadForCurrentRound = false;
      try { this.onRoadmapChange?.(); } catch (error) { console.error("[ROADMAP ERROR]", error); }
    }

    recordCurrentRoundRoad() {
      if (this.hasRecordedRoadForCurrentRound || !this.roundResult || !this.settlement) return false;
      const latest = this.roadHistory.at(-1);
      if (latest && latest.shoeId !== this.shoeId) this.resetRoadmapForNewShoe();
      this.roadHistory.push(roadmapEngine.createRoadHistoryEntry(this.roundResult, { shoeId: this.shoeId, roundId: this.roundId }));
      this.hasRecordedRoadForCurrentRound = true;
      try { this.onRoadmapChange?.(); } catch (error) { console.error("[ROADMAP ERROR]", error); }
      return true;
    }

    get totalBet() {
      return betting.roundMoney(Object.values(this.bettingRound.bets).reduce((sum, amount) => sum + amount, 0));
    }

    captureCurrentBetSnapshot() { return { ...this.bettingRound.bets }; }

    recordBetChipPlacement(betType, denomination) {
      if (!this.betChipPresentation[betType] || !CHIP_VALUES.includes(denomination)) return false;
      this.betChipPresentation[betType].push(denomination);
      return true;
    }

    undoLastBetChipPlacement(betType, denomination) {
      const placements = this.betChipPresentation[betType];
      if (!placements) return false;
      const index = placements.lastIndexOf(denomination);
      if (index < 0) return false;
      placements.splice(index, 1);
      return true;
    }

    clearBetChipPresentation() { this.betChipPresentation = createBetChipPresentation(); }

    getBetSnapshotTotal(snapshot) {
      return betting.roundMoney(Object.values(betting.BET_TYPES).reduce((sum, type) => sum + (snapshot?.[type] || 0), 0));
    }

    canRepeatLastBet() {
      if (this.state !== GAME_STATES.BETTING || !this.lastConfirmedBetSnapshot) return false;
      const total = this.getBetSnapshotTotal(this.lastConfirmedBetSnapshot);
      const availableAfterRefund = betting.roundMoney(this.account.balance + this.totalBet);
      return total > 0 && total <= ROUND_MAX_BET && total <= availableAfterRefund;
    }

    repeatLastBet() {
      if (this.state !== GAME_STATES.BETTING) return this.reject("Repeat is available only while betting is open");
      if (!this.lastConfirmedBetSnapshot || this.getBetSnapshotTotal(this.lastConfirmedBetSnapshot) <= 0) return this.reject("No previous bet to repeat");
      const snapshot = { ...this.lastConfirmedBetSnapshot };
      const snapshotTotal = this.getBetSnapshotTotal(snapshot);
      if (snapshotTotal > ROUND_MAX_BET || Object.values(betting.BET_TYPES).some((type) => snapshot[type] > AREA_MAX_BET)) return this.reject("Previous bet exceeds table limits");
      const beforeRepeat = this.captureCurrentBetSnapshot();
      const beforePresentation = cloneBetChipPresentation(this.betChipPresentation);
      try {
        betting.replaceOpenBets(this.account, this.bettingRound, snapshot);
        this.betActionHistory.push({ type: "SNAPSHOT", bets: beforeRepeat, presentation: beforePresentation });
        this.betChipPresentation = cloneBetChipPresentation(this.lastBetChipPresentation);
        this.hideBurnPresentationAfterFirstBet();
        if (DEBUG_BURN_UI) console.log("[Burn UI] repeat success", { totalBet: this.totalBet, burnPresentationVisible: this.burnPresentationVisible });
        this.message = `REPEAT · ${formatMoney(snapshotTotal)}`;
        return true;
      } catch (error) { return this.reject(error.message); }
    }

    selectChip(amount) {
      if (this.state !== GAME_STATES.BETTING || !CHIP_VALUES.includes(amount)) return this.reject("当前不能选择筹码");
      this.selectedChip = amount;
      this.message = `已选择筹码 ${formatMoney(amount)}`;
      return true;
    }

    setRevealMode(mode) {
      if (![GAME_STATES.BETTING, GAME_STATES.ROUND_END].includes(this.state)) return this.reject("Reveal mode is locked for this round");
      if (!Object.values(REVEAL_MODES).includes(mode)) return this.reject("Invalid reveal mode");
      this.revealMode = mode;
      this.message = `REVEAL MODE · ${mode}`;
      return true;
    }

    reject(message) {
      this.message = message;
      return false;
    }

    hideBurnPresentationAfterFirstBet() {
      if (!this.burnPresentationVisible || this.totalBet <= 0) return;
      this.burnPresentationVisible = false;
      if (DEBUG_BURN_UI) console.log("[Burn UI] hide requested", { totalBet: this.totalBet, burnPresentationVisible: this.burnPresentationVisible });
    }

    placeSelectedBet(betType) {
      if (this.state !== GAME_STATES.BETTING) return this.reject("下注已关闭");
      if (!Object.values(betting.BET_TYPES).includes(betType)) return this.reject("无效下注区");
      if (this.selectedChip < AREA_MIN_BET) return this.reject(`最低下注 ${AREA_MIN_BET}`);
      if (this.bettingRound.bets[betType] + this.selectedChip > AREA_MAX_BET) return this.reject(`该下注区最高限额 ${formatMoney(AREA_MAX_BET)}`);
      if (this.totalBet + this.selectedChip > ROUND_MAX_BET) return this.reject(`单局下注不能超过 ${formatMoney(ROUND_MAX_BET)}`);
      if (this.selectedChip > this.account.balance) return this.reject("余额不足");
      try {
        betting.placeBet(this.account, this.bettingRound, betType, this.selectedChip);
        this.betActionHistory.push({ betType, amount: this.selectedChip });
        this.recordBetChipPlacement(betType, this.selectedChip);
        this.hideBurnPresentationAfterFirstBet();
        if (DEBUG_BURN_UI) console.log("[Burn UI] bet success", { totalBet: this.totalBet, burnPresentationVisible: this.burnPresentationVisible });
        this.message = `${BET_LABELS[betType]} +${formatMoney(this.selectedChip)}`;
        return true;
      } catch (error) {
        return this.reject(error.message);
      }
    }

    undoBet() {
      if (this.state !== GAME_STATES.BETTING) return this.reject("下注已关闭");
      const action = this.betActionHistory.pop();
      if (!action) return this.reject("没有可撤销的下注");
      if (action.type === "SNAPSHOT") {
        try { betting.replaceOpenBets(this.account, this.bettingRound, action.bets); this.betChipPresentation = cloneBetChipPresentation(action.presentation); this.message = "已撤销重复下注"; return true; }
        catch (error) { this.betActionHistory.push(action); return this.reject(error.message); }
      }
      this.bettingRound.bets[action.betType] = betting.roundMoney(this.bettingRound.bets[action.betType] - action.amount);
      this.account.balance = betting.roundMoney(this.account.balance + action.amount);
      this.bettingRound.balanceAfterBet = this.account.balance;
      this.undoLastBetChipPlacement(action.betType, action.amount);
      this.message = `已撤销 ${BET_LABELS[action.betType]} ${formatMoney(action.amount)}`;
      return true;
    }

    clearBets() {
      if (this.state !== GAME_STATES.BETTING) return this.reject("下注已关闭");
      const refund = this.totalBet;
      this.account.balance = betting.roundMoney(this.account.balance + refund);
      this.bettingRound.bets = betting.createEmptyBets();
      this.bettingRound.balanceAfterBet = this.account.balance;
      this.betActionHistory = [];
      this.clearBetChipPresentation();
      this.message = refund ? `已退回 ${formatMoney(refund)}` : "当前没有下注";
      return true;
    }

    async prepareDeal(dealFaceDown, flipCard) {
      if (this.state !== GAME_STATES.BETTING) return this.reject("当前不能发牌");
      if (this.totalBet === 0) return this.reject("请先下注");
      if (this.cutCard.lastHandPending && this.shoe.length < 6) {
        this.cutCard.lastHandPending = false;
        this.cutCard.shoeEnding = true;
        this.state = GAME_STATES.ROUND_END;
        this.message = "SHOE COMPLETE · NEW SHOE REQUIRED";
        console.warn("[Cut Card] Not enough cards for Last Hand", this.shoe.length);
        return false;
      }
      betting.closeBetting(this.bettingRound);
      this.lastConfirmedBetSnapshot = this.captureCurrentBetSnapshot();
      this.lastBetChipPresentation = cloneBetChipPresentation(this.betChipPresentation);
      this.currentRoundRevealMode = this.revealMode;
      this.isCurrentRoundLastHand = this.cutCard.lastHandPending;
      if (this.isCurrentRoundLastHand) {
        this.cutCard.lastHandPending = false;
        this.cutCard.lastHandActive = true;
        if (root.__BACCARAT_DEBUG_CUT__ === true) console.log("[Cut] LAST HAND started");
      }
      try {
        // The real Baccarat Engine locks every card and result before UI reveal begins.
        this.roundResult = baccarat.playRound(this.shoe);
        this.checkCutCardAfterFormalDeal();
        this.dealQueue = buildDealQueue(this.roundResult);
        this.roundDealPlan = this.dealQueue;
        this.revealQueue = [];
        this.currentRevealIndex = 0;
        this.dealtKeys.clear(); this.revealedKeys.clear();
        this.currentDealIndex = 0;
        this.revealedCards = { PLAYER: [], BANKER: [] };
        this.settlement = null;
        this.state = GAME_STATES.ROUND_LOCKED;
        this.dealFaceDown = dealFaceDown;
        await this.autoDealCards(this.dealQueue.slice(0, 4), this.dealFaceDown, GAME_STATES.AUTO_DEALING);
        if (this.currentRoundRevealMode === REVEAL_MODES.AUTO) {
          this.state = GAME_STATES.AUTO_REVEALING;
          this.message = "AUTO REVEAL · 自动翻牌";
          this.startAutoRevealLoop(flipCard);
        } else {
          this.state = GAME_STATES.REVEAL_READY;
          this.message = "READY TO REVEAL · 等待翻牌";
        }
        return true;
      } catch (error) {
        this.state = GAME_STATES.ROUND_END;
        this.message = `发牌错误：${error.message}`;
        return false;
      }
    }

    dealKey(item) { return `${item.side}-${item.cardIndex}`; }

    async autoDealCards(items, dealFaceDown, state) {
      this.state = state;
      this.autoDealRunning = true;
      this.message = state === GAME_STATES.AUTO_DRAWING ? "DRAW CARD · 补牌中" : "DEALING · 发牌中";
      try {
        for (const item of items) {
          const key = this.dealKey(item);
          if (this.dealtKeys.has(key)) continue;
          let markedDealt = false;
          const markDealt = () => { if (!markedDealt) { this.dealtKeys.add(key); this.revealQueue.push(item); markedDealt = true; } };
          try { if (dealFaceDown) await dealFaceDown(item, markDealt); } catch (error) { if (DEBUG_DEAL_ANIMATION) console.error("[AUTO DEAL ERROR]", error); }
          markDealt();
          if (items.indexOf(item) < items.length - 1) await wait(110);
        }
      } finally { this.autoDealRunning = false; }
    }

    async revealNextCard(flipCard, auto = false) {
      if ((auto ? this.state !== GAME_STATES.AUTO_REVEALING : this.state !== GAME_STATES.REVEAL_READY) || this.isRevealInputLocked) return this.reject("当前不能翻牌");
      const nextDeal = this.revealQueue[this.currentRevealIndex];
      if (!nextDeal) return this.reject("没有待翻牌");
      this.isRevealInputLocked = true; this.isDealInputLocked = true; this.state = auto ? GAME_STATES.AUTO_REVEALING : GAME_STATES.REVEALING;
      let hasRevealed = false;
      const reveal = () => {
        if (!hasRevealed) {
          this.revealedCards[nextDeal.side].push(nextDeal.card);
          hasRevealed = true;
        }
      };
      try {
        // Animation is presentation-only. A failed animation cannot block the locked deal flow.
        if (flipCard) await flipCard(nextDeal, reveal);
      } catch (error) {
        if (DEBUG_DEAL_ANIMATION) console.error("[DEAL ANIMATION ERROR]", error);
      } finally {
        reveal();
        this.revealedKeys.add(this.dealKey(nextDeal));
        this.currentRevealIndex += 1;
        if (this.currentRevealIndex === 4 && this.dealQueue.length > 4) {
          await this.autoDealCards(this.dealQueue.slice(4), this.dealFaceDown, GAME_STATES.AUTO_DRAWING);
          this.state = auto ? GAME_STATES.AUTO_REVEALING : GAME_STATES.REVEAL_READY;
          this.message = auto ? "AUTO REVEAL · 自动翻牌" : "READY TO REVEAL · 等待翻牌";
        } else if (this.currentRevealIndex >= this.revealQueue.length && this.revealQueue.length === this.dealQueue.length) {
          this.state = GAME_STATES.SETTLING;
          await wait(160);
          this.settlement = betting.settleRound(this.account, this.bettingRound, this.roundResult);
          this.recordCurrentRoundRoad();
          this.completeCurrentRoundCutFlow();
          this.state = GAME_STATES.ROUND_END;
          this.message = this.cutCard.shoeEnding ? "SHOE COMPLETE · 本靴结束" : `${this.roundResult.winner}${this.roundResult.winner === "TIE" ? "" : " WIN"} · 发牌完成`;
        } else {
          this.state = auto ? GAME_STATES.AUTO_REVEALING : GAME_STATES.REVEAL_READY;
          this.message = auto ? "AUTO REVEAL · 自动翻牌" : "READY TO REVEAL · 等待翻牌";
        }
        this.isRevealInputLocked = false; this.isDealInputLocked = false;
      }
      return true;
    }

    startAutoRevealLoop(flipCard) {
      if (this.autoRevealRunning || this.currentRoundRevealMode !== REVEAL_MODES.AUTO) return;
      const runId = ++this.autoRevealRunId;
      this.autoRevealRunning = true;
      (async () => {
        try {
          await wait(this.autoRevealStartDelay);
          while (runId === this.autoRevealRunId && this.state === GAME_STATES.AUTO_REVEALING) {
            const next = this.revealQueue[this.currentRevealIndex];
            if (!next) break;
            this.message = `AUTO REVEAL · ${next.label}`;
            await this.revealNextCard(flipCard, true);
            this.onStateChange?.();
            if (runId !== this.autoRevealRunId || [GAME_STATES.SETTLING, GAME_STATES.ROUND_END].includes(this.state)) break;
            if (this.revealQueue[this.currentRevealIndex]) await wait(this.autoRevealInterval);
          }
        } catch (error) { if (DEBUG_DEAL_ANIMATION) console.error("[AUTO REVEAL ERROR]", error); }
        finally { if (runId === this.autoRevealRunId) this.autoRevealRunning = false; }
      })();
    }

    handlePrimaryAction(dealFaceDown, flipCard, discardCards) {
      if (this.state === GAME_STATES.BETTING) return this.prepareDeal(dealFaceDown, flipCard);
      if (this.state === GAME_STATES.REVEAL_READY) return this.revealNextCard(flipCard);
      if (this.state === GAME_STATES.ROUND_END) return this.cutCard.shoeEnding ? this.startNewShoeAfterComplete(discardCards) : this.nextRound(discardCards);
      return this.reject("当前操作不可用");
    }

    // Compatibility alias for pre-V0.6.2 callers; it now locks the result only.
    dealRound() { return this.prepareDeal(); }

    async startNewShoeAfterComplete(discardCards) {
      if (this.state !== GAME_STATES.ROUND_END || !this.cutCard.shoeEnding) return this.reject("New Shoe is unavailable");
      this.state = GAME_STATES.DISCARDING;
      this.autoRevealRunId += 1;
      this.autoRevealRunning = false;
      this.message = "COLLECTING CARDS · 收牌中";
      try { if (discardCards) await discardCards(getDiscardSequence(this.dealQueue, this.dealtKeys)); }
      catch (error) { if (DEBUG_DEAL_ANIMATION) console.error("[DISCARD ANIMATION ERROR]", error); }
      this.state = GAME_STATES.ROUND_END;
      this.roundId += 1;
      this.bettingRound = betting.createBettingRound(this.roundId, this.account);
      this.betActionHistory = [];
      this.clearBetChipPresentation();
      this.roundResult = null;
      this.settlement = null;
      this.dealQueue = [];
      this.revealQueue = [];
      this.currentRevealIndex = 0;
      this.dealtKeys.clear();
      this.revealedKeys.clear();
      this.revealedCards = { PLAYER: [], BANKER: [] };
      this.hasRecordedRoadForCurrentRound = false;
      return this.startNewShoe();
    }

    async nextRound(discardCards) {
      if (this.state !== GAME_STATES.ROUND_END) return this.reject("请先完成当前局");
      this.state = GAME_STATES.DISCARDING;
      this.autoRevealRunId += 1;
      this.autoRevealRunning = false;
      this.message = "COLLECTING CARDS · 收牌中";
      try { if (discardCards) await discardCards(getDiscardSequence(this.dealQueue, this.dealtKeys)); }
      catch (error) { if (DEBUG_DEAL_ANIMATION) console.error("[DISCARD ANIMATION ERROR]", error); }
      this.roundId += 1;
      this.bettingRound = betting.createBettingRound(this.roundId, this.account);
      this.betActionHistory = [];
      this.clearBetChipPresentation();
      this.roundResult = null;
      this.settlement = null;
      this.dealQueue = [];
      this.roundDealPlan = this.dealQueue; this.revealQueue = []; this.currentRevealIndex = 0; this.dealtKeys.clear(); this.revealedKeys.clear(); this.autoDealRunning = false; this.isRevealInputLocked = false; this.dealFaceDown = null; this.currentRoundRevealMode = null;
      this.currentDealIndex = 0;
      this.revealedCards = { PLAYER: [], BANKER: [] };
      this.isDealInputLocked = false;
      this.isCurrentRoundLastHand = false;
      this.hasRecordedRoadForCurrentRound = false;
      if (this.cutCard.lastHandPending) this.message = "LAST HAND · 本靴最后一局";
      this.state = GAME_STATES.BETTING;
      if (!this.cutCard.lastHandPending) this.message = "PLACE YOUR BETS · 请下注";
      return true;
    }
  }

  function cardHtml(card, index) {
    const symbol = SUIT_SYMBOLS[card.suit];
    const color = card.suit === "hearts" || card.suit === "diamonds" ? "red" : "black";
    const thirdCard = index === 2 ? " third-card" : "";
    return `<span class="card ${color}${thirdCard}" data-card-position="${index + 1}"><strong>${card.rank}</strong><small>${symbol}</small></span>`;
  }

  function cardSlotsHtml(game, side) {
    const cards = game.roundResult ? game.roundResult[side === "PLAYER" ? "playerCards" : "bankerCards"] : [];
    return [0, 1, 2].map((index) => {
      const item = cards[index] ? { side, cardIndex: index } : null;
      const dealt = item && game.dealtKeys.has(game.dealKey(item));
      const revealed = item && game.revealedKeys.has(game.dealKey(item));
      return `<span class="card-slot" data-slot-index="${index}">${dealt ? flipCardHtml(cards[index], index, revealed) : ""}</span>`;
    }).join("");
  }

  function getChipComputedStyleSnapshot(button, getComputedStyleFn = root.getComputedStyle) {
    if (!button || typeof getComputedStyleFn !== "function") return null;
    const read = (style) => ({
      border: style.border,
      outline: style.outline,
      boxShadow: style.boxShadow,
      background: style.background,
      backgroundImage: style.backgroundImage,
      inset: style.inset,
      content: style.content,
      pointerEvents: style.pointerEvents,
      width: style.width,
      height: style.height,
      zIndex: style.zIndex,
      position: style.position
    });
    const spots = button.querySelector ? button.querySelector(".chip__spots") : null;
    const inner = button.querySelector ? button.querySelector(".chip__inner") : null;
    return {
      button: read(getComputedStyleFn(button)),
      spots: spots ? read(getComputedStyleFn(spots)) : null,
      inner: inner ? read(getComputedStyleFn(inner)) : null,
      halo: read(getComputedStyleFn(button, "::after"))
    };
  }

  function mountGame(document) {
    const game = new BaccaratGameController();
    const byId = (id) => document.getElementById(id);
    const elements = {
      balance: byId("balance"), round: byId("round"), shoe: byId("shoe-id"), state: byId("game-state"), remaining: byId("remaining"), message: byId("message"),
      playerCards: byId("player-cards"), bankerCards: byId("banker-cards"), playerScore: byId("player-score"), bankerScore: byId("banker-score"),
      result: byId("result"), pairResult: byId("pair-result"), nextCard: byId("next-card-label"), playerScoreLabel: byId("player-score-label"), bankerScoreLabel: byId("banker-score-label"), totalBet: byId("total-bet"), totalReturn: byId("total-return"), netResult: byId("net-result"),
      settlementDetails: byId("settlement-details"), undo: byId("undo"), clear: byId("clear"), deal: byId("deal"), repeat: byId("repeat-bet"), burnCard: byId("burn-card"), burnCardFace: byId("burn-card-face"), burnRank: byId("burn-card-rank"), burnCenter: byId("burn-card-center"), burnValue: byId("burn-card-value"), shoeStatus: byId("shoe-status"), cutCardPresentation: byId("cut-card-presentation"), cutCardEvent: byId("cut-card-event"), shoeVisual: document.querySelector(".shoe-visual"), visualCutCard: byId("visual-cut-card"), chipAnimationLayer: byId("chip-animation-layer"),
      beadPlate: byId("bead-plate"), bigRoad: byId("big-road"), bigEyeBoy: byId("big-eye-boy"), smallRoad: byId("small-road"), cockroachPig: byId("cockroach-pig"), roadmapStats: byId("roadmap-stats"),
    };
    const roadmapToggle = byId("roadmap-toggle");
    let cutVisualRunId = 0;
    function resetCutCardPresentation() {
      cutVisualRunId += 1;
      if (elements.cutCardPresentation) {
        elements.cutCardPresentation.hidden = true;
        elements.cutCardPresentation.classList.remove("is-presenting");
      }
      if (elements.visualCutCard) elements.visualCutCard.hidden = true;
      if (elements.cutCardEvent) elements.cutCardEvent.hidden = true;
    }
    function playCutCardPresentation() {
      const presentation = elements.cutCardPresentation;
      if (!presentation || !presentation.hidden) return;
      const runId = ++cutVisualRunId;
      presentation.hidden = false;
      if (elements.visualCutCard) elements.visualCutCard.hidden = false;
      presentation.classList.remove("is-presenting");
      void presentation.offsetWidth;
      presentation.classList.add("is-presenting");
      setTimeout(() => {
        if (runId === cutVisualRunId) {
          presentation.classList.remove("is-presenting");
          presentation.hidden = true;
          if (elements.visualCutCard) elements.visualCutCard.hidden = true;
          if (elements.cutCardEvent) elements.cutCardEvent.hidden = true;
        }
      }, CUT_CARD_EVENT_MS);
    }
    function renderShoeEquipmentState() {
      if (elements.shoeVisual) elements.shoeVisual.dataset.state = getShoeEquipmentState(game);
      if (!game.cutCard.reached) resetCutCardPresentation();
    }
    const roadmap = document.querySelector(".roadmap");
    const betButtons = [...document.querySelectorAll("[data-bet-type]")];
    const betChipZones = new Map();
    for (const button of betButtons) {
      const zone = document.createElement("span");
      zone.className = "bet-chip-stack-zone";
      zone.dataset.betArea = button.dataset.betType;
      zone.setAttribute("aria-hidden", "true");
      button.querySelector("i")?.before(zone);
      betChipZones.set(button.dataset.betType, zone);
    }
    const chipButtons = [...document.querySelectorAll("[data-chip]")];
    for (const chip of chipButtons) {
      if (!chip.querySelector(".chip__spots")) chip.insertAdjacentHTML("afterbegin", '<span class="chip__spots" aria-hidden="true"></span>');
    }
    const pendingBetChipArrivals = new Set();
    const activeChipMovements = new Map();
    let nextChipMovementId = 0;
    let clearAnimationLocked = false;

    const isReducedMotion = () => Boolean(root.matchMedia && root.matchMedia("(prefers-reduced-motion: reduce)").matches);
    const chipMovementKey = (area, denomination, stackIndex) => `${area}:${denomination}:${stackIndex}`;
    const isViewportRect = (rect) => rect && rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.bottom > 0 && rect.left < root.innerWidth && rect.top < root.innerHeight;
    function getChipSelectorRect(denomination) {
      const selector = chipButtons.find((button) => Number(button.dataset.chip) === denomination);
      return selector ? selector.getBoundingClientRect() : null;
    }
    function getBetChipTargetRect(area, denomination, stackIndex) {
      const zone = betChipZones.get(area);
      const chip = zone?.querySelector(`.bet-chip[data-denomination="${denomination}"][data-stack-index="${stackIndex}"]`);
      return chip ? chip.getBoundingClientRect() : null;
    }
    function createChipMovementGhost(denomination, fromRect) {
      const layer = elements.chipAnimationLayer;
      if (!layer) return null;
      const chipClass = getChipDenominationClass(denomination);
      const ghost = document.createElement("span");
      ghost.className = `chip-movement-ghost chip--${chipClass}`;
      ghost.setAttribute("aria-hidden", "true");
      ghost.innerHTML = `<span class="chip__spots"></span><span class="chip__inner"><span class="chip__value">${denomination}</span></span>`;
      ghost.style.left = `${fromRect.left}px`;
      ghost.style.top = `${fromRect.top}px`;
      ghost.style.width = `${fromRect.width}px`;
      ghost.style.height = `${fromRect.height}px`;
      layer.append(ghost);
      return ghost;
    }
    function finishChipMovement(movementId, ghost, onFinish) {
      activeChipMovements.delete(movementId);
      ghost?.remove();
      onFinish?.();
    }
    function animateChipMovement({ denomination, fromRect, toRect, duration, onFinish }) {
      if (isReducedMotion() || !isViewportRect(fromRect) || !isViewportRect(toRect)) { onFinish?.(); return null; }
      const ghost = createChipMovementGhost(denomination, fromRect);
      if (!ghost) { onFinish?.(); return null; }
      const movementId = ++nextChipMovementId;
      const deltaX = toRect.left + toRect.width / 2 - (fromRect.left + fromRect.width / 2);
      const deltaY = toRect.top + toRect.height / 2 - (fromRect.top + fromRect.height / 2);
      const scale = Math.min(1.15, Math.max(.35, Math.min(toRect.width / fromRect.width, toRect.height / fromRect.height)));
      activeChipMovements.set(movementId, ghost);
      const finish = () => finishChipMovement(movementId, ghost, onFinish);
      try {
        if (ghost.animate) {
          ghost.animate([
            { transform: "translate(0, 0) scale(1)", opacity: 1 },
            { transform: `translate(${deltaX}px, ${deltaY}px) scale(${scale})`, opacity: 1 }
          ], { duration, easing: "cubic-bezier(.2, .7, .3, 1)", fill: "forwards" }).finished.then(finish, finish);
        } else setTimeout(finish, duration);
      } catch (error) { finish(); }
      return movementId;
    }
    function animateChipPlacement(area, denomination, stackIndex) {
      const key = chipMovementKey(area, denomination, stackIndex);
      const measure = () => {
        const fromRect = getChipSelectorRect(denomination);
        const toRect = getBetChipTargetRect(area, denomination, stackIndex);
        animateChipMovement({ denomination, fromRect, toRect, duration: CHIP_PLACEMENT_DURATION_MS, onFinish: () => {
          pendingBetChipArrivals.delete(key);
          renderBetChipStacks();
        } });
      };
      if (typeof root.requestAnimationFrame === "function") root.requestAnimationFrame(measure); else setTimeout(measure, 0);
    }
    function animateChipReturn(denomination, fromRect, duration = CHIP_RETURN_DURATION_MS) {
      animateChipMovement({ denomination, fromRect, toRect: getChipSelectorRect(denomination), duration });
    }
    function cancelPendingChipArrivals() {
      pendingBetChipArrivals.clear();
      for (const ghost of activeChipMovements.values()) ghost.remove();
      activeChipMovements.clear();
    }
    const revealModeButtons = [...document.querySelectorAll("[data-reveal-mode]")];
    function initializeCardSlots(container, side) {
      container.innerHTML = [0, 1, 2].map((index) => `<span class="card-slot" data-side="${side}" data-slot-index="${index}"></span>`).join("");
    }
    initializeCardSlots(elements.playerCards, "PLAYER"); initializeCardSlots(elements.bankerCards, "BANKER");
    function getCardElement(item) { return document.querySelector(`[data-card-key="${game.dealKey(item)}"]`); }
    function syncCardDom() {
      for (const item of game.dealQueue) {
        const key = game.dealKey(item); if (!game.dealtKeys.has(key) || getCardElement(item)) continue;
        const container = item.side === "PLAYER" ? elements.playerCards : elements.bankerCards;
        const slot = container.querySelector(`[data-slot-index="${item.cardIndex}"]`);
        if (slot) slot.insertAdjacentHTML("beforeend", flipCardHtml(item.card, item.cardIndex, false, key));
      }
    }

    function renderRoadmaps() {
      if (!elements.beadPlate || !elements.bigRoad) return;
      const beadCells = roadmapEngine.buildBeadPlate(game.roadHistory);
      const bigRoad = roadmapEngine.buildBigRoad(game.roadHistory);
      const bigEyeBoy = roadmapEngine.buildBigEyeBoy(bigRoad);
      const smallRoad = roadmapEngine.buildSmallRoad(bigRoad);
      const cockroachPig = roadmapEngine.buildCockroachPig(bigRoad);
      const renderCells = (container, cells, type) => {
        if (!container) return;
        const maxCol = Math.max(5, ...cells.map((cell) => cell.col));
        container.style.setProperty("--road-cols", String(maxCol + 1));
        container.innerHTML = cells.map((cell) => {
          const isBead = type === "bead";
          const isDerived = type.startsWith("derived-");
          const label = cell.winner === "BANKER" ? "庄" : cell.winner === "PLAYER" ? "闲" : "和";
          const markers = isBead ? `<i class="pair-marker banker-pair" aria-hidden="true" ${cell.bankerPair ? "" : "hidden"}></i><i class="pair-marker player-pair" aria-hidden="true" ${cell.playerPair ? "" : "hidden"}></i>` : "";
          const tie = !isBead && cell.tieCount ? `<em class="big-road-tie">${cell.tieCount > 1 ? cell.tieCount : ""}</em>` : "";
          const cellClass = isBead ? `bead-${cell.winner.toLowerCase()}` : isDerived ? `derived-cell ${type} derived-${cell.color.toLowerCase()}` : `big-${cell.winner.toLowerCase()}`;
          return `<span class="road-cell ${cellClass}" data-row="${cell.row}" data-col="${cell.col}" style="grid-row:${cell.row + 1};grid-column:${cell.col + 1}" title="${isDerived ? cell.color : cell.winner}">${isBead ? label : ""}${markers}${tie}</span>`;
        }).join("");
      };
      renderCells(elements.beadPlate, beadCells, "bead");
      renderCells(elements.bigRoad, bigRoad.cells, "big");
      renderCells(elements.bigEyeBoy, bigEyeBoy.cells, "derived-eye");
      renderCells(elements.smallRoad, smallRoad.cells, "derived-small");
      renderCells(elements.cockroachPig, cockroachPig.cells, "derived-cockroach");
      for (const grid of [elements.beadPlate, elements.bigRoad, elements.bigEyeBoy, elements.smallRoad, elements.cockroachPig]) {
        if (!grid) continue;
        const scroll = grid.closest(".road-scroll");
        if (scroll) scroll.scrollLeft = scroll.scrollWidth;
      }
      if (elements.roadmapStats) {
        const stats = roadmapEngine.getRoadmapStatistics(game.roadHistory);
        elements.roadmapStats.textContent = `${stats.hands} HANDS · B ${stats.banker} · P ${stats.player} · T ${stats.tie}`;
      }
    }

    function renderBetChipStacks() {
      for (const [betType, zone] of betChipZones) {
        const columns = buildBetChipColumns(game.betChipPresentation, betType);
        zone.innerHTML = columns.map(({ denomination, chips }) => {
          const visibleChips = chips.slice(-BET_CHIP_RENDER_CAP);
          const firstVisibleStackIndex = chips.length - visibleChips.length;
          const dense = visibleChips.length > 4 ? " is-dense" : "";
          const chipMarkup = visibleChips.map((chip, visibleIndex) => {
            const stackIndex = firstVisibleStackIndex + visibleIndex;
            const pending = pendingBetChipArrivals.has(chipMovementKey(betType, denomination, stackIndex)) ? " is-arrival-pending" : "";
            return betChipHtml(chip, stackIndex, pending);
          }).join("");
          return `<span class="bet-chip-column${dense}" data-denomination="${denomination}">${chipMarkup}</span>`;
        }).join("");
      }
    }

    function render() {
      const isBetting = game.state === GAME_STATES.BETTING;
      elements.balance.textContent = formatMoney(game.account.balance);
      elements.round.textContent = game.roundId;
      elements.shoe.textContent = game.shoeId;
      elements.state.textContent = game.state;
      elements.remaining.textContent = game.shoe.length;
      elements.message.textContent = game.message;
      renderBurnPresentation(elements, game);
      renderShoeStatus(elements, game);
      renderShoeEquipmentState();
      elements.totalBet.textContent = formatMoney(game.totalBet);
      renderRoadmaps();
      renderBetChipStacks();
      for (const button of betButtons) {
        const type = button.dataset.betType;
        button.disabled = !isBetting;
        button.querySelector(".bet-amount").textContent = formatMoney(game.bettingRound.bets[type]);
      }
      for (const button of chipButtons) { const selected = Number(button.dataset.chip) === game.selectedChip; button.classList.toggle("selected", selected); button.setAttribute("aria-pressed", String(selected)); }
      if (elements.repeat) elements.repeat.disabled = !game.canRepeatLastBet();
      const modeUnlocked = [GAME_STATES.BETTING, GAME_STATES.ROUND_END].includes(game.state);
      for (const button of revealModeButtons) { const selected = button.dataset.revealMode === game.revealMode; button.disabled = !modeUnlocked; button.classList.toggle("selected", selected); button.setAttribute("aria-pressed", String(selected)); }
      elements.undo.disabled = !isBetting || game.betActionHistory.length === 0;
      elements.clear.disabled = !isBetting || game.totalBet === 0;
      elements.deal.disabled = !isBetting || game.totalBet === 0;
      const nextDeal = game.revealQueue[game.currentRevealIndex];
      const actionText = game.state === GAME_STATES.BETTING ? ["DEAL", "发牌"] : game.state === GAME_STATES.ROUND_END && game.cutCard.shoeEnding ? ["NEW SHOE", "新牌靴"] : game.state === GAME_STATES.ROUND_END ? ["NEXT ROUND", "下一局"] : game.state === GAME_STATES.DISCARDING ? ["COLLECTING", "收牌中"] : ["REVEAL", "翻牌"];
      elements.deal.innerHTML = `${actionText[0]}<br><small>${actionText[1]}</small>`;
      elements.deal.disabled = (game.state === GAME_STATES.BETTING && game.totalBet === 0) || ![GAME_STATES.BETTING, GAME_STATES.REVEAL_READY, GAME_STATES.ROUND_END].includes(game.state) || game.isRevealInputLocked || game.autoDealRunning;
      elements.nextCard.textContent = nextDeal ? `待翻牌：${nextDeal.label}` : game.cutCard.shoeEnding ? "SHOE COMPLETE · 本靴结束" : game.cutCard.lastHandPending ? "LAST HAND · 本靴最后一局" : game.state === GAME_STATES.ROUND_END ? "本局结束" : game.state === GAME_STATES.DISCARDING ? "正在收牌" : game.state === GAME_STATES.AUTO_DRAWING ? "正在补牌" : game.state === GAME_STATES.AUTO_DEALING ? "正在发牌" : "请先下注";
      const isFinal = game.state === GAME_STATES.ROUND_END;
      const playerVisible = game.revealedCards.PLAYER;
      const bankerVisible = game.revealedCards.BANKER;
      syncCardDom();
      elements.playerScoreLabel.textContent = isFinal ? "FINAL SCORE" : "CURRENT SCORE";
      elements.bankerScoreLabel.textContent = isFinal ? "FINAL SCORE" : "CURRENT SCORE";
      elements.playerScore.textContent = playerVisible.length ? baccarat.calculateBaccaratScore(playerVisible) : "--";
      elements.bankerScore.textContent = bankerVisible.length ? baccarat.calculateBaccaratScore(bankerVisible) : "--";
      if (!game.roundResult || !isFinal) {
        elements.result.textContent = "--";
        const partialPairs = [];
        if (playerVisible.length >= 2 && playerVisible[0].rank === playerVisible[1].rank) partialPairs.push("PLAYER PAIR");
        if (bankerVisible.length >= 2 && bankerVisible[0].rank === bankerVisible[1].rank) partialPairs.push("BANKER PAIR");
        elements.pairResult.textContent = partialPairs.join(" · ");
        elements.totalReturn.textContent = "--";
        elements.netResult.textContent = "--";
        elements.settlementDetails.innerHTML = "";
        return;
      }
      const result = game.roundResult;
      elements.result.textContent = `${result.winner}${result.winner === "TIE" ? "" : " WIN"}`;
      elements.pairResult.textContent = [result.playerPair && "PLAYER PAIR", result.bankerPair && "BANKER PAIR"].filter(Boolean).join(" · ") || "无对子";
      elements.totalReturn.textContent = formatMoney(game.settlement.totalReturn);
      elements.netResult.textContent = `${game.settlement.netResult >= 0 ? "+" : ""}${formatMoney(game.settlement.netResult)}`;
      elements.settlementDetails.innerHTML = Object.values(game.settlement.settlements).map((item) => `<li>${BET_LABELS[item.betType]}: ${item.outcome} / Return ${formatMoney(item.returnAmount)}</li>`).join("");
    }
    game.onStateChange = render;
    game.onRoadmapChange = renderRoadmaps;
    game.onCutCardReached = () => {
      const event = elements.cutCardEvent;
      if (!event) return;
      const runId = ++game.cutEventRunId;
      event.hidden = false;
      if (root.__BACCARAT_DEBUG_CUT__ === true) console.log("[Cut UI] event = CUT_CARD_REACHED");
      setTimeout(() => { if (runId === game.cutEventRunId) event.hidden = true; }, CUT_CARD_EVENT_MS);
      playCutCardPresentation();
    };
    function debugChipPresentation() {
      if (root.__BACCARAT_DEBUG_CHIP_UI__ !== true) return;
      const selected = chipButtons.find((button) => button.classList.contains("selected"));
      if (!selected) return;
      console.log("[Chip UI] selected presentation", {
        selectedClass: selected.classList.contains("selected"),
        ariaPressed: selected.getAttribute("aria-pressed"),
        styles: getChipComputedStyleSnapshot(selected)
      });
    }
    function getLastPlacementSnapshot() {
      const action = game.betActionHistory[game.betActionHistory.length - 1];
      if (!action || action.type === "SNAPSHOT") return null;
      const stackIndex = (game.betChipPresentation[action.betType] || []).filter((denomination) => denomination === action.amount).length - 1;
      return { area: action.betType, denomination: action.amount, stackIndex, fromRect: getBetChipTargetRect(action.betType, action.amount, stackIndex) };
    }
    function getVisibleBetChipSnapshots() {
      return [...document.querySelectorAll(".bet-chip-stack-zone .bet-chip")].map((chip) => ({
        denomination: Number(chip.dataset.denomination),
        fromRect: chip.getBoundingClientRect()
      })).filter((item) => isViewportRect(item.fromRect));
    }
    chipButtons.forEach((button) => button.addEventListener("click", () => { game.selectChip(Number(button.dataset.chip)); render(); debugChipPresentation(); }));
    if (elements.repeat) elements.repeat.addEventListener("click", () => { if (game.repeatLastBet()) cancelPendingChipArrivals(); render(); });
    revealModeButtons.forEach((button) => button.addEventListener("click", () => { game.setRevealMode(button.dataset.revealMode); render(); }));
    betButtons.forEach((button) => button.addEventListener("click", () => {
      const area = button.dataset.betType;
      const denomination = game.selectedChip;
      if (!game.placeSelectedBet(area)) { render(); return; }
      const stackIndex = (game.betChipPresentation[area] || []).filter((value) => value === denomination).length - 1;
      pendingBetChipArrivals.add(chipMovementKey(area, denomination, stackIndex));
      render();
      animateChipPlacement(area, denomination, stackIndex);
    }));
    elements.undo.addEventListener("click", () => {
      const movement = getLastPlacementSnapshot();
      if (!game.undoBet()) { render(); return; }
      render();
      if (movement) animateChipReturn(movement.denomination, movement.fromRect);
    });
    elements.clear.addEventListener("click", () => {
      if (clearAnimationLocked) return;
      const movements = getVisibleBetChipSnapshots();
      if (!game.clearBets()) { render(); return; }
      render();
      if (!movements.length || isReducedMotion()) return;
      clearAnimationLocked = true;
      elements.clear.disabled = true;
      movements.forEach((movement) => animateChipReturn(movement.denomination, movement.fromRect, CHIP_CLEAR_RETURN_DURATION_MS));
      setTimeout(() => { clearAnimationLocked = false; render(); }, CHIP_CLEAR_RETURN_DURATION_MS);
    });
    function getTargetSlotRect(item) {
      const container = item.side === "PLAYER" ? elements.playerCards : elements.bankerCards;
      const slot = container.querySelector(`[data-slot-index="${item.cardIndex}"]`);
      return (slot || container).getBoundingClientRect();
    }
    function createFlyingCard(source) {
      const flying = document.createElement("div");
      flying.className = "flying-card";
      flying.innerHTML = playingCardBackHtml();
      flying.style.left = `${source.left + source.width / 2 - 30}px`;
      flying.style.top = `${source.top + source.height / 2 - 43}px`;
      document.getElementById("deal-animation-layer").append(flying);
      return flying;
    }
    async function animatePresentationCard(item, markDealt) {
      const sourceElement = document.querySelector(".shoe-visual");
      if (!sourceElement || !document.getElementById("deal-animation-layer")) return;
      const source = sourceElement.getBoundingClientRect();
      const target = getTargetSlotRect(item);
      const reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const flying = createFlyingCard(source);
      const duration = getDealDuration(source, target, reduced);
      const rotation = item.cardIndex === 2 ? (item.side === "PLAYER" ? -6 : 6) : 0;
      if (DEBUG_DEAL_ANIMATION) console.log("[ANIMATION]", item.label, duration);
      try {
        if (flying.animate) {
          await flying.animate([{ transform: "translate(0, 0) scale(.96) rotate(0deg)", opacity: 1 }, { transform: `translate(${target.left - parseFloat(flying.style.left)}px, ${target.top - parseFloat(flying.style.top)}px) scale(1.02) rotate(${rotation}deg)`, opacity: 1 }], { duration, easing: "cubic-bezier(0.22, 0.61, 0.36, 1)", fill: "forwards" }).finished;
          await flying.animate([{ transform: `translate(${target.left - parseFloat(flying.style.left)}px, ${target.top - parseFloat(flying.style.top)}px) scale(1.02) rotate(${rotation}deg)` }, { transform: `translate(${target.left - parseFloat(flying.style.left)}px, ${target.top - parseFloat(flying.style.top)}px) scale(1) rotate(${rotation}deg)` }], { duration: reduced ? 25 : 70, easing: "ease-out", fill: "forwards" }).finished;
        } else await wait(reduced ? 80 : duration + 70);
      } finally { flying.remove(); }
      markDealt(); render();
    }
    async function flipPresentationCard(item, reveal) {
      const element = getCardElement(item);
      if (!element || element.dataset.revealState === "FACE_UP") { reveal(); return; }
      element.dataset.revealState = "FLIPPING";
      const inner = element.querySelector(".card-inner"); inner.classList.remove("is-face-down"); inner.classList.add("is-flipping");
      await wait(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 35 : 220);
      inner.classList.remove("is-flipping"); inner.classList.add("is-face-up"); element.dataset.revealState = "FACE_UP"; reveal(); render();
    }
    function getDiscardTargetRect() { return document.querySelector(".discard-tray").getBoundingClientRect(); }
    function createDiscardClone(cardElement, source) {
      const clone = cardElement.cloneNode(true); clone.className = "discard-clone"; clone.style.left = `${source.left}px`; clone.style.top = `${source.top}px`; clone.style.width = `${source.width}px`; clone.style.height = `${source.height}px`; document.getElementById("deal-animation-layer").append(clone); return clone;
    }
    async function animateCardToDiscard(item, index) {
      const cardElement = getCardElement(item); if (!cardElement) return;
      const source = cardElement.getBoundingClientRect(); const target = getDiscardTargetRect(); const reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const clone = createDiscardClone(cardElement, source); cardElement.style.visibility = "hidden";
      const offsetX = (index % 3 - 1) * 3; const offsetY = (index % 2) * 3; const rotation = (index % 4 - 1.5) * 3; const duration = reduced ? 90 : Math.max(220, Math.min(340, getDealDuration(source, target) - 20));
      try {
        if (clone.animate) await clone.animate([{ transform: "translate(0, 0) scale(1) rotate(0deg)", opacity: 1 }, { transform: `translate(${target.left + target.width / 2 - source.left - source.width / 2 + offsetX}px, ${target.top + target.height / 2 - source.top - source.height / 2 + offsetY}px) scale(.76) rotate(${rotation}deg)`, opacity: 0 }], { duration, easing: "cubic-bezier(0.22, 0.61, 0.36, 1)", fill: "forwards" }).finished;
        await wait(reduced ? 20 : 45);
      } finally { clone.remove(); cardElement.remove(); }
    }
    async function discardRoundCards(items) {
      render();
      const tasks = items.map((item, index) => (async () => { await wait(index * 80); try { await animateCardToDiscard(item, index); } catch (error) { const el = getCardElement(item); if (el) el.remove(); } })());
      await Promise.all(tasks);
      const tray = document.querySelector(".discard-tray"); if (tray && tray.animate) await tray.animate([{ transform: "scale(1)" }, { transform: "scale(1.02)" }, { transform: "scale(1)" }], { duration: 110, easing: "ease-out" }).finished;
    }
    elements.deal.addEventListener("click", async () => { const wasRoundEnd = game.state === GAME_STATES.ROUND_END; const wasShoeEnding = game.cutCard.shoeEnding; await game.handlePrimaryAction(animatePresentationCard, flipPresentationCard, discardRoundCards); if (wasRoundEnd) { initializeCardSlots(elements.playerCards, "PLAYER"); initializeCardSlots(elements.bankerCards, "BANKER"); document.querySelectorAll(".flying-card,.discard-clone").forEach((element) => element.remove()); } render(); if (wasShoeEnding) await presentInitialBurn(); });
    if (roadmapToggle) roadmapToggle.addEventListener("click", () => {
      const expanded = roadmap.classList.toggle("expanded");
      roadmapToggle.textContent = expanded ? "收起" : "展开";
      roadmapToggle.setAttribute("aria-expanded", String(expanded));
    });
    async function presentInitialBurn() {
      if (!game.beginBurnPresentation()) return;
      render();
      await wait(BURN_PRESENTATION_MS);
      game.completeBurnPresentation();
      render();
    }
    render();
    presentInitialBurn();
    return game;
  }

  function playingCardBackHtml() {
    return `<span class="card-face card-back playing-card--back"><span class="playing-card__back-pattern" aria-hidden="true"></span><svg class="playing-card__back-crown" viewBox="0 0 64 48" aria-hidden="true"><path d="M11 30 15 13l12 10L32 8l5 15 12-10 4 17H11Z"></path><path d="M13 34c12 3 26 3 38 0l-2 6H15l-2-6Z"></path><circle cx="15" cy="11" r="2"></circle><circle cx="32" cy="6" r="2"></circle><circle cx="49" cy="11" r="2"></circle><path class="crown-diamond" d="m32 24 3 3-3 3-3-3 3-3Z"></path></svg></span>`;
  }
  function flipCardHtml(card, index, revealed, key = "") {
    const symbol = SUIT_SYMBOLS[card.suit];
    const color = card.suit === "hearts" || card.suit === "diamonds" ? "red" : "black";
    const third = index === 2 ? " third-card is-third-card" : "";
    return `<span class="card-shell${third}" data-card-key="${key}" data-card-position="${index + 1}" data-reveal-state="${revealed ? "FACE_UP" : "FACE_DOWN"}"><span class="card-inner${revealed ? " is-face-up" : " is-face-down"}">${playingCardBackHtml()}<span class="card-face card-front playing-card--front ${color}"><span class="playing-card__corner playing-card__corner--top"><strong>${card.rank}</strong></span><span class="playing-card__center">${symbol}</span><span class="playing-card__corner playing-card__corner--bottom"><strong>${card.rank}</strong></span></span></span></span>`;
  }
  const api = { INITIAL_BALANCE, CHIP_VALUES, DEFAULT_CHIP, AREA_MIN_BET, AREA_MAX_BET, ROUND_MAX_BET, BET_CHIP_RENDER_CAP, MIN_CUT_REMAINING, MAX_CUT_REMAINING, GAME_STATES, SHOE_STATUS, CUT_CARD_ENTER_MS, CUT_CARD_HOLD_MS, CUT_CARD_EXIT_MS, CUT_CARD_EVENT_MS, CHIP_PLACEMENT_DURATION_MS, CHIP_RETURN_DURATION_MS, CHIP_CLEAR_RETURN_DURATION_MS, formatMoney, getBurnValue, createBurnState, createCutCardState, createBetChipPresentation, cloneBetChipPresentation, buildBetChipColumns, getChipDenominationClass, betChipHtml, randomInteger, getShoePresentationState, getShoeEquipmentState, renderBurnPresentation, renderShoeStatus, playingCardBackHtml, flipCardHtml, buildDealQueue, getDealDuration, getDiscardSequence, getChipComputedStyleSnapshot, BaccaratGameController, mountGame };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.BaccaratApp = api;
  if (typeof window !== "undefined" && window.document) window.addEventListener("DOMContentLoaded", () => mountGame(window.document));
}(typeof globalThis !== "undefined" ? globalThis : this));
