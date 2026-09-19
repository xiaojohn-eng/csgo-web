# 原作击杀奖励（逐武器）

原作里"打死一个人给多少钱"不是一条常量：**按用什么武器打死的**分别给。这条表一直在发货文件里，只是不在模式配置里——`scripts/items/items_game.txt` 给每把武器（或它继承的 prefab）写一条 `kill award` 属性。这一轮把它读出来、入库、接进权威端的经济。

## 一条 `kill award` 在哪

| 读法 | 结果 |
| --- | --- |
| 属性名 | `"kill award"`（在武器/prefab 的 `attributes` 块里，属性类 `kill_award`，`description_format` 是 `value_is_additive`） |
| 在哪继承 | 武器自己的 item 块 → 它的 `prefab` → prefab 自己的 `prefab` …… 取链条上**第一条写着 `kill award`** 的 |
| 显式写着的 prefab | **15 条**：`statted_item_base` **300**、`melee` **1500**（刀）、五条 SMG prefab 各 **600**、四条霰弹枪 prefab 各 **900**、`weapon_awp_prefab` **100**、`weapon_cz75a_prefab` **100**、`weapon_taser_prefab` **0** |
| 其余武器 | 顺着链走到 `statted_item_base`，即 **300** |
| 交叉核对 | 两份发货竞技配置（`gamemode_competitive.cfg` 与它的短局覆盖）都写 `cash_player_killed_enemy_default = 300`、`cash_player_killed_enemy_factor = 1` —— 与 `statted_item_base` 的 300 **对得上**，导出脚本把两者不一致当作失败而不是二选一 |

也就是说：**AWP 击杀 100，SMG 600，霰弹枪 900，刀 1500，电枪 0，其余 300**。本作已实现的六把枪里，只有 AWP 属于"自己那一类另给"的（100），其余五把都走 300 —— 而此前端口对**每一把**都按 300 发钱。

## 解析链是走出来的，不是按名字猜的

导出把**每把武器**的链都记下来（81 把，含 `weapon_knife` 这种通过 `melee` 拿 1500 的），所以每个数字都能追到发货文件的一行：

| 武器 | 链 | 结论 |
| --- | --- | --- |
| `weapon_awp` | `weapon_awp` → `weapon_awp_prefab` | **100**（自己的 prefab 就写着） |
| `weapon_ak47` | `weapon_ak47` → `weapon_ak47_prefab` → `rifle` → `primary` → `weapon_base` → `statted_item_base` | 300 |
| `weapon_deagle` | …… → `secondary` → `weapon_base` → `statted_item_base` | 300 |
| `weapon_hegrenade` | `weapon_hegrenade` → `weapon_hegrenade_prefab` → `explosive_grenade` → `grenade` → `weapon_base` → `statted_item_base` | 300（手雷自己那一类也是 300） |
| `weapon_knife` | `weapon_knife` → `melee` | 1500 |
| `weapon_mp9` | `weapon_mp9` → `weapon_mp9_prefab` | 600 |

## 本作这把枪是哪把原作枪，也不是这张表说了算

表的"本作武器 → 原作武器"一列取自**已经入库的枪口效应映射**（`weapon-effects/effect-map.json` 自己的 `prefabs` 块：它就是"本作 id → 原作 prefab"的唯一定义处）。入库脚本逐个核对：映射到的原作武器 item，它自己的 `prefab` 必须**正好**是那一个 prefab，否则拒绝写表。所以这张表既没有按 id 猜，也没有第二份映射。

## 数据落地

| 产物 | 内容 |
| --- | --- |
| `scripts/export-source-kill-awards.py` | Blender + 仓库自己的 SourceIO 读取器（同一套 ACF/build 回执）：解析 `items_game.txt` 的 KV 栈、取出每把武器的 `prefab` 与 `kill award`、走链解析、并与两份模式配置交叉核对；写 `research/source-kill-awards.json` |
| `scripts/stage-source-kill-awards.py` | 写运行时表 `game/source-kill-award-table.ts`（生成物，勿手改）、同内容的 `public/source/csgo-12426148/economy/kill-awards.json`、字节与 SHA 回执 `game/source-kill-award-resources.json`；并做上面那条 prefab 核对 |
| `game/source-kill-award.ts` | 装载即校验（默认值与 `statted_item_base` 一致、每把武器的 award 等于它 owner 的 award、链的末位就是 owner、本作映射到的原作武器确实存在），再提供 `sourceKillAward(weapon)` |
| `game/source-gamemode.ts` | `sourceKillCash(gamemode, award)`：配置只定义基数与系数（`factor = 1`），实际发的钱是**武器自己那条 award** × 系数 |
| `game/simulation.ts` | 伤害要说明"是什么打死的"：子弹带自己的 `p.weapon`，手雷带 `'he'`（投掷者手里可能是步枪）；阵亡结算用这一条的 award |
| `tests/source-kill-awards.test.ts` | 8 条：表就是发货文件那张（15 条 prefab 行逐条）、AWP 100 而其余五把 300、手雷 300、本作自己的替身武器保留基数而不是 0 或别人的类、系数按配置缩放、**表自相矛盾时装载即拒绝**（默认值/owner/链/缺失原作/外来键/空映射六种反例）、本作映射与效应映射逐个核对、导出与生成表一致 |
| `tests/source-gamemode.test.ts` | 新增 1 条：真实 `Simulation.damage()` 里 AWP 击杀发 **100**、步枪 300、手雷 300 |

## 仍然缺的（写清楚，不当作已完成）

- **本作自己的三把替身武器**（VX-9 / FALCON DMR / FALCON P12）在原作里不存在，因此保留基数 300。原作 SMG 是 600，但这三把不是原作的 SMG，**给它们套 600 会是编出来的映射**，所以不给。
- **系数不为 1 时的行为没有发货文件可依**：两份竞技配置都是 1。端口把系数作用在"武器自己那条 award"上，与它对基数一直以来的做法一致；这个读法写进了表的 `limitations`。
- **近战与电枪的类**（1500 / 0）已随表入库，但本作还没有刀与电枪，所以只有数据、没有行为。
- **真机只到仿真层**：award 的施加由 `Simulation.damage()` 的单测钉住（AWP 100 / 步枪 300 / 手雷 300），而"钱进快照与 HUD"这条链路早已被既有的击杀验证覆盖（每次 +300）。**没有**在真实浏览器里单独采一次"AWP 击杀只加 100"的样本——房间里首局买不起 AWP，而在训练局里脚本化地一枪打死一个走动的机器人并不可靠，这一点如实记在这里而不是假装验过。
