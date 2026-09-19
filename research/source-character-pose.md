# 原 T 角色连续姿态合同

本轮交付纯 TypeScript 任意 cycle 采样，使用官方 App740 build12426148 的 tm_leet_varianta 主骨架及 t_animations 原解码帧。它不依赖 14 条组合烘焙 clips，也没有接入客户端活动状态机、IK、根运动提取或命中求交。

## 文件与原始数据

- `game/source-character-pose.ts`：纯采样、原时钟推进、同骨世界矩阵和命中盒元数据接口。
- `scripts/export-source-character-pose.py`：固定项目内 SourceIO commit cfc2591d096628a35f570aa830ab75cc8665108b；Blender 5.2.1 factory-startup，无 addon 安装。
- `scripts/validate-source-character-pose.ts`、`tests/source-character-pose.test.ts`：原 Python、实际 Three GLB、字节及边界验证。
- `.reference-assets/source-exports/character-t/continuous/pose-data.json`：191,519 bytes，SHA b2106b26a407d0fa5d57843d1df80ed8a406ef99c2ee0a6a2fb8742c321c6b51。
- 同目录 `frames.f64.bin`：5,673,752 bytes，SHA 5b504b956179cc0ba3ddb3e3e6884c10b6d76c144c87c96a3415403389f8ca1e。gzip 1,708,232 bytes。92 描述符、1427 帧、184 个数组全部保留原 float64 数值，未量化。
- 原角色 GLB：`character-t/tm_leet_varianta-source-unit.glb`，11,567,932 bytes，SHA 80ca401f20a7757b56d4ac78f2e81b15f1f9bd50bc25b4313ccf3134be716e59。
- `manifest.json` 保存每数组 SHA，`verification.json` 保存本轮独立读回；`interior-pose-fixtures.json` 增补斜向及分离时钟的 Python 对照。

主骨架 71 骨，动画骨架 71 骨，其中按原名及父名匹配 69 骨。主独有 weapon_hand_R/L 保留原 local rest。原 GLB 的 71 个 inverse bind matrices 原值保留，不能再调用 skeleton.calculateInverses()。

## 验证结果

10/10 专测通过。实际数据验证：40 个已有 Python 样本 ×71 骨，Source world 矩阵最大差 0.000012283 Source 单位，关节位置最大差 0.000012640 单位。参考 Python 的 mathutils 矩阵含 float32 运算，本模块为 float64。另 40 个独立内部方向/不同 upper、fire 时钟样本，原动画本地位置差 ≤8.89e-16、四元数差 ≤3.34e-16。

576 个 9way 角点与原帧吻合；20 个 fireWeight0 恒等检查、340 个 mask0 骨不变检查、72 个原帧跨度时钟检查通过。184 个二进制数组 SHA 与原 NPZ 数组一致，gzip 解压逐字节相同。

通过 GLTFLoader 原实际骨节点回写：Source world 到 Three 的 C 变换最大差 4.27e-14；带旋转、平移、.0254 比例的 actor world 最大差 3.56e-15。原 GLB 残留接近 1 的骨 scale 会累积偏差，故每次写 pose 必须同时恢复骨 scale=(1,1,1)。逆绑定矩阵始终逐元素不变。单次验证机准备约 13ms，40 样本采样均值约 .26ms；这是 CPU 短程观测，不是整局性能或 GPU 质量验收。

## 最小加载与骨更新

```ts
const [data, bytes, gltf] = await Promise.all([
  fetch(base + 'continuous/pose-data.json').then(r => r.json()),
  fetch(base + 'continuous/frames.f64.bin').then(r => r.arrayBuffer()),
  new GLTFLoader().loadAsync(base + 'tm_leet_varianta-source-unit.glb'),
]);
// 生产资产加载器需先检查 HTTP 与 manifest SHA。
const index = prepareSourceCharacterPose(data, bytes);
const byNode = new Map<number, Object3D>();
for (const [object, ref] of gltf.parser.associations)
  if (ref.nodes !== undefined) byNode.set(ref.nodes, object as Object3D);
const p = sampleSourceCharacterPose(index, player.sourcePose);
for (const r of index.data.renderJoints) {
  const bone = byNode.get(r.gltfNode)!;
  bone.position.fromArray(p.renderLocalPositions, r.mainBone * 3);
  bone.quaternion.fromArray(p.renderLocalQuaternions, r.mainBone * 4);
  bone.scale.set(1, 1, 1);
}
gltf.scene.scale.setScalar(.0254); // 外层 Source units→metres，仅一次
actorBrowserTransform.add(gltf.scene);
actorBrowserTransform.updateMatrixWorld(true);
```

