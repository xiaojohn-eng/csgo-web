# C02 共享步态采样合同

日期：2026-09-08。状态：**共享步态、权威 Simulation、净空约束、预测重放、服务器历史、快照、时间插值和腿部命中体已接入并通过 CPU 回归。** 渲染侧 `FalconCombatPose/assets/runtime/scene` 由根代理独立接入，其原作骨骼读回和浏览器观感验收由根代理记录；本文不把 CPU 结果等同于实际画面验收。实际 C02 数值收据见 `output/tests/locomotion/validation.json`。

## 为什么必须共用这一份采样

改动前 `FalconCombatPose.apply` 每帧取得原动作中的脚矩阵，再通过 IK 保持这些脚的位置；`falconBodyReferences` 从固定 Idle0 脚锚点重建腿部命中球链。现在二者通过公共完整参考函数使用同一踝、膝、髋和骨盆下降目标。只在可见腿部加正弦摆动会使命中位置与画面分离。

C02 左腿实测大腿/小腿长度分别为 0.3990349433 / 0.3966890300 米，站立时几乎完全伸直。把脚直接向前后移 20–40 厘米而不移动髋部会超出可达半径。因此 `sampleFootTargets` 同时返回左右踝/膝/髋目标和 `pelvisDrop`。可见骨盆、权威头/眼/身体参考必须一起应用这一下沉；不能仅在渲染侧使用。

## API 与最少状态

```ts
type LocomotionState = {
  stridePhase: number;  // 不取模的累计周期；出生时 0
  strideWeight: number; // 0..1；出生时 0
  strideSpeed: number;  // 平滑的可接受水平速度；出生时 0，m/s
};

advanceLocomotion(state, acceptedSpeed, fixedDt, grounded, crouchBlend)
sampleFootTargets(state, {
  direction: { x: strideX, z: strideZ }, // actor-local，+X右、-Z前
  crouch: crouchBlend,
  grounded,
  pelvisShift, // 原有站姿/俯仰 shift，尚未加入步态下沉
})
```

`Player` 已增加上述三个数值和 `strideX/strideZ` 共五个字段。类型可选以兼容旧 fixture；`readLocomotion(p)` 在任一核心时钟字段缺少时返回完整 Idle0（0/0/0/0/-1），现行 Simulation 始终写入完整字段。这些字段不属于客户端 `Input`：由服务器接受的位移/方向决定，预测端使用同一固定步逻辑。历史也保存现有 `grounded`、`stancePhase`、`yaw/pitch`。

- 玩家出生/新回合：`stridePhase=0, strideWeight=0, strideSpeed=0, strideX=0, strideZ=-1`。控制权转移/断线恢复保留整组状态。
- 移动时取净空后实际位移沿控制器候选方向的接受进度，限制为不超过候选距离；速度还受碰撞法线去除后的实际速度限制。该规则排除静止墙体去穿透和 Rapier contact skin 周期性毫米回退，防止靠墙重新迈步。局部方向由接受位移转为 `x=cos(yaw)*vx-sin(yaw)*vz`、`z=sin(yaw)*vx+cos(yaw)*vz` 后归一化。没有用 WASD 或 wish speed 驱动脚步。
- 速度低于 0.03 m/s 后保留最近一次有效方向，冻结相位；权重和速度用指数包络归零，脚目标连续回中。对静止玩家不要每帧用零向量覆盖方向。零方向在采样器中只有确定性前向回退，不携带隐藏历史。
- 空中冻结相位、衰减步态权重并令两脚接地标记均为 false；不伪造空中踏步。这里未加入独立跳跃/落地动作。
- `advanceLocomotion` 接受 `0 <= dt <= 0.25`，超过范围抛出 `RangeError`；宿主必须保留固定步累加器，不能把长渲染帧直接传入。非法数值不会进入网络状态。
- 速度按当前项目站立 4.8 m/s、全蹲 2.1 m/s 上限插值限制。`crouchBlend` 必须是 `characterBlend(p)`，不是二次 `smoothstep`，也不是单纯 `p.crouch` 的布尔跳变。

返回 `left/right` 的 `position` 是**踝骨 actor-space 绝对坐标**，不是世界坐标、脚底位置或局部增量；`offset` 是相对冻结 Idle0 踝锚点的增量。`hip/knee/upperLength/lowerLength` 可供权威重建和数值比对。脚底接地对应 `offset.y=0`，踝骨本身约位于根上方 0.101624 米。`pelvisDrop` 是正数，代表从现有骨盆平移的 Y 再减去该值。

## 轨迹、植足与相位

