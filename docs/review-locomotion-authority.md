# 步态权威 / 网络接入独立审阅

2026-09-08 22:25。只读检查当前 `simulation.move`、`pose-clearance`、`readLocomotion`、body references、history / timeline、客户端输入白名单；未修改实现、未访问或启停 27015、未操控浏览器。发现时已同步 root 与 reference 实现者。

首轮审阅发现的穿墙 P2 已由实现者修复，并经下文限定独立复核关闭。后续全量 QA 的楼梯回归已采用受限平脚降级修复；CPU 基准另外暴露的出生区纠偏死锁，也已按真实 fixture 红绿修复。最新验证与 CPU 结果见末尾，历史数据保留用于说明问题来源。

## P2：移动脚超出当前净空检测范围，真实靴子及权威脚部体积穿墙

位置：发现时 `game/pose-clearance.ts` 的 `parts()` 只返回 root capsule、head sphere、eye sphere；新的 `falconBodyHitVolumes` / C02 pose 则已经让脚向这些范围之外摆动。根、头、眼合法时，`resolvePoseMotion` 可以返回 `clear`，同时脚穿进墙体。该问题不是新 support 分支把整面墙当作地板。

独立实际 Simulation + Rapier 复现，默认固定步长 1/60：

```ts
const s = new Simulation('training', false);
s.world.createCollider(RAPIER.ColliderDesc.cuboid(15, .1, 15).setTranslation(100, -.1, 100));
const p = s.addPlayer('audit', 'Audit', 'amber');
Object.assign(p, {x:100, y:.015, z:100, yaw:0, pitch:0, grounded:true});
// 正跑；横移改为 cuboid(.05,2,3) @ (103,2,100)，以及 mx:1,mz:0。
const wall = s.world.createCollider(RAPIER.ColliderDesc.cuboid(3,2,.05).setTranslation(100,2,97));
s.world.step();
for (let i=0; i<35; i++) {
  s.move(p, {...EMPTY_INPUT, seq:i+1, mx:0, mz:-1});
  s.world.step();
}
```

| 检查 | 正向跑 | 向右横移 |
| --- | --- | --- |
| 第 35 次移动后的根位置 | z=97.435 | x=102.565 |
| resolution / rootClearance | clear / true | clear / true |
| 最大权威 boot sphere 穿透 | 0.108969 m | 0.129964 m |
| 真实 C02 越过墙前表面的脚部顶点 | 329 / 1450 | 675 / 1450 |
| 最大实际顶点越界 | 0.118071 m | 0.132390 m |

此时 stridePhase=1.2934667、strideWeight=0.9990881、strideSpeed=4.7914944。对相同根位置把 strideWeight / strideSpeed 设为 0，原来的六个 boot sphere 全部不接触墙，确认是新增摆脚范围引入。真实顶点使用当前 `GameAssets.operator(p)`、真实冻结 C02，按 Foot/Toe 骨累计权重 ≥0.5 选取；不是只凭代理球推测视觉问题。

建议：让共享净空 sweep 包含实际移动的下肢/脚部轨迹，并保留严格的地面支撑例外；对被拒绝的腿部候选继续恢复完整原姿态。不得只缩小脚的命中体积或只让渲染脚退回 Idle。reference 接收精确 fixture 后实施了修复，独立关闭记录见末尾。

原始读回：`output/tests/locomotion-authority-review.json`，包含完整 Player、resolution、实际脚顶点和碰撞数值。

## 未发现另外的 P1/P2

- `readLocomotion` 对缺少 phase / weight / speed 的旧 pose 整体回到中立步态；完整状态校验有限数值和范围，方向被归一化，零方向回到 -Z。当前 authority 的新建、spawn、每次 move 都写入全五字段。
- 对 134,784 个合法 stance / pitch / phase / direction 网格组合直接调用完整权威参考，无 RangeError；网格内最大 pelvisDrop=0.1268191 m。没有发现合法方向组合导致共享参考抛错的第二项缺陷。
- `Simulation.move` 以 controller 实际位移和剩余速度推导候选步态。水平纠偏后从同一原始时钟重新计算，最多三次重新校验；blocked / unresolved 恢复原 pose 的完整 gait，并恢复 grounded、归零速度。没有发现同 tick 双重推进或把纠偏位移作为输入脚步累计的问题。
- history 保存五个 stride 字段和 grounded；timeline 使用 unwrapped phase、短弧方向插值，180° 对向有固定选择，避免线性方向变成零向量。死亡、换席、瞬移及 phase reset 不跨界混合；丢包时保持最后实际 pose。
- `validateInput` 从白名单重新构造 Input，未复制 stride。server 的 input 消费该结果，客户端不能靠附加 stride 属性覆盖 authority；渲染里的预测状态也来自共享 Simulation。

