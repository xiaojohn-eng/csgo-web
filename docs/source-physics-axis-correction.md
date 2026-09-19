# Dust2 PHY 轴错误：原生指令、私有重导与真实移动回归

2026-09-09。已定位并修复 **P1：原 Source PHY 转换遗漏 IVP Y 轴符号**。没有修改 KCC、台阶/坡度/净空阈值或地图碰撞范围；没有覆盖 public、重启 LAN 服务或操作浏览器。下面的验收对应私有候选，网络与视觉仍需主任务统一 stage 后实测。

## 私有候选

- `.reference-assets/source-exports/dust2/collision-ivp-corrected/collision.json`
- SHA256：`55184f994bc852dc229bbed0cb772cb843b1bc662054013c5076df98ce2a43cb`
- 32,758,187 bytes；同目录 `manifest.json`。
- 原 BSP SHA256 仍为 `b91be410539fbbfc16300423f1e19c024f12addf1429c8cb2f72b53fe0fd6bcc`。
- 几何数量、源实例身份、mask、传感器及缺失范围均不变：12,459 共享几何、14,681 固体 collider、15 sensor。11,762 个 prop PHY 凸体实例、787 个 world VPHY 实例；缺失 PHY 仍为 13 个模型、45 个实例，完整名单和原坐标在 JSON `missingPHY`。未用 AABB 或渲染网格补缺失。

旧 `.reference-assets/source-exports/dust2/collision/` SHA `8edf9d1ecc0a27e73d10666ab976a708bdd6f7553515601f75308c54ee8c6999` 留作红证据，其 **PHY 几何正确性结论作废**。原 BSP brush 半空间、displacement grid、传感器来源不依赖这一错误 helper，独立逐项比较保持相同。以前的通路“通过”无法证明未走到的倾斜道具与 world VPHY 坐标正确。

## 真实失败与根因

输入来自 `output/playwright/source-r4-ct-arms-after-ack.json` 原 LAN CT 状态：feet `(12.09457363959501,-3.2736165000513897,-55.96975389061562)`，yaw `-1.6435061141549534`。同一真实 `Simulation` / Source movement / 60Hz 输入，W 48 tick：旧数据仅前进 **0.0285789041m**，完全复现 LAN 症状；修正版前进 **2.5936108281m**。蹲姿也能推进；没有通过跳跃绕过错误。

原 blocker 是 static prop **2647**，`dust_kasbah_ladder_128_01.mdl`，Source origin `[498,2331,-106]`、angles `[-60,0,-90]`，原 convex geometry 10422。旧 PHY 落在浏览器 Z `[-59.2241,-55.7320]`；原 VVD 和正确 PHY 都位于约 `[-62.69,-59.17]`。空坡上的“墙”是同一梯子错误反射后的形状。

原生 StepMove 的抬高/水平/落地诊断对旧数据落在这个错误梯面的 support normal.y `0.50376`，低于原 `.7` 可站阈值，因此 KCC 拒绝是正确行为。不能把台阶或爬坡阈值调高来掩盖这项数据错误。

## 原安装二进制证明

`scripts/probe-source-physics-axis.py` 用 Unicorn 只执行已安装 App740 `bin/vphysics.so` 的原 SSE 坐标转换指令块，未启动原引擎或模拟外部系统调用。

- binary SHA256：`7364e056a403b885441cfc1cd3e9c127a807143cad9a41c97a145c37894aba02`。
- `CPhysicsCollision` RTTI `0x159fd4` → vtable `0x15a0e0` → `ConvexFromVerts` `0x3f8a0` → vertex builder `0x3f610`。
- 执行 `0x3f66c..0x3f6a7`，原因子地址 `0x1be048` 的 float32 `.0254`；原 XOR 符号掩码 `0x159710` 为 `0x80000000`。
- 6 组输入包含三个单位基向量与非对称点。原 SSE 输出逐值符合 **IVP = `(Source.x,-Source.z,Source.y) * float32(.0254)`**。
- 反变换的轴约定为 Source = `(IVP.x,IVP.z,-IVP.y) / .0254`。浏览器依旧是 Source `(x,z,-y)*.0254`，不得重复缩放/旋转。

`SourceIO.library.models.phy.phy.CollisionModel.get_vertex_data` 已把原 IVP 的 Y/Z 交换，却没有恢复这个负号。修复位于 `scripts/export-source-collision.py`，在现有 helper 读完后 **只将返回的 column 2 取负**，再进入原 model→instance→browser 坐标链；world VPHY 和 static PHY 共用此路径。已额外限制仅接受本次验证的单 identity 根骨 static 模型，未来不同骨树需单独处理。