每只脚有支撑相和摆动相，右脚比左脚提前半周期。支撑相保持抬脚高度为零，在 actor-local 沿移动反方向作线性扫动；摆动相用三次 Hermite 回程和 `sin²` 抬脚。Hermite 端点速度与支撑扫动一致，避免落脚时水平速度跳变。蹲行使用较长支撑占比和较低抬脚高度；跑动允许短暂双脚无接地的周期区间。

稳定速度/方向且 `strideWeight=1` 时，半步幅为 `speed * duty / (2 * cadence)`，支撑脚局部速度恰好等于根速度的反向量。因此前进、后退、左右和斜向稳定移动都能抵消根平移；CPU 测试直接累加世界根位移验证足部不滑动。

**植足边界必须保留：** 五字段周期合同不存世界脚锚点，起停包络、急转、被障碍推挤、方向变化或速度突变时不保证严格世界植足。停止阶段是连续回中，不是完整的收步动作。需要任意运动下绝对植足时，后续应把每脚 touchdown 世界锚点、触地地面与摆动落点一起加入权威状态和回溯；不能在客户端私自加缓存脚锚点。高速横移的交叉步观感也需实际骨骼录像审核。

相位只在 `sampleFootTargets` 内取小数部分。网络始终传递未取模的累计周期，例如 `0.99 → 1.03`，中点是 `1.01`；不能把它存成 `0.99 → 0.03` 再普通插值，更不能在丢包跨过半周期后使用“最短环差”猜测走了几步。重生/换人/传送沿用现有离散重置边界。`strideWeight/strideSpeed` 可普通线性插值；方向应用 `atan2` 角度的最短圆弧插值，180°反转固定选择同一侧，不直接线性插值两反向单位向量。

## 原腿长与权威形状

采样器不缩放或拉长任何腿段。根据原始腿长及两个踝目标计算可达的最大髋高度，再取两腿需要的最大下沉量；最大允许 0.18 米。输出膝点由相同两段长度和当前 C02 膝朝前/略外侧的 pole 求解。不可达或无效状态抛错，不悄悄拉长腿。

`pelvisDrop` 不改变 `Player.y` 或物理根胶囊的地面高度。可先保留现有根胶囊高度作为保守移动包络，但细分头/腿命中体、眼/枪口参考、姿态墙体净空必须采用下沉后的姿态。不能同时下调 root.y 和骨盆，也不能在 `falconPoseReferences` 与 `FalconCombatPose` 中重复减一次。

模块没有 Three、Rapier、渲染时钟、全局随机数或可变缓存。`falcon-body-reference.ts` 的独立 knee solver 已移除；髋、膝、踝只从本采样器取得。该文件保留 Idle0 原始骨段向量用于蒙皮附属物的旋转映射，实际运动中的骨点以采样器为准。

## 完整公共参考 API（已实现）

```ts
const refs = characterReferences(playerOrHistoricalPose);
refs.head; refs.eye; refs.chest; // 世界坐标
refs.pelvisShift; // actor Vec3，已包含步态下沉，不能再扣一次
refs.pelvisDrop;  // 正数，额外下沉的诊断值
refs.feet.left; refs.feet.right; // FootTarget，actor 坐标，不含 glTF PI 旋转
```

渲染层可直接调用 `falconCompleteReferences({yaw,pitch,blend,origin,...stride,grounded})`，`blend` 是已经 easing 一次的 crouchBlend，`origin` 是 actor 根世界位置。该函数在 `falcon-body-reference.ts`；`characterReferences` 是 Player/旧 fixture 适配入口。`falconBodyReferences(input, refs?)` 与 `falconBodyHitVolumes(input, refs?)` 可复用同一结果；`characterHitVolumes` 已复用一次采样，头与整个身体球链不会重复求解脚轨迹。

渲染的精确顺序：restore 原 pose → 采样原 Idle/Fire/Reload → 调用完整参考 → 保留原脚旋转，用 `feet[side].position` 经 actor yaw + root 平移替换脚矩阵位置 → 应用 `pelvisShift` 一次 → 原长度两骨 IK → 上身/手/枪接触。本地 `visual` 必须覆盖预测 Player 的五字段与 grounded；远端直接读 `RemoteTimeline` 结果。`assets.ts` 传这些字段进入 `CombatPoseInput`，不能重新生成动画时钟。

净空事务先推算候选 gait，完整采样扫掠（包括相位/权重/速度/方向）后接受；修正降低实际进度时从原 tick 状态重算，最多三次修正，每次重新验证完整姿态。拒绝或不收敛时恢复原根/视角/步态/grounded。不会在最终净空检查后悄悄改变脚或头高。增加中间采样触发 Rapier 在根恰好贴地时的 GJK 法线翻转；对水平 Cuboid 使用其真实顶面与 feet.y ±25 mm 几何复核，屋顶、斜面和深穿透不会当作支撑忽略。

