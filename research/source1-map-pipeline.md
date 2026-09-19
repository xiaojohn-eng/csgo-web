# Dust2 Source 1 分层资源与碰撞清点

> **2026-09-09 PHY 坐标纠正**：本文件早期 `dust2/collision/` 的世界/道具 PHY 验收已被后续真实 LAN 复现推翻：SourceIO 交换 IVP Y/Z 后遗漏符号，导致原 Source Z 反射。BSP brush/displacement/trigger 数据未受此错误影响。修正版及新完整回归见 [source-physics-axis-correction.md](../docs/source-physics-axis-correction.md)（research 内相对路径为 `../docs/source-physics-axis-correction.md`）；旧数据与结果保留为问题证据，不能继续当当前物理几何正确性证明。

> **后续独立验收修正（2026-09-09）**：旧 world.glb 存在真实 displacement start corner 选择错误。SourceIO `np.isclose(...,0.5e-2)` 把第三参数作为相对容差；Face3744 的真 start `[832,2048,568]` 被前一角 `[832,2056,568]` 抢先匹配。原 GLB 的结构/三角数验收不覆盖这个语义错误。父任务另建 `dust2-corrected` / `dust2-lightmapped`，旧产物与回执保留证据。独立 collision 导出使用最近角与 .1 Source unit 绝对阈值，不走该错误路径。详细记录见 `dust2/known-issues.json`。


2026-09-08。主任务确认 SteamCMD 终态 exit 0 / fully installed 后才读取资产；此前仅审阅工具源码。输入 `.reference-assets/csgo-legacy/csgo`，主任务下载回执为 App 740、build 12426148、StateFlags=4、UpdateResult=0，731 manifest 1224088799001669801 / 740 manifest 6998097922547485721。解析分支显式使用 **SteamAppId.COUNTER_STRIKE_GO=730**，不会把下载 App 740 错当模型 / BSP 分支。

已完成：真实 VPK 目录、BSP 全部非空原始 lump、实体、static prop 记录、brush 半空间与模型归属、VPHY 数据块清点；尚未由这一步创建 Blender 场景、GLB、Rapier collider 或游戏实体行为。后续可视转换与静态道具真正实例化单独记录。

## 可重复执行

```sh
python3 scripts/inventory-source-map.py --self-test
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python-exit-code 1 \
  --python scripts/inventory-source-map.py -- --download-complete --extract-lumps
```

脚本默认拒绝未提供 `--download-complete` 的资产读取。执行于固定 SourceIO commit `cfc2591d096628a35f570aa830ab75cc8665108b`，检查 tracked source 干净；独立 Blender 5.2.1 LTS 进程，只使用 SourceIO Python/native API，不注册插件、不保存首选项、不创建场景物体。输出只能写入隔离目录，不得写回输入或 public。原始 BSP 读取前后 size/mtime 一致，已保存 BSP SHA256、每 lump SHA256、VPK 目录 SHA256；实际抽取资源另校验 VPK CRC。

最终真实执行 exit 0，约 7.4 s；日志 `output/source1-inventory.log`，主报告 `output/source1/de_dust2/inventory.json`。合成 self-test 另外验证 VPK v1/v2、preload+内置/外部 archive 组合、CRC 损坏拒绝、路径穿越拒绝。这些只校验读取边界，不能替代真实文件执行。

## 真实资源规模

| 层 | 实际读取 |
| --- | --- |
| de_dust2.bsp | 325,735,952 bytes，VBSP v21 |
| pak01_dir.vpk | v2，133,676 条资源索引；没有全量 glob 解出全部 payload |
| BSP 内嵌 pak | 5,579 文件 / 293,346,016 解压字节 |
| 内嵌资产 | 679 MDL、679 VVD、679 VTX、302 PHY、48 VMT、34 VTF、3,158 VHV |
| 世界几何 | 20,912 顶点、9,852 faces、8,324 displacement records |
| 实体 | 375 个、32 个 classname；15 CT + 15 T 出生点，2 炸点、2 购买区、12 trigger_multiple |
| 静态道具 | sprp v11；3,158 实例、1,258 模型字典项；solid=0 为 1,900，solid=6 为 1,258 |
| 直接模型依赖 | 静态+实体合计 1,259 个 MDL 引用；MDL / VVD / dx90.VTX 全部找到 |
| 世界 VMT | 120 引用全部找到 |

