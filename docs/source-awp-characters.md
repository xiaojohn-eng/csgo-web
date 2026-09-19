# 原 AWP T/CT 人物图、骨骼合并与命中盒

这是 `a5660eba950083ea341a6ec87cad81a8d14706ec` 之后的独立增量。只新增 AWP 人物模块和资源，没有修改首批 AWP 第一人称、世界枪、音频及其 166 项资源/证据 SHA；没有修改 shared 入口、玩法、原 Deagle 文件、依赖或服务。

交接清单：`docs/source-awp-character-asset-files.json`。新资源位于 `public/source/csgo-12426148/character-t-awp`、`character-ct-awp` 和 `.reference-assets/source-exports/awp-character-candidates`，共 99 个文件、174,666,473 字节。公开资源每队 21 文件，包含人物和 AWP 两个独立 skin、原 f64 数据、原命中盒字节、rig 和 13 张原贴图。纯采样和加载均可在尚未扩展 shared `WeaponId` 的工程中类型检查。

## 原图事实

原本地 App740 build `12426148`、SourceIO `cfc2591d096628a35f570aa830ab75cc8665108b`。原主模型与动画 MDL 再次读取并核对 SHA：

| 原文件 | SHA256 |
| --- | --- |
| `models/player/tm_leet_varianta.mdl` | `4c488531655430042c36ac8c2d17c317b9ab2f1dbbac7f8f6ddc7357e66ad590` |
| `models/player/t_animations.mdl` | `e974b59ff7f7736f6f23efad026764858eb2889823a84be034851a1c2743c1b8` |
| `models/player/ctm_idf.mdl` | `585f84b763f49c0682c715978569e1e0c7dade6f2335b20a36841c2c301b3a24` |
| `models/player/ct_animations.mdl` | `6d6ab1612f3b266f603f6b27e2af83f0c6f11a7dba70aa887f420da48bf6f9f7` |

每队原 AWP 专属 sequence 为索引 **277–299 的 23 条**：五个 9 向 `*_Aim_AWP`，五个 `*_HandPos_AWP`，五个 `*_Upper_AWP`，五个 `*_Shoot_AWP`，以及 `Reload_AWP_Inv / Reload_AWP_seq / Reload_AWP`。加上五个公共下身动作，共 28 条 sequence、92 个 descriptor、1,625 个原帧。T 动画骨骼 71、CT 动画骨骼 70；实际人物骨骼分别 71、74。

每个 Upper 按原顺序累加自身 AWP Aim 和 AWP HandPos。Reload_AWP 按原顺序叠加 `Reload_AWP_seq` 和 `Reload_AWP_Inv`，两层原包络为 start 0、peak `0.04545454680919647`、tail `0.9272727370262146`、end 1。它们不是手枪/AK 动作的改名副本，加载器还会拒绝非 AWP graph、错误武器身份和错误层顺序。

原时长必须分别使用，不能把第一人称 fire 时长套到人物：

| 原人物动作 | 帧 / FPS | 时长秒 |
| --- | --- | --- |
| Idle / Walk / Run `_Shoot_AWP` | 45 / 30 | 1.4666666667 |
| Crouch_Idle / Crouch_Walk `_Shoot_AWP` | 37 / 30 | 1.2 |
| `Reload_AWP` | 111 / 30 | 3.6666666667 |

对原 T/CT 动画 MDL 全部 sequence 名称的检查没有找到单独命名的 scope、zoom 或 bolt 序列。因此没有虚构 `scoped`/`bolt` 人物动画开关。射击层包含原编码动作；开镜与射击时机、朝向、动作层权重仍由玩法提供。世界 AWP 只有原 default 和四条 `sniper_reload*`，没有 world fire 或 pistol aim 包装。

## 显式输入与调用