独立审阅随后以实际 C02 靴子顶点确认：移动脚可超出旧 root/head/eye 包络并穿薄墙（前进最深 118 mm，横移 132 mm）。已把移动下肢纳入同一权威净空：每条腿增加 hip→knee 半径 0.16 m、knee→ankle 半径 0.16 m、靴子 heel→toe 半径 0.101 m 三个保守胶囊，中心和朝向从同一公共脚目标生成；`strideWeight > 1e-6` 时参与所有候选/纠偏查询。靴胶囊端点为 actor `(±.1415,.055,.031)` / `(±.1415,.055,-.105)` 加采样 offset。这里只是移动障碍包络，细部命中球链没有变粗，未把腿重新塞进根胶囊，也未在画面侧单独缩短步幅。每个候选最多增加六个 shape query，而不是查询几十个部位命中球。

新增前进/横移各 100 帧持续逼近薄墙的回归，在每帧对原靴子命中球直接做 Rapier contact 检查，穿透均低于 2 mm。原“夹住已迈出腿”的窄通道 fixture 实际已经非法，改用完整合法站姿验证 blocked 恢复；初始非法仍明确返回 unresolved。长期贴墙时 Rapier 可以消耗接触余量产生毫米级真实根位移；允许这种小进度推进少量 phase，静止根不会原地跑，松开输入后 phase 冻结、脚连续回中。

## 集成调用点与所有权

以下权威/合同调用点已完成；运行时四文件由根代理接入。行号是本轮读取时的定位提示，以函数名为准。

| 文件/位置 | 已实现合同 / 渲染交接要求 |
| --- | --- |
| `game/types.ts:114`，`Player` | 新增五个步态字段。不要加入 `Input` 的允许字段；客户端无法直接指定步态相位或脚位置。 |
| `game/simulation.ts:130`，`addPlayer`；`:191`，`spawn`；`:225`，`transferControl` | 初次初始化/出生重置；原席位控制转移保留。 |
| `game/simulation.ts:347`，`move`，位移/碰撞完成附近 `:429`，净空处理 `:431` | 保存 tick 开始步态。先得到候选实际水平位移，再推进步态并把候选完整姿态交给 `resolvePoseMotion`。若该姿态被拒绝，恢复对应旧步态；若净空纠偏明显改变位移，要重算步态并再次做有界净空检查。不能在最终净空检查后才改变步态并抬起头/眼。 |
| `game/pose-clearance.ts:5/12`，`ClearancePose` / `clearancePose` | 显式 pick/投影现已包含五个步态字段及 grounded。 |
| `game/pose-clearance.ts:94–105`，扫掠采样与 blocked 返回 | 扫掠插值应包含未取模相位、速度、权重和方向；采样数量除位移/转角/蹲姿外应考虑相位变化，检查足步引起的头部下沉/回升路径。blocked 状态恢复一致，不能留下一半新的步态。 |
| `game/simulation.ts:90`，history 类型；`:631`，history.push | 显式保存五个字段和 grounded，否则当前击中和延迟回溯击中会使用不同腿位置。 |
| `game/simulation.ts`，snapshot | 对象展开保留字段已用运行中 Simulation 测试断言；真实 wire payload 属于 LAN 集成验证。 |
| `game/pose-timeline.ts:3/10/40`，NetworkPose / interpolatePose / samplePoseFrame | 加入历史字段，使用未取模相位插值；与远端播放和服务器回溯共用同一实现，保留死亡/传送/换队不跨越的旧边界。 |
| `game/runtime.ts:361/364/636`，预测复制与输入重放 | 复制完整步态后重放同一个 `Simulation.move`，禁止另建前端步态时钟。 |
| `game/runtime.ts`，本地 visual 对象 | 根代理接入：连同预测的五个步态字段、grounded 一起覆盖。 |
| `game/character-contract.ts:18/26/34`，CharacterPose / characterReferences / characterHitVolumes | 扩展姿态字段。先算原站姿参考和 pelvisShift，再采样脚目标，把 `pelvisDrop` 同时减到 eye/head/chest；把同一脚采样结果传给身体命中体。 |
| `game/falcon-body-reference.ts:40/44`，falconBodyReferences | 用采样输出的 hip/knee/ankle 取代固定 ankle；现有 `attached` / `rotateCalf` 继续从新腿方向重建。torso/pelvis 的 transform 也要减 pelvisDrop；脚球链须跟随同一 ankle。 |
| `game/assets.ts:229`，animateFalcon → sampleFalconCombatPose | 传入服务器或插值 Player 的完整步态，不能读取 `state.idleTime` 作为步态相位。原 Idle/Fire/Reload 上半身采样继续保留。 |
| `game/falcon-combat-pose.ts:3/129/144/146`，CombatPoseInput / apply | 扩展入参；保留原脚旋转但用公共 absolute ankle 目标替换捕获脚位置；actor-local 目标转世界时只应用 root yaw/translation，勿再次应用 glTF 的 PI 导入旋转。在既有 pelvis shift 基础上减 pelvisDrop，再用原骨长做两段 IK；其后手臂/枪肩求解与护膝维护保持当前顺序。 |
| `game/falcon-combat-pose.ts:179`，sampleFalconCombatPose | 保持 restore → 原始 clip/time 采样 → 公共姿态层的顺序，避免叠加变换。新增 sampler 本身没有累积姿态。 |