不要以 Three 清洗后的 name 直接查原名；GLTFLoader 会移除点等字符。用 manifest 原 glTF node index 与 parser.associations 对应。组合 GLB 的 node indices 与此单角色 GLB 不同，正式加载器必须使用组合文件自己的映射。

`sampleSourceCharacterPose(index, input)` 的 input：

```ts
{
  state: 'Idle' | 'Walk' | 'Run' | 'Crouch_Idle' | 'Crouch_Walk',
  cycle: number,
  parameters: {move_x?: number, move_y?: number,
               body_yaw?: number, body_pitch?: number},
  upperCycle?: number, fireCycle?: number, fireWeight?: number,
  blendMode?: 'sdk-3way' | 'sdk-bilinear'
}
```

默认 upper/fire cycle 与 lower 相同，fireWeight 默认 0，blendMode 默认 sdk-3way。客户端应直接使用权威快照，禁止每个远端角色另以本地 dt 漂移。历史需保留完整 input 和数据版本/hash。此接口不会自己判断跑走/跳跃、平滑站蹲或插入 reload；这些活动切换尚不是已证客户端图。

原网格第 1 轴 move_y，第二轴 move_x；keys 分别 [-1,0,1] 和 [1,0,-1]，保留原反向第二轴。aim 原 keys 为 body_yaw[-60,0,60]、body_pitch[-70,0,70]，采样按 keys clamp。参数不是浏览器世界速度；调用方必须依据共同 actor basis 换算。pose parameter 记录的 loop360 不是已复刻客户端角度归一化。

`advanceSourceSequenceCycle(index, sequence, cycle, dt, parameters)` 由原 fps/(frames-1) 推进；loop wrap，非 loop clamp，返回 unwrapped 供历史插值。`sourceSequenceCycleRate` 用 Studio_CPS 原四角 bilinear 权重，即使姿态采用 3way。Run_lower 真实 9way 中混合 20 和21帧 @30fps，不能统一取某一条时长；单帧 aim 不产生循环速率。

## 坐标与同骨命中

`sourceWorldMatrices` 是 71×16 列主序、原 Source 坐标/单位。`renderLocalPositions/Quaternions` 仅根骨前乘 C=(x,z,-y)，子骨保 Source local basis。原 IBM = sourceInverseBind * inverse(C)，不采用共轭变换。

```ts
const browserBones = sourceCharacterBrowserBoneMatrices(
  p, actorBrowserTransform.matrixWorld.elements, .0254,
);
// 每骨：actor * scale(.0254) * C * sourceBoneWorld
const rawHits = sourceCharacterHitboxTransforms(index, p);
```

此转换与实际 Three 渲染父变换逐矩阵比过。actorMatrix 必须与渲染使用同一浏览器旋转和平移，函数不猜 yaw 朝向。若 actorMatrix 已含单位换算，不要再传 .0254；建议保持 actor 米制根、模型子节点统一 .0254。

原 MDL 有 cstrike 1 套22个 hitbox，原 bone id、group、min/max、name 已核实，每项68字节原包及32字节扩展原样保留。固定公开 SDK2013 将扩展称 unused[8]，本轮未验证本 CS:GO 构建的旋转/半径解释，因此未声称它们都是轴对齐盒或胶囊；`sourceCharacterHitboxTransforms` 只返回元数据及同一采样 Source bone matrix。角色MDL eyePosition=73与游戏 view64/46、hull72/54无替换关系。

## 来源和明确缺口

- 原 assets 来自官方 SteamCMD 匿名 App740 build12426148，本机元数据与 depot ACF 已另留证。
- [Valve bone_setup.cpp](https://github.com/ValveSoftware/source-sdk-2013/blob/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/src/public/bone_setup.cpp)：3way、BlendBones、SlerpBones、sequence cycle rate、layer 次序。
- [Valve mathlib_base.cpp](https://github.com/ValveSoftware/source-sdk-2013/blob/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/src/mathlib/mathlib_base.cpp)：QuaternionScale、delta乘法参考。
- [Valve studio.h](https://github.com/ValveSoftware/source-sdk-2013/blob/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/src/public/studio.h)：结构和 flags，公开 SDK 并非完整 CS:GO 客户端源码。

绝对帧/同序列是 normalized lerp，累积是 slerp；delta采用 SDK QuaternionScale 并遵循 POST 右乘；mask值实际参与累积，自动层仅已见 flags0。未知特殊 sequence/layer flags 与反向 fixed-alignment slerp极端分支明确拒绝，不静默套近似。

原 anim_3wayblend 编译默认1已有独立 App740 binary 证据，运行时 override 未测。根 local 编码保持原样，不从 pelvis 曲线推导移动补偿。原 IK、procedural骨、root movement提取、客户端活动图、手握IK和真正客户端逐帧外观尚未建立等价性。
