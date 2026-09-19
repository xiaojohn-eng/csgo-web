# 原 AWP 独立资产增量

来源为本机 App740 build `12426148` 原安装，item definition `9`、`weapon_awp`、动画扩展 `awp`。导出前已查现有私有候选和 output，没有 AWP 导出缓存。SourceIO 固定为 `cfc2591d096628a35f570aa830ab75cc8665108b`，Blender `5.2.1 LTS`。本增量只新增 AWP 文件，没有修改 Deagle、shared gameplay/runtime/assets、依赖或运行服务。

原文件及 SHA256：

| 文件 | SHA256 |
| --- | --- |
| `models/weapons/v_snip_awp.mdl` | `37e15ab1db5613843df7efaf2dc61cf3dc5dc1642a4eee74f74596c10b56e0c3` |
| `models/weapons/w_snip_awp.mdl` | `c44d2295db6dbf7cc58c9695593faf7d7954232bbd203fed6972b5cbd84ae93d` |
| `scripts/items/items_game.txt` | `510e09b68a01d88edba2342972960025fd6484aaaa58365fcf47d8513de79623` |

T/CT 手臂直接复用已核实原 `t_arms.mdl` / `ct_arms_idf.mdl` 的骨骼与贴图，不使用替代枪或生成图。完整原始依赖、VMT、VTF→PNG、WAV、原序列字段、section decoder 读回及 SHA 在 `.reference-assets/source-exports/awp-candidates`，逐文件交接清单为 `docs/source-awp-asset-files.json`。

## 第一人称

`public/source/csgo-12426148/awp-t` 和 `awp-ct` 各保留 57 个原枪骨骼、48 个原手臂骨骼、47 个精确同名绑定、34 个有权重的手臂骨骼、2 个原附件 `1`/`2`、全部 7 个序列，总计 435 帧。GLB 中保存原帧，两个 skin 的 105 个 IBM 均为逐 float32 精确的 `originalIBM * inverse(C)`；`C` 是 Source→glTF 的 `(x,z,-y)` 轴转换。

| 原 sequence | 帧 / FPS | 时长秒 | 原 activity | sequence flags |
| --- | --- | --- | --- | --- |
| `awp_idle` | 2 / 30 | 0.0333333333 | `ACT_VM_IDLE` | 0 |
| `awp_fire` | 51 / 30 | 1.6666666667 | `ACT_VM_PRIMARYATTACK` | 2 |
| `awp_draw` | 31 / 24 | 1.25 | `ACT_VM_DRAW` | 2 |
| `awp_reload` | 111 / 30 | 3.6666666667 | `ACT_VM_RELOAD` | 2 |
| `lookat01` | 151 / 30 | 5 | 空 | 0 |
| `lookat01_prepare` | 32 / 30 | 1.0333333333 | 空 | 0 |
| `lookat01_loop` | 57 / 15 | 3.7333333333 | 空 | 0 |

这 7 个 descriptor flags 均为 64。`lookat01_loop` 原序列 flags 为 **0**，不能从名字推断为自动循环；inspection 三项 activity weight 为 0。原文件 activity 数字为注册前 `-1`，原字符串、权重、flags、fade、descriptor 和所有事件均保存在公开 manifest 的 `sourceSequences`，不猜测引擎注册编号。

必须保留的原事件：

- `awp_fire`：5001 枪口事件 cycle 0、`AE_WPN_UNZOOM` cycle `0.20000000298023224`、BoltBack `0.36000001430511475`、BoltForward `0.5600000023841858`、`AE_CLIENT_EJECT_BRASS` `0.46000000834465027`。弹壳为延时原事件，不应在开火时再发一次。
- `awp_draw`：Draw cycle 0、BoltBack `0.23333333432674408`、BoltForward `0.46666666865348816`。
- `awp_reload`：ClipOut、ClipIn、ClipHit、BoltBack、BoltForward 分别为 `0.06363636255264282`、`0.3636363744735718`、`0.5454545617103577`、`0.699999988079071`、`0.8090909123420715`；`AE_WPN_COMPLETE_RELOAD` 为 `0.5454545617103577`，约原时间 2 秒。
- 检视的原 StatTrak glow 和 `AE_BEGIN_TAUNT_LOOP` 事件也保留。调用方负责对应行为；资源 owner 不自行提交弹药、循环检视或调度权威事件。

接口：

