# 原作玩家 IK 规则（握枪/踩地）

本文件记录从原作资产里**实际读出来的**玩家 IK 数据，以及它对“握手 IK 间隙”这一长期未完成项给出的结论。所有数字都可用本仓库脚本复现，没有猜测值。

## 数据在哪

| 项目 | 位置 |
| --- | --- |
| IK 链定义 | `models/player/t_animations.mdl` / `ct_animations.mdl` 的 `mstudioikchain_t` 表（`header.ik_chain_count` / `ik_chain_offset`） |
| IK 规则 | 各动画的描述符（`mstudioanimdesc_t`）的 `ikrule_count` / `ikrule_index`；玩家动画的规则**不在 .mdl 里**，而在 `.ani` 动画块的 `animblockikruleindex` 处，走 `_resolve_ani_file()` 读 |
| 记录布局 | `mstudioikrule_t`（公开 Source SDK 2013 `studio.h`），**152 字节** |
| 导出脚本 | `scripts/export-source-ik-rules.py` → `research/source-ik-rules.json` |
| 入库脚本 | `scripts/stage-source-ik-rules.py` → `public/source/csgo-12426148/ik/ik-rules.json` |
| 运行时解析 | `game/source-ik-rules.ts`，测试 `tests/source-ik-rules.test.ts` |

152 字节这个布局不是假设：导出时对**每一条**规则都要求记录自带的 `index` 字段等于它在块内的位置（或为未设置的 0），536 个带规则描述符全部通过；`compressedikerrorindex` 也全部落在合理范围（4 条规则的块在 `@rifle_reload` 上正好读到 608 = 4×152）。

## 读到了什么

四个 IK 链，两队同名同骨：

| 链 | 骨骼（UpperArm → Forearm → Hand/Foot） |
| --- | --- |
| `rhand` | `ValveBiped.Bip01_R_UpperArm` → `R_Forearm` → `R_Hand` |
| `lhand` | `ValveBiped.Bip01_L_UpperArm` → `L_Forearm` → `L_Hand` |
| `rfoot` | `ValveBiped.Bip01_R_Thigh` → `R_Calf` → `R_Foot` |
| `lfoot` | `ValveBiped.Bip01_L_Thigh` → `L_Calf` → `L_Foot` |

规则种类与数量（每队 536 个描述符 / 1528 条规则）：

| 类型 | 条数 | 出现在哪 |
| --- | --- | --- |
| `RELEASE` | 1156 | 几乎所有序列，四个链都有；窗口多为 `[0,0,1,1]`（整段） |
| `SELF` | 350 | **只**出现在按武器区分的 `@<state>_HandPos_<weapon>` / `<state>_HandPos_<weapon>` 姿势序列上，且只作用于两条手链 |
| `GROUND` | 22 | 只作用于两条脚链，带真实的按周期窗口与 `contact` 帧 |
| `ATTACHMENT` / `WORLD` | **0** | 玩家动画模型与世界武器模型里都不存在 |

`GROUND` 规则的原数（例）：`a_RunS` 右脚 `[start .35, peak .40, tail .50, end .55]`、`contact .45`；左脚 `[.85, .90, 1, 1.05]`、`contact .95`。带 `GROUND` 的描述符共 11 个：9 个方向跑 `a_Run*` 加两个转身层 `Idle_Lower_Turn_Layer[_NoAnim]`。两队数值相近但**不是同一份数据**：CT 的 Run 窗口整体后移约 0.1 周期（`a_RunS` 右脚 `.45/.50/.55/.60`）。180 个带 `SELF` 规则的描述符**名字里全部含 `HandPos`**。两条脚链的 `height` 恒为 18、`radius` 恒为 2.5。

## 对“握枪 IK 间隙”的结论

`scripts/validate-source-world-ak.mjs` 长期记录着一个未通过的检查：角色 `weapon_hand_L` 骨骼与武器 `left_hand_attach` 附件之间的距离是 1.3~3.8 单位（`audit.json` 的 `leftGripGapMin/Max`）。上面的数据说明：

1. **原作数据里不存在把手锁到武器上的 IK 规则**。没有任何 `ATTACHMENT` 规则，`left_hand_attach` 也不会被任何规则引用；`Idle_lower` / `Idle_Upper_AK` / `Idle_Shoot_AK` 这些我们已经在播的层**连一条 IK 规则都没有**。所以那个 1~3.8 单位是原作动画自身的作者结果，不是我们漏掉的机制；按它去“补一个 IK”反而会偏离原作。
2. 武器模型自带的 `weapon_hand_L` 骨骼（未合并时的默认姿势）离 `left_hand_attach` 有 **38.8 单位**，说明该附件只是武器作者标在枪上的“左手参考点”，并不是手骨位置，不能当精度基准。
3. 真正在原作里、而我们尚未实现的机制是另外两件事：
   - **脚部 `GROUND` IK**：按原窗口把摆动脚踩到地形上（本例 `height=18`、`radius=2.5`、`contact` 帧来自原数据），平地上不动、台阶/斜坡/箱体上贴面；
   - **按武器区分的 `HandPos` 姿势层**：37 把武器 × 5 种移动状态共 185 个描述符，全部带两条手链的 `SELF` 规则与各自的烘焙 IK 误差。**这一层其实早已在用**：发货姿态数据里每个 `<state>_Upper_<weapon>` 包装的两条 auto-layer 正是 `<state>_Aim_<weapon>` + `<state>_HandPos_<weapon>`（AK：`Run_Upper_AK` → `Run_Aim_AK` + `Run_HandPos_AK`；Glock：`Idle_Upper_PISTOL` → `Idle_Aim_Pistol` + `Idle_HandPos_PISTOL`），而 `sampleSourceCharacterPose()` 对 upper 序列会递归应用 auto-layer，所以按武器摆手一直在生效——此前把它记成缺口是本仓库的第二处误诊（第一处是“握枪 IK”）。

## 现状与边界

- 已入库的数据是**发货姿态数据集真正会采样的那部分**：两队各 56 个描述符 / 190 条规则，入库时逐个描述符与 `pose-data.json` 的 `ikRules` 计数交叉核对（四个数据集各 178 条，全中）。
- `game/source-ik-rules.ts` 提供解析、按描述符取规则、取脚部地面规则，以及原窗口包络 `sourceIKWindowWeight()`（窗口可越过 1，按一个动画周期取模回绕）。
- **脚部 `GROUND` IK 已实现**：`game/source-foot-ik.ts` 用原链、原窗口/权重与原 18/2.5 数值驱动 `Bip01_*_Thigh → Calf → Foot`，只沿世界竖直方向把踩地的脚贴到脚下真实地表，平地与窗口外**零修正**，超过原台阶高即截断，不可达就拒绝而不是拉长骨头；求解器本身是标准两骨解析 IK，不是原作引擎的内部实现。接线在 `GameAssets.animateOperator()`（步枪角色系），地表查询由运行时持有的原关卡提供；真机与离线验证见 `docs/parity.md` 的“原作脚部 IK 求解恢复点”。
- **尚未实现**：`SELF` 规则搭配的烘焙 IK 误差曲线（`compressedIkError` 指向的压缩误差通道）未解码；脚部 IK 只沿世界竖直方向修正，没有墙面法向与沿墙滑动；四个原武器系共用同一段代码与规则，但真机开窗样本目前只有步枪系。
