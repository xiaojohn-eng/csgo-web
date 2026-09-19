# 原版 AK47、Dust2 T 手臂与动画转换审计

日期：2026-09-08。本轮成果是 **App 740 原资源 → 两个独立原蒙皮 → 四段保持原秒时长的 GLB**，并通过 Blender 和独立 Three.js 数值读取。没有改 `game/`、`public/`，没有登录私人账号、全局安装插件或保存 Blender 用户首选项。运行时接入与材质修正由主任务另行负责。

## 可接入文件与版本

推荐合并样本：[v_rif_ak47-with-arms-source-unit.glb](../.reference-assets/source-exports/ak47-arms/v_rif_ak47-with-arms-source-unit.glb)，**23,655,172 字节**，SHA-256 `e29d4e64a7a204a8d80bd9c338f12078609f2d4cb38feadadffe04dd93833ee7`。保持 **58 骨武器 skin + 48 骨原T手臂 skin**，3 材质、9 个嵌入图片、4 个动画。没有重拓扑、减面、Draco 或 meshopt 压缩。

- [完整源与 Blender 审计 JSON](../.reference-assets/source-exports/ak47-arms/audit.json)
- [独立 Three 与 Khronos 验证回执](../.reference-assets/source-exports/ak47-arms/three-readback.json)
- [GLB JSON 结构读回](../.reference-assets/source-exports/ak47-arms/gltf-structure.json)
- [单独武器 GLB](../.reference-assets/source-exports/ak47/v_rif_ak47-source-unit.glb) 与 [独立回执](../.reference-assets/source-exports/ak47/three-readback.json)
- [转换脚本](../scripts/import-source-weapon.py)、[独立验证脚本](../scripts/validate-source-weapon.mjs)

输入由官方 SteamCMD 匿名 `app_update 740 validate` 完成，日志最后是 `Success! App '740' fully installed.`。本轮独立读取 ACF：`StateFlags=4`、`UpdateResult=0`、BuildID **12426148**；731 manifest **1224088799001669801**，740 manifest **6998097922547485721**。下载与暂存已完成 **14,706,250,528 / 34,705,746,562 字节**。[安装日志](../output/steamcmd-download740.log)、[ACF](../.reference-assets/csgo-legacy/steamapps/appmanifest_740.acf)、[官方可取得性报告](official-csgo-assets.md)