## support / 低顶边界独立检查

新增 root support 后备分支只接受水平 Cuboid 且顶面位于脚底 ±25 mm；普通高墙与低顶不符合高度条件，head / eye 从不使用该 root 例外。它放宽的是同一脚底接触带内 Rapier 异常法线的处理，本次没有发现它允许角色根穿过高墙或低顶。

另做实际 Rapier 低顶矩阵：屋顶底面 1.45 m，4 个初始 stridePhase × pitch[-1.5,0,1.5] × yaw[0,π/2]，每案 15 帧蹲行 + 75 帧请求站起，共 24 × 90 帧。直接查询 roof 与当前 root capsule / head sphere：最大穿透均 **0**，capsule 顶部最高 **1.4398097 m**。结果保存在上述 JSON 的 `lowRoof`。这覆盖当前场景，不把它当作任意地形的证明。

本次实际执行：

```sh
npx vitest run tests/locomotion-integration.test.ts tests/pose-clearance.test.ts tests/pose-timeline.test.ts
# 3 suites / 45 tests passed
```

未添加镜像实现测试、未重复全套测试。

## P2 修复后的独立关闭记录

实现者在共享 `parts()` 中增加六个下肢 capsule：两条 hip→knee、两条 knee→ankle、两只 heel→toe 靴子，中心和方向来自同一完整权威参考；intersection / contact / cast 都采用相应骨轴四元数。新增约束只在 strideWeight>1e-6 时启用。地面支撑例外扩展到腿足，仍受实际水平 Cuboid 顶面与 root 脚底 ±25 mm 限制；头眼没有加入该例外。

独立再次运行原始 fixture，正跑 / 横移各 **100 帧**，每帧读取实际 `Simulation.move` 后的 Player，送入当前 `GameAssets.animateOperator` 并检查所有 **1450 个 Foot/Toe 主要权重顶点**：

| 修复后检查 | 正跑 | 横移 |
| --- | --- | --- |
| 100 帧最大 authority boot sphere 穿透 | 0 | 0 |
| 145,000 次真实顶点采样中的越墙次数 | 0 | 0 |
| 最大实际顶点越界 | 0 | 0 |
| clear / corrected 帧数 | 93 / 7 | 87 / 13 |
| 松开输入后 120 帧 phase | 严格保持 1.5980333338 | 严格保持 1.5961333339 |
| 松开后 strideWeight | 9.92e-11 | 2.28e-10 |

新增下肢 support 后，另把前述 **24 × 90 帧低顶矩阵**原样复跑：root / head 最大穿透仍为 **0**，capsule 顶部最高仍为 **1.4398097 m**。相关现有测试再次执行为 **3 suites / 47 tests passed**，包括新增正跑 / 横移薄墙回归。完整修复后读回追加在 `output/tests/locomotion-authority-review.json.afterFix`，保留修复前数据用于对照。

该 P2 在复现场景中已关闭。结论不扩展为任意地形、所有衣物装备轮廓或主观步态观感已经验收。

## 新增下肢净空后的权威 CPU 基准（楼梯降级前历史样本）

执行 `npx tsx scripts/simulation-bench.ts`，证据 `output/tests/simulation-performance.json`。脚本只创建 / 释放本进程的真实 Simulation，不使用网络、浏览器、定时节拍或忙等。Apple M4 Pro、Node v22.23.2、Rapier 0.20.0；预热世界先跑 180 个真实 AI tick 后释放。两个正式世界分别采用训练 / 攻防模式、真实地图、10 个实际 AI 玩家，保留自然战斗和回合阶段，各 **3600 tick、dt=1/60、60 秒模拟时间**。

