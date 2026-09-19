# 死亡展示模块

> 状态（2026-09-11）：本模块是早期 C02 占位角色的倒地/留尸过渡，**Source 关卡不再使用**——原版地图上的角色死亡走 `game/source-*-character-pose.ts` 姿态驱动的 Death1 原序列，随后交由 `game/source-ragdoll.ts` 的原 PHY ragdoll 物理模拟（服务器权威，快照只传 16 个部件位置 + settled）。本模块在 `game/`、`server/` 中已无生产 import，仅保留其单测与历史说明，见 `parity.md` 的"死亡 ragdoll 物理恢复点"。

`game/death-presentation.ts` 是本项目自行编写的倒地、留尸和退场过渡，不是 CS:GO 原作动作、动作捕捉、关节布娃娃或完整死亡动画。它改善死亡时站立模型直接消失的问题；活人走跑和跳跃仍需独立动作开发。

## 接口与顺序

```ts
// 完整 C02 Scene 已经 SkeletonUtils.clone，保留原 body.rotation.y = Math.PI。
root.add(body);
bindDeathPresentation(root, body);

// 每一帧先应用当前权威位置与朝向，包括不可见或已死亡角色。
root.position.set(player.x, player.y, player.z);
root.rotation.y = player.yaw;
const presentation = updateDeathPresentation(body, root, player.alive, dt);
// presentation.visible 与烟雾、自己、菜单等场景可见性规则一起使用。

if (player.alive) {
  // 复活时必须先由 updateDeathPresentation 复位，再进行原动作/姿态采样。
  sampleFalconCombatPose(pose, sampleOriginalAnimation, poseInput);
  markLivingPose(root);
}
// 死亡时冻结最后的完整骨骼姿态；body.visible 保持 true。

// 删除角色时先解开 wrapper，再恢复/释放姿态层的私有骨骼。
unbindDeathPresentation(root);
pose.dispose();
```

`bindDeathPresentation(root, body)` 返回新增的 `DeathPresentation` Group。重复绑定同一 root/body 不会叠加容器；不同 body 误绑定到同一 root 会抛错。只允许在完整克隆后的 body 是 root 直接子级时初始化，不能复制已经绑定的容器继续冒充新角色。

`updateDeathPresentation(body, root, alive, dt)` 返回 `{phase, elapsed, visible}`，阶段为 `alive / falling / held / retiring / hidden`。死亡锁存一次，0.72 秒倒地、2.4 秒留尸、0.4 秒下沉后隐藏。单次累计 dt 限为 0–0.1 秒，NaN/Infinity/负值不推进，后台恢复不会一帧跳完过程。重复死态更新不会重置计时。复活时容器位置、旋转、缩放和可见性回到 identity。

初次死亡会用当前实际 posed geometry 的精确包围盒测量最终倒地姿势，让尸体停在死亡位置地面之上。当前接口遵循游戏的米制、根节点只绕 Y 轴旋转契约；没有查询地形碰撞，楼梯、斜坡、墙边和特殊俯仰下的落地自然度需要画面复核。计算只在死亡沿发生，逐帧阶段不扫描全部顶点。

## 骨骼与命中边界

权威 root 的 position/quaternion/scale、原骨骼 local TRS、GLB、几何、蒙皮权重、贴图和共享材质不会被本模块改写。正常骨骼通过外层容器跟随倒地。原头部/身体命中体函数完全不变，模块仅对 `alive=false` 的角色呈现死亡。

C02 姿态层另有 8 个护膝网格使用独立 Skeleton palette，其 `ACTION03_*_Patella` 代理骨不在角色子树内，且关闭自动世界矩阵更新。仅旋转容器会使它们停留在原地。模块在死亡沿记录这些私有代理的世界矩阵，将同一容器世界增量施加到代理，并更新对应 palette；复活前恢复记录。原 64 骨局部变换没有修改。

`markLivingPose(root)` 必须紧接每次完整姿态采样，记录代理对应的世界基准。死亡前若权威位置/朝向已经推进而姿态还没重新采样，死亡沿先用当前根与上次采样根的差异搬运代理。只记录死亡当帧的根会把最后一帧位移误差永久冻结进尸体。实际 GameAssets 测试覆盖 0.3 m 平移、0.4 rad 转向及组合；修复前分别偏差 0.3 / 0.140699 / 0.240897 m，修复后均小于 0.00001 m。

首次创建时已经死亡的远端玩家也先按其权威 crouch/pitch 与原 clip 完成一次初始采样并标记基准，再进入冻结。当前 GameAssets 通过 `state.current === ''` 区分这种初始化与普通死亡后的冻结，避免晚加入时所有尸体从站姿开始倒地。

数值测试必须调用与渲染器相同的 `root.updateMatrixWorld(true)`。仅调用继承的 `updateWorldMatrix` 不会触发 SkinnedMesh 的 bindMatrixInverse 更新，可能掩盖护膝错误。实际 C02 测试在修复前测得护膝顶点偏差 0.852481 m；修复后同一顶点随尸体刚性变换的偏差小于 0.00001 m，并验证复活回到原位置。

## 验证

`tests/death-presentation.test.ts` 覆盖 identity 包裹/幂等、原骨骼与材质保持、可见倒地与短暂停留、grounded 包围盒、计时锁存、异常 dt、复活/再次死亡、独立角色、解绑定，以及实际 57.5 MB C02 的护膝 palette 读回。实际 GLB 测试仅在内存剥除图片/材质 I/O；原几何、骨架、绑定、权重和动画完整保留。

```sh
./node_modules/.bin/vitest run tests/death-presentation.test.ts
```

这是数值及生命周期验证，未替代实际浏览器里的死亡近景、地形与多角色画面验收。