```ts
const fp = await loadSourceAWPViewmodel({team: 't', signal});
const model = fp.createViewmodel();
fp.sampleViewmodel(model, {sequence: 'awp_fire', timeSeconds: .5});
const attachment = sourceAWPAttachment(model, '1', model);
fp.disposeViewmodel(model);
fp.dispose();
```

与现有 owner 保持 `manifest / gltf / createViewmodel / sampleViewmodel / fetchFile / disposeViewmodel / dispose` 形状。拥有者 SHA 校验后才返回，克隆骨骼相互独立。外层已经且仅一次施加 yaw `π/2`、scale `.0254`；附件矩阵使用 glTF 基坐标，相对于传入的 Object3D。

## 世界模型与原始姿态

`public/source/csgo-12426148/awp-world` 包含原 `w_snip_awp` 和独立弹匣网格、94 骨骼、94 原 IBM、14 原附件、完整五个普通 sequence：`default` 1 帧，`sniper_reload` / `sniper_reload_moving` / `sniper_reload_crouch` / `sniper_reload_crouch_moving` 各 111 帧、30 FPS、3.6666666667 秒，共 445 帧。

原 AWP 世界图没有 `pistol_aim_t`，也没有任何 aim auto layer。这里保留实际 94 骨骼和五条原图，不替换为 Deagle/Glock/USP 的 9 向图。人物 AWP graph、人物/world bone merge、authority pose driver 需要后续独立接入。

14 个附件是 `legacy_weapon_bone`、`weapon_hand_L`、`weapon_hand_R`、`__illumPosition`、`muzzle_flash`、`shell_eject`、`mag_eject`、`camera_inventory`、`camera_buymenu`、`sticker_a/b/c/d`、`left_hand_attach`。world 四个换弹 sequence 的原 `AE_CL_EJECT_MAG` cycle `0.19090908765792847` 隐藏弹匣，`AE_CL_EJECT_MAG_UNHIDE` cycle `0.30909091234207153` 恢复；切回 default 恢复可见。

```ts
const world = await loadSourceAWPWorld({signal});
const model = world.createWorldModel();
world.sampleWorldModel(model, {sequence: 'sniper_reload', timeSeconds: .8});
world.attachment(model, 'muzzle_flash', model);
// 后续人物 bone merge 可以直接消费原始姿态：
sampleSourceAWPWorldPose(world.poseIndex, {sequence: 'sniper_reload', cycle: .3});
world.dispose();
```

独立 world owner 直接消费通过 Python/mathutils 核对的 f64 原帧。开发中测得 glTF 对导出帧之间插值与 Source 原 quaternion 插值约有 `0.000505` 个 Source 单位差异，因此没有放宽运行时姿态阈值；owner 使用原 pose 后，测试中所有骨骼矩阵与原 sampler 的差异小于 `1e-10`。GLB 仍保留全部原 clip，方便离线检查。

纯接口 `prepareSourceAWPWorldPose / sampleSourceAWPWorldPose / sourceAWPWorldCycleRate / sourceAWPWorldMatrices` 不依赖 shared WeaponId。允许按显式顺序叠加实际 world sequence；不生成不存在的 AWP 人物瞄准权重。

## 声音和材质

`loadSourceAWPAudio(audioEngine,{signal})` 在返回前读取并验证 15 个不同原 WAV；`event(name, volume, pan, position, occluded)` 支持原音名大小写归一化、原音量和 pitch 范围。`timeline` 只包含动画中的声音事件及秒时间；UNZOOM、弹壳、reload completion 属于 FP manifest 的行为事件，不能从音频 timeline 触发。

声音包含两条 `Weapon_AWP.Single`、SingleDistant、Draw、BoltBack/Forward、ClipOut/In/Hit、WeaponMove1/2/3，以及 `Default.NearlyEmpty`、`Default.ClipEmpty_Rifle`、`Weapon_AWP.Zoom`。Zoom 和空仓不在原 FP 声音事件引用中，已从原 `game_sounds_weapons.txt` 及 VPK 索引独立读取，长度/CRC32/逐 SHA 读回；没有猜测路径。具体键、WAV SHA、音量、pitch 和时间在 `game/source-awp-audio.json`。

新 `source-awp-materials.ts` 保留原 AWP FP boost 2、world boost 1、Fresnel `[.8,.8,1]`。FP/world 原 base/exponent 图分别取自各自原 VMT。独立 `scope_awp` 材质使用原 scope base + normal、normal alpha 高光 mask、固定 exponent 200、tint `[.8,1,.9]`、Fresnel `[.2,.2,1]`；保留原 scope tangent，并按现有 Source normal 约定设置 normalScale `(1,-1)`。

