# 原版竞技模式的经济与回合计时

这次交付把权威模拟里的经济与回合计时从本地硬编码换成**发货原文件里的数值**：`csgo/cfg/gamemode_competitive.cfg`（4,542 字节，SHA-256 `f76ccb9f…`）就是原作服务器实际套用的竞技模式配置，同一个安装里还有 `gamemode_competitive_short.cfg`（116 字节），它就是这份配置的两条覆盖（`mp_maxrounds 16`、`mp_starting_losses 2`）。

在此之前局域网模式的金钱是**开局 16000**、回合结算固定 2700/1900、击杀固定 300、买枪阶段 12 s、回合 100 s、结算面板 5 s——也就是**没有经济可言**，每回合都是满配。这些计时与金额字段已改为来自原文件；Source 竞技出生只发队伍手枪，主武器与投掷物需按余额购买，刀槽可用基础近战闭环。

## 已生效的原值

| 项目 | 原值 | 原文件位置 |
| --- | --- | --- |
| 开局金钱 / 上限 / 回合结束补钱 | 800 / 16000 / 0 | `mp_startmoney`、`mp_maxmoney`、`mp_afterroundmoney` |
| 冻结时间 / 购买时间 / 回合时长 / 结算面板 | 15 s / 20 s / 115.2 s / 3 s | `mp_freezetime`、`mp_buytime`、`mp_roundtime_defuse`（1.92 分钟）、`mp_win_panel_display_time` |
| 击杀敌人（默认） | 300 × 系数 1 | `cash_player_killed_enemy_default` × `cash_player_killed_enemy_factor` |
| 误杀队友 | −300 | `cash_player_killed_teammate` |
| 竞技友伤 | 开启；子弹 0.33、HE 0.85、自伤 HE 1、其它 0.4 | `mp_friendlyfire`、`ff_damage_reduction_{bullets,grenade,grenade_self,other}` |
| 死亡观战限制 | 仅同队（`forcecamera 1`） | `mp_forcecamera` |
| 下包 / 拆包（个人） | 300 / 300 | `cash_player_bomb_planted`、`cash_player_bomb_defused` |
| 回合奖金（炸弹图） | 清空 3250 / 引爆 3500 / 拆包 3500 / 守时 3250 | `cash_team_elimination_bomb_map`、`cash_team_terrorist_win_bomb`、`cash_team_win_by_defusing_bomb`、`cash_team_win_by_time_running_out_bomb` |
| 下包但被拆（败方） | 800 | `cash_team_planted_bomb_but_defused` |
| 败方连败阶梯 | 1400 + 500 × 级 | `cash_team_loser_bonus`、`cash_team_loser_bonus_consecutive_rounds`、`mp_starting_losses` |
| 赛制键 | 30 回合 / 半场 1 / 可提前锁定 1 | `mp_maxrounds`、`mp_halftime`、`mp_match_can_clinch` |

败方阶梯按原作语义实现：计数器从 `mp_starting_losses`（1）起，**先读后加**，所以新队伍的第一次失败拿 1400，连续失败每多一场上一级（1900/2400/2900/3400）。原生 `mp_consecutive_loss_aversion=1` 表示胜方每赢一场只把自己的计数器降低 1，连续赢继续降低，round-end 原生逻辑将其限制在 0，不会一胜立即重置。

**购买窗口**按原作的口径实现：买枪不是"买枪阶段专属"，而是从回合开始算 `mp_buytime` 秒，因此它比冻结时间（15 s）多出 5 秒进入实战。客户端商店的可用性用**同一份** `sourceBuyWindowOpen()` 判断，不会出现"权威允许但按钮是灰的"。

练习（`training`）模式保持自己的沙盒：金钱仍是 16000、购买不受回合限制——这是刻意的偏离，写在模块的 limitations 里。

## 数据落地

```sh
python3 scripts/stage-source-gamemode.py
```

`scripts/stage-source-gamemode.py` 从发货文件直接读出本作真正套用的键，**每个数都带它来自哪一行**，并记录整份文件的字节数与 SHA-256；短局模式按"覆盖层"落库（它只有两条覆盖，不假装是完整模式）；原文件里**没有**的键（`mp_consecutive_loss_max`）被显式记为缺失。产物 `game/source-gamemode-competitive.json` 由构建期导入，运行时 `game/source-gamemode.ts` 逐项校验（格式/构建/应用、整数与小数解析、金额非负、金钱与时间自洽、短局覆盖集合、缺失记录），**任何一项不对就抛错**，不会退回本地默认。

## 验证

```sh
npx vitest run tests/source-gamemode.test.ts
npm run typecheck && npm run lint
```

`tests/source-gamemode.test.ts` 9 条：① 入库回执与**发货文件逐行复核**——每个数必须真的出现在它声称的那一行、键名一致；② 金钱/时间/赛制原值；③ 阶梯与原作奖金/步长；④ 购买窗口（含多出实战的 5 秒与训练模式）；⑤ 畸形数据被拒（错格式、缺键、非整数、负金额、金钱不自洽、短局覆盖集合被改、缺失记录被删）；⑥ 局域网模式开局 800、练习模式 16000；⑦ 回合结算按获胜方式给钱并推动连败阶梯；⑧ 下包被拆给 800、击杀给 300；⑨ 买枪窗口在实战开始 5 秒后关闭。`tests/simulation.test.ts` 的买枪用例同步改写为原值口径。

