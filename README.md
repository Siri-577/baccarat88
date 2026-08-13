# 百家乐88 — V0.6.3.3 Discard Tray Collection Animation

纯 JavaScript 的百家乐规则、虚拟下注、真实牌靴 RTP 模拟及可玩网页版本。牌位采用持久化 DOM：已落桌牌保持不动、每张仅翻开一次，第三张补牌同样从 Shoe Travel 后才以背面落位；NEXT ROUND 会将本局牌面收进 Discard Tray 后才开启新局。

## 运行

需要 Node.js 18+：

```bash
npm test

# 运行 1,000,000 局正式模拟，并生成 simulation-report.json / .txt
npm run simulate
```

## 模块

- `baccarat-engine.js`：8 副牌 Shoe、Fisher-Yates 洗牌、抽牌、点数、Natural、Player/Banker 第三张规则、Pair、胜负及单局执行。
- `betting-engine.js`：余额、下注区、锁定状态、赔率、Tie Push、Pair 独立结算、返还及重复结算保护。
- `baccarat-simulator.js`：连续 8 副牌靴模拟、概率/用牌/RTP/House Edge 统计及报告生成。
- `index.html`、`style.css`、`app.js`：Casino Table Foundation；包含深绿桌布、Player/Banker 手区、Shoe、Discard Tray、下注印刷区、路纸预留及控制台。界面只调用既有核心引擎，不重写规则或赔率。
- `baccarat-test.js`：V0.2 规则矩阵与 10,000 局随机运行测试。
- `betting-test.js`：V0.3 确定性结算与 10,000 局集成稳定性测试。
- `simulator-test.js`：V0.4 种子可复现性和模拟结构测试。
- `app-test.js`：V0.5 游戏控制器、限额与连续 100 局测试。

`playRound(shoe, { debug: true })` 可开启单局调试日志。`placeBet` 会即时扣除余额，只有在 `BETTING_OPEN` 状态允许下注；`settleRound` 必须先关闭下注，且同一局只能结算一次。

模拟器通过 V0.2 的 `playRound` 真实发牌，并用 V0.3 的纯 `settleBet` 为每种投注逐局按 1 单位结算。它在每局开始前、剩余牌少于 60 张时重洗；不会在牌局中途更换 Shoe。

使用浏览器打开 `index.html` 即可游玩。初始余额为 100,000；筹码为 10 / 50 / 100 / 500 / 1,000 / 5,000；单区限额 10–20,000，单局总限额 50,000。点击 DEAL 后，桌面将显示队列驱动的 NEXT CARD 提示，逐张发牌；路纸目前仅为可展开/收起的布局占位，尚未实现任何路纸算法。
