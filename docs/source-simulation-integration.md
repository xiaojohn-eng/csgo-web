# SourceScenario 接入范围与风险（原接入前评估）

> **2026-09-09 PHY 坐标纠正**：本文件早期 `dust2/collision/` 的世界/道具 PHY 验收已被后续真实 LAN 复现推翻：SourceIO 交换 IVP Y/Z 后遗漏符号，导致原 Source Z 反射。BSP brush/displacement/trigger 数据未受此错误影响。修正版及新完整回归见 [source-physics-axis-correction.md](source-physics-axis-correction.md)（research 内相对路径为 `../docs/source-physics-axis-correction.md`）；旧数据与结果保留为问题证据，不能继续当当前物理几何正确性证明。

本文保留接入前的风险评估；最新已实施接口、测试和边界见 `docs/source-simulation.md`。下述旧行号只用于定位当时问题，不是当前源码状态。

建议第三参使用可选 `SourceScenario`，让 caller 先异步加载 `{level, collision, navigation}` 的大 JSON，再同步构建 Simulation 内的 SourceLevel。JSON 可在训练、预测、服务器之间共享只读数据，但每个 Simulation 必须创建自己 world 中的 colliders/KCC；不能把某个训练 world 的 SourceLevel 实例传给另一 prediction world。构造错误需释放已创建的 world/controller；顺序为 controller.dispose、level.dispose、world.free。

## 可独占交付的 Simulation 变更

可由一个 owner 独占 `simulation.ts` 完成以下范围，同时保留无 scenario 时的现有 M01 分支：

1. 构造时 Source world 重力、真实碰撞角色 groups、level/NAV 身份核验，替换 BOXES world 构造；actor 创建/重生使用原 32×32×72u AABB 和原 15+15 个 spawn，完整 AABB 落地。不能继续 `%5` 只选五出生或让全部角色由 (0,0,0) 进入地图。
2. Source 的 `move` 作为完整单独分支，调用新控制器；输入适配 `forward=-mz,right=mx`，把 caller 原武器 maxspeed 传入。跳键 previous state 必须纳入权威/预测状态契约，重生/控制权转移/输入清空有明确规则。
3. Source 分支完全不进入 M01 capsule、BOXES support、`usesFlatStairStance` 或 C02 完整脚/头约束事务。这些事务按另一个角色几何制定，不能对原 Source hull 再额外压窄原通道。角色动画由实际 accepted 位移驱动；不能把视觉脚伸出 hull 倒过来当作 Source 玩家引擎碰撞。
4. 射线/视线/炸弹使用实例级 SourceLevel。Source 投掷物动态 collider 必须使用 projectile groups；playerclip 不能挡子弹，trigger 不能做实墙；Source GLB 不参与权威碰撞补齐。
5. AI 路线改用原 NAV 的带高度、area ID、transition kind 的 waypoints。现有 `ai.path:{x,z}[]` 和仅按 XZ 距离 pop 会在楼层重叠处跳过路径，需要升级内部结构，并用碰撞执行结果识别阻挡。NAV graph path 不等于可行物理步行；梯子未实现时应 `allowLadders:false`，无法完成的原连接不能用矩形网格替代。
6. Bomb A/B 使用原 trigger 区域；`SITES` 的 M01矩形、默认爆炸/AI目标点不能混入 Source。站/蹲 hull 与 trigger 的交叠规则须统一用 `sitesForSourcePlayer`，与视觉 A/B 标识及房间 mapId 同一绑定。

当前 `world.step()` 位于主循环后，符合新模块“只 stage body，caller 每 tick 步进一次”的接口。但 prediction reconciliation 在 `runtime.ts` 连续调用 `prediction.move`、最后仅 world.step 一次；body/collider 必须每个输入先同步已恢复状态，新控制器已执行该同步。previous jump latch 仍需一起回滚，不能只复制 Player 而漏掉闭包 state。

## 必须联合接入的 SourceContract