只在完整 `sim.step(dt)` 前后采样墙钟，报告收集、初始化、最终 snapshot 和 dispose 不计入 step；另记录包含报告读取的完整 loop 墙钟。固定 `sim.rng=69421` 后再 fillBots；已检查这些共享 simulation / handling / map / tactics / locomotion 路径不调用 Math.random。输出含相关源码 SHA256 和最终 snapshot SHA256。浮点平台与 GC / 系统调度耗时不因此变得确定。

| 完整 step | 训练，3600 tick | 攻防，3600 tick |
| --- | --- | --- |
| mean | 1.1465 ms | 0.6977 ms |
| p50 | 0.9434 ms | 0.3257 ms |
| p95 | 2.0690 ms | 1.7481 ms |
| p99 | 6.3249 ms | 5.2120 ms |
| max | 9.7463 ms | 7.7920 ms |
| 累计 step CPU 墙钟 | 4127.52 ms | 2511.68 ms |
| 整个测量 loop 墙钟 | 4147.10 ms | 2523.69 ms |
| 超过 16.6667 ms 的 tick | 0 | 0 |

攻防自然产生 buy=1440、live=1785、ended=375 个 tick，不能用总体均值掩盖战斗开销：其 **live 均值 1.2004 / p95 2.6888 / p99 5.4747 / max 7.7920 ms**。训练全部是 live；期间发生 205 次射击、168 次命中、36 次击杀并自然复活。攻防发生 112 次射击、80 次命中、17 次击杀，推进到第 2 回合结束；该种子没有录到埋包或投掷物事件，因此不把这次样本称为那些分支的压力测试。

另单列“10 人存活且至少 8 人步态权重>0.05”的 live tick，避免死亡 / 购买阶段稀释：训练 803 个样本均值 1.2733 / p95 2.0804 / p99 2.8887 ms；攻防 951 个样本均值 1.1446 / p95 1.7781 / p99 2.4777 ms。统计时读到的平均运动人数为训练 8.10、攻防 3.96（后者包含 buy / ended）。

测量范围内，新增六个下肢 capsule 与扫掠没有吃完单步 **16.6667 ms** 的 60 Hz 预算：训练平均占 6.88%，攻防 live 平均占 7.20%，本次最大 step 仍低于预算。它不包含 server snapshot 编码、WebSocket 发送、多个房间并发、浏览器 GPU 或操作系统长时间调度抖动，不能表述为“已保证网络 / GUI 60 FPS”。

预热世界和两个正式世界均成功退出；重复 `dispose()` 安全，正式世界释放各约 0.232 / 0.091 ms；`failure=null`，无 WASM borrow / world.free 错误。未改任何共同源文件。

## M01 楼梯回归：受限平脚降级

全量 QA 发现原 `tests/tactics.test.ts` 的 M01 楼梯 125 tick 登台回归失败：预期 x<-10.3，实际 x=-6.03645。14 个 15 cm 高、40 cm 深的踏步会不断挡住平面周期的前摆靴子，重复水平纠偏使角色爬不完楼梯。新增步态没有地形脚锚，不能以放行全部 riser 来假称完整楼梯动画。

按 root 批准，仅在 `Simulation` 构造时缓存的 `BOXES.kind==='step'` 附近，给完整候选姿态写入中性步态：phase 严格保持，weight / speed 为 0，方向回到 (0,-1)。邻域为踏步水平 AABB 外扩 0.65 m，脚底位于该盒底面 -0.10 m 至顶面 +0.30 m；修正后的候选会重新判定邻域。退出后通过现有 shared `advanceLocomotion` 平滑启步，没有新增网络字段、渲染特判或被跳过的墙体 collider。原台阶爬升、根胶囊、头眼和完整扫掠事务保留；被拒绝仍恢复原姿态。

新增 `tests/stair-locomotion.test.ts`，实际读回 `output/tests/stair-locomotion.json`：

