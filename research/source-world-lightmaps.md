# Dust2 HDR 光照与位移曲面校验

此报告对应私有资产管线，尚不代表地图已接入可玩房间或与原引擎视觉完全一致。

## 原始光照

来源是官方 App 740 构建 12426148 的 de_dust2.bsp，SHA256 `b91be410539fbbfc16300423f1e19c024f12addf1429c8cb2f72b53fe0fd6bcc`。

- 9,852 个原面，8,896 个有光照；8,325 个含四层 bump 光照，571 个单层。点亮面均只有原 style 0。
- 2,899,227 个引用的原始 ColorRGBExp32 样本逐字节复制。四层 atlas 均为 2,048 × 1,024，两像素边框仅复制原边缘。
- 解码为 `RGB8 / 255 * 2 ** signedInt8(exponentByte)`；先解码相邻样本，再在线性空间插值，不能对编码指数滤波。
- 依据固定 Valve Source SDK 2013 的 TexLightToLinear、ConvertRGBExp32ToLinear；URL、commit、hash 在 source-lightmap-reference.json。这不是 CS:GO 客户端 shader 源码。

## 起始角纠错

普通 BSP 面使用 texinfo lightmap vectors 投影。位移面按 SDK CalcLuxelCoords、CalcDispSurfCoords 的调整后四角网格插值。相关原文件记录在 source-displacement-lightmap-reference.json。

首次范围检查在 face 1942 查出投影方法错误。进一步的原始顶点与 UV 配对，在 face 3744 查出 SourceIO 的起始角误选：np.isclose(points,start,.005) 的第三参数是相对容差。原 start [832,2048,568] 被误选为 [832,2056,568]。

source-displacement-start.py 在隔离进程内使用原 SDK FindSurfPointStartIndex 的最小平方距离规则。原 BSP 角点存在舍入，最近角与 start 的实际最大差为 .02001953125 单位。0.1 单位绝对检查只检测坏数据，不改变最近角选择。共 575 个面修正起始角，最大原误选距离 52 单位。固定 SourceIO 仓库和 Blender 全局设置未修改。

旧 dust2/world.glb 与旧 GPU/meshopt 记录保留，其结构、数量和字节一致结论不能覆盖该几何语义错误。新参照是 dust2-corrected/world.glb；新增 HDR 与 faceID 的版本是 dust2-lightmapped/world.glb。

## 独立读回

validate-source-lightmaps.py 直接读取原 BSP 与 GLB：

- 302,307 三角形、85 材质、8,896 原 face IDs。HDR 版与纠错参照的位置、法线、base UV、角点顺序和绕序逐字节相同。
- 所有新增 UV 位于对应原面 luxel 范围；每个三角形的三个 face IDs 精确一致。
- 全部 8,324 位移面由 UV 反推原网格顶点，再按 BSP 四角及原位移向量重建位置；最大位置误差 .00048828125 Source 单位。
- 四层 atlas 文件 SHA256 均读回一致。

纠错参照 SHA256：`cd1d43e4fd1c4cad8c3e980191976f79fa637c0ddc76c33074305128d580c6ad`。

HDR 世界 SHA256：`91b52e52b988e1b41b07b9cd365c159d615934fa49f07c3fa1e438d43269ffa8`。

## GPU 与剩余差异

preview-source-lightmaps.js 使用原 HDR 第 0 层提供 diffuse illumination，已实际编译并查看 CT/T 出生点。后三层 bump 方向光照保留在磁盘，尚未接入 shader。原始样本没有调色、量化或曝光烘焙。

道具 VHV、WorldVertexTransition 第二纹理与顶点 alpha、方向 bump 光照、环境 cubemap、天空、原曝光和雾仍未完整实现。当前道具仍明显过亮。PVS 与共享可玩模拟也在分别接入，不能声称完整光照还原。
