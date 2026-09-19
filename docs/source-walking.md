# 原 App740 IN_SPEED 步行与地面支持修复

本轮已将原普通 AK47/M4A4 的步行判定、站姿加速与准确度状态接入共享 Simulation 和客户端重演。Shift 是请求；网络保存的 `sourceWalking` 是原 `m_bIsWalking` 判定结果，两者不可等同。另修复 Rapier 地面接触累计下沉导致蹲后无法站起的问题；未修改地图碰撞数据、步高、坡度、snap 距离或落地取样时序。

版本为 `SOURCE_WALKING_VERSION = csgo-walking-12426148-r1` 与 `SOURCE_PLAYER_MOVEMENT_VERSION = csgo-player-movement-12426148-r2`，分别由 `game/source-walking.ts`、`game/source-player-movement.ts` 导出。调用方必须将两者纳入 Source `simulationVersion`；BSP/碰撞 SHA 相同不足以兼容不同移动算法。

## 原指令证据

原始文件为本机完整安装 App740 build 12426148 的 `csgo/bin/server.so`，SHA256：

`7de235c31b2d645c5106cbd7358da3f3ac7964e87f870c4fe6ea31d93a714386`。

可重复脚本 `scripts/probe-source-walking.py` 使用 ELF32 映射和 Unicorn，执行原指令，不调用本项目 TypeScript 计算预期值。报告为 `output/tests/source-walking-native.json`。指令、字段与普通分支适配边界同时保留于脚本。

| 分支 | 原入口及字段 | 本次样本 |
| --- | --- | ---: |
| CheckParameters 步行判定 | `0xba26f4` 开始；IN_SPEED 分支 `0xba2c8d`；状态 `player+0x16a9` | 512 |
| 普通站姿 rifle Accelerate | `0xba1330`，通过最终速度写入 `0xba1bd5`，停于后续副作用之前 | 1296 |
| 步行判定后 GetInaccuracy | 完整原 getter `0xd3ff60` 读取刚写入的 walking 状态 | 64 |

512 个 gate 样本覆盖两枪、水平/垂直速度、此前 flag、按键开关与四种 duck 条件。1296 个加速样本覆盖两枪、9 个速度、正向/反向/斜向、4 个 dt、3 个 surface friction 及 Shift 开关。上述 gate、速度分量与准确度在专项测试中逐值严格相等，无 epsilon 放宽。

