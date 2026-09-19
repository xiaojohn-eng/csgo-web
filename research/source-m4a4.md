# 原 M4A4：两队第一人称与连续第三人称交付

本轮资产和 CPU 合同已完成，尚待根任务在实际游戏中验收 GPU、声音时机、换枪和两队拾枪。输入为已安装并验证的 Valve App740 build12426148。`weapon_m4a1` / item16 是 M4A4；item60 `weapon_m4a1_silencer`、`*_m4a1_s.mdl`、`m4_s` 动作族均未替用。

## 固定身份

| 资源 | 原路径 / 合同 | 当前 SHA256 |
|---|---|---|
| M4A4 + IDF CT 臂 FP | `v_rif_m4a1.mdl` 57 骨 + `ct_arms_idf.mdl` 48 骨 | `defbb97f7c799a22b2eab42419a480d1aaffe910ffd17639cdd166360375934a` |
| M4A4 + T 臂 FP | 同一 M4 57 骨 + `t_arms.mdl` 48 骨 | `eed443e06f447daf14ab374189db0a1acb46a6d8605cbb5c5943df35a2a0af28` |
| 独立 world M4 | `models/weapons/w_rif_m4a1.mdl`，94 骨 | `747270206c909be9511ae5c9e9b4dfe25b4fc8a57e9305cb6e33ae203dbb6726` |
| 原 T 身体 + world M4 | 71 + 94 独立 skins | `74b1d0d7a0dbb6edcb726f143ca912a2f84a4bed158f1641a0e6c2fb68d15b13` |
| 原 IDF 身体 + world M4 | 74 + 94 独立 skins | `70dab80d89878cc49755eb4f9f1c835c498ee1de885c82ac9ded17a9b6f875f1` |

第一人称原 attachment `1`→`v_weapon.flash`、`2`→`v_weapon.shelleject`。CT/T 臂各有 47 个原同名骨，34 个实际加权骨全部匹配；唯一非匹配 `Bip01` 保留原局部 rest。每次枪动作采样后拷贝共享 world matrix，再反推手臂 local，保留各自 raw IBM，未将手臂权重改绑到枪 skin。FP 外层变换仍是 Source `(x,y,z)`→camera `(-.0254*y,.0254*z,-.0254*x)`。

## 原动作与武器值

| 用途 | GLB clip | 原帧数 / FPS | 片段跨度 `(frames-1)/fps` |
|---|---|---|---|
| idle | `idle__idle` | 2 / 30 | 0.033333333 s |
| fire | `fire__shoot1` | 9 / 20 | 0.4 s |
| reload | `reload__reload` | 93 / 30 | 3.066666667 s |
| inspect | `inspect__lookat01` | 160 / 30 | 5.3 s |
| draw | `draw__draw` | 35 / 30 | 1.133333333 s |

原配置为 30/90 弹药、damage33、headshot multiplier4、原 `armor ratio=1.4`、penetration2、cycle0.09 s、max player speed225 Source u/s（5.715 m/s）、range8192 u（208.0768 m）、range modifier0.97、silencer0、animation extension `m4`。

原 `AE_WPN_COMPLETE_RELOAD` 在 cycle0.44565218687（约1.366666708 s）。这只是原事件位置，不等于已证明的射击解锁时间；片段跨度也不能直接当闭源武器 next-attack 定时。ClipOut/In/Hit、draw bolt、inspect weaponmove 和 taunt/stattrak 事件均原样保留在 manifest。

已提取 11 个原 sound event 和 12 个唯一 WAV，包括近处 single variants、`Weapon_M4A4.SingleDistant`、boltback/forward、clipout/in/hit、draw、weaponmove1/2/3。没有合成或重新编码声音。逐文件记录原路径、CRC、SHA、采样率、声道、帧数和原 operator 配置；空间衰减/远近事件图仍由根任务接入。

## 材质

FP 的原 `rif_m4a1.vmt` 与 world 的 `w_models/w_rif_m4a1/rif_m4a1.vmt` 分别提取，各用其原 base/exponent PNG。已核对两者 direct Phong 参数与现 AK 适配相同：boost2、Fresnel `[.83 .83 1]`、base alpha mask、exponent R、albedo tint G、disable HalfLambert。材质身份和纹理没有借用 AK。CT 臂继续原 IDF sleeve/glove；T 臂继续原裸臂、fingerless glove 和原 skin lightwarp。

SDK 公式适配仍缺 CS:GO 专属 phongalbedoboost、原环境/ambient cubemap、ambient rim 和原曝光。未将 exponent RGB 当 specularColorTexture，也未宣称浏览器着色器已与原客户端逐像素一致。

world GLB 原导出器在退化 UV 的九个顶点生成了零切线。该原 VMT 没有 normal map；交付仅移除两个 primitive 的无效、未使用 TANGENT 声明，原 accessor/binary 保留。没有改 position/normal/baseUV、索引、原绕序或三角数；未制造替代切线。原始 body 与 world buffer 在组合 GLB 中逐 byte 拼接保留，JSON 只重映射引用并移除不可达旧 AK skin/mesh 节点。未运行量化、简化或重排优化。

## 连续姿态与生产 API