## 尚未恢复的部分

1. **逐武器奖励已接入**：从 `scripts/items/items_game.txt` 读取并生成 `game/source-kill-award-table.ts`，当前开放枪械中 AWP 击杀奖励为 100，其他枪械为 300，乘竞技配置的奖励系数。旧版“所有枪默认 300”的结论已过时。
2. `mp_consecutive_loss_max` 不在发货配置里，阶梯按原作奖金与步长本身的五级封顶（1400…3400）；`mp_consecutive_loss_aversion=1` 的 round-end 行为来自原生二进制，计数器每次胜利减 1 并 clamp 到 0。
3. `cash_team_bonus_shorthanded`（少打多补偿）与**人质图**相关金钱已入库但未套用：本作打的是炸弹图，且少打多的触发条件不在这些文件里。
4. **刀具**：Source authority 支持 slot 2 轻/重击和近距离伤害，客户端使用明确标注的通用低模；原始刀模型、动作与音频尚未从本地资源接入。
5. **购买区已接入**：Dust II 的两个原 `func_buyzone` 进入服务器与本地模拟，只在对应队伍区域和购买窗口内购买。出生免疫期的购买限制仍需单独核实。
6. **赛制**：房间创建时可选原作两种模式——**短竞技**（16 回合、先到 9、第 8 回合后换边，局域网默认）与**完整竞技**（30 回合、先到 16、第 15 回合后换边）。模式由房间在创建时定下、写入房间元数据，并随快照下发（`snapshot().rules`），因此 HUD、商店与房间列表都跟着权威走；服务端收到未知赛制 id 直接报 `RULES_MISMATCH` 而不是退回默认，避免两端跑在不同规则上。
7. **友伤**：竞技 authority 使用发货配置的 `mp_friendlyfire 1` 和四个 `ff_damage_reduction_*` 倍率。子弹命中队友、HE 对队友或投掷者自身会按各自倍率扣血/护甲；队友被击杀扣 `cash_player_killed_teammate -300`，不增加敌方击杀奖励。训练模式仍保持沙盒的无友伤行为。

## 赛制：换边与提前锁定

`mp_maxrounds` / `mp_halftime` / `mp_match_can_clinch` 现在真正生效。`sourceMatchFormat()` 把它们变成两条规则：

| 模式 | `mp_maxrounds` | 先到几局（clinch） | 第几回合后换边（halftime） |
| --- | --- | --- | --- |
| 完整竞技 | 30 | 16 | 15 |
| 短竞技（局域网默认） | 16 | 9 | 8 |

- **提前锁定**：`mp_match_can_clinch 1` 的意思是"赢过半数即可结束"，所以先到 `⌊maxrounds/2⌋+1`，永远不会打那些已经追不回来的回合。
- **半场换边**：两侧交换队伍、出生点与攻防身份，已经赢下的回合跟着人走。装备和经济重置的本轮状态见 [接续记录](trae-handoff-20260913.md)；原先声称“交换装备”只由队伍/比分测试支撑，不能作为装备复核结论。练习模式保留自己的沙盒规则。
- **短竞技不是另一个模式文件**：它只覆盖两条键（`mp_maxrounds 16`、`mp_starting_losses 2`），其余全部继承完整竞技——落库与解析都按"覆盖层"处理，这两条键的出处也记在短文件自己的行号上。`mp_starting_losses 2` 让败方阶梯从第二级起步（首败 1900），这正是短局加速经济的本意。
- **换边要让玩家知道**：换边无法从比分推断，所以 `swapSides()` 像回合结果一样广播一条 `半场结束 · 双方交换边`；HUD 的回合计时列在非练习模式下显示本模式的赛制「先到 9 局 · 第 8 回合后换边」——两处都用 `sourceMatchFormat()` 从同一份入库数据算出，不在界面里另抄数字。

## 房间如何选择赛制

创建房间时可选两种原作模式，模式在创建那一刻定下、整个房间不变：

| 环节 | 位置 | 行为 |
| --- | --- | --- |
| 选项 | `app/page.tsx` 创建对话框 | 文案由 `sourceRuleSets()` 从入库数字生成，界面不存数字 |
| 请求 | `game/runtime.ts` → `JoinOptions.rules` | 客户端把所选 id 发给房主 |
| 校验 | `server/lan.ts` `requestedRuleSet()` | 未知 id **报 `RULES_MISMATCH`**，不退回默认 |
| 权威 | `server/index.ts` → `new Simulation(..., ruleSet)` | 房间按该赛制运行，写入房间元数据 |
| 下发 | `simulation.snapshot().rules` | HUD 的"先到 N 局"、商店购买窗口、房间列表标签全部跟随它 |

真机验收脚本 `scripts/run-playwright-room-rules-validation.mjs` 会走完这五处（选项 → 请求 → 权威 → HUD → 大厅），证据 `output/playwright/source-room-rules-evidence.json`。**注意**：大厅要在房间存活时查——房主返回主菜单会离开房间，最后一个客户端离开后房间被回收（见 PROGRESS 的同日记录，这一行为是否合意待确认）。