原 IN_SPEED 检查为 `0x20000`。固定官方 [Source SDK 2013 in_buttons.h](https://raw.githubusercontent.com/ValveSoftware/source-sdk-2013/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/src/game/shared/in_buttons.h) 中 IN_SPEED 是 `1 << 17`，另有不同的 IN_WALK `1 << 18`；本实现没有混用这两个标志。

## 真实状态与单位

`sourceWalkingGate()` 的输入速度是原 **m_vecVelocity 的三维长度**，单位 Source units/s；不是准确度 getter 使用的水平 m_vecAbsVelocity。原 DataMap 分别确认 m_vecVelocity 在 `player+0x1fc`，m_vecAbsVelocity 在 `player+0x184`。

普通非 duck 请求按以下原逻辑处理：

1. IN_DUCK 请求、ducking 或 ducked 任一成立，清 walking，保留正常武器 wish 上限。
2. 未按 IN_SPEED，同样清 walking。
3. 按 IN_SPEED 且 3D 速度 **严格小于** `f32(maxSpeed * f32(.52)) + 25`，置 walking，wish 上限裁到 `.52`。
4. 达到或超过阈值时，保留此前 walking flag，wish 上限保持正常值。原 ground Accelerate 独立读取 IN_SPEED，通过加速尾端衰减与地面摩擦使角色减速；不能直接把速度改成 `.52`。

原 `.52` float32 是 `0.5199999809265137`。AK 理论裁剪上限为 `111.79999542236328 u/s`，M4 为 `117 u/s`。真实坡面经 KCC 后的速度不必等于这个平面 wish 上限。

`sourceRifleGroundAccelerate()` 接收 **地面摩擦之后** 的速度，执行普通站姿 rifle 原 arithmetic。正常跑动 acceleration speed 为 `max(250,wishSpeed) * min(weaponSpeed/250,1)`；IN_SPEED 为 `max(250,wishSpeed) * .52`，并按当前方向投影在 `.52` 武器上限前 5u 区间逐渐减小 acceleration coefficient。所有重要中间值保留原 float32 运算次序。

在 64Hz 从静止开始：原 AK 跑动第一步 `18.4765625 u/s`，步行 `11.171875 u/s`。原 200u/s 同向高速按 Shift 的 Accelerate 不会增加速度；减速由先前地面摩擦完成。站起当帧 gate 仍能因为先前 ducked 而为 false，但更新后的站姿 Accelerate 必须读取原 IN_SPEED；故不能以 `gate.walkRequested` 替代原按钮。

准确度 getter 在 `0xd401a8` 读取实际 walking：walking 使用线性归一化移动比例；未 walking 使用两次平方根。不能把按钮一按就提前获得准确度收益。

## 共享接入与重演

- `Input.walk?: boolean` 是客户端可发送的按钮，缺失默认为 false； supplied 非 boolean 被校验拒绝。客户端不能通过 input 覆盖 `sourceWalking` 或 handling state。
- `runtime.input()` 采样左右 Shift；暂停或按键释放后 false。线上预测视觉 Player 合并同一个 predicted.sourceWalking；HUD spread 原本就直接读取 predicted player。
- `Player.sourceWalking` 由 movement 输出，出生重置 false，作为 snapshot 普通字段传输并经 JSON 恢复；保持每 actor 独立。
- `Simulation.moveSource()` 在 movement 后写入实际 walking，然后更新 weapon accuracy。原时序仍为 punch tick → 初始地面分类/落地速度取样 → KCC → OnLand → weapon accuracy → accepted shot。
- 原 bullet seed 仍由服务端管理；本次无新的 RNG、客户端命中射线或伤害预测。

## 地面累计下沉：红绿证据

新增长时测试先复现：100m 平面上持续 crouch 移动，脚底降至 `-0.04770293943m`，站起被本应支持脚底的 floor collider 拒绝。无 Shift 跑动对照也出现下沉，排除了“只有步行 gate 才引入”的判断。原失败日志为 `output/source-walking-stand-debug.log` 与 `output/source-movement-floor-red.log`。

根因是 Rapier 近接触 GJK/snap 数值：snap 可反复产生微小向下平移，接近水平面的 GJK normal 偶尔倾斜，也会不当地裁掉水平速度。尝试禁用 snap 不是最终修复；当前仍保留原 autostep/snap 配置。

修复限制在两个经过实物查询的处理：

1. 对 standable KCC normal，在该碰撞的 **同一个 collider、原 witness 附近** 反向射线查询真实 facet；只有返回精确水平 `(0,1,0)` 且接触距离在原 offset 以内，才以该真实法线替换近接触 normal。没有中心射线替代全脚底支持，也没有忽略墙面。
2. 最终原全 AABB support 后，如该支持面的 `contactShape` 实测负距离超过既有 penetrationTolerance，按其真实 normal 计算恢复高度；候选再次经过完整全 AABB blockers。通过才采用，失败恢复前一合法移动基准，不将角色推入屋顶或邻墙。

仍保持碰撞 offset `0.00079375m`、support probe `0.0508m`、18u 步高、原 standable normal 与已有严格 penetrationTolerance；没有放宽穿透阈值或屏蔽 floor。新增极低顶测试只余 `0.00005m` 高度，恢复不得穿透顶/底，松开 crouch 仍正确拒绝站起。

## 验证与复跑

专项命令：

```sh
.tools/source-binary-venv/bin/python scripts/probe-source-walking.py
npx vitest run tests/source-walking.test.ts tests/source-walking-input.test.ts tests/source-player-movement.test.ts tests/source-simulation.test.ts tests/input-retention.test.ts tests/source-landing.test.ts tests/source-accuracy.test.ts tests/source-aim.test.ts
npx tsc --noEmit
npx tsx scripts/source-player-movement-smoke.ts --corrected --output output/tests/source-player-movement-walking.json
npx tsx scripts/probe-source-ct-ramp.ts --corrected --output output/tests/source-ct-ramp-walking.json
npx tsx scripts/source-walking-smoke.ts
```

专项 8 套件 **56/56**，包括步行、跑动中按 Shift、duck 排除、松开 Shift、左右键/暂停采样、完整 JSON 重演、持续地面行走与低顶恢复。native 私有样本不存在时相关 oracle 测试会显式 skip；本次本机原样本存在，全部运行。完整类型检查 exit 0。

真实地图始终使用已校正 collision SHA256：

`55184f994bc852dc229bbed0cb772cb843b1bc662054013c5076df98ce2a43cb`。

- `source-player-movement-walking.json`：30 个原出生点 × 两姿态，共 60 个落地；5 条原路线 × 两姿态可达，已知不可达 B 目标仍被原 brush 846 阻挡；原斜边 playerclip、低顶拒站、持有 jump 不连跳均通过，最大实测穿透 0。
- `source-ct-ramp-walking.json`：原 LAN 卡住状态的 CT 坡道，48 tick 站姿 W 前进 `2.58845699945m`，蹲姿 `0.52155017746m`；没有移除原 ladder 或真实碰撞。
- `source-walking-dust2.json`：原 long approach 起点，330 tick 依次静止、跑动、Shift、蹲、松开站起；终态为 standing + walking，蹲段 walking=false。全 AABB 最大穿透 0，另一个独立 World 从第 150 tick 的 JSON 快照重演 179 条命令，feet/walking/fall/handling 全部严格相等。

CPU 项仅计一角色 movement + world.step，完整原 Dust2 colliders，最终源码 7422 次样本：mean `0.195582ms`、p50 `0.183250ms`、p95 `0.266333ms`、p99 `0.410333ms`、max `6.056709ms`；报告源码 SHA 已与本次最终 movement 文件回读一致。它不等于十人服务端预算、网络同步或浏览器 FPS。所有独立 World 正常释放，无 WASM borrow 错误。

边界仍明确：Rapier 几何响应不是原 Source 全移动函数逐帧同值验证；air control 使用此前固定官方 SDK 部分；未实现水、梯子、移动基底、scoped/stamina/重甲/hostage/ExoJump/encumbrance 分支或原渐进 duck 状态机。本轮原生 walking/站姿加速 oracle 不能扩称这些分支已还原。构建、实际双浏览器 Shift 长走/蹲站与 LAN 体验由根代理统一验收，本子任务未操作浏览器或端口。
