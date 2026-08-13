# 百家乐88 — V0.7.5 Shoe / Cut Card Visual Polish & Table Integration

纯 JavaScript 的百家乐规则、下注、RTP 模拟与可玩桌面。V0.7.5 将 Shoe、Discard、Shoe Status 和纯视觉 Cut Card 统一为 Dealer Equipment System。

## 运行

```bash
npm test
npm run simulate
```

使用浏览器直接打开 `index.html` 即可游玩。

## Roadmap Core

- `roadmap-engine.js`：无 DOM 依赖的纯算法；提供 Road History Entry、6 行珠盘路与大路。
- 结算完成后才写入一条 Road History；Manual / Auto 共用同一入口，并有单局防重复保护。
- 珠盘路逐局记录庄、闲、和及庄对/闲对标记，按照上到下、再由左至右排列。
- 大路仅以庄/闲建立 streak；Tie 附着到最近的有效格，支持连续 Tie、开局 Tie、龙尾与碰撞右转。
- NEXT ROUND 不清路纸；新的 Shoe 会通过 `resetRoadmapForNewShoe()` 清空路史。
- 桌面端默认紧凑显示，可展开；移动端默认收起，展开后仅路纸内部横向滚动。

## 模块

- `baccarat-engine.js`：8 副 Shoe、洗牌、发牌、点数、Natural、补牌、Pair 和胜负。
- `betting-engine.js`：余额、下注、赔率、Tie Push、Pair 结算及重复结算保护。
- `baccarat-simulator.js`：真实 Shoe 的 RTP / House Edge 模拟。
- `app.js`：Casino Table、发牌/翻牌/弃牌表现层、Manual / Auto Reveal、Road History 生命周期与 Roadmap UI。
- `roadmap-test.js`：Roadmap Core 的 20+ 算法测试，包括 Tie、Leading Tie、Dragon Tail、碰撞与 500 局稳定性。
- `roadmap-layout-test.js`：Roadmap 上下顺序、6 行、独立横滚、Compact/Mobile、筹码与控制台响应式约束。
- `derived-road-test.js`：大眼仔、小路、曱甴路的 offset、结构比较、Tie/Pair 忽略、龙尾、碰撞、时间顺序与 500 局稳定性。
- `repeat-bet-test.js`：Repeat snapshot、覆盖、原子余额校验、Pair、Undo、Clear 和状态锁定测试。
- `burn-card-test.js`：A、5、9、10、J、Q、K 的 Burn Value、真实移除、单 Shoe 防重复、状态锁定以及与 Roadmap / Repeat 的隔离测试。
- `cut-card-test.js`：Cut Threshold、单次触发、当前局完成、Last Hand、Shoe Complete、New Shoe 和手动/自动发牌回归测试。
- `shoe-status-test.js`：Shoe Status 派生、DOM 单一来源、隐藏规则、Cut Event token 及 Last Hand / Shoe Complete 展示测试。
- `mobile-table-layout-test.js`：移动端设备区尺寸、Player 安全距离、Card Slot 居中、第三张倾斜与横向溢出约束测试。
- `shoe-visual-test.js`：纯视觉 Cut Card、设备状态、事件驱动动画、New Shoe reset、Mobile 安全区与 Burn 回归测试。