仅替换地图碰撞与相机 eye 会留下实际射线/可见性错误。建议一个纯数据/函数 SourceContract 描述：

- `id/sourceHash`、meters/unit、standing/crouching hull/eye 和 stance 语义。
- `eyeOrigin(p)`、`hitVolumesOrBoxes(sampledPose)`、网络历史中重建原角色姿态所需离散/连续字段。
- 原武器 maxspeed 查表；不把地图配置携带进客户端 Input 更改权威参数。
- 角色根脚点坐标始终原地图米制，不把脚/头动画偏移反写 root。

`source-character-pose.ts` 已为纯模块并提供实际骨矩阵/原 hitbox metadata，是可复用基础。但本轮 metadata 的 hitbox extension 仍标未解释原字节；不能把它猜作 capsule radius，再声称精确 hitbox。等待相关 owner 的原字段/动画语义验收后，由同一 contract 在服务器与客户端计算。Source hull 是移动边界，不自动等于原命中体。

需跨文件同批修正的实际使用点：

| 当前点 | 风险 / 所需适配 |
|---|---|
| `simulation.ts:439` `Math.max(0,p.y+mv.y)`；441 的 `p.y<.025` | CT 真正负高度会被抬到世界零平面，并被错误强制 grounded。Source 分支必须完全绕过。 |
| `simulation.ts:382` BOXES 台阶与 436 地面接触时直接用 dx/dz | 原地图墙/坡不满足 M01 假设；必须完全采用真实 KCC accepted movement。 |
| `simulation.ts:746` eyeOrigin + map.wallDistance；762 的 C02 hit volumes | 自己射线起点/地图墙/回溯目标头部将来自三套不一致几何。全部从场景 SourceContract/Level 提供。 |
| `simulation.ts:695` history + `pose-timeline.ts` | 需保存 Source stance、jump latch（用于预测）及原动画 pose/cycle（用于回溯）。瞬时 AABB stance 不可直接被旧 stancePhase 插值成未定义 Source hull。历史跨死亡/重生保护必须保留。 |
| `runtime.ts:257,354` Simulation 创建 | 训练和 LAN prediction 必须使用与房间协商同版本 scenario，加载成功后才启输入；不能训练 Source、预测 M01。 |
| `runtime.ts:650,694,732` 本地枪口、声音listener、事件视线 | 原 eye 与 source wall/sight 要同一实例源。相机改64u并不会自动修好这些路径。 |
| `server/visibility.ts:1–2,14–18` | 仍直接导入 C02 eyeHeight、M01 sight 和0.95/1.4目标高度。需接收 sim 的 SourceContract/Level 查询，避免客户端穿墙显示或服务器错误隐藏。PVS是绘制候选优化，不能替代按角色 mask 的射线。 |
| `game/tactics.ts:43–48` flashExposure | 同样直接使用旧眼高和 M01 sight；Source 闪光穿墙判断会错，必须依赖注入。 |
| `server/index.ts` MAP_ID metadata 与 visibility 调用 | 房间真实场景/mapId/hash与客户端预加载/拒绝版本规则一致；不能只修改静态常量。 |
| `server/visibility.ts:25` 隐藏玩家 y=-100 | 原 Source world bounds 包含负高度；长期应显式可见标志，不能把任意固定高度当作整个 Source 地图的隐藏判定。 |

## 验证边界

可以先交付一个不开浏览器、不启动端口的 Source Simulation 专项：两支队伍出生不落零平面、60Hz同输入 authority/prediction一致、hold-jump reconciliation不多跳、两种stance跨低顶、原playerclip子弹/玩家差异、A/B trigger、负高度CT投掷物、NAV层级路径以及dispose。这是对 Simulation 分支的独立验收。

完整训练和 LAN 发布还必须由 root 一起接 Runtime/Scene/Server/SourceContract；当前不可将“可调用 SourceSimulation”当作完整客户端已切地图。特别是回溯头部命中、地图版本协商、服务器可见性和实际键鼠/网络回放需要真实集成证据。
