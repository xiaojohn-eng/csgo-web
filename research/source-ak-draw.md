# 原 AK draw：原数据与独立 T / CT 候选验收

原 App740 build12426148 的 `v_rif_ak47.mdl` 有真实 `ak47_draw`。已解出全部源帧、原事件与原 WAV，并在独立 private 目录追加 T / CT 候选、完成逐字节/CPU/真实 GPU/原声音时序验收。**没有改现用 public T/CT AK GLB、manifest、owner、shared VM 或对战逻辑**。原始审计目录 `.reference-assets/source-exports/ak47-draw-audit`；新候选 `.reference-assets/source-exports/ak47-draw-candidates/{t,ct}`。

| 原字段 | 当前实际值 |
|---|---|
| item / model | 7 `weapon_ak47` / `models/weapons/v_rif_ak47.mdl` |
| MDL SHA | `8d2a07150f9e31573ef9187a203527cd4dfb2de004fce941902d0a58e2ea4472` |
| 外置 ANI SHA | `4dcfa75c2664287652b011bd7ed4532334cc0a4fc52509e91d360dabff987062` |
| sequence / descriptor | `ak47_draw` / `@ak47_draw`，index4 |
| activity | `ACT_VM_DRAW`（原 activity 数字缓存为 -1） |
| sequence flags / descriptor flags | 2 / 64（FRAMEANIM，绝对姿态） |
| 帧 / FPS / 时长 | **31 / 30 / 1.0 s**，按 `(31-1)/30` |
| 骨 / blend / mask | 原58骨，单 descriptor，58个权重均1，无 auto layer |
| animblock / sectionFrames | **外置 ANI block1 / 30** |
| section 选择 | frames0…29 → section0；frame30 → **section2 local0** |

这里不能从手枪的 inline MDL 动画假定 AK draw 也在 MDL 内。使用已经验证的 process-local FRAMEANIM 常量＋逐帧解码适配及 section decoder，按原 block table 加 offset。所有动态帧字节跨度与原 header 一致；最后一帧正确 section 与旧 decoder 的本条 draw 最终值差为0，这不改变其他 AK 序列末帧已修的事实。

`draw-original-frames.npz` 保存原 `float32` position `[31,58,3]` 与 xyzw quaternion `[31,58,4]`，逐数组 shape/dtype/byte readback 全等，没有归一化、改单位或烘焙。最大原四元数范数偏差约1.79e-7。独立 raw 数组 SHA：

- positions：`67d92c86d39dc191455354fa7e69262f9555e76659bf49cac6659a15ef074d6f`
- quaternions：`5e31e445059cc71401c26f9bb7c31eacb244948d6f9457fdedde76323003c78b`
- NPZ 文件：`c5883cb14ebbe9f1230478937d6a162bfd443b9924110655f3a45a365ea8cc61`

## 原 draw 事件

| Event | 原 cycle | 对应原 clip 秒 | 原 options |
|---|---:|---:|---|
| 5004 | 0 | **0** | `Weapon_AK47.Draw` |
| 5004 | .36666667461395264 | **.36666667461395264** | `Weapon_AK47.BoltPull` |

两个 WAV 均按原 VPK 目录 bytes/CRC、已冻结原 AK sound manifest SHA 和新写文件 readback 核对。

- `sound/weapons/ak47/ak47_draw.wav`：mono PCM16，44100 Hz，19920帧，.4517006803 s；SHA `8118407efcf748c119e459d6dd87369fa714a36863dc11e735dc59c857376cd2`。原音量 `.3`、`PITCH_NORM`、`CHAN_STATIC`、`SNDLVL_65dB`，`~` 前缀及原 operator stack 保留。
- `sound/weapons/ak47/ak47_boltpull.wav`：mono PCM16，44100 Hz，13673帧，.3100453515 s；SHA `d6253073be8c071eb6112cdbf8212ac58f377dd7c5ee623c48b4b673dec5f36c`。原音量 `1`、pitch `100, 105`、`hrtf_follow 1`；不是统一随机音高或原音量.3。

完整 event/原 sound definition、所有 FP sequence inventory、骨原 position/quaternion/IBM、attachments、原依赖 SHA、解码跨度在 `audit.json`。没有把音频长度当事件时点或 draw 完成时点。

## 候选文件与不变性