VPK native `find_file(TinyPath)` 实际返回 **bytes**，不是 `.pyi` 注释里过时的 tuple；真实 `dust_ac_unit.mdl` 1,904 bytes 与独立目录读取 / CRC 校验结果严格相等。脚本导出 VPK 元数据目录，而不使用 native `glob('*')` 无谓读取全部归档。

资源查找明确列出每条候选：BSP 内嵌 pak → loose csgo → 主 pak01。中文声音 / lowviolence / perfectworld 包只清点，不静默覆盖主资源。SourceIO `ContentManager.children` 是 set，后续转换必须设置 `priority_list`；专服目录缺少 csgo.exe 时不依赖自动 detector 判断。

主清点产物：

- `output/source1/de_dust2/lumps/`：全部非空原始解压 lump，各自保留编号与名称；40-pakfile.bin 是完整内嵌 ZIP。
- `entities.raw.txt`、`entities.json`：保留原文本和 SourceIO 结构化实体。原文本用于保留重复 I/O 键等语义，不能只信 to_dict 后的结果。
- `static-props.json`：原 origin、angles、skin、solid、flags、uniform_scale、lighting_origin 等完整记录。
- `collision-brushes.json`、`collision-vphysics.json`：真实碰撞来源，独立于可见网格。
- `direct-dependencies.json`、`pakfile-catalog.json`、`vpk/*.json`：直接依赖存在性和精确提供者。
- `solid-props-missing-phy.json`：不能悄悄用渲染模型填补的碰撞缺口。

## 真实碰撞来源与工具缺口