```ts
const owner = await loadSourceAWPCharacter({team: 't', signal});
const actor = owner.createActor();

const pose: SourceAWPCharacterPoseInput = {
  body: {
    state: 'Idle', cycle: 0, upperCycle: 0,
    fireCycle: .2, fireWeight: 1,
    parameters: {move_x: 0, move_y: 0, body_yaw: 0, body_pitch: 20},
    blendMode: 'sdk-3way',
  },
  bodyLayers: [],
  world: {sequence: 'default', cycle: 0},
};

owner.updateActor(actor, {
  x: 0, y: 0, z: 0, yaw: 0,
  sourceContract: 'csgo-player-12426148',
  sourcePoseVersion: owner.manifest.poseVersion,
  sourceAWPPose: pose,
});
const muzzle = owner.attachment(actor, 'muzzle_flash');
owner.dispose();
```

`loadSourceAWPCharacter` 保持 `manifest / gltf / poseIndex / hashVerified / createActor / updateActor / attachment / disposeActor / dispose` 形状。`sourceAWPPose` 是本增量使用的独立权威字段；根目录未来需把它接进类型、预测/快照、插值、渲染和 rewind。缺少完整姿态或版本不符时 actor 隐藏，不能退回旧武器姿态。

`body.state` 为五种已有原地面状态。`bodyLayers` 只接受 `Reload_AWP`，原 seq/inverse 子层由原图内部处理。各层 cycle、weight、移动向量、body yaw/pitch 都是明确输入；`sourceAWPBodyCycleRate(index, name, parameters)` 给出原序列速率。可选 `clock` 保留游戏 time、startedAt、generation、bodyRate、worldRate，采样器不猜测命令时序。

世界换弹应把 `world.sequence` 设为实际 `sniper_reload` / `sniper_reload_moving` / `sniper_reload_crouch` / `sniper_reload_crouch_moving`，cycle 为自己的原时钟。原 `AE_CL_EJECT_MAG` cycle `0.19090908765792847` 隐藏弹匣，`AE_CL_EJECT_MAG_UNHIDE` cycle `0.30909091234207153` 恢复。

`sourceAWPCharacterWorldEvents` 返回复制的原事件表，调用方拥有已接受事件游标，采样不重复发送音频/网络事件。普通单条世界序列的弹匣可见性由原 cycle 自动决定；若调用方使用 `world.layers` 叠加多个世界动作，则必须显式提供 `magazineVisible`，避免虚构层之间的事件优先级。两种输入均可 JSON roundtrip。

## 原 bone merge 与附件

人物和世界枪保留两个独立 skin。T 165 个、CT 168 个原 IBM 逐 float32 精确，原 body/world GLB 二进制段逐字节保持，不重算绑定姿态。源 body-only 部分只使用人物几何；原未引用 buffer/accessor 留存，GLB 不保留旧武器的活动 clip。

同名 world-space 合并恰好三项，两队一致：

| 世界骨骼 | 人物骨骼 | 原名字 |
| --- | --- | --- |
| 32 | 30 | `weapon_hand_L` |
| 60 | 29 | `weapon_hand_R` |
| 92 | 16 | `ValveBiped.weapon_bone` |

先独立采样原人物图和原世界枪，再将这三项 world 矩阵替换为人物原矩阵，并重新计算世界枪 local 矩阵。没有绑定偏移或手部 IK 替代。14 个原附件随合并后的 world rig 运动；`attachment()` 输出完整浏览器 world 矩阵，包含 actor yaw `π/2` 偏移、一次 `.0254` 单位换算和 Source 附件本身的基坐标。120 个姿态 × 两队 × 14 附件均与独立 Python reference 核对。

## 命中盒和数值边界

`createSourceAWPCharacterHitboxes(index, poseVersion)` 使用相同的完整 AWP body sampler，包括 Reload_AWP 两层；每队原 22 个旋转 OBB 的 68 字节源记录、骨骼、命中组、角度和 radius 字段保留在 body pose 数据。世界枪几何不成为玩家命中盒。

