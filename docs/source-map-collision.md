# Dust2 原始碰撞模块与实际通路验收

> **2026-09-09 PHY 坐标纠正**：本文件早期 `dust2/collision/` 的世界/道具 PHY 验收已被后续真实 LAN 复现推翻：SourceIO 交换 IVP Y/Z 后遗漏符号，导致原 Source Z 反射。BSP brush/displacement/trigger 数据未受此错误影响。修正版及新完整回归见 [source-physics-axis-correction.md](source-physics-axis-correction.md)（research 内相对路径为 `../docs/source-physics-axis-correction.md`）；旧数据与结果保留为问题证据，不能继续当当前物理几何正确性证明。

本轮输出可独立挂到 Rapier World 的碰撞数据与纯模块，没有修改 `simulation`、场景、服务器或 `public` 游戏资源。它还没有接入游戏。数据来自完整 App 740 build 12426148 的 de_dust2，BSP SHA-256 `b91be410539fbbfc16300423f1e19c024f12addf1429c8cb2f72b53fe0fd6bcc`。

## 产物与复现

- `.reference-assets/source-exports/dust2/collision/collision.json`：32,762,387 bytes，SHA-256 `8edf9d1ecc0a27e73d10666ab976a708bdd6f7553515601f75308c54ee8c6999`。
- 同目录 `manifest.json`：统计、来源、缺失 PHY 实例原坐标、哈希和未实现项。
- `game/source-map-collision.ts`：`attachSourceMapCollision(world,data,options)`、查询分组、统计、原来源 metadata、幂等 `dispose()`。
- `scripts/export-source-collision.py`：固定 SourceIO commit、已完整下载 ACF 校验；不依赖渲染 GLB，不创建 Blender 场景物件。
- `scripts/source-map-collision-smoke.ts`：真实全地图、30 出生点、墙/角色分组/传感器、85 地面采样、6 次通路行走。
- `tests/source-map-collision.test.ts`：4 项有边界的模块测试，覆盖非 AABB 斜面、旋转/缩放、分组/传感器、只释放 owned 资源及失败回滚。

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python-exit-code 1 --python scripts/export-source-collision.py -- --download-complete
npx tsx scripts/source-map-collision-smoke.ts
npx vitest run tests/source-map-collision.test.ts
```

## 数据与坐标

Source `(x,y,z)` 严格转换为浏览器 `(.0254*x,.0254*z,-.0254*y)`；与已交付 `world.glb` 的外层变换相同。JSON 已是 Y-up 米，调用者不能再次缩放/旋转。每个原凸体以自身中心为局部原点，保留实例 origin、Source angles 和 uniform_scale 的组合，降低远处暖身场景的浮点损失。

| 来源 | 实例碰撞体 | 方法 |
| --- | ---: | --- |
| BSP brush | 2,031 | 原 brush/model 归属、所有半空间三平面求交，包括原 bevel 限制；没有 AABB 替代 |
| World / active func_brush VPHY | 787 | 原 LUMP29 43 block / 46 solid 的凸叶，projectile 专用；启用的 4 个 func_brush 采用其原实体变换 |
| Displacement | 101 chunks | 原 8,324 个 displacement 的完整 grid、300,832 triangles、原 offsets / triangle diagonals；不是 world.glb 网格 |
| Static prop PHY | 11,762 | 原 solid=6 的 MDL/PHY checksum 匹配后读取原凸叶，复用形状并实例化 |
| 传感器 | 15 | bomb target、buy zone、trigger_* 原 brush，仅传感查询 |

总计 14,696 Rapier colliders，14,595 convex / 101 trimesh。用于 player 13,893、bullet 12,615、projectile 12,651，三者会重叠。原所有 PHY triangles 仍保存在 JSON 凸体记录中，Rapier 用这些原凸体点重建凸体；没有把所有可见三角形当碰撞。trimesh 仅启用 FIX_INTERNAL_EDGES，未用删除坏面/重复面的修复选项。

求 brush 顶点的初版使用 .002 Source unit 容差，会在接近共面的源 bevel 周围产生多余顶点，实际 brush 367 导致原生凸体构建失败。最终改为 double 求交和 1e-7 Source unit 数值容差，最终所有凸体构造通过；不是缩小/删除该 brush 或用包围盒掩盖。

## 用途分组

原 contents 位来自地图。分组候选使用 Valve 官方 [bspflags.h](https://github.com/ValveSoftware/source-sdk-2013/blob/master/src/public/bspflags.h)：player=`MASK_PLAYERSOLID` 0x0201400b，bullet=`MASK_SHOT` 0x46004003；静态 projectile 明确采用 `MASK_SOLID` 0x0200400b。GRATE 阻玩家/投掷物而不进入此 bullet mask；PLAYERCLIP 只阻玩家。未实现本 CS:GO build 的动态实体过滤、武器特例、penetration、grenade 时序，不能把所有 projectile 都宣称等价原引擎。

player/bullet 采用 brush，projectile 采用对应 VPHY，避免重复接触。`func_clip_vphysics` 单独作为 projectile；enabled 的实体才装载，disabled / never-solid brush、areaportal、occluder 等留在 metadata。原所有非零 contents 不会一概成为墙。

```ts
await RAPIER.init();
const world = new RAPIER.World({x:0,y:-22,z:0});
const map = attachSourceMapCollision(world, data);
world.step(); // caller owns query refresh / simulation schedule
const groups = sourceMapQueryGroups('player');
// colliderDesc.setCollisionGroups(groups)
// world.castRay(ray, max, solid, flags, groups)
// sensor-only queries use SOURCE_SENSOR_QUERY_GROUPS.
map.dispose(); // before world.free(); does not remove caller's actors.
```

必须给 actor 与 query 设置对应 groups；默认 Rapier ALL 会把 bullet 查到 PLAYERCLIP，并同时命中 BSP/VPHY 的不同表示。sensor group 是独立的查询入口，本模块不创建自动 enter/leave 游戏事件。销毁两次保持安全，构造失败仅回收本次已经添加的 colliders。

## 当前实测

证据：`output/tests/source-map-collision.json`、`output/source1-collision-unit.log`、`output/source1-collision-typecheck.log`。当前一次实际 JSON→colliders→step 为 **1240.7 ms**（JSON 读取在计时外），这只是装载成本，不是 GUI FPS 或服务器 10 人 CPU 基准。

- 30/30 原出生点向下找到 normal.y > .9 的地面；完整 standing capsule（现项目半段 .63m / radius .3m）扫掠落地后 30/30 无重叠。出生点不是预先吸到地面的坐标。CT hammerid12649439 的单点射线落点旁有原 PLAYERCLIP 台阶；完整胶囊扫掠正确停在更高支撑面，不能用中心射线代替体积净空。
- CT/T 两区域各 8 个方向：原墙能挡 bullet ray 与有限半径 projectile sweep；真实 PLAYERCLIP、GRATE brush/VPHY 分开隔离查询，正确命中/排除。
- 15/15 原传感器能被 sensor 查询命中，不能被 player/bullet/projectile wall 查询命中。
- CT 阶梯、中路、A 大、A/B 点内 85/85 固定地面射线命中原向上表面。地面采样线可能经过箱顶或跨过门楣，不能据这些射线单独宣称可走。
- 另行实际 KCC 行走：中路到门 514 tick、A 大 652 tick、B 点内 155 tick、A 点内 61 tick 均到达目标（固定 60Hz、2.8m/s、有重力）。使用 standing capsule 和现有 .28m autostep。
- **必须处理的集成差异**：原 CT 台阶线 Source `(256,2200,-50)→(256,2440,-50)`，现有 .28m autostep 停住 60 tick，终点仍相距 3.820m；仅在独立 KCC 对照把跨阶改为 `18*.0254=.4572m`，同一份原始碰撞数据 142 tick 可到达，终距 .043m。没有改变/删掉阶梯碰撞。此轮后继续补原 Source AABB 与本 App740/固定官方 SDK 参数证据，不能拿 C02 全身胶囊等同 Source hull。
- 模块单测 4/4；实际世界最后删除本模块 colliders，保留 caller sentinel，再删除 sentinel / free，无 WASM borrow 错误。

## 缺失 PHY 与能力边界

45 个 solid=6 实例 / 13 模型没有找到对应 PHY；其中 **25 个主图实例、20 个五个暖身 arena 实例**。原坐标、实例 index 和模型名均在 manifest/missingPHY；没有生成 render-mesh 或 AABB 假碰撞。这不等于已经证实存在 45 个通行洞，因为相同位置可能还有原世界 brush。

| 模型末名 | 实例数 |
| --- | ---: |
| `dust_window_48x152_double_01.mdl` | 7 |
| `dust_window_56x90_01.mdl` | 2 |
| `dust_rooftop_ornament_02.mdl` | 1 |
| `dust_electric_panel_02_cover.mdl` | 1 |
| `dust_railing_f_64.mdl` | 17 |
| `dust_railing_f_128.mdl` | 7 |
| `dust_window_quarter_round_112_01.mdl` | 3 |
| `dust_railing_e_end.mdl` | 2 |
| `dust_rooftop_ornament_01.mdl` | 1 |
| `dust_trash_pile_02.mdl` | 1 |
| `dust_car_wreck_glass.mdl` | 1 |
| `dust_trash_pile_03.mdl` | 1 |
| `dust_wires_01_clamp.mdl` | 1 |

原 PHYSDISP LUMP28 的 8,324 个长度块精确消耗 581,693 bytes，但 native optimized virtualterrain 的几何尚未解码。当前 displacement hull/ray 使用原完整 grid，这与 Valve 的完整 trace grid 路径相符；`disp_ivp.cpp` 的物理 virtual terrain 可使用不同 tessellation，因此投掷物在该地形上的边缘结果还不能宣称完全等价。参考 [dispcoll_common.cpp](https://github.com/ValveSoftware/source-sdk-2013/blob/master/src/public/dispcoll_common.cpp)、[disp_ivp.cpp](https://github.com/ValveSoftware/source-sdk-2013/blob/master/src/utils/vbsp/disp_ivp.cpp)。本图 displacement 低碰撞 flags=0，未出现需移除的 triangle tag；遇到未知变体导出器主动失败。

没有实现原 Source 材质 friction/restitution、动态足球 prop_physics、breakability、entity I/O、触发事件、原AI/NAV或CS:GO运动。静态 prop 原 PHY 的相对精度不代表其可见所有装饰都应该碰撞。原 1,900 个 nonsolid props 继续无碰撞；远处五个官方 warmup arena 也在完整资源中，不能按世界包围盒把它们误认为主图比例。