Valve BSP 的 plane、brush、brushside、leafbrush 和 model/node/leaf 结构是独立的碰撞层。脚本按真实 lump 长度、索引范围和节点遍历校验，保存向外法线的半空间 `dot(n,p)<=dist`、contents、完整 bevel 原值、每个 BSP model 的 brush 归属。这里不把可见 face 当碰撞真值，也不把触发区直接变成阻挡墙。[Valve BSP 结构定义](https://github.com/ValveSoftware/source-sdk-2013/blob/master/src/public/bspfile.h)、[Valve contents/mask 定义](https://github.com/ValveSoftware/source-sdk-2013/blob/master/src/public/bspflags.h)

实测 **20,946 planes / 20,501 brushsides / 2,471 brushes / 43 models**；model 0 的 BSP 树归属 **2,357 brushes**。内容包含 1,253 个 `0x8030000` brush，说明不可见 clip 层占很大比例，不能通过“显示了全部墙”证明角色碰撞完整。保留原位面与 flags，后续需要按 player / bullet / trigger 分别生成并验收 Rapier 形状。

SourceIO 的 `library/source1/bsp/lumps/brush_lump.py` 目前只有 IBSP/RBSP Quake 分支，没有 Valve VBSP lump 18/19 读取器。本脚本因此独立解析这些原始结构，不改 SourceIO，也没有替换游戏碰撞实现。

实际 LUMP_PHYSICS (29) 首次使用原 `PhysicsLump` 得到 AssertionError：`SolidBlock.parse` 连读 `SolidHeader` 后没有按 `solid_size+4` 跳到下一段。实际第一个 world block 有 4 个 solid，因此第二次读错位置。脚本保留原 API 失败记录，采用有界包装：按 block 的 data_size / script_size 和每个真实 solid_size 划定 buffer，再调用**未修改的** SourceIO SolidHeader / CollisionModel / TreeNode。全部 **43 block / 46 VPHY solid / 3,312 非子节点凸叶 / 37,452 triangles** 成功读取，消耗长度精确等于 1,209,060 字节并核对终止记录。独立的 LUMP_PHYSDISP (28) **581,693 bytes** 原样保留，未宣称已转成 displacement collider。

静态道具的 direct PHY 总计缺 466 个模型文件；其中多数可能对应 nonsolid 道具，但仍有 **45 个 solid=6 实例 / 13 个模型**没有找到 PHY。缺口包括若干栏杆、窗户、垃圾堆、车玻璃、屋顶饰件和线夹。主 VPK 的 7 个 PHZ 与这些型号不对应，地图 pak 没有 PHZ。必须在原引擎回退行为、相关手工 brush 或其他权威来源上继续确认；本轮不能把这些物件的 render mesh 宣称为已还原原始碰撞。

## 可视转换的具体边界

SourceIO `import_bsp.py` 会导入世界 / 实体 brush、材质和 displacement，但 `import_static_props` 首先只创建带路径的 **Empty 占位**。真实模型实例化必须后续调用 MDL loader，且保留 sprp 的 skin、solid、uniform_scale 与实例光照。原 API 用 `prop.scaling` 而非 CS:GO v11 的 uniform_scale，后续脚本应显式检查；本图 uniform_scale 非 0/1 数量为 0，不能外推其他地图也安全。

CSGO entity handler 对大部分 class 存在导入函数，但实际仍有 point_worldtext、postprocess_controller、game_player_equip、filter_activator_team、logic_script 缺少对应导入 handler。即使 handler 存在，也只是 Blender 图形 / 元数据入口，不等于炸点逻辑、购买规则、可破坏物、I/O、脚本或触发行为已经在网页实现。

建议后续隔离转换顺序：

1. 世界 faces + displacement，保留原纹理路径、UV、材质 shader 参数；world 与 props 分开输出。对未支持的 Shader 明确记录，而非静默白材。
2. 真正加载 1,258 个 static model 字典项并实例化 3,158 个对象。按模型 / 材质 / skin 分组，但 VHV 是实例光照数据，不能错误地共享唯一 vertex-color 数组而覆盖别的实例。
3. 保留 HDR lightmap、VHV、cubemap、sky_camera 的源记录；确定烘焙或浏览器 shader 映射再宣称光照还原。世界 model bounds 包含远处 3D skybox/off-map 部分，不能用全图包围盒自动归一化模型大小。
4. 所有渲染、出生点、炸点、brush、PHY 使用统一的 Source → 浏览器变换；源 units 和 Z-up 数据本阶段没有缩放。记录一次外层缩放与轴变换，并用实际门宽、出生区、角色尺寸交叉读回，防止 Blender / GLB / loader 重复缩放。
5. 独立生成并验证 collision halfspaces/hulls、displacement、solid props 与 sensor volumes，再把样本接入游戏。可绘制 GLB、原始碰撞来源、已实现的游戏实体行为分别出回执。

## 隔离可视转换样本

`scripts/convert-source-map.py` 只向 `.reference-assets/source-exports/dust2` 写入，依旧固定 SourceIO commit、专服完成回执和显式 provider 顺序。世界和道具各用一个独立 factory-startup Blender 进程：

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python-exit-code 1 \
  --python scripts/convert-source-map.py -- --download-complete --layer world
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python-exit-code 1 \
  --python scripts/convert-source-map.py -- --download-complete --layer props
python3 scripts/verify-source-map.py
```

world 已实际完成：原 BSP faces、8,324 个 displacement 及初始启用的 func_brush 可见面合计 **302,307 triangles**。只删除有编译 sky/nodraw 语义的不可见面，共 837 个 polygon；碰撞原件完全独立。合并成一个带 85 个材质 primitive 的 world mesh；这是方便完整几何验收的样本布局，尚未按 PVS / 空间块组织运行时剔除。GLB 为 **151,958,584 bytes**，85 个可见材质全部带原 baseColor 图，没有缺失材质或诊断材；85 张原 VTF 全分辨率解码 PNG 同时保存在 `textures/`，并嵌入 GLB。读回的三角形数量严格一致。

材质没有声称达到原引擎效果：59 个 WorldVertexTransition 当前只显示第一层 base texture，另有 27 个 LightmappedGeneric 源材质记录（含后续剔除的工具材质）。原 VMT 参数和 SHA256 全保存在 manifest；HDR lightmap、displacement alpha / multiblend、VHV、环境光照、反射和 Source shader 的其余参数尚未重建。普通 tangent normal 采用 SourceIO 同样的绿色通道翻转。工具面被剔除，不需要白色占位；若真正解析失败则使用显式洋红诊断材并在 errors 列出。world 的透明材质均来自 `$translucent=1` / `$alphatest=0`，GLTF 的 BLEND 正确保留。道具若遇到 `$alphatest`，脚本会在导出后写入 GLTF MASK 和原 alpha cutoff，避免 Blender DITHERED 一律导成 BLEND。

所有网格保留源数值单位。只有 `SourceUnits_to_Metres` 外层 scale **0.0254**；Blender glTF 导出执行一次 Y-up 变换，最终浏览器坐标为 **`(0.0254*x, 0.0254*z, -0.0254*y)`**。这是一项明确的预览尺度选择，还未与运行中的原 CS:GO 客户端交叉标定；SourceIO 自己的 Source1 默认其实是 0.01905，本脚本没有沿用那个默认，也不能在 loader 再缩一次。原 3D skybox 的偏远几何 / 道具保留在源位置，不能根据总 bounds 自动居中或缩到单位箱。

道具首次全量运行在第 2,540 个实例主动失败并保留日志 `output/source1-props-conversion-first-failure.log`：源 `dust_hanging_light_02_broken.mdl` 只有一套单材质 skin 表 `[[0]]`，实例却请求 skin 1。独立审阅同时发现 SourceIO `MdlV49.from_buffer` 会截断 skin_groups，因此不能用该对象的 skin_groups 给非默认皮肤验收。当前脚本直接按 MDL header 的 offset / family count / reference count 读取完整 uint16 表，校验长度和索引，再将每个原 mesh 的 skin reference 映射到实际材质 index 后导入。默认 bodygroup 只选 body=0，避免把互斥模型同时显示。相同 `(model,skin)` 共享评估后的真正网格；原模型 / 请求 skin / solid / origin / angles / scale 和实际材质槽均另存实例清单。上述坏灯保留 requested=1，明确以其唯一材质 row 0 作为 preview fallback，**没有据此宣称已观察到原引擎的越界 skin 行为**。

最终全量 props 已完成：**3,158 个真实实例 / 3,170 mesh nodes / 1,258 原模型 / 1,275 model-skin variants / 6,269,945 triangles**，209 个材质、283 张原图，GLB 为 **543,629,080 bytes**。皮肤分布 0:2850 / 1:204 / 2:35 / 3:69，只有上述坏灯一个越界请求，其他皮肤从完整原表映射。没有 Empty-only 占位，也没有贴图解析错误。3158/3158 anchor 坐标读回最大误差 24.805 微米，朝向 quaternion 分量最大误差 1.638e-7。

导出器的真实几何回归已修正并保留证据：Blender glTF 在 nodes.py 调用 Mesh.validate，自动删除 45 个 mesh 上的重复面，按实例合计少 223 triangles。实际 door fixture 被删除的是逆绕向的非零面积重复面，不能当退化垃圾清掉。直接在 Blender 中拆角点又暴露其无效拓扑下的 corner_normals getter 会产生近零向量，因此最终没有采用该方案。当前脚本保留 Blender 的材质、图、node 实例，只对有数量差异的 mesh，从**原 MDL/VVD/VTX**恢复 primitives；法线取原 VVD，经原 VTX vertex remap 后只做轴变换，不经 Blender custom-normal 重编码。随后独立第二次读取原文件，45/45 mesh 的 POSITION / NORMAL / UV 与 GLB 原始 float32 数组严格相等。两个真实 fixture 的诊断见 `output/source-props-degenerate-review.json`。最终 `verification.json complete=true` 检查全部三角索引、有限且单位的法线、嵌入图、原属性 SHA256、实例和皮肤引用，31 项原 alphatest 已逐项验证 MASK / cutoff。

世界面另一次校正保留了 `tools/toolsblack`：其原 SURF flags=0，属于真实可见黑材质，不能仅按 tools 路径前缀剔除。21 个 startdisabled=1 的 retake / 临时 func_brush 保留原实体与 source model metadata，本样本不主动显示它们。原 sky portal 仍按编译语义剔除。最终源材质 shader 记录为 27 LightmappedGeneric + 59 WorldVertexTransition，原先导入禁用实体时出现的两个 UnlitGeneric 已不在默认 world 内。

包内 `map-metadata.json` 保存 30 个原出生点及 browserMetresPosition / browserForward、环境实体、原 BSP SHA256 和碰撞源文件索引；`source-metadata/` 保存 entities / brush 半空间 / VPHY 回执 / 缺 PHY 清单 / NAV 与原 28、29、53 lumps。world 与 props 使用同一外层尺度。当前边界：**完整默认可视几何和原纹理样本已完成结构与源数据读回；光照、完整静态道具碰撞和浏览器实体语义仍未完成。**

只读回已修复 mesh 的原 VVD/VTX 属性，可使用独立进程；它不会重新导入整个场景：

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python-exit-code 1 \
  --python scripts/convert-source-map.py -- --download-complete --layer props --repair-topology-only
python3 scripts/verify-source-map.py
```


## 原始碰撞可运行模块

完整数据、分组语义、30 spawn 与真实通路验收见 [source-map-collision.md](../docs/source-map-collision.md)。当前14,696个Rapier colliders构造通过，原缺失PHY与未解码virtualterrain保持明确边界；CT台阶需要独立的Source运动配置，未改动现游戏。