两队均从原 `*_animations.mdl` 的 `*_Upper_M4`、`*_Shoot_M4`、Aim/HandPos/Reload 及其自动层依赖解码，92 descriptors、28 sequences。T 为 1456 帧、CT 为 1459 帧。原 9-way/3-way 参数轴、骨权重、flags、原时钟、父骨映射和原 hitbox bytes 保留。采用已证明的 `anim_3wayblend=1` 默认对应的 SDK3way 分支；不把烘焙组合 clips 当连续自由瞄准。

- T：`/source/csgo-12426148/character-t-m4/`，`csgo-t-m4-12426148:bfe7b6fdd27ca36e`
- CT：`/source/csgo-12426148/character-ct-m4/`，`csgo-ct-m4-12426148:a1662ded736ded00`

```ts
const firstPerson = team === 'blue'
  ? await loadSourceM4A4Viewmodel({baseUrl:'/source/csgo-12426148/m4a4'})
  : await loadSourceM4A4TViewmodel({baseUrl:'/source/csgo-12426148/m4a4-t'});
const gun = firstPerson.createViewmodel();
// 原 SourceVM 接口：sampleSourceViewmodel / updateSourceViewmodel /
// startSourceInspection / startSourceDraw / sourceAttachment。
firstPerson.disposeViewmodel(gun);

const owner = await loadSourceCharacter({baseUrl:
  team === 'blue' ? '/source/csgo-12426148/character-ct-m4/'
                  : '/source/csgo-12426148/character-t-m4/'});
const actor = owner.createActor();
owner.updateActor(actor, authoritativePlayer); // sourcePose + 同一 poseVersion
// 不用本地 dt 另推角色时钟。换武器/队伍须同时切 owner 和权威 poseDriver。
```

`source-character.ts` 用可选 `manifest.weaponId`（旧缺省 ak47）区分固定 GLB SHA、poseVersion 和原状态名字，保留旧 AK 合同。M4 world 只有原 `rifle_fire`，没有 `rifle_fire_crouch`；蹲姿枪械仍选同一个原 world fire，角色上半身则采原 `Crouch_*_Shoot_M4`。未添加假名 clip。world original default/fire/reload/crouch/moving 共六序列与 raw delta arrays 均保留。

当前连续 actor 仍未实现完整原 AnimState、IK、根位移提取、原 reload layer 调度和 IDF beret jiggle。初始地面状态选择是本工程规则，不能宣称完整原动作图。原移动 eye64/46 与 hull72/54 保持独立；MDL eyePosition 不替代玩家视点。

## 验证

- FP：每队 299 原帧 + 每片段两个区间内样本＝309 时间点。CT 14,523 共名骨对、93,318 顶点采样；最大 world matrix/vertex 误差小于 `7e-16 m`。T 使用相同严格逐骨/原 IBM 顶点断言；数值在各自 `runtime-readback.json`。
- 每队连续 pose：40 原 Python world + 40 interior locals、576 次 9-way corners、weight0/mask0、原时标率检查通过。
- T/CT actor 各 40 时间与独立 Python 原 frames→SDK→matrix 对照。最大实际关节误差分别 `4.22e-7 / 4.61e-7 m`；实际蒙皮顶点最大 `2.80e-7 / 3.44e-7 m`。165/168 raw IBM 不变；clone 骨独立、共享几何材质不被单实例释放。
- 独立 world/FP/两队组合 GLB Khronos errors0。loader 测试覆盖 SHA、HTTP 无 WebCrypto、allSettled 失败回收、abort、重复 dispose、队伍/武器错配拒绝。
- 最新整体验证见 `output/source-weapon-sections-final-tests.log` 与 `output/source-weapon-sections-final-tsc.log`；本轮不操作浏览器，GPU/声音与真实切枪验收由根任务继续。

## 可复现入口与原证据

运行 Blender 均用本机5.2.1 `--background --factory-startup --python-exit-code 1`；SourceIO固定 MIT commit `cfc2591d096628a35f570aa830ab75cc8665108b`，只安装项目内，没有修改 addon 源文件。

1. `scripts/import-source-m4a4.py`、`import-source-m4a4-t-viewmodel.py`、`import-source-m4a4-world.py`。
2. `export-source-m4a4-character-poses.py`、`assemble-source-m4a4-character.py`、`reference-source-m4a4-actor.py`。
3. `validate-source-m4a4.mjs`、`validate-source-m4a4-character-pose.ts t|ct`、对应 Vitest。
4. `stage-source-m4a4.py`、`stage-source-m4a4-t-viewmodel.py`、`stage-source-m4a4-characters.py`。

配置证据：`research/source-items-catalog.json` 与 M4 私有 `m4a4-metadata.json` 均可回溯当前 App740 原 items/MDL/VMT/WAV 的 CRC/SHA。闭源游戏内容与 MIT 工具分开保留，暂存目录用于本机/LAN，未发布到公网。

后续武器队列建议：AWP（原 scope/bolt/zoom 与精确射击视点）、USP-S（原 silencer attach/detach 与切换动作）、Glock（单发/三连发和burst时钟）。每把仍需 FP两队、world+连续角色动作族、原配置/声音和真实交互验收，不能只换灰模或贴图。
