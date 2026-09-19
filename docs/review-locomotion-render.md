# C02 步态实际骨骼与皮肤消费验收

验收日期：2026-09-08。范围为当前工程实际 C02 GLB 的 CPU 骨骼/皮肤读回、原始资产不变量，以及骨架共享/顶点缓存的独立复核。本轮没有启动浏览器或运行 GPU/帧率基准。

当前结果：7,923 个姿态样本通过；发现并修复一个护膝接触时序 P2。修复后，在本报告范围内未发现剩余 P1/P2。这里的步态和护膝过渡是项目自制程序动作，不是 CS:GO 原作 mocap，也没有建立原作动作或完整画面还原结论。

## 可复现入口

```sh
npx tsx scripts/validate-locomotion.ts
npx vitest run tests/c02-locomotion.test.ts tests/c02-performance.test.ts tests/death-presentation.test.ts
npx tsc --noEmit
```

- `scripts/validate-locomotion.ts`：默认完整 7,923 样本，`--quick` 为 1,587 样本。输出 SHA、误差最大值与对应输入、失败详情、接触统计、不变量和范围说明；失败返回非零退出码。可作为模块导入以复用真实模型测试装置。
- `tests/c02-locomotion.test.ts`：三个真实模型测试，分别覆盖快速姿态矩阵、跨动画/步态的可重复采样、同帧移动/转向护膝刚性变换对照。
- 本轮实际执行：完整脚本通过；上述 3 文件 / 23 项测试通过；TypeScript 全工程检查通过。

## 数据与测量方式

来源是发布目录实际 `public/models/web-w01/falcon-combat-actions.glb`，SHA-256 为 `a541aeb26e0e6154830e23f2f6c3c978e54b0209f0e930564bb5f43545adfa2a`。加载器先校验哈希，仅在 Node 内存中剥离图片/材质 I/O，保留原始动画、几何、蒙皮权重、骨架层级和 bind inverse。磁盘 GLB 没有修改。

测试通过 `SkeletonUtils.clone → shareEquivalentSkeletons → 原 clip/time 采样 → FalconCombatPose` 走实际完整骨架路径，保留 GLB 的 PI 导入旋转。在每次读回前执行渲染器同样会执行的 `root.updateMatrixWorld(true)`。

每个样本读取左右 `Bip01_*_Thigh/Calf/Foot` 的真实世界坐标，对照公共 `falconCompleteReferences` 返回的 actor 局部 hip/knee/ankle，再由 root 变换至世界。骨长基准取自该样本、该原始动画时刻在程序姿态层处理前的实际骨段。双脚四元数读回后归一化再比较，避免源骨骼微小非均匀缩放使未归一化四元数产生伪角度误差。

完整矩阵包含：

- Rifle_Idle：0、1.37、3.999 秒；Rifle_Fire：0、0.0575、0.114999 秒；Rifle_Reload：0、0.42、1.05、1.7、2.2499 秒。
- 上述 11 个 clip/time 组合 × 3 蹲姿 × 5 俯仰 × 8 相位 × 6 方向 = 7,920 样本。
- yaw、世界原点、步态权重、速度与 grounded 以固定模数调度交错，覆盖多个值，但这些维度不是完全笛卡尔积。包括起点/远处原点交替，以暴露跨帧矩阵残留。
- 另加一个合法最大下沉见证和两个已知薄墙复现姿态，共 7,923。薄墙样本在这里仅验证骨链消费，不验证墙体碰撞。

## 实测结果

| 检查 | 完整采样最大值 / 结果 | 门槛 |
| --- | --- | --- |
| 髋、膝、踝与公共参考的世界位置差 | 1.4813756387e-7 m | 5e-5 m |
| 原始上/下腿骨段长度差 | 8.7889984124e-8 m | 5e-6 m |
| 脚骨原始世界旋转角差 | 3.8397606393e-7 rad | 1e-5 rad |
| SkinnedVertexFrame 与原 Three getter 的抽样顶点差 | 0 | 1e-10 m |
| 护膝接触失败 / 位移截断 | 0 / 0，合计 15,846 次接触 | 0 / 0 |
| 最大额外骨盆下沉（本样本集） | 0.12681909165095162 m | 记录量，不是全域上界 |
| root 权威 TRS、调用输入 | 每个样本不变 | 不变 |
| 原始/克隆几何属性、索引、morph 数组 | SHA 摘要一致 | 不变 |
| 原始骨骼 bind inverse 数值 | 所有蒙皮逐矩阵一致 | 不变 |

所有快速/完整样本都重新读取实际骨链，没有用“纯采样器可达”代替实际动画消费。原 Three getter 与缓存相同只证明两种计算一致；它们可能同时使用同一个错误的输入矩阵，因此护膝修复另有独立刚性变换对照。