| 队伍 | 新 GLB SHA256 | 候选 manifest SHA256 | GLB bytes |
|---|---|---|---:|
| T | `2bb9a3be6f863a8cbe42820355c6c20c5e5fac3baf6b093eff1d6b68fe6cd1e4` | `fe662149184218413be6e6ff8271850a9d876b6035ed4a95c3da098a0773f8d0` (`provenance.json`) | 23988880 |
| CT | `72230f3bdbde976eb63e92d6d87bd5be770efe8f244e806c8efc8afe55080844` | `437ca88b68c2f1bb4b029350870c36283c6b62c554adf95d03fba2b86a7a9762` (`manifest.json`) | 24759716 |

（上表是**当前已发货**的身份：draw 追加完成后的 T `c5da61dc…f5d65` / CT `d7812ebb…c0bf1` 又被 `scripts/append-source-rifle-fire-variants.py` 追加了另两条原开火序列 `ak47_fire2`/`ak47_fire3`，两个前缀身份与验证结果见 `research/source-weapon-fire-variants.json`。追加同样只加不改：旧 BIN 逐字节前缀不变，旧 nodes/skins/meshes/materials/images/textures/samplers/scenes/asset、原 5 条动画、全部原 accessor/bufferView 全等。）

`scripts/append-source-ak-draw.py` 对当前 T SHA `8e93eb7f…b0baa` / CT `8a8a31f6…43e55` GLB 做 append-only：原 BIN 的 23,425,792 / 24,197,148 bytes 全前缀完全相等。原 nodes、skins、meshes、materials、images、textures、samplers、scenes、asset、extensions 结构相等；原4动画、全部原 accessor/bufferView 前缀相等。原 PNG/WAV 逐 SHA 复制。由此原几何属性、indices/winding、材质参数、图字节和两个独立 skin 的 IBM 没有重新导出。

只新增 `draw__ak47_draw`，31帧/30FPS，58枪骨＋48原臂骨共212条position/rotation轨道。原绝对 position 保 Source 单位；根坐标转 `(x,z,-y)`，root scale仍1；glTF需要单位四元数，因此仅新轨道归一化，并按相邻四元数符号连续存储。原 NPZ float32 未改。T同名47骨采用既有烘焙姿态路线，CT继续调用既有47同名骨 matrix bone-merge hook，未合并skin、未重算IBM。

精确 keyframe 是本轮原值比较边界。glTF LINEAR 四元数在 Three 内按 slerp，而 Source 帧内普通插值为 nlerp；本轮没有将所有任意时间标成原引擎逐值相等，也未修改旧四片段插值方式。

独立 CPU 回执 `output/tests/source-ak-draw-candidates.json`：

| 检查 | T | CT |
|---|---:|---:|
| 原4clips采样总数 | 230 | 230 |
| 新/旧实际骨world矩阵最大差 | **0** | **0** |
| 新draw原58骨，31帧最大误差(m) | 1.456e-7 | 1.456e-7 |
| 原同名臂/枪骨最大差(m) | 4.510e-7 | 3.331e-16 |
| 原 muzzle/ejection位置最大差(Source u) | 8.549e-6 | 8.549e-6 |
| 原臂IBM独立蒙皮顶点样本 | 5394 | 9362 |
| 原IBM顶点最大差(m) | 8.263e-7 | 1.054e-7 |

源位置/quaternion直接读原 NPZ 的独立 JSON，参考层级计算使用 Three 矩阵，原臂 IBM 直接读 MDL raw metadata；参考不读取新增 draw tracks。两个 GLB Khronos validator 均0 error，保留2条 `NODE_SKINNED_MESH_NON_ROOT` warning及原材质切线unused info；实际外层坐标/蒙皮已由上表检查。原所有 IBM 在采样前后不变。draw开始、时标、打断回idle测试通过。限定三个新 TS 文件 typecheck exit0（`output/source-ak-draw-typecheck.log`）。

## 真实 GPU 与声音

私有预览 `http://127.0.0.1:27018/assets/source-exports/ak47-draw-preview/index.html`，实现仅在 `scripts/source-ak-draw-candidate.ts`、`scripts/preview-source-ak-draw.ts`。GPU按两个候选 manifest/GLB/PNG的 SHA 验证后加载，复用既有原AK及T/CT原材质函数与共享VM，不放宽当前生产owner固定hash。

`output/playwright/source-ak-draw-gpu.json` 保存实际浏览器回读、模块/预览bundle SHA、候选SHA。两队分别采样0、.1、.235、.3666666667、.6、1秒，共12图。T/CT每图实际24,449 / 33,169三角；手臂world对应最大差4.303e-7 / 2.221e-16米。已独立看 T .3667 / .6 和 CT .6图，原裸臂与IDF袖臂身份明确，未见枪/腕骨整体分离或爆炸。光照为中性预览，原材质未改；不作为全原引擎光照等价证明。