已建立上述 `falconCompleteReferences/characterReferences`。依赖关系为 `character-contract → body-reference → locomotion`，原始 `head-reference` 保持基础层，没有循环依赖。

## 测试和实际 C02 数值证据

先用未实现接口运行 **23 个模块测试全部失败**，完成模块后全部通过；集成前 **7 个集成测试全部失败**，落地后通过，并补充历史脚射线与输入拒绝/180°方向边界用例。薄墙缺口新增两项测试先失败，再加共享下肢碰撞包络后通过。本轮相关集共 **9 个测试文件 / 115 项**：locomotion、locomotion-integration、pose-clearance、pose-timeline、body-volumes、character-scale、stance、simulation、handling。`npm run typecheck` 通过，所改文件 `oxlint` 无诊断。

新增 CPU 用例验证：固定 tick 重放、输入不变、相位跨整数连续、停止回中、空中冻结、速度上限、异常数值、Idle0 锚点、五方向稳定支撑植足、左右半周期互补、蹲行抬脚/支撑差异、实际 C02 腿长保持、墙体长期压住无原地步、完整快照/历史字段、预测与权威一致、拒绝整组恢复。`Simulation.shoot` 同射线在历史中击中迈出的靴子，在当前 Idle0 脚位置落空，证明服务器 rewind 真正消费历史 gait。

另在 Node 内存中加载实际 C02 GLB，仅去除图像/材质 I/O，保留原骨架、动画、权重和几何，并采样 Rifle_Idle t=0 测量骨长；没有修改资产文件。

| 项目 | 实测 |
| --- | --- |
| C02 SHA-256 | `a541aeb26e0e6154830e23f2f6c3c978e54b0209f0e930564bb5f43545adfa2a` |
| 枚举 | 9 个蹲姿 × 7 个俯仰 × 6 个速度 × 8 个方向 × 64 个相位 = **193,536** |
| 最大额外骨盆下沉 | 0.1258531342 m |
| 最大足部水平偏移 | 0.4389656273 m |
| 最大抬脚 | 0.1225632048 m |
| 最坏腿长剩余可达余量 | **1.515 mm**，没有超伸 |
| 模块腿长与原 GLB 的最大差值 | 6.98e-10 m |
| 模块髋锚与原 GLB 的最大差值 | 5.43e-10 m |
| 本机该 CPU 枚举平均耗时 | 约 1.36 µs/样本，含测试循环与外部姿态计算；不是游戏 FPS 或跨设备性能承诺 |

## 接入后的验收门槛

1. 在真实 C02 的 Idle/Fire/Reload 多个时刻逐步态相位采样，读回左右髋/膝/踝世界位置，与同 tick `characterHitVolumes` 的腿链逐项对齐；所有骨段长度不变。
2. 服务器回溯和 RemoteTimeline 在整数相位边界、丢包跨周期、急停反向、蹲站转换、重生/接管后仍返回相同脚目标。攻击者客户端提交 stride 字段不能覆盖服务器结果。
3. 真实两设备对看前进、后退、左右和斜向走/跑/蹲行；检查脚滑、膝反折、腿交叉、护膝穿透、手/枪肩接触和本地镜头高度。只有 CPU 可达性不代表这些观感通过。
4. 楼梯、斜面、地面高差和移动平台需要额外权威地面采样/脚锚合同；当前是平面周期步态，不能宣称有地形贴足。空中动作、落地缓冲和停止收步仍需独立动作层。
5. 保留现有头/眼墙体净空、低顶、历史命中和原枪械动作回归。在净空受限处允许共同冻结/调整步态，禁止渲染端单独降低头或移动脚来隐藏穿透。

达到这些画面/骨骼门槛前，应写“权威共享步态已接入并通过 CPU 回归，实际骨骼/观感待验收”，不能写“角色完整动作已实现”或“CS:GO 动作已还原”。
