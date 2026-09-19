# C02 渲染性能审计与局部优化

2026-09-08；当前隔离项目 `csgo-web`。本次未操控浏览器、未访问或启停 27015、未修改旧 BREACHLINE。

主任务的真实浏览器基线：训练约 33 FPS / 1499 draw calls / 6.706M triangles / 248 geometries / 316 textures；菜单约 56–60 FPS / 415 draws / 1.19M triangles。这些是主任务提供的观察，本报告没有重新测量其 FPS，也不将下述 Node CPU 改善直接折算为 FPS。

## 已证实的重复成本

1. `FalconCombatPose.updateKneeGear` 每个活态角色、每帧对左腿 1575 个顶点 / 2572 个三角形，以及右腿 337 个顶点 / 591 个三角形做蒙皮和射线接触采样。原实现重新创建 1912 个 Vector3、两份 Map 和条目数组；Three 的 `SkinnedMesh.applyBoneTransform` 又对每个非零权重重复计算同帧相同的 `bone.matrixWorld × boneInverse`。

   真实 C02 初始 CPU 探针（3 × 160 帧）中，角色完整采样中位数约 0.792–0.809 ms；护膝耗时占总 CPU 的约 79–82%。新红测在一次真实蹲姿变化中记录 cloth 骨矩阵乘积 **2242 次**，而 64 根骨骼只需 64 次 CPU double 矩阵缓存，另保留原有 GPU palette 更新的 64 次。

2. 冻结 C02 原文件有 28 个 SkinnedMesh，共享 1 份 64-bone Skeleton。当前安装的 Three `SkeletonUtils.clone` 在每个 mesh 上单独 `sourceMesh.skeleton.clone()`，产生 28 个对象；它们的骨骼引用逐项相同、inverse 矩阵数值相同，但对象身份不同。

   Three `WebGLObjects` 按 Skeleton 对象身份每帧更新一次，`WebGLRenderer` 又按该身份创建 bone texture。因此，actor 内重复 Skeleton 会产生重复 palette 更新和 bone texture。护膝层替换其中 8 份为私有 ACTION03 palette；优化前有 28 份活跃 palette，并另保留 8 份被护膝替换的原 palette。旧 releaseActor 释放 36 份是这两组所有权之和，不能据此误判 double-dispose。

## 本轮已获批准并实施的改动

- `game/falcon-combat-pose.ts`：增加 `SkinnedVertexFrame`，在当前帧完整姿态采样后计算一次 double `Matrix4[]`；逐顶点保留 Three 原来的 base/morph、bind、四权重累加与 inverse 运算顺序。没有使用 Float32 GPU palette 近似接触位置。每侧 patch 的 Map 与 Vector3 只初始化一次，随后原位更新；三角形、顶点遍历顺序及射线规则不变。
- `game/share-skeleton.ts`：只在一个刚创建且独占的 SkeletonUtils clone 子树内共享。必须逐项骨引用一致、inverse 矩阵完全相等；不按名字合并，不跨 actor / 源资产共享。被替代的 clone Skeleton 立即 dispose；返回的 canonical Skeleton 继续由该实例持有。
- `game/assets.ts`：只在 C02 body clone 后、pose 创建前接入 helper。28 份基础 clone 合并为 1，之后保留 8 份私有护膝，最终 **9 份活跃 Skeleton / actor**。已有 releaseActor 先释放 8 份 private，再对恢复后的 canonical 集合释放一次；无需改变死亡状态或 `markLivingPose`。
- `game/falcon-viewmodel.ts`：同样在 clone 后共享，**28 → 1 份 Skeleton / 第一人称**；记录 ownedSkeletons，在 viewmodel dispose 时释放一次。源 geometry / materials / textures 仍共享，已有专属裁剪 geometry 回收保留。

模型顶点、三角形、材质、阴影设置、LOD、可见性、姿态目标、服务器命中语义均未因本补丁改变。每 actor 比优化前减少 19 份活跃 Skeleton；这能减少相应 bone texture 与 palette 更新，但没有 GPU trace 就不能声称整个训练场 texture 数必然按某个常数下降。

## 红绿与精度证据

`tests/c02-performance.test.ts` 的首轮 4 个红测分别暴露：2242 > 128 次矩阵乘积、actor 28 ≠ 9、旧活跃与待回收 palette 数量不同、第一人称 28 ≠ 1。实现后扩为 9 项全部通过：