工具固定为第三方 MIT [SourceIO commit cfc2591d096628a35f570aa830ab75cc8665108b](https://github.com/REDxEYE/SourceIO/tree/cfc2591d096628a35f570aa830ab75cc8665108b)，原生 arm64 Blender **5.2.1 LTS** / Python **3.13.13**。SourceIO tracked files 始终未修改。SourceIO 的 MIT 不改变 Valve 输入资产的使用范围；本轮产物留在项目私有参考目录。

## 实际源文件与几何

从已完成的 `csgo/pak01_dir.vpk` 按精确路径读取：

- `models/weapons/v_rif_ak47.mdl`：MDL49，checksum **228263958**，58 骨、9 anim_desc、9 sequence、无 include_models。
- 同名 `.vvd`、`.dx90.vtx`、外部 `.ani` 均实际取得；每个读取依赖的字节数与 SHA-256 在 audit.dependencies。
- 武器 mesh `ak47_model.smd`：**12,523 顶点 / 13,435 三角面**，不包含可见手臂；保留 AK47 原材质和 UV。
- `models/weapons/t_arms.mdl`：`t_arms_leet.dmx` **6,413 顶点 / 11,014 三角面**，48 骨，裸臂与无指手套两材质。
- `gamemodes.txt` 的 `de_dust2` 块明确指定 T=`models/weapons/t_arms.mdl`，CT=`models/weapons/ct_arms_idf.mdl`。本轮选择原T手臂；不是使用 C02 角色手臂替代。[实际配置](../.reference-assets/csgo-legacy/csgo/gamemodes.txt)

材质原 VMT：`materials/models/weapons/v_models/rif_ak47/ak47.vmt`，shader `VertexLitGeneric`；base VTF **2048×2048**、exponent VTF **512×512**。GLB 导出后因为法线/UV/切线边界可拆分顶点，GLB 顶点数不应反过来称为原 MDL 顶点数。

## 原动作和 sequence 清单

所有 9 项本轮都能完成解码；表中时长为 `(frameCount−1)/fps` 的采样跨度，不能自动等同武器玩法冷却或完整 Source 状态机时长。所有 anim_desc **delta=false**，只有 idle 的 loop 标志为真；`lookat01_loop` 这个名字本身不代表循环标志为真。

| 原 sequence | activity | FPS | 帧数 | 采样跨度（秒） | 导出 |
| --- | --- | ---: | ---: | ---: | --- |
| ak47_idle | ACT_VM_IDLE | 30 | 2 | 0.0333333333 | `idle__ak47_idle` |
| ak47_fire1 | ACT_VM_PRIMARYATTACK | 20 | 16 | 0.75 | `fire__ak47_fire1` |
| ak47_fire2 | ACT_VM_PRIMARYATTACK | 20 | 16 | 0.75 | 只清点 |
| ak47_fire3 | ACT_VM_PRIMARYATTACK | 20 | 16 | 0.75 | 只清点 |
| ak47_draw | ACT_VM_DRAW | 30 | 31 | 1 | 只清点 |
| ak47_reload | ACT_VM_RELOAD | 30 | 74 | 2.4333333333 | `reload__ak47_reload` |
| lookat01 | 空 | 30 | 138 | 4.5666666667 | `inspect__lookat01` |
| lookat01_prepare | 空 | 20 | 29 | 1.4 | 只清点 |
| lookat01_loop | 空 | 15 | 38 | 2.4666666667 | 只清点 |

这些 sequence 均单 anim_desc、无 auto-layer。本轮只选一条简单绝对动作代表每类，没有伪造原源码状态机。每条 source FPS、flags、block、sequence index、events、bone weights 和 fade 参数均保留在 audit.json。

原事件举例：reload 的 Clipout 在 **0.3s**、Clipin 在 **1s**、BoltPull 在 **1.666667s**；`AE_WPN_COMPLETE_RELOAD` 在 **1.166667s**。它不位于 2.433333s 动画末尾，游戏补弹时机需结合实际武器逻辑另核实。inspect 的 `AE_BEGIN_TAUNT_LOOP` 在 **2.166667s**，options `.204379`；准备、循环、退出、快速取消尚未组合成原作状态机。

## 必须修正的 SourceIO 与导出问题

1. **真实 ANI 同时含常量和逐帧通道。** 固定 SourceIO `_read_frame_animations` 把两者写成互斥分支，原样运行仅 idle 成功，8 段动态动画触发 AssertionError。保留 [基线日志](../output/import-source-weapon-sourceio-baseline.log) 和 [基线 JSON](../output/source-weapon-sourceio-baseline.json)。自有脚本只在当前进程替换该方法，沿用 `StudioFrameAnim`、`AniBoneFlags`、`Quat48/Quat48S` 结构读法，将常量与动态通道分别覆盖默认骨姿态；每一帧强制核对读取字节数等于 header.frame_length。常量末段允许非零 frame_offset 但 frame_length=0。
2. **适配出处必须准确。** 这个适配是依据实际 ANI 字节、SourceIO 结构和数值交叉读取的格式推断，不是“Valve 官方解码器”。公开 Source SDK 2013 的 studio/bone_setup 没有本轮完整 CS:GO FRAMEANIM 实现。只对当前非 delta 样本有回执，不能泛化到全部角色、delta、blends 或动画层。[固定 SourceIO 动画解析](https://github.com/REDxEYE/SourceIO/blob/cfc2591d096628a35f570aa830ab75cc8665108b/library/models/mdl/structs/local_animation.py)
3. **FPS 与零起点。** SourceIO Action 按 1…N 写 Blender 帧号。脚本将每条关键帧转成 `(sourceFrame−1)*60/sourceFPS`，scene 60FPS，GLB 第一关键帧严格 0 秒。首次结构读回发现额外 1/60 秒前缀，已修正并重跑。保留原每帧关键帧，不用默认 Blender FPS 把 20FPS 动作变速。
4. **原手臂必须保留自己的 inverse bind。** 48 个手臂骨中 47 个与武器同名，所有 **34 个有顶点权重的骨**都能匹配；唯一未匹配 `Bip01` 没有顶点权重。手臂/武器同名骨 bind 矩阵分量最大差 **35.263557 Source units**，直接把手臂绑到武器 skeleton 会变形。当前保留两个 skin：将每帧武器 global 骨变换转成手臂自己的 local 动作，未匹配无权重骨保原层级。手臂原 `pose_to_bone` 与导入 inverse bind 分量误差 ≤ **3.911×10⁻⁵**。
5. **附件必须随骨骼。** SourceIO 原导入是 `CHILD_OF` 约束，直接导出会变成静态 Empty。当前将原 3×4 local matrix 作为真实骨子级，补偿 Blender bone tail 的父级偏移；每帧核对源 parentBone × localMatrix。`1` 的父骨是 `v_weapon.AK47_flash`，`2` 是 `v_weapon.AK47_shelleject`，最终 GLB 两附件有正确骨父级。

## 数值验收

取每条动作首帧、第二帧、中点、倒数两帧及事件帧去重，共 **25 个时点**；没有声称穷尽所有连续时间、全部动画或原客户端视觉。

| 独立检查 | 范围 | 实测最大误差 |
| --- | --- | ---: |
| 源解码 local poses → Blender 武器父链矩阵 | 25×58=1,450 骨样本 | 2.575×10⁻⁵ 矩阵分量 |
| 武器 global poses → 独立手臂骨 global poses | 25×47=1,175 同名骨样本 | 2.003×10⁻⁵ 矩阵分量 |
| 原手臂 pose_to_bone 与权重蒙皮 → Blender evaluated 顶点 | 25×6,413=160,325 顶点样本 | 3.850×10⁻⁵ Source units |
| GLTFLoader/AnimationMixer → 武器骨位置 | 1,450 骨样本 | 1.831×10⁻⁵ Source units |
| GLTFLoader/AnimationMixer → 手臂骨位置 | 1,175 同名骨样本 | 3.276×10⁻⁵ Source units |
| Three 实际 applyBoneTransform → 原手臂顶点 | 2,550 顶点样本 | 3.857×10⁻⁵ Source units |
| Three 原动态附件位置 | 25×2=50 样本 | 1.631×10⁻⁵ Source units |

独立 Three 读取移除材质图片以适配 Node 无 ImageBitmap 的环境，但保留原 GLB geometry/skin/animation buffer。顶点验证按原 bind 坐标匹配导出的实际 primitive，未以共享 Blender 动画公式替代 Three 回放。原代码解码正确性的最终边界仍需原客户端对照，不能把两段转换验证误称完整原作动作验收。

Khronos glTF validator：**0 error、2 warning**。两 warning 是 Blender 导出 skinned mesh 位于 armature 节点下；armature 父变换为 identity，实际 Three 骨与顶点读取已通过。手臂 normal map 所需 tangent 已显式导出；武器没有 normal map，因此有一条 unused tangent 信息，不是错误。

## 坐标、实例与运行时契约

所有源几何/位移保持 **scale=1**。Blender glTF Y-up 转换为 `Source(x,y,z) → GLB(x,z,−y)`，没有偷偷乘 0.01905 或 0.0254；物理米制需在运行时明确选择并对照。SourceIO 默认 0.01905 只是工具默认值，不作为本轮物理校准结论。

同名骨在两个独立 skin 内都需要保留。运行时复制模型需用能复制 skinned skeleton 的方法（例如当前 Three 的 SkeletonUtils.clone），不能把两个 skin 的 inverse bind 合并。Action 按上述固定完整名字查找，不按数组下标。Idle 本身是两个相同姿态的静止序列；原作观感中的呼吸、移动、晃枪、视角相机偏移不能从这一条 clip 自动补齐。

附件从武器那一套骨树读。骨名称可能被 GLTFLoader 对点号做 PropertyBinding 名称清理，应以加载后的实际对象/来源映射识别；重复同名骨不能全场景用最后一次覆盖的字典绑定。

## 材质与视觉边界

当前默认 SourceIO/GLB 材质 **不等于原 Source shader**：主任务 GPU 发现明显绿色高光；GLB `KHR_materials_specular.specularColorTexture` 直接使用原 `$phongexponenttexture` RGB，不符合各通道原用途。主任务正在用独立的运行时 Source 材质适配修正，未在此脚本伪称解决。

已额外直接从原 VTF native RGBA8 数据无损输出，不经过 GLB PBR 重打包/色彩变换：

- [ak47-rgba.png，2048²，含原alpha](../.reference-assets/source-exports/ak47-arms/textures/ak47-rgba.png)
- [ak47_exponent-rgba.png，512²](../.reference-assets/source-exports/ak47-arms/textures/ak47_exponent-rgba.png)

每项原 RGBA 字节与 PNG SHA 在 audit.raw_texture_exports。GLB 中的 arm/weapon 材质 extras 保留 SourceIO 读取的原 VMT 参数。原 Phong、albedoboost、Fresnel、env_cubemap、法线通道、皮肤磨损和材质代理仍须逐项映射；官方 Source SDK 公开 shader 也不自动等于此 CS:GO build 的实际 shader。

原客户端尚未启动对照，未验证完整视角/FOV、枪口特效、弹壳、声音的运行时触发、射速/换弹取消状态机、所有皮肤或角色。本报告验证一个实物模型与可重复读取的动画转换，不承诺“完美复刻”。

## 复现命令

在项目根目录运行，所有输出限定为项目内部：

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python-exit-code 1 --python scripts/import-source-weapon.py -- --confirmed-complete --export-glb --arms-model models/weapons/t_arms.mdl --output-dir .reference-assets/source-exports/ak47-arms
node scripts/validate-source-weapon.mjs .reference-assets/source-exports/ak47-arms
```

脚本先核对固定 SourceIO commit、tracked clean、arm64、factory-startup 和 ACF 完成状态；只显式挂载已完成项目安装目录的 loose/VPK/provider 优先级。不 `glob('*')` 全包解码；原文件按需读取、保存依赖哈希。此脚本当前仅为 AK47/原T手臂实测路径，不是全游戏批量转换器。
