# Source 1 → Blender → GLB：可复现工具链调查

日期：2026-09-08。本报告保留工具调查阶段证据；其后真实 App 740 AK47/原手臂转换及独立 GLB 回放已通过，具体能力与仍有的材质限制以 [真实武器审计](source-weapon-audit.md) 为准。先只读调查源码，随后获主任务明确授权，把固定 SourceIO 提交下载到项目 `.tools/SourceIO`，完成独立 Blender 进程的 import/register/native/interface smoke，**未转换 MDL/VTF/动画**。未全局安装插件、未保存 Blender 用户偏好。Workbench OBJ 的转换由 asset_audit 负责，不在本报告重复执行。[本机 smoke 回执](sourceio-smoke.md)

## 建议与当前证据

优先评估 **固定提交的 SourceIO + 本机 Blender 5.2.1 LTS + Blender 自带 glTF 导出器**。环境加载关口已通过，SourceIO 有直接导入 Source 1 MDL/BSP/VTF/VMT 的代码路径；仍须通过真实单模型、单动画与材质转换验收，才能称为可用生产工具链。

| 项目 | 当前核验 |
| --- | --- |
| 原作者仓库 | [REDxEYE/SourceIO](https://github.com/REDxEYE/SourceIO)，第三方开源工具，**不是 Valve 官方工具** |
| 固定版本 | commit **cfc2591d096628a35f570aa830ab75cc8665108b**，GitHub commit 时间 **2026-09-08T12:44:42Z**；不要使用浮动 master 作为转换回执 |
| 实际代码版本 | `__init__.py` 的 `bl_info.version=(5,5,5)`，要求 Blender **≥4.2.0**、Python **≥3.11**；README 的 Blender 4.0+ / supported-formats v5.3.0 已落后 |
| 许可 | 根 LICENSE 为 **MIT**，Copyright 2020 REDxEYE；保留代码版权/许可声明。该工具许可证不改变 Valve 输入美术资源的使用范围 |
| 本机 | Blender **5.2.1 LTS**，build hash **9e2066aef7ef**，内置 Python **3.13.13**、原生 arm64；实际 SourceIO import/register/unregister 均通过 |
| macOS 原生依赖 | `library/utils/pylib/macos/pylib.abi3.so` 头部为 x86_64 + arm64 universal；随后实际 arm64 Blender 成功加载，VPKFile/compression/image/mesh/vtf 五接口存在。仅验证动态加载/接口，没有调用资产解码 |
| CSGO 支持声明 | README 标 **Partial support：models, maps(not all entities), textures, materials**，不能称所有地图实体/着色器/动画状态机完整支持 |

源码：[固定 init/version](https://github.com/REDxEYE/SourceIO/blob/cfc2591d096628a35f570aa830ab75cc8665108b/__init__.py)、[固定 MIT LICENSE](https://github.com/REDxEYE/SourceIO/blob/cfc2591d096628a35f570aa830ab75cc8665108b/LICENSE)、[原生模块加载器](https://github.com/REDxEYE/SourceIO/blob/cfc2591d096628a35f570aa830ab75cc8665108b/library/utils/pylib/__init__.py)。原生文件只读头部来自同一提交的 [macOS pylib](https://raw.githubusercontent.com/REDxEYE/SourceIO/cfc2591d096628a35f570aa830ab75cc8665108b/library/utils/pylib/macos/pylib.abi3.so)。

## 已读代码中的具体能力

**模型与骨架：** `sourceio.mdl` 导入操作会扫描输入附近的资源目录，`IDST`/49 路径要求配套 VVD/VTX，并建立 armature、权重、bodygroups、attachments；可选 PHY。骨架从源骨位置/四元数按父链建立，不应额外逐骨“修直”或统一重命名，否则会破坏基准。[MDL 操作入口](https://github.com/REDxEYE/SourceIO/blob/cfc2591d096628a35f570aa830ab75cc8665108b/blender_bindings/operators/source1_operators.py#L31)、[MDL49 导入分派](https://github.com/REDxEYE/SourceIO/blob/cfc2591d096628a35f570aa830ab75cc8665108b/blender_bindings/models/mdl49/__init__.py)、[建骨架代码](https://github.com/REDxEYE/SourceIO/blob/cfc2591d096628a35f570aa830ab75cc8665108b/blender_bindings/models/mdl44/import_mdl.py#L33)

**动画：** `import_animations` 与 `import_include_animations` **默认都为 False**。同时启用后，`load_all_animations` 读取主 MDL、include_models、外部 ANI/anim blocks，`import_animations_to_armature` 按骨名建立各个 Action。`load_refpose` 默认 False；True 会使用第一条动画的首帧影响参考姿态，不能把它盲当“更准确 bind pose”的开关。[参数声明](https://github.com/REDxEYE/SourceIO/blob/cfc2591d096628a35f570aa830ab75cc8665108b/blender_bindings/operators/import_settings_base.py#L34)、[动画装载](https://github.com/REDxEYE/SourceIO/blob/cfc2591d096628a35f570aa830ab75cc8665108b/library/models/mdl/load_animations.py)、[Action 建立](https://github.com/REDxEYE/SourceIO/blob/cfc2591d096628a35f570aa830ab75cc8665108b/blender_bindings/models/import_animations.py)

**材质：** 有 VertexLitGeneric、LightmappedGeneric、UnlitGeneric 等转换实现，`import_textures=True` 默认开启；`use_bvlg=False` 是此固定提交的默认。Blender 自定义节点组不会自动原样进入 GLB。保留原 VMT 参数与纹理引用，在 GLB 外提供 `materials.json`，再决定哪些直接映射 Principled、哪些烘焙、哪些必须在 Three shader 重建。[VertexLitGeneric 实现](https://github.com/REDxEYE/SourceIO/blob/cfc2591d096628a35f570aa830ab75cc8665108b/blender_bindings/material_loader/shaders/source1_shaders/vertexlit_generic.py)、[Khronos glTF Blender 导入导出器](https://github.com/KhronosGroup/glTF-Blender-IO)

## 会直接影响“还原”的未通过点

1. **动画时长不能使用 Blender 默认 FPS。** `AnimationData` 保存源 `fps`，但本次读取的通用 Action 构造按 `1…frame_count` 写帧号，没有用 `anim_data.fps` 调整时间。若源 30 FPS、场景默认 24 FPS，就有变慢风险。每条动画须保存源 FPS 与采样数，以统一目标 FPS 重采样，或逐 clip 设置正确帧率单独导出后核对秒时间轴。
2. **delta、loop、sequence 不是一个 Action 名字就足够。** 装载器保存 `is_delta/is_looping`，上述 Action 构造未使用它们；sequence 与 anim_desc 是不同表，还可能含混合与上层叠加。脚本不能把所有增量层作为独立全身绝对动画直接播放。此点是静态代码风险，尚无实际 CS:GO clip 的失败/成功回执。
3. **局部失败可能仍有产物。** 动画装载和导入有逐项 catch/log 后继续的路径；材质也会记录错误继续。`{'FINISHED'}` 或存在 GLB 不足以验收。应比较期望动画/骨骼/材质数，收集每条错误，缺依赖即标失败。
4. **Actions 必须实际绑定并导出。** `use_fake_user` 只保留数据块，不证明目标 armature 播放了它。Blender 4.4+ 的 Action slots/NLA 规则需按本机版本处理。先逐 clip 单独 GLB，确认动作有关键帧、有实际骨矩阵变化、时长正确；再建立多动画库。[Blender 官方动画导出说明，当前 dev 页面](https://docs.blender.org/manual/en/dev/addons/scene_gltf2.html)
5. **CSGO 部分支持和开源工具不代替原作运行。** 地图实体、材质代理、反射、皮肤磨损合成、IK/瞄准层、动画事件、root motion 和足部状态仍需逐项对照。先保留误差记录，再谈浏览器接入。

第 1–3 点的证据是上面固定提交的装载/Action 代码；它们是要求验证的风险，并非已经在本机证明所有 CS:GO 模型都会出错。

## 可复现的执行顺序（提案，尚未执行）

1. **冻结输入。** 完成 App 740 下载校验，保存 appmanifest、731/740 manifests、指定 MDL/VVD/VTX/ANI/VMT/VTF 原文件哈希。把 `gameinfo.txt`、VPK、materials/models 相对路径保持完整；不要只复制一个 MDL 再猜依赖。
2. **冻结工具（已完成）。** 从原作者仓库取得上述 commit，保留 MIT LICENSE，放项目 `.tools/SourceIO/` 并 detached checkout。独立 Blender 进程使用 `--factory-startup`，进程内 import/register/unregister；未修改用户 Blender 首选项。
3. **最小环境 smoke（已通过）。** 已记录 Blender/Python/架构、SourceIO commit/bl_info，实际加载 macOS pylib 和四个 Blender 操作接口。下一步才是源资产解码，不需要先修改系统 Python 或全局 pip。
4. **一份模型先验。** 先导入一把实际取得的 M4 viewmodel，记录 armature、mesh、material、attachments、bounds、bind matrices，再显式导入其 Idle/Fire/Reload/Inspect 所需动画及依赖；随后一个角色。具体文件名按 VPK 清单选择，不在取得前臆造。
5. **建立动作清单。** 每项记录 `{sourceMdl,sequence,animDesc,fps,frameCount,loop,delta,includeModel,events}`，将每个动作实际绑定 armature 采样。记录 t=0、中点、末帧和关键事件前后的骨矩阵、关节长度与武器附件位置。
6. **标准化导出。** 基准轮关闭有损简化与 Draco/meshopt，保留法线/UV、全部蒙皮骨、attachments 和 extras。把可标准表达的材质改成明确的 glTF 节点连接，复杂效果保留参数侧车。按原 FPS 校准后导出各 clip；使用本机 exporter RNA 确认选项名，不复制旧版 exporter 参数。
7. **独立读回。** 用 Three GLTFLoader 读取 GLB、按同一秒时间点采样，并同 Blender 结果比较。再用原作参考进行视觉/动作对照。记录原作→Blender 与 Blender→GLB 两段误差，防止两端共享同一错误而自证正确。

可用的已核验 SourceIO 操作参数骨架如下；输入必须已清点。环境 smoke 已通过，下述 MDL 实际转换调用尚未执行：

```python
# 独立 Blender 进程；SOURCEIO_PARENT 指向只含冻结 SourceIO 目录的父目录。
sys.path.insert(0, str(SOURCEIO_PARENT))
import SourceIO
SourceIO.register()
result = bpy.ops.sourceio.mdl(
    filepath=str(MDL_PATH),
    files=[{"name": MDL_PATH.name}],
    discover_resources=True,
    import_textures=True,
    import_animations=True,
    import_include_animations=True,
    load_refpose=False,
    use_bvlg=False,
)
assert result == {"FINISHED"}
# 接着必须执行动作/材质数量、日志、FPS/增量语义与骨矩阵检查。
```

## 验收门槛与保留范围

| 关口 | 必需回执 |
| --- | --- |
| 工具可运行 | 固定 commit、Blender/Python/架构、pylib 加载日志；没有安装到全局 |
| 模型完整 | 源与导入骨数/父链一致；无丢权重/缺贴图/意外 bodygroup；坐标/尺寸明确 |
| 动作完整 | 源清单与导入 Action 一一映射；FPS/秒时长、loop/delta、实际播放和事件有独立采样 |
| GLB 保持 | Blender 与 GLTFLoader 关节/附件/顶点采样一致，导出动画不为空且实际运行 |
| 原作接近 | 同版本原作可见参考；不把 Workbench 2013 静态 OBJ 或当前 CS2 材质指南混作 2023 CS:GO 的完整真值 |

SourceIO 调查阶段的定位是环境加载通过的候选工具链；后续已证实单把原 AK47/原手臂可转换，须修正混合 FRAMEANIM 解码、FPS/零起点、骨绑定与附件导出，且默认 Phong 材质映射仍不等价。这个单样本通过不能外推到全部角色、delta、多blend、完整动画状态机；详见 [后续审计](source-weapon-audit.md)。