- 原路线 125 tick 到 x=-13.206667、y=2.115100；neutral 区间 86 tick 严格保持相位，退出后首帧 weight<0.25，末帧 weight=0.998338。原登台测试也恢复通过。
- 每帧将真实 Simulation 五字段送入当前 GameAssets / C02，读取 1450 个 Foot/Toe 主权重顶点，合计 181,250 个样本，对全部 authored step 和 COL_0339 台面进行实际 AABB 体内测试。最大体内深度 0、>1 mm 穿透样本 0。该读回针对实际指定路线，不证明所有斜向走法或衣物轮廓。
- 邻接普通 5 cm 薄墙持续前进 100 tick，root / head / eye / boot sphere 最大穿透 0，停在 z=99.394790，没有把墙当成踏步放行。
- 邻接底面 1.45 m 的低顶、90 tick 转头和请求站起，最大 root / head / eye 穿透 0；胶囊顶部最高 1.441702 m，相位保持 .4375。
- 特别构造原先合法的移动头部下沉姿态：直接归零步态会让头部穿入局部顶棚 27.630 mm。真正 `Simulation.move` 的完整事务返回 initiallyLegal=true / corrected，原位候选水平退让 28.827 mm，头眼最终穿透 0、phase 保持；没有绕开归零抬头的检查。

专项及相关测试 `stair-locomotion / tactics / locomotion-integration / pose-clearance` 共 **42/42** 通过，`npx tsc --noEmit` 通过。reference 实现者做限定只读复核，未发现新增 P1/P2，未重复运行测试。

明确限制：目前是楼梯邻域的中性平脚移动，可能滑步 / 悬脚，尚无地形贴足、跨级抬脚或完整楼梯走跑动画；动态 Rapier 楼梯、斜坡也不在 authored step 缓存的能力范围内。不能在能力清单写“楼梯完整走跑动画已完成”。

## 楼梯修复后 CPU 复测与新增非楼梯死锁

2026-09-08 22:51 再执行一次相同 10 AI × 两模式 × 3600 tick 的完整 step 基准。下面是死锁修复前的历史样本，`output/tests/simulation-performance.json` 现保存文末 23:01 的最终读回。

| 完整 step | 训练 | 攻防 |
| --- | --- | --- |
| mean | 5.5728 ms | 0.6553 ms |
| p50 / p95 / p99 | 6.9867 / 10.0315 / 11.2296 ms | 0.3346 / 1.7755 / 2.9959 ms |
| max | 23.3510 ms | 9.8571 ms |
| step 总墙钟 / loop 总墙钟 | 20062.17 / 20105.56 ms | 2359.14 / 2372.81 ms |
| 超过 16.6667 ms 的 tick | 1 / 3600 | 0 / 3600 |

攻防 live 1797 tick，mean 1.1042 / p95 2.1961 / p99 4.2187 ms。两个世界和预热世界正常释放，无 WASM borrow 错误。该次训练已不能表述为所有 step 都在 60 Hz 预算内。

限定 profiler `output/stair-perf-debug.ts` 不改变执行路径，只记录每个真实 move 的耗时和 before/input/resolution。结果 `output/tests/stair-perf-debug.json` 指向 3046 次 blocked，共耗时 16.54 s；而 27376 次 clear 共 3.52 s。首个重复慢姿态在训练 tick1325，bot-amber-4，根 (25.6911219,0.0159081,-27.2349005)，周围无 authored step。输入 yaw 从 2.0201092 转向 -0.3043012，stridePhase=.4765458、weight=.9441160；连续固定点重算三次仍不收敛，reason=`Complete locomotion/clearance pose did not settle within three corrections`。完整恢复旧 pose 后，相同请求下一 tick 又重复同样失败，形成出生区停滞。楼梯改动改变了自然战斗轨迹，暴露了此分支；不能把它简单归因于 0.65 m 邻域判断成本或随机 GC。

已将真实 P2 和精确 fixture 同步 root。一次性 `output/relax-debug.ts` 先验证了保守补救可行性：请求不收敛后，保留 before 的根位置和 yaw，仅按 speed=0 渐退原 gait 并再次完整校验；前四次 clear，phase 保持，weight .944→.799→.676→.573→.485，第五帧原输入自然可接受，30 帧后移出 1.63 m。root 随后批准将此有界补救纳入本轮修复。

## 角落死锁修复与最终 CPU 复测