- 真实 C02 actor 28 个 SkinnedMesh、9 份 palette，其中恰好 8 份含 ACTION03 私有骨骼；两个 actor 与源资产彼此不共享 palette。
- 27 份冗余 clone palette 及已分配 bone texture 各释放一次，canonical 不被提前释放。重复 helper 调用不再次回收；不同 bone identity / inverse 不合并。
- actor 释放时 9 份活跃 palette / bone texture 各回收一次，重复释放无效；另一 actor、源资产未受影响。
- 第一人称回收只释放其 canonical Skeleton 与专属裁剪 geometry；不释放源 geometry 或另一实例。
- 8 组不同 crouch / yaw / pitch / Reload 时间，以及独立改变的左右腿姿态：全部 **62,325 × 8 = 498,600 个真实蒙皮顶点**与未经 Skeleton 共享、使用 Three 原 CPU getter 的对照严格相等。逐个 double 坐标比较，无 epsilon 放宽；完整 pose / knee report 相等。
- 对全部真实 mesh 再独立比较 cache getter 与 Three getter；另覆盖 absolute / relative morph target。源骨骼和未更新的第三 actor 矩阵保持原值。

2026-09-08 22:10 本次限定回归：

```sh
npx vitest run tests/c02-performance.test.ts tests/death-presentation.test.ts tests/skins.test.ts
# 3 suites / 24 tests passed
git diff --check
# passed
```

当时全项目 `npx tsc --noEmit --incremental false` 尚未通过：错误均在另一项正在接入的 stride / feet 字段（runtime、locomotion-integration 测试及相关类型）上；本性能文件、fixture、脚本已没有类型诊断。主任务完成步态合并后仍须完成最终类型与构建检查。

22:16 在 LAN 响应头补丁收尾时再次执行全项目同一类型检查，已通过；最终构建与 WebGL 复核仍由主任务合并后执行。

## 可复现 CPU 小基准

```sh
npx tsx scripts/c02-performance-bench.ts
```

输出 `output/tests/c02-performance.json`。读取真实本地 GLB，仅在内存去除浏览器图像 / 材质 I/O，保留所有 geometry / weights / bind / bones / animations；Node v22.23.2，darwin/arm64。单个活态 GameAssets 角色，包括原动画、当前 pose、world matrix update，100 帧预热，交替顺序测 3 × 300 帧。对照仅恢复原始 Three CPU 蒙皮 getter，双方都复用新的 patch buffer，因此该对照没有把减少 Map / Vector3 分配的收益额外计入。

| 轮次 | 原 getter median / p95 ms | cache median / p95 ms | 原 / cache 总 CPU ms |
| --- | --- | --- | --- |
| 1 | 0.7866 / 1.4420 | 0.4179 / 1.0401 | 269.29 / 158.44 |
| 2 | 0.7610 / 1.6626 | 0.3907 / 1.0417 | 271.42 / 154.54 |
| 3 | 0.7465 / 1.5233 | 0.3987 / 1.1121 | 259.61 / 154.61 |

900 帧合计约 **800.32 → 467.60 ms（减少 41.6%）**。每轮最终 pose report 严格相等。并行浏览器和其它任务可能影响墙钟数据；此项不是渲染器/GPU基准，也没有包含 shadow/transmission pass 的成本。

## 已审计但未扩入本轮的渲染项

- `assets.ts` 明确让 C02 SkinnedMesh `frustumCulled=false`。因此转到相机外的角色仍可产生蒙皮绘制，且阴影相机也不能按该 mesh 的动态范围剔除。今后可研究保守的随骨骼包围体，但必须包含 ACTION03 和完整动画 / 死亡姿态。不能直接打开静态 skinned bounding sphere，也不能按主相机把整个 actor 隐藏，因为那会删除画面内应有的离屏角色阴影。本轮未改剔除。
- 世界与第一人称分别有 2048 / 1024 shadow map，每帧动态更新。停更会冻结人物/武器阴影，不属于无损 cache。
- C02 护目镜和武器镜片使用 transmission。Three 的 transmission 路径会增加 opaque prepass，这是额外 draw/triangles 的真实来源之一。保留光学材质；不能通过关闭透射来声称无损提升。
- `WorldComposite.render` 透射分支只渲染世界一次到离屏 target，再作为 foreground 背景使用；这里没有把完整世界额外渲染两次。每帧相同尺寸的 `target.setSize` 不会每帧重建 buffer。不要把该模块误判为重复 world render 根因。
- 地图有 227 个 mesh 实例 / 213 份独立 mesh，只有少量重复几何；按现有共享关系做 instancing 理论只能合掉约 14 次基础 draw，优先级低于角色多 palette / 不剔除问题。地图材质没有 transmission。
- 静态地图矩阵冻结、foreground transmission 标志预计算可以另作小 cache，但当前没有独立测得显著收益，也未实施。

最终浏览器校验由主任务负责：同一设备 / 画质 / 分辨率 / 镜头 / actor 数前后对照，并观察 crouch、跑动、换弹、死亡/复活、第一人称镜片与阴影；确认每帧 draw/triangles 不因本补丁下降而隐藏角色，检查多轮加入/离开后的 bone textures 能回落。CPU 的精确回归不能替代这些实际 WebGL 观察。
