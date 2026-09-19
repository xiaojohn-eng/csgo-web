# 原 Glock-18 / USP-S 候选与第一人称 owner

后续状态：四套第一人称已由根任务实际 GPU 验收（`output/playwright/source-pistols-gpu.json`）；双队第三人称完整五自动层、连续 graph、独立 owner 与 36 张 GPU 图已见 [source-pistol-character.md](source-pistol-character.md)。下文保留第一阶段导出收据与当时边界，第三人称未完成的旧陈述已由该后续报告取代。

本轮完成原 App740 build **12426148** 两种手枪的四套 T/CT 第一人称资产、独立 production owner 与本机 staging。**尚未接菜单、装备、Simulation 或真实 GPU；不是完整手枪玩法验收。** 原双队第三人称 Pistol pose 数据及各自 world 武器仍为私有候选，不用 AK 骨架或姿态代替。

## 原始身份与模式字段

来源是已验证安装的 `scripts/items/items_game.txt`、原 VPK 内 MDL/VVD/VTX/VMT/VTF/WAV。完整解析与逐文件 SHA/CRC 在 `.reference-assets/source-exports/pistol-candidates/inventory.json`；item 源 SHA `510e09b68a01d88edba2342972960025fd6484aaaa58365fcf47d8513de79623`。历史 App740 安装/version/manifest 证据在 `output/steamcmd-app740-tcp.log`、原 ACF 与 `research/official-csgo-assets.md`。

| 字段 | Glock-18 | USP-S |
|---|---|---|
| Item | 4 `weapon_glock` | 61 `weapon_usp_silencer` |
| item_class / anim_class | weapon_glock | **weapon_hkp2000 / weapon_usp_silencer** |
| FP / world MDL | v_pist_glock18 / w_pist_glock18 | **v_pist_223 / w_pist_223** |
| 弹匣 / 备用 | 20 / 120 | 12 / 24 |
| primary_ammo | BULLET_PLAYER_9MM | BULLET_PLAYER_357SIG_SMALL |
| Damage / head multiplier / raw armor ratio | 30 / 4 / .94 | 35 / 4 / 1.01 |
| range / modifier / penetration | 4096 u / .85 / 1 | 4096 u / .91 / 1 |
| speed / alt speed | 240 / 240 u/s（6.096 m/s） | 240 / 240 u/s |
| full auto / burst / silencer | 0 / 1 / 0 | 0 / 0 / 1 |
| cycletime / alt | .15 / .3 s | .17 / .3 s |
| 原 burst 专用字段 | cycle .5 s；time between burst shots .05 s | 无 |
| player_animation_extension | **pistol** | **pistol** |

以上是原配置值，尚未执行实际本 build Glock/USP 状态机。不能仅凭 `cycletime alt` 推断每种模式实际 fire timer，不能把模型时长或 AE_WPN_COMPLETE_RELOAD 当成射击解锁时点。Glock 后续的 burst shot 数量、排队/取消/剩余弹量逻辑仍需独立原 binary/运行证据；当前 owner 不虚构它们。

## 第一人称原片段与模式边界

| 武器 | 输出 clip | 原帧数 / FPS | 原 duration s | 原 activity |
|---|---|---|---|---|
| glock | `idle__glock_idle` | 2 @ 30 | 0.033333333 | `ACT_VM_IDLE` |
| glock | `fire__glock_firesingle` | 13 @ 30 | 0.400000000 | `ACT_VM_PRIMARYATTACK` |
| glock | `fire_last__glock_firelast` | 13 @ 30 | 0.400000000 | `ACT_VM_DRYFIRE` |
| glock | `draw__glock_draw` | 34 @ 30 | 1.100000000 | `ACT_VM_DRAW` |
| glock | `reload__glock_reload` | 69 @ 30 | 2.266666667 | `ACT_VM_RELOAD` |
| glock | `inspect__lookat01` | 194 @ 30 | 6.433333333 | `` |
| usp | `idle__idle` | 50 @ 30 | 1.633333333 | `ACT_VM_IDLE` |
| usp | `attach__attach` | 146 @ 30 | 4.833333333 | `ACT_VM_ATTACH_SILENCER` |
| usp | `detach__detach` | 146 @ 30 | 4.833333333 | `ACT_VM_DETACH_SILENCER` |
| usp | `fire_1__shoot1` | 13 @ 30 | 0.400000000 | `ACT_VM_PRIMARYATTACK` |
| usp | `fire_2__shoot2` | 13 @ 30 | 0.400000000 | `ACT_VM_PRIMARYATTACK` |
| usp | `fire_3__shoot3` | 13 @ 30 | 0.400000000 | `ACT_VM_PRIMARYATTACK` |
| usp | `fire_empty__shoot_empty` | 13 @ 30 | 0.400000000 | `ACT_VM_DRYFIRE` |
| usp | `reload__reload` | 66 @ 30 | 2.166666667 | `ACT_VM_RELOAD` |
| usp | `draw_silenced__draw` | 31 @ 30 | 1.000000000 | `ACT_VM_DRAW_SILENCED` |
| usp | `draw_unsilenced__draw_silenced` | 31 @ 30 | 1.000000000 | `ACT_VM_DRAW` |
| usp | `inspect__lookat01` | 194 @ 30 | 6.433333333 | `` |

