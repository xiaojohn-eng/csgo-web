# Source 玩家移动控制器（独立模块）

> **2026-09-09 PHY 坐标纠正**：本文件早期 `dust2/collision/` 的世界/道具 PHY 验收已被后续真实 LAN 复现推翻：SourceIO 交换 IVP Y/Z 后遗漏符号，导致原 Source Z 反射。BSP brush/displacement/trigger 数据未受此错误影响。修正版及新完整回归见 [source-physics-axis-correction.md](source-physics-axis-correction.md)（research 内相对路径为 `../docs/source-physics-axis-correction.md`）；旧数据与结果保留为问题证据，不能继续当当前物理几何正确性证明。

`game/source-player-movement.ts` 已可运行。本轮没有接入或修改 Simulation、Runtime、Scene、Server，也没有启动网络端口。它使用原 Source 玩家 AABB、原 Dust2 的角色碰撞分组，输出权威脚点与速度；它不是原 Source 运动求解器的逐帧等价移植。

## 接口和生命周期

```ts
const movement = createSourcePlayerMovement(world, sourceLevel);
const next = movement.step(body, collider, state, {
  forward: -input.mz, right: input.mx, yaw: input.yaw,
  jump: input.jump, crouch: input.crouch, dt: 1 / 60,
  maxSpeed: 215 * sourceLevel.metersPerSourceUnit, // caller 的武器数据
});
// 多角色全部处理后由 caller 调一次 world.step()，world.timestep 与 dt 一致。
// caller 保存 next，并在预测校正时恢复整个 state。
movement.dispose(); // 先于 world.free()；不删除 caller 的 actor
```

`state` 是 `{feet, velocity, grounded, stance, jumpHeld}`，`stance` 为 `standing | crouching`。脚点和速度均为浏览器米制、Y 向上；没有零高度地面假设。W 在 yaw=0 时朝 -Z，D 朝 +X。AABB 始终轴对齐，caller 的 body/collider 旋转被归一化；body 必须是当前 world 的 position-kinematic，collider 必须归属它。

`jumpHeld` 是每个 actor 的权威上一帧按键状态。它必须随预测基线一起恢复，不能由客户端上传任意值，也不能只藏在不随 reconciliation 回滚的闭包里。按住跳跃不会连续起跳；空中按下并持续持有也不会在落地自动触发。

输入 `maxSpeed` 是未蹲裁剪的武器速度上限，不是 M01 速度。AK 原 items 字段为 215u/s，本轮使用 5.461m/s。精确 IN_SPEED 慢走、开镜、护甲重量、体力修正未接入；不能仅把一个已乘慢走倍率的值当作已经实现完整 CS 慢走分支。

返回还包括 `eye`、`jumped`、`stanceBlocked`、`stanceBlockers`、`collisions`、`groundHandle` 和 `stepped`，用于 caller 诊断。查询使用 `sourceLevel.queryGroups('player')`，排除 sensor，正确包含 PLAYERCLIP；投掷物专用障碍不误当玩家障碍。body/collider 的 shape/transform/group 由本模块管理，world、地图和 actor 生命周期归 caller。

## 来源与算法范围

当前 App740 build 12426148 的 `server.so` SHA256：
`7de235c31b2d645c5106cbd7358da3f3ac7964e87f870c4fe6ea31d93a714386`。

此前 `scripts/probe-source-player.py` 已锁定当前 ELF 的 CCSGameRules vtable、CViewVectors 初始化和 ConVar 构造参数，证据在 `output/tests/source-player-parameters.json`。本轮不使用同安装目录较旧的 `server_i486.so` 推定当前行为。

| 项目 | 当前数据 |
|---|---|
| hull | X/Y Source 水平各 ±16u；站高 72u，蹲高 54u |
| eye | 站 64u，蹲 46u |
| 重力、台阶、跳跃冲量 | 800u/s²、18u、301.993377u/s |
| 摩擦、停止速度、地面/空中加速 | 5.2、80u/s、5.5 / 12 |
| 坡面站立法线阈值 | 0.7 |
| 速度轴向上限 | 3500u/s |