镜身材质不代表游戏开镜：瞄准镜 overlay、FOV、遮挡和光学 camera 行为由主任务接入。Source 原 cubemap、`phongalbedoboost` 和原灯光仍是现有 shader 适配的明确差距；本包没有做 GPU 或原客户端视觉等价承诺。

## 独立验证与复现

4 个专属测试文件共 **13 项通过**，`npm run typecheck` 通过。覆盖两队全部 FP clip/附件/骨骼克隆、原行为事件、scope shader 参数、损坏 SHA 拒绝及清理、15 声音载入/释放、world 所有 sequence 与原 Python 插值参考、弹匣事件边界。

| 验证 | 数量 | 最大误差，Source 单位 |
| --- | --- | --- |
| 每队 FP 原帧 / 枪矩阵 / 手臂矩阵 / 附件矩阵 | 435 / 24,795 / 20,880 / 870 | 0.00003831 |
| 每队原 IBM | 105 | float32 完全相等 |
| world 原帧 / 骨骼矩阵 / 附件矩阵 | 445 / 41,830 / 6,230 | 0.00006971 |
| world 原 IBM | 94 | float32 完全相等 |
| 独立原 NPZ + Python/mathutils | 30 个姿态 × 94 骨骼 | local `2.23e-16`、world `0.00001985` |
| 三个 GLB Khronos 检查 | 各 0 errors | 各 2 个 skinned mesh 非根节点 warnings；父级变换已经独立矩阵读回覆盖 |

原数值读取器在 Node 中只省去图片解码，几何、skin、IBM、动画二进制保持不变；这属于资产和 CPU 验证，真实浏览器画面、原客户端观感与 LAN 游戏体验仍需主集成验证。

复现顺序如下，所有新 wrapper 对复用脚本文本进行显式 token 断言，公共管线变化时会停止，不会默默换资产：

```sh
blender_awp=/Applications/Blender.app/Contents/MacOS/Blender
candidate_awp=.reference-assets/source-exports/awp-candidates
"$blender_awp" --background --factory-startup --python scripts/inventory-source-awp.py
"$blender_awp" --background --factory-startup --python scripts/import-source-awp-viewmodel.py -- --weapon awp --team t
"$blender_awp" --background --factory-startup --python scripts/import-source-awp-viewmodel.py -- --weapon awp --team ct
"$blender_awp" --background --factory-startup --python scripts/import-source-awp-world.py -- --weapon awp
python3 scripts/finalize-source-awp.py "$candidate_awp/awp-t" "$candidate_awp/awp-ct" "$candidate_awp/awp-world"
node scripts/validate-source-pistol.mjs "$candidate_awp/awp-t" > output/awp-fp-t-validation.log
node scripts/validate-source-pistol.mjs "$candidate_awp/awp-ct" > output/awp-fp-ct-validation.log
node scripts/validate-source-pistol-world.mjs "$candidate_awp/awp-world" > output/awp-world-validation.log
"$blender_awp" --background --factory-startup --python scripts/export-source-awp-world-pose.py
"$blender_awp" --background --factory-startup --python scripts/reference-source-awp-world-pose.py > output/awp-world-reference.log
node scripts/validate-source-awp-world.mjs > output/awp-world-dense-validation.log
"$blender_awp" --background --factory-startup --python scripts/extend-source-awp-audio.py > output/awp-audio-extend.log
python3 scripts/stage-source-awp.py
python3 scripts/stage-source-awp-audio.py
python3 scripts/stage-source-awp-world.py
npx vitest run tests/source-awp-owner.test.ts tests/source-awp-audio.test.ts tests/source-awp-world-pose.test.ts tests/source-awp-world-owner.test.ts > output/awp-tests.log
npm run typecheck > output/awp-typecheck.log
python3 scripts/manifest-source-awp.py
```

`extend-source-awp-audio.py` 是已完成 GLB 导出后补齐音效的幂等工具；新导出器本身已经包含 Zoom 和 ClipEmpty_Rifle，不必再调用它。所有资源文件保持未纳入 Git，按交接清单逐 SHA 复制；公共入口、scope/gameplay/native command/audio engine 注册均由主任务后续集成。