- **USP 原 sequence 名称和 activity 反向**：`draw` 对 ACT_VM_DRAW_SILENCED，起点 SHOW_SILENCER；`draw_silenced` 对 ACT_VM_DRAW，起点 HIDE_SILENCER。owner 使用精确原 sequence，不按英文名称猜模式。
- `shoot1/2/3` 同为 ACT_VM_PRIMARYATTACK，全部保留；哪个变体被原状态机选中尚未移植。Glock `glock_firelast` / USP `shoot_empty` 原 activity 均 ACT_VM_DRYFIRE，不自行等同普通 fire。
- USP attach/detach 各 146 @ 30，4.833333333 s；原完成事件 cycle .6965517401695251，对应约 3.366666748 s。显隐事件分别独立。这里只忠实消费显隐，**不提交权威消音器模式或推断可再次开枪时间**。
- 原 inspect 带 AE_BEGIN_TAUNT_LOOP、StatTrak glow 等事件，本 owner 按请求原时间采样并保留事件清单；未复制 taunt 循环/中断状态图。
- Glock source attachment `1`、`2`；USP 还包含 `muzzle_flash2`，按原名字暴露。不要把同骨上的两个 muzzle marker 合并或无证据选择消音模式。

## 独立数据与 CPU 验收

| 资源 | 原独立 skin 骨数 | 逐帧样本 | Stage 文件/字节 | GLB SHA256 |
|---|---|---:|---|---|
| glock / t | [48, 57] | 325 | 23 / 36,207,632 B | `85d12f6cc45c81a958bf825df3fc4093160a69fce1d45609accb58896fb48e1b` |
| glock / ct | [48, 57] | 325 | 21 / 37,993,941 B | `f228a91d39e3b85d4945368f4417c735e59647a5efe699929cf31516e75f01ed` |
| usp / t | [48, 48] | 716 | 33 / 44,716,402 B | `ea1d2523787142eea4de4cec8dda3fa4dc874b62e18b3ae8772f79172b03117a` |
| usp / ct | [48, 48] | 716 | 31 / 46,502,711 B | `89f523ea0940895a20c251ca5b062334c6b1d64429df4bc0cf3507716c60d003` |

四套共 **2082 原帧**；每帧全部原武器骨矩阵独立回读，83,534 次 matched arm world matrix 比较通过。原时长/FPS、所有附件、原 source frame→Blender→GLTFLoader、手臂顶点稀疏独立采样通过。GLTFLoader 的独立逐帧矩阵误差最大约 3.24e-5 **Source unit**；不是米。每个原 IBM 按 `rawSourceIBM * inverse(C)` 精确写为 float32，并独立逐元素回读；两 skin 不合并。

`C=(x,z,-y)`：骨 world 是 `C*SourceBoneWorld`；普通附件 object 自身局部基转换后是 `C*SourceAttachmentWorld*inverse(C)`。渲染外层仅 `yaw=pi/2`、`scale=.0254` 一次。原 source-unit 顶点、索引、绕序、纹理均保留。Glock 枪体有 4 个、USP 枪体有 3 个零 tangent，原 VMT 无 normalmap；仅移除对应无效且未使用的 TANGENT semantic，**全部 BIN bytes/accessor 保留**，四套 Khronos validation 0 errors。手臂 normalmap 的切线保持。

原 T/CT 手臂各 48 bones。Glock 匹配 **47**，USP 匹配 **37**，两者实际加权手臂骨均 **34**，全部同名可匹配。USP 其余未加权 helper 继续保原骨链，不删骨，也不沿用步枪固定47断言。runtime 每次采样后严格按原匹配集合 bone merge，并刷新中间未匹配父骨；原 IBM 独立。`tests/source-pistol-owner.test.ts` **10/10**，四套每原帧 production adapter、克隆隔离、回收、HTTP 无 WebCrypto SHA、坏 manifest/PNG、abort、USP 显隐 seek、原 Phong 参数测试通过。`output/source-pistol-typecheck.log` 新模块/专测限定类型检查通过。

## Production API（独立，不改 shared SourceViewmodel）