固定 [Valve SDK gamemovement.cpp](https://github.com/ValveSoftware/source-sdk-2013/blob/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/src/game/shared/gamemovement.cpp) 的 Friction、AirAccelerate、StartGravity/FinishGravity、CheckJumpButton、FinishDuck/FinishUnDuck 提供了可核对算法：地面摩擦先扣 `max(speed,80u)*5.2*dt`；空中无地面摩擦，方向投影上限 30u，增速量使用未裁到 30u 的 wishspeed；空中重力分两半步；地面 WalkMove 竖直速度置零；空中收蹲/展开保持 hull 顶部，地面保持脚点。30u 来自同 commit 的 [gamemovement.h](https://github.com/ValveSoftware/source-sdk-2013/blob/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/src/game/shared/gamemovement.h)。2u 地面探测与 `DIST_EPSILON=1/32u` 来源分别为 CategorizePosition 和 [coordsize.h](https://github.com/ValveSoftware/source-sdk-2013/blob/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/src/public/coordsize.h)。

原 SDK 默认蹲高 36u、蹲倍率 1/3 不能直接套本构建。第一轮真实运动用通用 SDK 加速公式出现了蹲行停滞：AK 蹲 wish=71.67u，每 tick 加速 6.57u，小于静摩擦 6.93u，每帧都回到近零。没有调低摩擦绕过此问题。

新增 `scripts/probe-source-movement-branches.py` 用同一 SHA 的当前 ELF 独立核对：

- RTTI `15CCSGameMovement`，vtable `0x12a2184`，slot `+0x6c` 指向 `0xba1330`。
- 普通、未开镜、未 IN_SPEED、无特殊体力/护甲修正分支先取 `max(250u,wishspeed)` 加速基准；站立乘 `min(weaponMaxSpeed/250u,1)`；全蹲乘原浮点 `0.3400000035762787`，即常规基准 85u。
- 当前蹲裁剪函数 `0xba7580` 对 forward/side/up/maxspeed 使用 `1+(.34-1)*duckFraction`；本模块的全蹲状态取 fraction=1。
- 指令地址、原字节、浮点地址和 SDK 文件 hash 留在 `output/tests/source-movement-branches.json`。这是静态分支证据，尚没有原引擎相同输入流逐帧对照。

地面/空中滑动、台阶扫掠和凸体接触由 Rapier 0.20.0 KCC 完成。地面开启 18u autostep，最小宽度为 0（没有添加 M01 的 .2m 宽度），动态物体不自动踏上；空中禁用 autostep/snap。本模块没有实现 Source TryPlayerMove 四次 bump/crease 的相同求解顺序，边缘法线、斜坡速度和轨迹误差不能宣称原引擎等价。半毫米附近接触法线会有浮点噪声；平地斜向约 0.55% 的瞬时速度差已在专项测试注明，速度不产生斜向增益。

还没有实现水、梯子、移动平台/base velocity、材质 surfaceFriction（目前 1）、渐进 CS duck 状态机、体力/疲劳、精确慢走与开镜减速。这些是接口能力边界，不影响本轮已实测的普通站立/全蹲路线结论。

## 净空与数值修复

蹲转站先对最终完整 72u AABB 查询真实碰撞，仅在无穿透时改变 stance；地面固定脚点，空中按 SDK 保持 hull 顶部。真实 sensor 不参与，合法地面接触不被当成顶棚。查询回调只收集 collider，退出回调后才调用 contactShape，避免 WASM 可变借用重入。

首轮测试发现 Rapier sub-mm 非零 `targetDistance` 的 GJK TOI 在近地面可返回约半间隙，反复把它当真实地表距离扣除会使角色下沉。修复为 targetDistance=0 的完整 hull 探测，随后保留 KCC 的 1/32u 间隙；地面 WalkMove 不再重复施加向下半重力。失败/修复证据分别保存在 `output/source1-movement-first.log`、`source1-movement-trace.log` 和后续 green 日志。

## 本轮验收

运行：

```sh
python3 scripts/probe-source-movement-branches.py
npx vitest run tests/source-player-movement.test.ts
npx tsx scripts/source-player-movement-smoke.ts
npx tsc --noEmit
```

专项 10/10 通过，覆盖摩擦和加速、无对角加速、真实 CS 全蹲基准、防按住跳跃重复、空中按键不缓冲、低顶拒站、playerclip、轴对齐、空中缩形、controller 多 actor 状态隔离与生命周期。私有 smoke 加载完整原碰撞 JSON（SHA256 `8edf9d1ecc0a27e73d10666ab976a708bdd6f7553515601f75308c54ee8c6999`），没有生成替代墙体或覆盖源数据。

- 30 原出生点 × 站/蹲 = 60 次全部落地，保留 CT 负高度。
- middle、long、A、CT 原台阶与 B 内侧目标各站/蹲均可达，共 10 次。所有轨迹逐 tick 完整 AABB 接触检查，本轮检测到的最大穿透为 0。
- 原 B 外侧目标两种 stance 都不可达，仍由原 PLAYERCLIP brush 846 阻挡，剩余约 .233m；端点完整 AABB 确实与该刷子相交。没有靠缩小 hull 宣称该点通过。
- 真低顶位置：NAV area 6476 的候选点（NAV flags=0，仅用 NAV 找采样候选），实际脚点 `(-55.5625,-0.81220965,7.62)`；原 brush 480 阻止从 54u 蹲姿展开成 72u，保持合法蹲姿，0 穿透。
- 原 brush 846 斜边产生 64 次碰撞接触，随后切向移动可离开边界，0 穿透。
- T 出生地面按住 jump 180 tick 只跳一次，第 44 tick 落地，升高 1.447453m；松开再按成功。
- 7,445 个“单 actor movement + 完整 Dust2 world.step”CPU 样本：mean .179ms、p50 .168ms、p95 .248ms、p99 .350ms、max 5.142ms。此项不包含渲染/网络，也不是 10 actor 服务器 60Hz 总预算证据。
- controller、地图和 world 正常释放，没有 WASM borrow 错误。最终 proof 在 `output/tests/source-player-movement.json`，含实现 SHA256；所有最终专测/typecheck/smoke 日志为 `output/source1-movement-final-*`。