## 已修复 P2：护膝接触读取上一帧绑定逆矩阵

位置：`game/falcon-combat-pose.ts` 的 `updateKneeGear`。

原因是姿态层调用 `Object3D.updateWorldMatrix` 更新层级，却没有触发 `SkinnedMesh.updateMatrixWorld` 中的 attached-mode `bindMatrixInverse = inverse(matrixWorld)` 刷新。角色 root 先平移/转向后，CPU 接触采样同时使用当前骨骼世界矩阵和上一帧 mesh 绑定逆矩阵；稍后渲染器会刷新 mesh，但护膝代理骨的接触偏移已经算错。原始 getter 和优化缓存都会受影响。

独立对照固定 Idle t=0、crouch=0.7、pitch=0.6、stridePhase=0.4375、strideWeight=1、strideSpeed=2.1、向前、grounded=true。先在固定 root 建立护膝实际皮肤顶点基准，再只改变 root。正确预期来自 `currentRoot × inverse(initialRoot) × baselineVertex`，没有调用公共步态/护膝接触公式推导预期。

| root 变化 | 修复前实际顶点偏离正确刚性变换 |
| --- | --- |
| 平移 0.035 m（蹲行 60 Hz 单帧距离） | 0.0135795734 m |
| 平移至 0.3 m | 0.0229359615 m |
| 当前位置 yaw 转至 0.4 rad | 0.0570640393 m |
| 下一帧 root 保持不变 | 约 1.26e-8 m，暴露出一帧时序特征 |

新增回归测试修复前明确失败：`expected 0.05706403933417797 to be less than 0.000001`。小范围修复是在 `cloth.skeleton.update()` 与缓存 `begin()` 之前调用一次 `cloth.updateMatrixWorld(true)`。此时父级已经更新，因而只刷新该 mesh 的当前帧绑定语义；没有改写 source `bindMatrix`、骨 inverse、权威 root 或原始皮肤缓冲区。

修复后，相同移动/转向/固定 root 序列的最大偏差低于 1 µm，左右护膝均保持相同接触/截断状态；原 `bindMatrix` 与骨 inverse 不变。完整姿态矩阵也从大量接触失败变为 0 失败、0 截断。死亡展示与共享骨架的相关回归通过。

## 骨架共享与顶点缓存复核

`shareEquivalentSkeletons` 只有在骨对象引用、顺序和每个 bind inverse 都完全一致时共享 palette。调用点都紧跟独占 `SkeletonUtils.clone`，没有把源模型或其他角色加入匹配集合；被替换的克隆 palette 释放，canonical palette 在所属 actor/viewmodel 结束时释放。不同 mesh 自有的 `bindMatrix` 仍然各自保留。没有发现此辅助函数的额外 P1/P2。

`SkinnedVertexFrame.begin` 每次姿态处理后重建 `bone.matrixWorld × boneInverse`，使用双精度 Matrix4，且 getter 保留 Three Mesh 的 morph 处理、原权重与运算顺序。缓存局限于当前角色当前采样帧，不跨 actor。实际 GLB 抽样对照误差为 0；现有性能回归另覆盖所有皮肤顶点、morph 和独立 actor。上面的绑定逆矩阵 P2 在调用时序，已经单独修复；不能把“旧 getter 等于 cache”当作正确接触证明。

本轮未重复性能 benchmark，不从 CPU 单元测试时长推导 GPU FPS 或设备承诺。

## 对 193,536 纯采样结论的独立判断与保留项

`9 × 7 × 6 × 8 × 64 = 193,536` 计数正确，原文的骨长/可达性检查和 Idle0 校准是有用证据，但其“最大值”只属于所列离散网格。合法额外样本 `crouch=0, pitch=-1.5, phase=0.4375, speed=4.8, weight=1, direction=(0.8660254037844387,0.5)` 的下沉为 0.12681909165 m，大于网格报告的 0.1258531342 m；不应把后者宣传成连续全域上界。

站立横移约 0.44 m 的最大脚偏移可能形成明显交叉步；数值可达、骨长不变、命中体与骨链一致，都不足以证明自然观感。需要根任务继续在真实 GPU 画面中检查横移/斜向、急停反向、步态过渡、护膝贴合和上下身协调。本程序保留原脚骨旋转，尚未建立脚尖/脚跟滚动、地形贴足和落地动作验收。

薄墙前脚尖穿透与 M01 楼梯进退由 authority/clearance 任务独立处理，本脚本不运行物理世界，不能据此关闭这些问题。联网两设备、GPU 蒙皮、材质和原作动作还原也不在本轮结果范围内。