```ts
import {loadSourcePistolViewmodel, sourcePistolAttachment,
  isSourcePistolViewmodel, inspectSourcePistolViewmodel} from '@/game/source-pistol-viewmodel';
const owner = await loadSourcePistolViewmodel({weapon:'usp',team:'ct'});
const gun = owner.createViewmodel();
owner.sampleViewmodel(gun, {sequence:'attach',timeSeconds:1,silencerAttached:false});
const flash = sourcePistolAttachment(gun, '1', camera);
owner.disposeViewmodel(gun); // only this clone
owner.dispose(); // instances + shared fetched resources
```

四个便利入口：`loadSourceGlockTViewmodel`、`loadSourceGlockCTViewmodel`、`loadSourceUSPTViewmodel`、`loadSourceUSPCTViewmodel`，均接 `{baseUrl?,signal?,loadingManager?}`。默认路径分别 `/source/csgo-12426148/glock-t`、`glock-ct`、`usp-t`、`usp-ct`。owner 还返回 GLTF、manifest、profile、team、weaponId、hashVerified 和 `fetchFile(path)`（原 sounds 的按需 SHA 读取）。所有加载 `cache:'no-cache'`；**manifest 本身也有编译期固定 SHA**，且 GLB/rig/实际加载 PNG 校验原清单。清单内尚未请求的 WAV 不冒称已下载；staging 时已逐文件回读。

不要把 `gun` 传给现有 `updateSourceViewmodel`；该 API 是独立严格 owner，下一步 Root 按 `isSourcePistolViewmodel` 分发。游戏层必须提供原 sequence 与权威 time、USP 初始 attached 状态；本适配器无自行累计 dt、burst 定时器、音效重放或 ammo 变更。原事件保留在 manifest clips，原音效有 Glock **11** / USP **21** 个唯一 WAV（含距远 operator 依赖），原采样率、声道、字节 SHA 均保留。USP 换弹音效实际引用 Weapon_hkp2000，不凭枪名改成想象资源。

材质使用原 base RGBA/exponent R+G、原 VMT boost：Glock 1，USP 8，Fresnel [.83,.83,1]，base alpha Phong mask、albedo tint G、无 HalfLambert；T/CT 手臂各用已验原 profile。**CSGO phongalbedoboost35/80、原 ambient/local cubemap、原照明/曝光尚未实现，未宣称原客户端材质等价。** 本轮没有操作浏览器或更新既有枪支 GPU 收据。

## 私有第三人称阶段

`pistol-candidates/glock-world`：93 bones、7 simple 原序列；`usp-world`：95 bones、15 simple 原序列，含 6 条站/动/蹲 silencer ON/OFF 与 alternate fire。原 delta/post fire 以原 default+mask 和 SDK QuaternionScale 右乘做**明确的预览合成**，原未合成 delta 数组另存在 `world-original-frames.npz`。独立 Three 读回/Khronos 0 errors。

二者还存在 5 组 9way `pistol_aim_*_t` 和包装 `pistol_aim_t`，auto layer flags **16448**；本轮没有合成这些原 world aim 层，不能简单把 world93/95 骨按 AK94 默认挂接后声称完整原手枪握姿。原 bodygroups/material/source pose-param/autolayer 全清单在 inventory。

原角色端 `pistol-candidates/character-t-pistol` / `character-ct-pistol` 的各 **98 descriptors / 34 sequences**（含 silencer layers）、原 5 lower + PISTOL upper + Pistol shoot、原 9way/3way/mask 已导出紧凑 continuous JSON/F64；T 2258 帧，CT 2262 帧。原主角色71/74、动画71/70、69同名映射/原IBM不变。TS sampler对既有 Python40世界矩阵与40内部点、576角点、mask0/weight0检查通过。它们是 Pistol 家族候选数据，**未分配 production poseVersion / combined actor / 装备身份**；未重建 closed AnimState、reload/attach/detach 完整调度、world 9way/IK、根运动抽取。严禁用当前 AK/M4 actor loader 绕过身份校验。

## 可复现命令

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python-exit-code 1 --python scripts/inventory-source-pistols.py
# Four separate Blender factory processes: weapon glock/usp × team t/ct
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python-exit-code 1 --python scripts/import-source-pistol-viewmodel.py -- --weapon usp --team ct
python3 scripts/finalize-source-pistol.py .reference-assets/source-exports/pistol-candidates/usp-ct
node scripts/validate-source-pistol.mjs .reference-assets/source-exports/pistol-candidates/usp-ct
python3 scripts/stage-source-pistols.py
./node_modules/.bin/vitest run tests/source-pistol-owner.test.ts
```

Staging 脚本不自动更新编译期冻结 SHA；重新导出后必须独立验证并有意更新 `game/source-pistol-contracts.ts`。原始脚本/SourceIO/addon 未修改。第三人称另用 `import-source-pistol-world.py -- --weapon …`、`export-source-pistol-character-poses.py`、`validate-source-pistol-character-pose.ts t|ct`，不覆盖公开已验 AK/M4。