证据：`output/tests/source-physics-axis.json`、`output/source-physics-convexfromverts.asm`、`output/source-physics-convert-vertices.asm`。接口槽位参考固定 Valve SDK [vphysics_interface.h](https://github.com/ValveSoftware/source-sdk-2013/blob/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/src/public/vphysics_interface.h)；原坐标转换数值来自本机当前二进制。

## 原始骨树与全顶点交叉核验

`scripts/audit-source-physics-models.py` 独立读取原 PHY vec4 字节，刻意绕开上述 SourceIO 顶点 helper；instance rotation 使用直接实现的固定 SDK [AngleMatrix](https://github.com/ValveSoftware/source-sdk-2013/blob/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/src/mathlib/mathlib_base.cpp#L1194)，不调用导出器的 Blender Euler 转换。[原 SDK 的碰撞调试网格示例](https://github.com/ValveSoftware/source-sdk-2013/blob/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/src/game/server/physics.cpp#L2890)也把 static prop 本地碰撞点乘实例 origin/angles。

- **616 / 616** checksum 匹配的 PHY 模型均为 `STATIC_PROP`，每个均只有一个 `static_prop` 根骨，parent `-1`，位置 `[0,0,0]`、四元数 `[0,0,0,1]`、原 inverse bind 为 identity；所有 7,000 个共享凸叶 bone id 为 0。报告保留逐模型 SHA、完整骨树/逆矩阵、原 PHY keyvalues，不用“静态模型应该没有骨骼变换”来替代检查。
- 全部 **11,762** prop 凸体实例、**142,416** 顶点逐项比对原 PHY inverse + SDK instance matrix，最大分量误差 **3.2102µm**，来自 f32 顶点/四元数导出舍入；旧反射坐标最大误差 **39.2687m**。
- **787** world / active brush VPHY 实例最大分量误差 **8.3765µm**，含其原实体 origin/angles。
- 12 个实际非对称/倾斜道具实例另存原 MDL/VVD/PHY 原点、旋转、源边界及世界边界。包括失败梯子 2647、CT 台阶 1216，以及 5、321、324、326、463、465、490、493、494、855。VVD 与 PHY 边界只是诊断对照：简化物理壳不要求等于渲染 bbox，未据此替换或“修补”原凸体。
- 原 brush / displacement 几何、传感器、source identity、role 和 missing PHY 数据逐项保持一致。

回执 `output/tests/source-physics-models.json`，日志 `output/source-physics-models.log`。

## 碰撞与移动回归

1. `scripts/probe-source-ct-ramp.ts --corrected`：同原 LAN feet/yaw，6 个站/蹲/5mm 微抬/跳/A/D 变体；站立 W >2m、蹲 W >.3m，并断言这两段不再接触梯子 2647。回执包含 collision SHA。
2. `scripts/source-player-movement-smoke.ts --corrected`：**60/60** 原站蹲出生落地；五条可行路线 × 两姿态通过；原 B 端点仍由 brush846 阻挡；真实 NAV area6476 的低顶 brush480 拒绝站起；斜边碰撞、落地、按住 jump 仅跳一次、松开再按正常。全部采样最大检测 AABB 穿透 **0m**。
3. `scripts/source-collision-corrected-smoke.ts`：真实梯子位置的玩家/子弹/投掷物三类 ray 均在 **0.8956156m** 命中；站立 AABB sweep 在 **1.1792623m** 被阻挡；梯档空隙的零半径 ray 仍穿过。相同梯子在原 LAN 空坡的 .2m sweep 没有命中。旧数据该空坡 sweep 在 **.0008959m** 命中，实际梯子位置却未命中，脚本 `--original` 保留预期失败的红日志。
4. 真实 playerclip / grate / world VPHY 的孤立角色分组符合原 mask；15 个 sensor 可查但不会成为 player/bullet/projectile 实墙。dispose 两次只回收本模块数据，保留 caller sentinel。
5. `source-map-collision` / `source-player-movement` / `source-level` 现有专项 **19/19**；本次全 TypeScript 检查通过。

移动 smoke 7,427 样本（单 actor movement + full-map world.step）平均 **.1970ms**，p95 **.2652ms**、p99 **.4090ms**、max **6.8811ms**。这不是十人服务端基准，也不是 LAN / GUI 60FPS 证明。

## 复现与交付边界

```sh
.tools/source-binary-venv/bin/python scripts/probe-source-physics-axis.py
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python-exit-code 1 --python scripts/export-source-collision.py -- --download-complete
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python-exit-code 1 --python scripts/audit-source-physics-models.py
npx tsx scripts/probe-source-ct-ramp.ts --corrected
npx tsx scripts/source-player-movement-smoke.ts --corrected
npx tsx scripts/source-collision-corrected-smoke.ts
# 对旧产物执行这条会以断言失败结束，这是保留的真实红对照：
npx tsx scripts/source-collision-corrected-smoke.ts --original
npx vitest run tests/source-map-collision.test.ts tests/source-player-movement.test.ts tests/source-level.test.ts
npx tsc --noEmit
```

导出 JSON 内保留当次 elapsedSeconds，因此重新生成会产生新文件 SHA，即使物理几何相同。主任务须从同一已验文件统一 stage 客户端与服务器，并采用完整 collision SHA 派生版本；仅 BSP hash 一致不足以允许新旧物理数据联网。

仍未声称完整原生物理引擎逐 bit 相等、动态 breakable/实体 I/O、材料物理属性、13 个缺失模型的精确 PHY、穿透/投掷时序或浏览器最终验收。本轮没有改 KCC 或通过地图改形消除阻挡。
