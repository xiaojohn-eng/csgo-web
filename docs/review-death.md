# 死亡展示与测试迁移独立审阅

审阅时间：2026-09-08 21:40–21:45。只读检查 `death-presentation.ts`、`assets.ts`、`scene.ts`、`falcon-combat-pose.ts`、皮肤释放路径和迁移后的测试。没有启动浏览器、没有触碰 27015、没有重复完整测试。本次两个窄探针直接在 Node 中加载交付的 C02 GLB，仅在内存剥离图像/材质 I/O，调用真实 `GameAssets` 和 Three 骨架计算，不写生产文件。

## P2：首个死亡快照移动后，护膝代理没有对齐当前根坐标

位置：`game/scene.ts` 的 `updateActors` 将 root 设置为当前快照位置/朝向，紧接着调用 `assets.updateDeath`；`game/death-presentation.ts` 的 `capturePrivatePalettes` 捕获 detached ACTION03 代理当前 `matrixWorld`。

活帧最后一次姿态采样后，ACTION03 护膝代理保留当时世界矩阵。首个死帧先移动 root，普通骨骼跟着移动，但 detached 代理不会自动跟随。死亡模块随后把旧代理矩阵当作新根位置的正确基线冻结，整个倒地期间留下同样偏移。

实际复现：`GameAssets.operator` 先以 `x=2,y=.015,z=-3,yaw=.5,pitch=.6,stancePhase=.7,reload=1.05` 初始化活态 C02；随后把 root.x 和玩家 x 改至 2.3，`alive=false`，更新死亡 12×.1 秒。以死亡容器增量作用于“上一帧护膝顶点+0.3m根平移”计算正确结果，实测如下：

```json
{
  "expected": [2.006126717450026, 0.2444838901810753, -3.319603107681816],
  "actual": [1.7888366744444857, 0.10065622859981455, -3.1709469911755765],
  "kneeErrorM": 0.3
}
```

建议：记录最后一次真实活姿态采样的根世界矩阵，在死亡沿先把 detached 代理从旧采样坐标变换至当前 root，再捕获死亡基线。补一个含死亡前平移和yaw变化的真实 C02 + GameAssets 集成用例；原护膝测试的死亡前root保持不动，没有覆盖此分支。

## P2：首次创建即死亡的角色没有初始化权威姿态

位置：`game/assets.ts` 的 `falconOperator` 最后调用 `animateFalcon(root,state,p,0)`；`animateFalcon` 在 `!p.alive` 时立即返回，早于原动作和 `FalconCombatPose` 采样。

晚加入房间、接管已死亡bot或重建演员后，如果首次玩家快照已死亡，该角色仍处于GLB默认姿态，之后死亡容器会从这份默认站姿倒地，而不是从该快照的 crouch/pitch 和持枪动作开始。

实际 C02 复现：同一 `stancePhase=1,pitch=.6` 和根位置，首次死态角色 `sampledClip=null,poseReport=null`，头骨世界 y=1.602058；同姿态活态初始化 `Rifle_Idle` 后头骨 y=1.061824，差约0.540234m。

建议：演员创建时无论alive状态都初始化一次可用的快照姿态，随后的死帧仍冻结；或明确保存可重建的死亡末姿态。补“首次快照即死亡”的集成用例，不能只调用已经人工采样好的底层死亡容器。

## 已复核且未发现新的阻断问题

- 死亡模块只操作新增wrapper及ACTION03私有代理，不改权威root或原骨骼local TRS；scene仍直接采用权威/远端时间线提供的位置与yaw。
- `updateDeath` 在可见性判断之前执行，因此wrapper隐藏后仍会在复活时恢复；随后可见活态才进入原姿态采样。普通复活次序成立。
- 角色ID消失时，scene先恢复/释放专有皮肤材质，再释放TeamMarker，再调用 `releaseActor`；后者依次解绑死亡wrapper、释放私有护膝palette、停止/uncache mixer并dispose克隆骨架。共享原GLB几何和纹理只在GameAssets整体释放时处理。此为源码所有权审查，未声称GPU内存实测通过。
- 迁移后的 `tests/fixtures/net-session-server.mjs`、`initial-sync-server.mjs` 都从本repo相对路径载入真实 server/index.ts；IPC fixture仅在专用测试进程中存在。测试产物路径已改为本repo `output/tests`。
- 原协议测试已由根代理明确迁移到新项目 `csgo-web-r1`，新增csgo专用用例仍显式拒绝web-w04。root提供的30/30复跑结果未被当作本次独立执行证据；本次仅审阅变更，未重复整套测试。

## 仍然适用的展示边界

> 状态（2026-09-11）：以下边界针对 C02 占位角色的 `game/death-presentation.ts`，该模块在 Source 关卡已无生产引用。原版 Dust2 上的死亡现由原 Death1 序列 + `game/source-ragdoll.ts` 的原 PHY ragdoll 物理接管（姿态管线 Source 原生 +Z 向上帧，服务器权威，双客户端 LAN 静止姿态零偏差并经渲染骨骼审计确认平躺，见 `parity.md` 的"死亡 ragdoll 物理恢复点"）。**其中"无地形查询"这一条对 ragdoll 同样成立且仍未解决**：ragdoll 的 `groundZ` 由死亡帧推出，只有演员局部一张水平地面，空中阵亡会在死亡高度悬停，尸体不贴合楼梯/箱体/墙体。

这是刚性倒地，不是ragdoll。`measureGroundLift` 把权威root高度当作“地面”，而模拟器死态不再推进重力；空中被击杀时可能在死亡高度上方留尸，楼梯/墙边也没有碰撞贴合。现有文档已说明无地形查询，不能据包围盒测试宣称真实接地或地形碰撞验收通过。

以上两个P2已发给根代理；修复后的限定复核结果将追加在本报告末尾。

## 修复后限定复核：两个P2已关闭

实现者新增 `markLivingPose(root)`，在完整C02姿态采样完成后记录世界基准；死亡沿按当前root/最后采样root的世界增量先校正ACTION03代理，再捕获死亡基线。初始 `state.current==''` 时允许死态角色采样一次真实crouch/pitch/clip，普通死帧仍保持冻结。

独立复核重新使用相同真实C02和GameAssets窄探针，死亡后推进至留尸阶段，结果如下。没有重新跑完整测试，也没有操作27015。

| 死亡沿变化 | 修复后护膝顶点误差 |
| --- | ---: |
| 平移0.3m | 3.89e-16m |
| yaw转向0.4rad | 9.31e-16m |
| 平移0.3m + 转向0.4rad | 8.90e-16m |

三种情形的权威root position/quaternion均保持输入值不变。进一步将已死root平移10m后复活，真实 `updateDeath→animateOperator` 后头部与同快照新建活角色一致。首次死态深蹲角色已采样 `Rifle_Idle`，头骨与同快照活态初始化误差0m。

此次新增的“末帧移动护膝错位”与“首次死亡快照未初始化”均有独立修复回读，可关闭。剩余地形/空中死亡与真实浏览器观感边界不因这些数值检查而关闭。
