# Redline 输出尺寸、写色和最终格式增量

运行时 owner 改为 **颜色 1024、指数 256**，采用原成功 clone 后的 intensity `5 → 0.019608`。接口 `apply(root, finish)` 不变。FP / world 暂时仍共用这组参数资源；当前是原最高物理 RT + 原 Redline 指数尺寸的候选，尚未完整移植游戏各调用者的请求尺寸与 `mat_picmip`。没有把 2048 当成更接近原版。

## 原写色状态

`scripts/probe-source-redline-render-contract.py` 对 preview / exponent / hardware support / 初始 flags 执行 32 组原代码。

- stdshader `0x65d3a…0x65d55` 生成 `(!exponent) || preview`，调用 writer 虚表 `+0x98`。
- 原 shaderapi RTTI 确认 `CShaderShadowDX8`，虚表 `0x315440 +0x98 → 0x5c980`。实际原方法设置 `object+0x39 bit 2`，包括不支持硬件时清零分支。
- 原 `0x62874…0x6289e` 写出 `[1,194,enabled]`；对应直接路径调用原 `IDirect3DDevice9::SetRenderState`。
- 原 libtogl `0x2b4a0` 的 state 194 分支 `0x2b570 / 0x2bef8`，实际 dispatch `GL_FRAMEBUFFER_SRGB (0x8db9)` enable / disable。

硬件能力与 GL 函数是显式 ABI 输入/记录端；没有启动原引擎或原 GPU。由此支持网页颜色 sRGB 写出、指数线性写出的状态选择。**不证明原 GPU 量化或最后压缩像素相等。**

## 逻辑尺寸到最终 VTF

原 materialsystem RT 表 `0x37f760` 的四项为 `_rt_CustomMaterial1024/512/256/128`。`0x68d60` 实际执行 17 组请求，假定四个目标成功分配；逻辑请求大于 1024 仍选中 1024。

原 `CCompositeTexture` 逻辑尺寸为 `(1 << object+0x21c) >> picmip`，存 `+0x2a8`。原 `0x699e0` 的 ignorePicmip 分支已执行 6 组；没有伪造运行中的 ConVar 值。

后续原链条说明 RT 是实际输出尺寸：

1. `0x68da0…0x68e4b` 选中 RT 写 `object+0x2b8`，对应共享 VTF 写 `+0x2b0`。
2. `0x69042…0x690c7` 根据共享 VTF 的宽、高、深度、mipCount 初始化最终 VTF `+0x280`；此原参数 writer 已实跑 34 组。allocator 与尺寸 getter 是显式 ABI 输入。
3. `0x6a210…0x6a2b2` 从实际 RT 读取宽高，设置绘制矩形；`0x6a3a0…0x6a438` 又按同一尺寸读回。这两个调用点已逐指令读取，未当成实际 GPU 执行。
4. 原 `0x696a7` 调用 CVTFTexture vtable `+0x170 → 0x115f70` 生成 mip，然后 `0x696b8…0x69757` 逐 mip 转换。生成函数与原 mip 字节尚未执行/移植；网页仍使用 WebGL mipmap。

指数 descriptor 的 **24 组原执行**包含 `colorLog2==9` 强制 exponentLog2=8，以及其它颜色尺寸从 paint kit `+0x11c` 进入原 `0x13e7bf0` 整数 log2。原 schema 字段 `view_model_exponent_override_size` 默认 256，Redline 未覆盖；原默认所有这些 cases 均请求指数 256。

最终格式来自原 `ImageFormatInfo` 表 `0x37f910`，不是凭枚举名称回忆：索引 65 为 `DXT1_RUNTIME`，66 为 `DXT5_RUNTIME`。原 VTF init 和逐 mip 转换分别选指数 65、颜色 66。因此当前直 RGBA 是保留 alpha 的网页实现，**不是原最终 DXT 字节**。

## 代码与运行证据

- `game/source-redline-render-contract.ts` 把原写色、物理 RT 上限、当前 owner 尺寸与未闭合边界分开。
- `compose(parameters, colorSize, exponentSize=colorSize)` 保留旧的显式同尺寸诊断调用；结果 `color.size`、`exponent.size` 各自附带尺寸。owner 正确按各自尺寸创建 DataTexture，继续有界共享、取消和释放。
- `sourceFinishEvidence` 新增 `sizes` 与 `outputBoundary`；后者明确 DXT / RGBA、原压缩未复现、原 mip 未复现、游戏 profile/picmip 未完成。
- 4 个独立 Redline 测试文件 28 项通过，包括原完整 c3 writer 的 `factor>1` 取倒数分支，35 对应 float32(1/35)。针对独立 Redline 运行模块的严格 TypeScript 检查通过。全工作树 `tsc` 受私有同步的主 runtime/types 与旧 Deagle / Art / Audio 依赖不匹配影响，未宣称通过。

真实 WebGL 复验 `seed 422 / wear 0.4`：FP/world 共用材质，5 个其它材质未改，旧请求不覆盖新状态，默认材质恢复，renderer 纹理数 `17 → 19 → 17`。本次计时 7.6 ms 只含输入已加载后的生成，不是完整加载性能承诺。中性诊断光下已亲自检查 FP / world / 恢复图。仍使用旧有界 `createSourceAKMaterial`，共享 AK 的 albedoBoost 35 公式由主任务随后接线，截图不是该后续公式的验收。

| 产物 | SHA256 |
| --- | --- |
| `render-contract.json` | `2233f1c92eaae943de83143d676d9cd22d15d47c314d3474b0db395b12a233df` |
| GPU color RGBA 1024 | `97547e3323ce6990d22a983c753e81f9fab68707440c3b128a3e8a4da2597cf0` |
| GPU exponent RGBA 256 | `5bdca58275ff55029874d89a43684cdca309fcf9f97e55e5b332428f49a168ed` |
| `output/redline/finish-owner-contract.json` | `0f6266c18688b5b7cd1cff21809ce23a9ddb1d1769fa7c56f55ebee2a02f391e` |
| `output/redline/finish-owner-contract-preview.png` | `20f8a03f9db4f5050b7bce4e979e3a338a1a885eadb560893c02d0f5b5276851` |

原 JSON / DX9 文件在私有 `.reference-assets/source-exports/ak47-redline-programs/`；新版截图 `output/redline/finish-owner-contract-preview.png`，旧双 2048 图像与 JSON 保留原文件名。没有修改主服务、public 输入或共享 Scene / UI / runtime。
