"use strict";

(function initializeApp(root) {
  const baccarat = root.BaccaratEngine || (typeof require !== "undefined" ? require("./baccarat-engine") : null);
  const betting = root.BettingEngine || (typeof require !== "undefined" ? require("./betting-engine") : null);
  if (!baccarat || !betting) throw new Error("Baccarat and betting engines must be loaded before app.js");

  const INITIAL_BALANCE = 100000;
  const CHIP_VALUES = Object.freeze([10, 50, 100, 500, 1000, 5000]);
  const DEFAULT_CHIP = 100;
  const AREA_MIN_BET = 10;
  const AREA_MAX_BET = 20000;
  const ROUND_MAX_BET = 50000;
  const RESHUFFLE_THRESHOLD = 60;
  const GAME_STATES = Object.freeze({ BETTING: "BETTING", DEAL_READY: "DEAL_READY", DEALING: "DEALING", SETTLING: "SETTLING", ROUND_END: "ROUND_END" });
  const BET_LABELS = Object.freeze({ PLAYER: "闲 / PLAYER", BANKER: "庄 / BANKER", TIE: "和 / TIE", PLAYER_PAIR: "闲对 / PLAYER PAIR", BANKER_PAIR: "庄对 / BANKER PAIR" });
  const SUIT_SYMBOLS = Object.freeze({ spades: "♠", hearts: "♥", diamonds: "♦", clubs: "♣" });

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

  class BaccaratGameController {
    constructor({ initialBalance = INITIAL_BALANCE, random = Math.random } = {}) {
      this.random = random;
      this.account = betting.createPlayerAccount(initialBalance);
      this.roundId = 1;
      this.shoeId = 1;
      this.selectedChip = DEFAULT_CHIP;
      this.state = GAME_STATES.BETTING;
      this.shoe = this.createShuffledShoe();
      this.bettingRound = betting.createBettingRound(this.roundId, this.account);
      this.betActionHistory = [];
      this.roundResult = null;
      this.settlement = null;
      this.dealQueue = [];
      this.currentDealIndex = 0;
      this.revealedCards = { PLAYER: [], BANKER: [] };
      this.isDealInputLocked = false;
      this.message = "请选择筹码并下注";
    }

    createShuffledShoe() {
      return baccarat.shuffleShoe(baccarat.createShoe(8), this.random);
    }

    get totalBet() {
      return betting.roundMoney(Object.values(this.bettingRound.bets).reduce((sum, amount) => sum + amount, 0));
    }

    selectChip(amount) {
      if (this.state !== GAME_STATES.BETTING || !CHIP_VALUES.includes(amount)) return this.reject("当前不能选择筹码");
      this.selectedChip = amount;
      this.message = `已选择筹码 ${formatMoney(amount)}`;
      return true;
    }

    reject(message) {
      this.message = message;
      return false;
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
      this.bettingRound.bets[action.betType] = betting.roundMoney(this.bettingRound.bets[action.betType] - action.amount);
      this.account.balance = betting.roundMoney(this.account.balance + action.amount);
      this.bettingRound.balanceAfterBet = this.account.balance;
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
      this.message = refund ? `已退回 ${formatMoney(refund)}` : "当前没有下注";
      return true;
    }

    prepareDeal() {
      if (this.state !== GAME_STATES.BETTING) return this.reject("当前不能发牌");
      if (this.totalBet === 0) return this.reject("请先下注");
      betting.closeBetting(this.bettingRound);
      if (this.shoe.length < RESHUFFLE_THRESHOLD) {
        this.shoe = this.createShuffledShoe();
        this.shoeId += 1;
        this.message = "重新洗牌";
      }
      try {
        // The real Baccarat Engine locks every card and result before UI reveal begins.
        this.roundResult = baccarat.playRound(this.shoe);
        this.dealQueue = buildDealQueue(this.roundResult);
        this.currentDealIndex = 0;
        this.revealedCards = { PLAYER: [], BANKER: [] };
        this.settlement = null;
        this.state = GAME_STATES.DEAL_READY;
        this.message = "READY TO DEAL · 准备发牌";
        return true;
      } catch (error) {
        this.state = GAME_STATES.ROUND_END;
        this.message = `发牌错误：${error.message}`;
        return false;
      }
    }

    revealNextCard() {
      if (![GAME_STATES.DEAL_READY, GAME_STATES.DEALING].includes(this.state) || this.isDealInputLocked) return this.reject("当前不能发下一张牌");
      const nextDeal = this.dealQueue[this.currentDealIndex];
      if (!nextDeal) return this.reject("发牌完成");
      this.isDealInputLocked = true;
      this.revealedCards[nextDeal.side].push(nextDeal.card);
      this.currentDealIndex += 1;
      if (this.currentDealIndex >= this.dealQueue.length) {
        this.state = GAME_STATES.SETTLING;
        this.settlement = betting.settleRound(this.account, this.bettingRound, this.roundResult);
        this.state = GAME_STATES.ROUND_END;
        this.message = `${this.roundResult.winner}${this.roundResult.winner === "TIE" ? "" : " WIN"} · 发牌完成`;
      } else {
        const following = this.dealQueue[this.currentDealIndex];
        this.state = GAME_STATES.DEALING;
        this.message = following.isThirdCard ? "DRAW CARD · 补牌" : "DEALING · 发牌中";
      }
      this.isDealInputLocked = false;
      return true;
    }

    handlePrimaryAction() {
      if (this.state === GAME_STATES.BETTING) return this.prepareDeal();
      if ([GAME_STATES.DEAL_READY, GAME_STATES.DEALING].includes(this.state)) return this.revealNextCard();
      if (this.state === GAME_STATES.ROUND_END) return this.nextRound();
      return this.reject("当前操作不可用");
    }

    // Compatibility alias for pre-V0.6.2 callers; it now locks the result only.
    dealRound() { return this.prepareDeal(); }

    nextRound() {
      if (this.state !== GAME_STATES.ROUND_END) return this.reject("请先完成当前局");
      this.roundId += 1;
      this.bettingRound = betting.createBettingRound(this.roundId, this.account);
      this.betActionHistory = [];
      this.roundResult = null;
      this.settlement = null;
      this.dealQueue = [];
      this.currentDealIndex = 0;
      this.revealedCards = { PLAYER: [], BANKER: [] };
      this.isDealInputLocked = false;
      this.state = GAME_STATES.BETTING;
      this.message = "新一局开始，请下注";
      return true;
    }
  }

  function cardHtml(card, index) {
    const symbol = SUIT_SYMBOLS[card.suit];
    const color = card.suit === "hearts" || card.suit === "diamonds" ? "red" : "black";
    const thirdCard = index === 2 ? " third-card" : "";
    return `<span class="card ${color}${thirdCard}" data-card-position="${index + 1}"><strong>${card.rank}</strong><small>${symbol}</small></span>`;
  }

  function mountGame(document) {
    const game = new BaccaratGameController();
    const byId = (id) => document.getElementById(id);
    const elements = {
      balance: byId("balance"), round: byId("round"), shoe: byId("shoe-id"), state: byId("game-state"), remaining: byId("remaining"), message: byId("message"),
      playerCards: byId("player-cards"), bankerCards: byId("banker-cards"), playerScore: byId("player-score"), bankerScore: byId("banker-score"),
      result: byId("result"), pairResult: byId("pair-result"), nextCard: byId("next-card-label"), playerScoreLabel: byId("player-score-label"), bankerScoreLabel: byId("banker-score-label"), totalBet: byId("total-bet"), totalReturn: byId("total-return"), netResult: byId("net-result"),
      settlementDetails: byId("settlement-details"), undo: byId("undo"), clear: byId("clear"), deal: byId("deal"),
    };
    const roadmapToggle = byId("roadmap-toggle");
    const roadmap = document.querySelector(".roadmap");
    const betButtons = [...document.querySelectorAll("[data-bet-type]")];
    const chipButtons = [...document.querySelectorAll("[data-chip]")];

    function render() {
      const isBetting = game.state === GAME_STATES.BETTING;
      elements.balance.textContent = formatMoney(game.account.balance);
      elements.round.textContent = game.roundId;
      elements.shoe.textContent = game.shoeId;
      elements.state.textContent = game.state;
      elements.remaining.textContent = game.shoe.length;
      elements.message.textContent = game.message;
      elements.totalBet.textContent = formatMoney(game.totalBet);
      for (const button of betButtons) {
        const type = button.dataset.betType;
        button.disabled = !isBetting;
        button.querySelector(".bet-amount").textContent = formatMoney(game.bettingRound.bets[type]);
      }
      for (const button of chipButtons) button.classList.toggle("selected", Number(button.dataset.chip) === game.selectedChip);
      elements.undo.disabled = !isBetting || game.betActionHistory.length === 0;
      elements.clear.disabled = !isBetting || game.totalBet === 0;
      elements.deal.disabled = !isBetting || game.totalBet === 0;
      const nextDeal = game.dealQueue[game.currentDealIndex];
      const actionText = game.state === GAME_STATES.BETTING ? ["DEAL", "发牌"] : game.state === GAME_STATES.ROUND_END ? ["NEXT ROUND", "下一局"] : ["NEXT CARD", "下一张"];
      elements.deal.innerHTML = `${actionText[0]}<br><small>${actionText[1]}</small>`;
      elements.deal.disabled = (game.state === GAME_STATES.BETTING && game.totalBet === 0) || game.state === GAME_STATES.SETTLING;
      elements.nextCard.textContent = nextDeal ? `下一张：${nextDeal.label}` : game.state === GAME_STATES.ROUND_END ? "发牌完成" : "请先下注";
      const isFinal = game.state === GAME_STATES.ROUND_END;
      const playerVisible = game.revealedCards.PLAYER;
      const bankerVisible = game.revealedCards.BANKER;
      elements.playerCards.innerHTML = playerVisible.length ? playerVisible.map(cardHtml).join("") : "<span class=\"placeholder\">等待发牌</span>";
      elements.bankerCards.innerHTML = bankerVisible.length ? bankerVisible.map(cardHtml).join("") : "<span class=\"placeholder\">等待发牌</span>";
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
    chipButtons.forEach((button) => button.addEventListener("click", () => { game.selectChip(Number(button.dataset.chip)); render(); }));
    betButtons.forEach((button) => button.addEventListener("click", () => { game.placeSelectedBet(button.dataset.betType); render(); }));
    elements.undo.addEventListener("click", () => { game.undoBet(); render(); });
    elements.clear.addEventListener("click", () => { game.clearBets(); render(); });
    elements.deal.addEventListener("click", () => { game.handlePrimaryAction(); render(); });
    if (roadmapToggle) roadmapToggle.addEventListener("click", () => {
      const expanded = roadmap.classList.toggle("expanded");
      roadmapToggle.textContent = expanded ? "收起" : "展开";
      roadmapToggle.setAttribute("aria-expanded", String(expanded));
    });
    render();
    return game;
  }

  const api = { INITIAL_BALANCE, CHIP_VALUES, DEFAULT_CHIP, AREA_MIN_BET, AREA_MAX_BET, ROUND_MAX_BET, RESHUFFLE_THRESHOLD, GAME_STATES, formatMoney, buildDealQueue, BaccaratGameController, mountGame };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.BaccaratApp = api;
  if (typeof window !== "undefined" && window.document) window.addEventListener("DOMContentLoaded", () => mountGame(window.document));
}(typeof globalThis !== "undefined" ? globalThis : this));