声音由当前生产 `advanceSourceSoundEvents` 对 `sourceViewmodelPlayback` 的实际clip time/generation发出，原文件SHA后真实 `AudioContext.decodeAudioData`，再实际 `AudioBufferSourceNode.start`。两个缓冲均44100Hz mono，19920 / 13673帧，与源WAV完全一致。预览固定pitch100（属于原允许值），保留原Draw音量.3、BoltPull音量1；没有声称原随机pitch分布或HRTF/operator stack已复刻。

- 原门限0与.36666667461395264s不变。T BoltPull实际采样.3687000000s，CT .3807000000s，各只发一次。
- WebAudio start相对draw记录：T Draw .005805s / BoltPull .377324s；CT .005805s / .383129s。这包含当前浏览器RAF/audio quantum延迟，未冒充零延迟精确采样点调度。
- 再读同一cursor不重复；新generation重新发一次首音。于约.1s打断后只保留已开始的Draw，不补播BoltPull。
- 以上是实际WebAudio解码/调用/时钟验证，不是声卡回环或麦克风录音验收。
- 两队卸载后 **geometry=texture=program=0**，console/page/network errors `[]`。

图例：`output/playwright/source-ak-draw-t-0_3666666667.png`、`source-ak-draw-ct-0_6.png`。浏览器操作仅使用独立 session `pistol-character-reference`，没有操作根任务主游戏浏览器。

## Root 同步窗口的最小接入变化（尚未执行）

1. Root选择新不可变URL **`/source/csgo-12426148/ak47-draw/` / `ak47-ct-draw/`**，旧 `/ak47` / `/ak47-ct` 不覆盖。把 T candidate 的 `provenance.json`＋15项manifest.files、CT 的 `manifest.json`＋12项manifest.files 全部复制到新目录（不能只复制差异文件）。`stage-list.json`有精确清单，candidate本身不需改。更新loader默认URL及 `SOURCE_T_VIEWMODEL_SHA256`、`SOURCE_CT_VIEWMODEL_SHA256`及相应fixture常量；保留当前旧receipt。所有原PNG、4clips、IBM不需改变；其中CT新增同SHA的两个原draw WAV副本用于manifest完整自洽，实际游戏音源仍可沿原ak47-audio银行。两个候选manifest当前只额外含draw字段和原sound引用。
2. T/CT owner均向 `createSourceViewmodel` 传明确AK weapon contract `{...old clips, draw:'draw__ak47_draw'}`。`scripts/source-ak-draw-candidate.ts:AK_DRAW_WEAPON` 为可直接移动的最小定义。当前sharedVM已经支持该可选contract及start/interrupt，不必改采样公式。CT wrapper可加可选weapon参数后原样传下；保留原CT bind hook，T不增加hook。默认旧AK contract仍四片段可保旧fixture边界。
3. `game/scene.ts` 当前仅对 `changed && sourceWeapon==='m4a4'` 调 `startSourceDraw`。允许已经stage并含draw的AK owner进入同一动画启动路径，队伍缓存切换仍沿现有释放流程。Root已补充首次生命也须触发：训练菜单预建的AK可能gunId相同，不能仅靠setWeapon changed。
4. `game/source-ak47-sound-timeline.json` 加draw：`[{time:0,event:'weapon_ak47.draw'},{time:.36666667461395264,event:'weapon_ak47.boltpull'}]`。原 `source-ak47-audio.json` 已有两条准确WAV URL，无需新音频菜单/手工补播。GameAssets已有generation cursor逻辑能复用，需主游戏重新验声音首帧/中断。
5. **不修改native handling部署/射击解锁逻辑**。原片段1秒仅是动画时长，本任务没有读取/执行原deploy攻击定时器，不能据此设置武器可射击时刻。所有主游戏/服务器版本同步及LAN回归由Root协调，本轮没有stage到public。

复现：

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python-exit-code 1 --python scripts/audit-source-ak-draw.py
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python-exit-code 1 --python scripts/append-source-ak-draw.py
npx tsx scripts/validate-source-ak-draw.ts
node scripts/build-source-ak-draw-preview.mjs
```

浏览器独立批次：`scripts/browser-source-ak-draw.pw.js`，日志 `output/playwright/source-ak-draw-run.log`。所有本轮脚本、manifest及原新GLB身份均可由GPU/CPU receipts互相追溯。
