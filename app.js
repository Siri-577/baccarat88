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
  const GAME_STATES = Object.freeze({ BETTING: "BETTING", ROUND_LOCKED: "ROUND_LOCKED", AUTO_DEALING: "AUTO_DEALING", REVEAL_READY: "REVEAL_READY", REVEALING: "REVEALING", AUTO_DRAWING: "AUTO_DRAWING", SETTLING: "SETTLING", ROUND_END: "ROUND_END", DISCARDING: "DISCARDING" });
  const BET_LABELS = Object.freeze({ PLAYER: "闲 / PLAYER", BANKER: "庄 / BANKER", TIE: "和 / TIE", PLAYER_PAIR: "闲对 / PLAYER PAIR", BANKER_PAIR: "庄对 / BANKER PAIR" });
  const SUIT_SYMBOLS = Object.freeze({ spades: "♠", hearts: "♥", diamonds: "♦", clubs: "♣" });
  const DEBUG_DEAL_ANIMATION = false;
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

    async prepareDeal(dealFaceDown) {
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
        this.state = GAME_STATES.REVEAL_READY;
        this.message = "READY TO REVEAL · 等待翻牌";
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

    async revealNextCard(flipCard) {
      if (this.state !== GAME_STATES.REVEAL_READY || this.isRevealInputLocked) return this.reject("当前不能翻牌");
      const nextDeal = this.revealQueue[this.currentRevealIndex];
      if (!nextDeal) return this.reject("没有待翻牌");
      this.isRevealInputLocked = true; this.isDealInputLocked = true; this.state = GAME_STATES.REVEALING;
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
          this.state = GAME_STATES.REVEAL_READY;
          this.message = "READY TO REVEAL · 等待翻牌";
        } else if (this.currentRevealIndex >= this.revealQueue.length && this.revealQueue.length === this.dealQueue.length) {
          this.state = GAME_STATES.SETTLING;
          await wait(160);
          this.settlement = betting.settleRound(this.account, this.bettingRound, this.roundResult);
          this.state = GAME_STATES.ROUND_END;
          this.message = `${this.roundResult.winner}${this.roundResult.winner === "TIE" ? "" : " WIN"} · 发牌完成`;
        } else {
          this.state = GAME_STATES.REVEAL_READY;
          this.message = "READY TO REVEAL · 等待翻牌";
        }
        this.isRevealInputLocked = false; this.isDealInputLocked = false;
      }
      return true;
    }

    handlePrimaryAction(dealFaceDown, flipCard, discardCards) {
      if (this.state === GAME_STATES.BETTING) return this.prepareDeal(dealFaceDown);
      if (this.state === GAME_STATES.REVEAL_READY) return this.revealNextCard(flipCard);
      if (this.state === GAME_STATES.ROUND_END) return this.nextRound(discardCards);
      return this.reject("当前操作不可用");
    }

    // Compatibility alias for pre-V0.6.2 callers; it now locks the result only.
    dealRound() { return this.prepareDeal(); }

    async nextRound(discardCards) {
      if (this.state !== GAME_STATES.ROUND_END) return this.reject("请先完成当前局");
      this.state = GAME_STATES.DISCARDING;
      this.message = "COLLECTING CARDS · 收牌中";
      try { if (discardCards) await discardCards(getDiscardSequence(this.dealQueue, this.dealtKeys)); }
      catch (error) { if (DEBUG_DEAL_ANIMATION) console.error("[DISCARD ANIMATION ERROR]", error); }
      this.roundId += 1;
      this.bettingRound = betting.createBettingRound(this.roundId, this.account);
      this.betActionHistory = [];
      this.roundResult = null;
      this.settlement = null;
      this.dealQueue = [];
      this.roundDealPlan = this.dealQueue; this.revealQueue = []; this.currentRevealIndex = 0; this.dealtKeys.clear(); this.revealedKeys.clear(); this.autoDealRunning = false; this.isRevealInputLocked = false; this.dealFaceDown = null;
      this.currentDealIndex = 0;
      this.revealedCards = { PLAYER: [], BANKER: [] };
      this.isDealInputLocked = false;
      this.state = GAME_STATES.BETTING;
      this.message = "PLACE YOUR BETS · 请下注";
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
      const nextDeal = game.revealQueue[game.currentRevealIndex];
      const actionText = game.state === GAME_STATES.BETTING ? ["DEAL", "发牌"] : game.state === GAME_STATES.ROUND_END ? ["NEXT ROUND", "下一局"] : game.state === GAME_STATES.DISCARDING ? ["COLLECTING", "收牌中"] : ["REVEAL", "翻牌"];
      elements.deal.innerHTML = `${actionText[0]}<br><small>${actionText[1]}</small>`;
      elements.deal.disabled = (game.state === GAME_STATES.BETTING && game.totalBet === 0) || ![GAME_STATES.BETTING, GAME_STATES.REVEAL_READY, GAME_STATES.ROUND_END].includes(game.state) || game.isRevealInputLocked || game.autoDealRunning;
      elements.nextCard.textContent = nextDeal ? `待翻牌：${nextDeal.label}` : game.state === GAME_STATES.ROUND_END ? "本局结束" : game.state === GAME_STATES.DISCARDING ? "正在收牌" : game.state === GAME_STATES.AUTO_DRAWING ? "正在补牌" : game.state === GAME_STATES.AUTO_DEALING ? "正在发牌" : "请先下注";
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
    chipButtons.forEach((button) => button.addEventListener("click", () => { game.selectChip(Number(button.dataset.chip)); render(); }));
    betButtons.forEach((button) => button.addEventListener("click", () => { game.placeSelectedBet(button.dataset.betType); render(); }));
    elements.undo.addEventListener("click", () => { game.undoBet(); render(); });
    elements.clear.addEventListener("click", () => { game.clearBets(); render(); });
    function getTargetSlotRect(item) {
      const container = item.side === "PLAYER" ? elements.playerCards : elements.bankerCards;
      const slot = container.querySelector(`[data-slot-index="${item.cardIndex}"]`);
      return (slot || container).getBoundingClientRect();
    }
    function createFlyingCard(source) {
      const flying = document.createElement("div");
      flying.className = "flying-card";
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
    elements.deal.addEventListener("click", async () => { const wasRoundEnd = game.state === GAME_STATES.ROUND_END; await game.handlePrimaryAction(animatePresentationCard, flipPresentationCard, discardRoundCards); if (wasRoundEnd) { initializeCardSlots(elements.playerCards, "PLAYER"); initializeCardSlots(elements.bankerCards, "BANKER"); document.querySelectorAll(".flying-card,.discard-clone").forEach((element) => element.remove()); } render(); });
    if (roadmapToggle) roadmapToggle.addEventListener("click", () => {
      const expanded = roadmap.classList.toggle("expanded");
      roadmapToggle.textContent = expanded ? "收起" : "展开";
      roadmapToggle.setAttribute("aria-expanded", String(expanded));
    });
    render();
    return game;
  }

  function flipCardHtml(card, index, revealed, key = "") {
    const symbol = SUIT_SYMBOLS[card.suit]; const color = card.suit === "hearts" || card.suit === "diamonds" ? "red" : "black"; const third = index === 2 ? " third-card is-third-card" : "";
    return `<span class="card-shell${third}" data-card-key="${key}" data-card-position="${index + 1}" data-reveal-state="${revealed ? "FACE_UP" : "FACE_DOWN"}"><span class="card-inner${revealed ? " is-face-up" : " is-face-down"}"><span class="card-face card-back"></span><span class="card-face card-front ${color}"><strong>${card.rank}</strong><small>${symbol}</small></span></span></span>`;
  }
  const api = { INITIAL_BALANCE, CHIP_VALUES, DEFAULT_CHIP, AREA_MIN_BET, AREA_MAX_BET, ROUND_MAX_BET, RESHUFFLE_THRESHOLD, GAME_STATES, formatMoney, buildDealQueue, getDealDuration, getDiscardSequence, BaccaratGameController, mountGame };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.BaccaratApp = api;
  if (typeof window !== "undefined" && window.document) window.addEventListener("DOMContentLoaded", () => mountGame(window.document));
}(typeof globalThis !== "undefined" ? globalThis : this));