`Simulation.move` 只在请求状态为 blocked、原姿态 initiallyLegal 且旧 strideWeight>1e-6 时，尝试上述原姿态收步。它不采用被拒绝的根位置、yaw、pitch、站蹲变化或输入速度；phase 不推进，速度向 0 衰减。完整 `resolvePoseMotion` 包含足部归位与 pelvisDrop 减小后的头眼回升。只有 clear / corrected 时接纳这个经过校验的备选姿态；否则原阻挡状态和完整旧 pose 保留。无论是否成功收步，原请求的 vx / vz / vy 都清零，grounded 保留。对 initially illegal 的 unresolved 放置，不新增这种恢复路径。

新增固定真实数据 `tests/fixtures/locomotion-corner.json` 和 `tests/corner-locomotion.test.ts`，先确认旧代码失败（weight 永远 .944116 不退），再实施修复：

- 真实出生区样本前四帧的 root XYZ / yaw / pitch / phase **严格保持**，只减小 weight，且 vx / vz=0。第 5 帧原请求获准，30 帧移动超过 1 m；各帧头眼穿透<1 mm。
- 另设普通双墙 + 低顶合法初态，原方向请求被阻挡；不经校验的收步会抬头穿顶 **1.181 mm**。实现返回 blocked / initiallyLegal=true，完整 `clearancePose(after)` 与 before **严格相等**，phase、根、yaw 和 weight 全不变，最终头眼穿透 0。这证明收步不是绕过低顶的专用放行。
- `corner-locomotion / stair-locomotion / tactics / locomotion-integration / pose-clearance` **44/44** 通过，`npx tsc --noEmit` 通过。完整证据为 `output/tests/corner-locomotion.json` 和前述楼梯 JSON。

在同一机器以相同脚本、种子、预热、10 AI、每模式 3600 tick 重新执行一次最终基准（2026-09-08 23:01）。最新结果保存于 `output/tests/simulation-performance.json`，Simulation SHA256 为 `1355fe358d665b11db7ff0541c0d4ec33465021d272b2c7d8b755475b4332f00`：

| 完整 step | 训练，全部 live | 攻防，含自然回合阶段 |
| --- | --- | --- |
| mean | 1.1080 ms | 0.6168 ms |
| p50 | 0.9301 ms | 0.3350 ms |
| p95 | 2.0813 ms | 1.6442 ms |
| p99 | 3.4493 ms | 2.3063 ms |
| max | 16.2463 ms（tick 2） | 10.7537 ms |
| 累计 step / 全 loop 墙钟 | 3988.95 / 4011.03 ms | 2220.36 / 2232.13 ms |
| 超过 16.6667 ms 的 tick | 0 / 3600 | 0 / 3600 |
| blocked 状态读回 | 0（修前 3046） | 0 |

攻防单独 live 的 mean / p95 / p99 为 **1.0274 / 1.9232 / 2.7862 ms**。10 人存活且至少 8 人处于运动步态的 live 样本，训练 790 次 mean 1.3320 / p95 2.4373 / p99 3.7423 ms，攻防 951 次 mean 1.1803 / p95 1.9295 / p99 2.7862 ms。训练发生 192 次射击、167 次命中、35 次击杀；攻防 105 次射击、80 次命中、16 次击杀并推进到第 2 回合结束。本种子仍没有埋包 / 投掷物事件。

预热与两个正式世界均正常释放、重复 dispose 安全、failure=null，无 WASM borrow 错误。训练重复 blocked 的停滞已在真实 fixture 与该次 3600 tick 种子中关闭；新下肢净空与修复在本次 CPU 样本内没有超出 16.6667 ms 单步预算，但最大值只剩约 0.42 ms 余量，仍不能宣称网络服务 / 多房间 / GPU / 长时调度均保证 60 Hz。

reference 对新增 rejected / settled 分支再次限定只读复核：未发现 P1/P2；确认 rejected 布尔值在替换 resolution 前固定，因此安全收步成功后仍会清零被拒输入的速度；correction 相对尚未回写的请求 pose 计算，最终 collider 高度和 body 位置使用接受的完整 pose。该复核未修改文件、未重复 CPU 基准。