原服务器 `server.so` SHA `7de235c31b2d645c5106cbd7358da3f3ac7964e87f870c4fe6ea31d93a714386` 的 OBB/分组指令，在隔离 x86 解释器中消费独立 Python AWP 完整姿态矩阵，执行 **4,092 条射线**，其中 3,960 条带显式换弹层。JS 适配器的命中组和 head 判定逐条相同；最大距离差 **1.16313623e-6 米**，测试明确限制为 **2e-6 米**。独立 mathutils float32 骨骼 world 矩阵的最大偏差约 1.82 微米，是同一数值量级。

**不是逐 hitbox ID 完全等价：**23 条同一命中组的相邻盒边界选择了不同编号；逐盒再次执行原指令后，14 条原 fraction 完全相等，另 9 条相差最多 2 个 float32 ULP。回归逐条要求对应的原生重放证据、同一组以及 ≤2 ULP。这些编号差异不会改变当前 head/伤害分组，但仍作为浮点边界限制保留；未修改 shared OBB 双精度实现，也未把它们隐藏为完全一致。

## 验证

- 4 个专属测试文件、13 项通过；`npm run typecheck` 通过。
- 每队原帧 payload 与 NPZ 所有 f64 数组逐 SHA/值读回；92 descriptors、1,625 frames、576 个原 9 向边角采样比较，40 个保存的 Python world 姿态及 40 个内部姿态匹配。
- 每队 120 个完整 body/world 原图 reference；与 Python float64 最大矩阵差约 `1.28e-13` Source 单位。Three 关节最大约 `1.23e-12`，两队共 20,280 个独立皮肤顶点检查最大约 `1.20e-12`。
- 原 T 165 / CT 168 个 combined IBM 精确相同。两个 GLB Khronos 均 0 errors、3 个 skinned-node 非 root warnings；父级变换已经完整关节/顶点/actor 矩阵读回覆盖。未引用源 accessor 和当前未使用 tangent 是保留二进制带来的 info。
- Owner 两队各 120 姿态与全部附件矩阵最大误差 `3.56e-14` 米；骨骼克隆独立，原 IBM 不变，SHA 损坏/中止加载释放所有已完成资源。
- 首批 AWP 166 个文件逐项核对保持原 SHA。

本批没有重建完整封闭 AnimState、跳跃/死亡/梯子状态、IK、原根运动提取或 CT 贝雷帽的 jiggle 动力学。原根局部位移保留，CT 三个帽骨保持原 local rest。Source 材质的原 cubemap、phongalbedoboost 和灯光仍是首批声明的差距；没有 GPU、原客户端视觉或 LAN 验收结论。

## 复现顺序

```sh
blender_awp=/Applications/Blender.app/Contents/MacOS/Blender
"$blender_awp" --background --factory-startup --python-exit-code 1 --python scripts/export-source-awp-character-poses.py > output/awp-character-export.log
node scripts/validate-source-awp-character-poses.mjs
python3 scripts/assemble-source-awp-characters.py > output/awp-character-assembly.log
"$blender_awp" --background --factory-startup --python-exit-code 1 --python scripts/reference-source-awp-characters.py > output/awp-character-reference.log
npx vitest run tests/source-awp-character-pose.test.ts
node scripts/validate-source-awp-character-glbs.mjs > output/awp-character-gltf-validation.log
python3 scripts/stage-source-awp-characters.py > output/awp-character-stage.log
.tools/source-binary-venv/bin/python scripts/probe-source-awp-character-hitboxes.py > output/awp-character-native-hitbox.log
# 首次生成边界请求时，这个测试按缺少证据失败；随后执行原生逐盒探针。
npx vitest run tests/source-awp-character-hitboxes.test.ts
.tools/source-binary-venv/bin/python scripts/probe-source-awp-character-hitbox-ties.py > output/awp-character-native-ties.log
npx vitest run tests/source-awp-character-pose.test.ts tests/source-awp-character-owner.test.ts tests/source-awp-character-contract.test.ts tests/source-awp-character-hitboxes.test.ts > output/awp-character-tests.log
npm run typecheck > output/awp-character-typecheck.log
python3 scripts/manifest-source-awp-characters.py
```
