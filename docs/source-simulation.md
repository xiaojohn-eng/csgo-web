# Source Simulation 接入验收

> **2026-09-09 PHY 坐标纠正**：本文件早期 `dust2/collision/` 的世界/道具 PHY 验收已被后续真实 LAN 复现推翻：SourceIO 交换 IVP Y/Z 后遗漏符号，导致原 Source Z 反射。BSP brush/displacement/trigger 数据未受此错误影响。修正版及新完整回归见 [source-physics-axis-correction.md](source-physics-axis-correction.md)（research 内相对路径为 `../docs/source-physics-axis-correction.md`）；旧数据与结果保留为问题证据，不能继续当当前物理几何正确性证明。

已实现 `new Simulation(mode, bots, scenario?)`。无第三参保留旧 R3；SourceScenario 由 caller 异步加载 `level/collision/navigation` JSON，另可注入 `poseDriver` 与经独立验证的 `hitboxes`。JSON 按只读数据共享，每个 Simulation 构造自己的 Rapier world、SourceLevel colliders、KCC。构造失败回滚；dispose 幂等，先释放 controller/level，再 free world。

## 最小调用接口

```ts
const poseDriver = createSourcePoseDriver(poseIndex, 'csgo-t-ak-12426148:b2106b26a407d0fa');
const sim = new Simulation('training', true, {
  mapId: 'de_dust2-source-12426148', level, collision, navigation, poseDriver,
  // hitboxes 只有实际验证该构建字段/骨矩阵后才能注入。
});
sim.eyeOrigin(player); sim.sight(a, b); sim.wallDistance(x, y, z, dx, dy, dz, 'bullet');
sim.sourceLevel; sim.scenarioIdentity;
filterVisibility(snapshot, you, eventCursor, sim);
flashExposure(player, burst, sim);
```

`Snapshot.mapId/sourceBspSha256` 为真实 Source 身份；无 scenario 不增加这些值。Source Player 保存 `sourceContract/sourceJumpHeld/sourcePose/sourcePoseVersion`，history/snapshot 深复制 pose。客户端 Input 没有这些字段，不能覆盖权威动画或 jump latch。预测恢复必须复制整个 Source Player 后重放输入。

Source 角色采用已验证 32×32×72u / 54u 轴对齐盒、64u / 46u 眼高、18u 台阶、800u 重力；移动控制器详见 `docs/source-player-movement.md`。CT 负高度原样保存，不走 y≥0、M01 support、C02脚/眼净空。Source `poseClearance` 诊断入口显式拒绝旧诊断。只允许本轮已核实 AK-47（内部既有 weapon key vandal），速度 215u/s，拒绝其他 FALCON 买枪/切槽；无 Source 时经济/武器路径保持旧行为。

站点按原 A/B trigger 与原完整 hull 重叠。地图射线、server visibility、flash 使用实例级 SourceLevel 查询；缺 Source context 的可见性/闪光调用抛错，不静默落 M01。playerclip 只挡玩家；projectile、bullet mask 分开；trigger 为传感器。

## 权威姿态与回溯

actor basis 固定 `yaw + π/2`，Source +X 对齐浏览器视线前向。方向由本 tick 实际 accepted 位移转成原 `move_x=forward/move_y=-right`，不由请求输入或残留速度冒充运动。原序列 cycle 按真实 sequence rate 推进并保持 unwrapped；空中 lower cycle 与方向一起冻结，瞄准仍更新。重生重新初始化 pose。当前地面状态选择器是已声明的受限实现，不是原 CCSGOPlayerAnimState；尚无原 jump/ladder/death clip graph、IK 或脚步事件消费。

shoot 同 tick 将 `fireTimeSeconds/fireCycle` 归零。角色层使用原 shoot rate/weight，世界 AK 继续使用真实 elapsed 秒以播放更长枪动画尾段。回合结束只继续开火时钟，不移动、再射击或推进 lower pose。timeline 同版本插原 pose input；跨死亡/重生/team/版本/contract/teleport 切断，状态切换与瞬时 Source stance 在权威边界离散。丢包 span 内多次开火只知道最新事件，不能恢复所有中间射击。

`SourceHitboxProvider` 只接同回溯 pose 的真实骨/扩展字段几何；无 provider 时 `hitboxStatus=unavailable`，不回退 C02。后续已完成原CPU字段/旋转OBB取证，并由root按T/CT注入 `createSourceHitboxes`；带命中骨采样与真实交火的新验收见 `docs/source-hitboxes.md`。本文下方早期CPU仍不包含该后续成本。

## 原 NAV 消费

保留原 XYZ / areaId / flags / transition kind；仅在真实 XZ 与支撑高度都到达时 pop。原 NAV 面与真实 collision 有 0.12–0.20m 差异，保留 NAV 原 Y，另用全 AABB 在不超过原18u台阶范围采样真实支撑作 `supportY`，没有把 NAV 面改平或按 XZ 跳过门点。原地阻挡超时重新寻路。

AI 当前只用 walk-only 路线：`allowLadders:false, blockedFlags:2` 排除原 JUMP 区域。玩家 jump 已可用；AI 没有伪造原跳跃/爬梯。近侧低物门点尚未到高面时保持原门点，沿后续方向离开障碍支撑再消费。此次10AI在30秒模拟中位移10–71m，证明真实移动与路径消费，不证明所有AI已经抵达最终炸弹目标。

## 当前实际证据

- `output/source-simulation-regression-final.log`：12套90项 Source/旧 Simulation/stance/tactics/visibility/timeline 回归通过；后续空中方向冻结红绿与新增 Source 专项为17/17。
- `output/source-pose-timeline-red.log` 记录原时间线未处理Source cycle、stance、版本的4失败；`output/source-pose-timeline-green.log` 修复通过。
- `output/source-air-pose-red.log/green.log` 记录空中方向由1归0的真实回归与修复。
- `output/tests/source-simulation.json`：真实 Dust2 30出生、15 CT负高度，10可达路线全部通过、2原B点PLAYERCLIP保持阻挡；90tick预测重放根误差 `0`，完整 SourcePose 逐值一致。10AI均使用原NAV并越过出生地9m。源文件散列见该receipt。
- 1800个完整step、10AI、固定模拟60Hz，原pose输入/时钟已接：平均 **1.490ms**，p50 **1.450ms**，p95 **2.327ms**，p99 **2.662ms**，max **12.863ms**。不是忙等30秒，也不是LAN/渲染FPS；本次平均/p99低于16.67ms，但未来命中骨采样仍须重测。
- 所有私有 worlds dispose 后退出，无 WASM borrow 错误。

复现：`npx vitest run tests/source-simulation.test.ts tests/source-player-contract.test.ts tests/source-pose-timeline.test.ts`，`npx tsx scripts/source-simulation-smoke.ts`。后者需要本机私有官方资产，不能在无资产 CI 静默伪造测试数据。

地图精确碰撞仍保留原缺13模型/45实例PHY等边界，见 `docs/source-map-collision.md`。原BSP位移碰撞自行按最近原角解析，未使用 SourceIO 的宽容 isclose；后来发现的旧 world 渲染偏8u不影响这里的碰撞。整图可玩性、真实LAN交火、GPU/键鼠及资源生命周期由root联合验收，本报告不替代。
