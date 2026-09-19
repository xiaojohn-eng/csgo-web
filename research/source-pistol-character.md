# 原 Glock / USP 双队第三人称：完整姿态图与 owner

本轮完成四套原角色＋原世界手枪的独立 owner、连续原图采样、严格 SHA staging、CPU 与实际 WebGL 验收。没有修改已冻结的 AK/M4 pose/character/shared VM，也没有把手枪接入菜单、Simulation 或对战。此处“完整图”指本 MDL 中所选 PISTOL lower/upper/shoot、原 reload/silencer 包装层、世界模型五个 9way 自动层与显式 action layers 都被保留并采样；不等于闭源 CS:GO AnimState/IK、模式或事件调度器已复刻。

## 原自动层的关键取证

原世界模型 `pistol_aim_t` 的五个 24 B auto layer 都是 flags **16448 = 0x4040 = POSE | SPLINE**，`start=end=0`、`peak=0`、`tail=1`，pose id 2…6。旧 [Valve SDK2013 bone_setup.cpp](https://github.com/ValveSoftware/source-sdk-2013/blob/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/src/public/bone_setup.cpp) 的 `AddSequenceLayers` 不包含此处实际游戏使用的 0/0 特殊分支，不能据此把五层全当 weight=1。

本机已验证 App740 build 12426148 原 `server.so`（SHA `7de235c31b2d645c5106cbd7358da3f3ac7964e87f870c4fe6ea31d93a714386`）的实际入口 **0xebcf20**、特殊分支 **0xebd180…0xebd255** 已通过 Unicorn 执行。以原 MDL 参数范围与层记录代入 standalone 非 virtual 查表适配，截取真正 `AccumulatePose` 调用：

1. 由原 normalized pose 与原参数 start/end 回到物理值。
2. `clamp((physicalPose - peak)/(tail - peak), 0, 1)`。
3. 原 `SimpleSpline(t)=3*t*t-2*t*t*t`，保持实指令 float32 的运算顺序与夹取。
4. 乘父 weight，保留父 cycle，按原五层顺序提交。

`sourcePistolPoseLayerWeight` 精确保留 f32 中间舍入。原指令 **660 案例**（两枪、五个活动权重、越界/边界/内部参数、三个父 weight、两个 cycle）均 weight/cycle/order 完全相同，最大误差 **0**。证据 `output/tests/source-pistol-autolayers-native.json`、`output/source-pistol-autolayer-consumer.asm`；可复现 `scripts/probe-source-pistol-autolayers.py`。这是实际原层请求分支取证，未把模型查表适配、独立数学合成或整个客户端执行误称原生游戏骨计算。

## 文件、骨架与身份

| 队伍/武器 | 角色 / 世界骨数 | poseVersion | staged 字节（含 manifest） |
|---|---:|---|---:|
| T Glock | 71 / 93 | `csgo-t-glock-12426148:1e0ca4177e00dcab` | 43,478,514 |
| T USP | 71 / 95 | `csgo-t-usp-12426148:02994d747933077d` | 39,282,901 |
| CT Glock | 74 / 93 | `csgo-ct-glock-12426148:2a853dc6a326b200` | 55,328,343 |
| CT USP | 74 / 95 | `csgo-ct-usp-12426148:3bb195d1317bac0c` | 51,134,270 |

默认路径 `/source/csgo-12426148/character-{t,ct}-{glock,usp}`。每套 19 个文件，共 **76** 个；每个文件的大小/SHA 已最终读回。固定 manifest/model/rig SHA 在 `game/source-pistol-character-contracts.ts`；完整 receipt 在 `output/source-pistol-character-staged.json`、`output/tests/source-pistol-character-final-readback.json`。

原 T/CT 角色几何、主骨与原 IBM 来自已冻结 `tm_leet_varianta` / `ctm_idf` 原组合中的角色部分；原世界枪来自 `w_pist_glock18` / `w_pist_223`。两个原 BIN 段逐字节保留，包括原顶点、UV、索引、图片和原 f32 inverse bind；移除旧 AK 活动节点并追加原手枪，保留两个独立 skin，输出无烘焙 animation clips。GLB 有少量未引用旧数据，体积不是最小；没有以优化为由改变原几何。Khronos 四套均 **0 error**，3/4 个 `NODE_SKINNED_MESH_NON_ROOT` warning 保留，实际带平移/旋转/米制父节点的 Three 皮肤矩阵已独立验证。

原角色两族各 **98 descriptors / 34 sequences**，T 2258 帧、CT 2262 帧；Glock world **53 descriptors / 13 sequences / 385 帧**，USP world **61 descriptors / 21 sequences / 1227 帧**。源 FPS、帧数、delta/post、固定四元数 alignment、原 masks、9way keys、auto layer 顺序、根局部平移及原 hitbox 小数据均保留。全部使用已修 Source1 section 末帧 decoder；新 world 全帧与先前已验 simple 原帧数组重合部分逐分量误差 0。

原 bone merge 只匹配 **weapon_hand_L、weapon_hand_R、ValveBiped.weapon_bone** 三个名字：先各自采样，再拷贝同名 Source **world**，其他武器骨保留其原局部并依序计算；绝不把 93/95 骨直接绑定成 71/74 骨。GLB 逆绑定矩阵保持 `rawSourceIBM * inverse(C)`，不是共轭。`C` 是 Source `(x,y,z)→(x,z,-y)`；actor 外层一次 `.0254` 和 `yaw + pi/2`。

## 最小客户端、服务端合同

```ts
import {loadSourcePistolCharacter} from '@/game/source-pistol-character';
import {sampleSourcePistolCharacterPose} from '@/game/source-pistol-character-pose';
const owner = await loadSourcePistolCharacter({team:'ct', weapon:'usp'});
const actor = owner.createActor();
scene.add(actor.root);
const pose = {
  body: {state:'Idle' as const, cycle:.3, fireWeight:0,
    parameters:{move_x:0, move_y:0, body_yaw:17, body_pitch:-9}},
  bodyLayers: [],
  world: {parameters:{body_yaw:17, body_pitch:-9,
    aim_blend_stand_idle:1, aim_blend_stand_walk:0, aim_blend_stand_run:0,
    aim_blend_crouch_idle:0, aim_blend_crouch_walk:0}, cycle:.3, layers:[]},
  silencerVisible:true, magazineVisible:true,
}; // 明确的示例输入，不是已证明的 AnimState 权重选择器
owner.updateActor(actor, {x:0,y:0,z:0,yaw:0,
  sourceContract:'csgo-player-12426148',
  sourcePoseVersion:owner.manifest.poseVersion, sourcePistolPose:pose});
const same = sampleSourcePistolCharacterPose(owner.poseIndex, pose);
// same.body.sourceWorldMatrices 是角色命中、历史回溯应使用的同源骨矩阵。
owner.disposeActor(actor); // 仅此实例骨架
owner.dispose(); // 所有实例 + 共享材质/纹理/几何
```

`loadSourcePistolCharacter({team,weapon,baseUrl?,signal?,loadingManager?})` 返回 `gltf, poseIndex, manifest, surfaces, hashVerified, createActor, updateActor, attachment, disposeActor, dispose`。所有读取 `cache:'no-cache'`；manifest 本身固定 SHA，模型/rig/pose/frames/实际加载 PNG 均检查清单 SHA。HTTP LAN 无 WebCrypto 时仍用已有安全 SHA 实现。`hashVerified` 是已请求文件的字典，不把未请求的材质说明 JSON 冒称网络下载成功。staging 全部文件另已校验。`allSettled` 保证某项失败或 abort 后仍回收晚到纹理；clones 骨架/IBM 独立，geometry/material 由 owner 共享。

纯层输入 `SourcePistolCharacterPoseInput`：

- `body` 沿用原连续 `SourceCharacterPoseInput`。允许的 `bodyLayers` 为精确原 `Reload_PISTOL`、`Silencer_Attach_Pistol`、`Silencer_Detach_Pistol`，每层显式 `sequence/cycle/weight`。
- `world.parameters` 必须给 body_yaw/body_pitch（Source 度）与五个 `aim_blend_*` 原参数；不会在 loader 内按站/蹲猜权重。原 `pistol_aim_t` 五层永远保留并按原权重计算。
- `world.layers` 是按给定顺序的原 world 片段，保留站/动/蹲 reload，USP ON/OFF 及 alt fire。`sourcePistolWorldCycleRate` 只对普通原 sequence 给 `fps/(frames-1)`，不推断特殊 wrapper 的闭源时钟。
- USP `silencerVisible` 必填；弹匣 `magazineVisible` 默认为 true。显示事件的权威时序属于后续状态机，本 owner 不提交模式/弹量，也没有本地累计 dt。
- `sourcePoseVersion` 或 Source player contract 不匹配时角色隐藏并标 invalid-authority；不降级到 C02、AK 或 M4。
- `attachment(actor,原名字)` 返回原 attachment Source 局部轴在浏览器世界中的矩阵，含 `.0254`。平移可直接作为附件位置；不要把它误当 glTF 已换基 attachment 的完整矩阵，也不要无证据猜某个 marker 的开火模式。

**命中接口必须一起接。** 目前旧 `game/source-hitboxes.ts:createSourceHitboxes` 内部仅 `sampleSourceCharacterPose(index,p.sourcePose)`，不消费新增 bodyLayers。接手枪时必须把完整 `sourcePistolPose` 和版本写进 Player、history、snapshot、timeline，并从 `sampleSourcePistolCharacterPose(index,input).body.sourceWorldMatrices` 构造同一原 hitbox transform；否则 reload/silencer 会出现可见身体和权威判定不同。原站64/蹲46 eye、72/54 hull 的 movement 合同仍独立，不用 MDL eyePosition 代替玩家视点。普通枪伤 provider、exact local hitbox angles/radius 原取证不需要改变，姿态供应函数需要换成此完整结果。

## 验收与边界

`tests/source-pistol-world-pose.test.ts`、`source-pistol-character-pose.test.ts`、`source-pistol-character-owner.test.ts` 共 **20/20**；新模块、专测和预览的 strict 类型检查通过。

- 每枪 77 个独立 Python 完整 world graph 样本、45 个直接原 9way 角点；660 原 x86 自动层 requests 全等。
- 四套各 60、共 **240** 个独立 Python 原 NPZ + SDK 数学 + NumPy float64 world/bone-merge 案例。包含原 lower/upper/fire、reload/attach/detach、显式权重和连续时钟。角色世界矩阵最大误差 **3.76e-12 Source u**，世界枪最大 **7.82e-14 u**。
- 实际 GLTFLoader/Three 每根骨的矩阵与双皮肤 IBM、**18,360** 个独立加权蒙皮顶点检查通过。实际带 actor 旋转平移比例的浏览器矩阵误差最大 **1.60e-13 m**。这是独立数学/实际 Three 数值一致性，不是原闭源骨计算 oracle。
- 特别记录：CT Glock case38 reload 隐藏 clip helper 原位置约 7,000 u。mathutils float32 world 比较有 **.002148 u** 偏差，而两实现 animation local 差仅 2.23e-16；独立 NumPy float64 世界计算把该误差定位为参考累计精度，未修改原数据、动作或放宽判定来掩盖它。

实际 GPU 使用独立 Playwright session `pistol-character-reference` 与私有新预览：`http://127.0.0.1:27018/assets/source-exports/pistol-character-preview/index.html`。四套共 **36 张实际截图**，hold/fire/reload 早中晚/蹲行换弹/两原 aim 层混合与 USP attach/detach 早晚均实际绘制，原 shader 实编译，console/page/HTTP `errors=[]`；四次 wrong-version 拒绝和卸载后 **geometry=texture=program=0**。完整证据 `output/playwright/source-pistol-characters-gpu.json`。

人工独立读图覆盖 T Glock 换弹、CT Glock 换弹、两队 USP 装卸消音器与混合持枪：人物和真实手枪已显示，动作明显变化，未见骨架爆开或整枪脱离。近景仍存在手指与握把接触精细度、原 IK 和中性照明下高光差异边界，不宣称 CS:GO 客户端视觉逐帧等价。预览的显隐布尔、动作权重和状态组合是**测试输入**，不是证明原动画事件的时点。staged manifest 中 GPU-pending 表述保留生成当时状态，本轮后续 GPU receipt 是当前验收证据，不为状态文字重写已测资源。

World USP 材质独立消费原 VMT：**boost5、Fresnel [.2,.5,1]、白色 specular tint、HalfLambert**；不能复用 FP 的 boost8/albedo tint/noHalfLambert。World Glock 使用 boost1、[.83,.83,1]、exponent G albedo tint、base-alpha Phong。原 Source ambient/local cubemap、ambient rim、Glock albedoboost35 与原照明/tone mapping 仍未完成。

## 可复现流水线

```sh
# 已安装本机原文件 + 固定 SourceIO；全程不改 Blender 全局设置。
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python-exit-code 1 --python scripts/export-source-pistol-world-pose.py
.tools/source-binary-venv/bin/python scripts/probe-source-pistol-autolayers.py
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python-exit-code 1 --python scripts/reference-source-pistol-world-pose.py
python3 scripts/assemble-source-pistol-characters.py
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python-exit-code 1 --python scripts/reference-source-pistol-characters.py
node_modules/.bin/vitest run tests/source-pistol-world-pose.test.ts tests/source-pistol-character-pose.test.ts
python3 scripts/stage-source-pistol-characters.py
# 新导出导致清单 SHA 改变时，需核验并显式更新新 contracts；不会自动放宽。
node_modules/.bin/vitest run tests/source-pistol-character-owner.test.ts
node scripts/build-source-pistol-character-preview.mjs
# 独立浏览器通过 scripts/browser-source-pistol-characters.pw.js 重放。
```
