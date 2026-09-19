# SourceIO 本机 headless 加载回执

2026-09-08，结果 **PASS**。范围仅 import/register/native-library/interface；源模型加载数 **0**，没有模型、动画、贴图转换结论。

## 可复现命令

原作者 [REDxEYE/SourceIO](https://github.com/REDxEYE/SourceIO) 克隆至项目 `.tools/SourceIO`，detached checkout 固定 commit **cfc2591d096628a35f570aa830ab75cc8665108b**。运行前后 tracked files 均保持未改动。

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python-exit-code 1 --python scripts/sourceio-smoke.py > output/sourceio-smoke.log 2>&1
```

命令在项目根目录运行，exit **0**。脚本先校验 commit/干净状态/arm64/factory-startup，再导入并注册 SourceIO，读取 MDL/BSP/VTF/VMT RNA，最后注销；未调用保存用户偏好、全局 pip 或用户目录插件安装。

## 实测值

| 项目 | 读回值 |
| --- | --- |
| Blender | **5.2.1 LTS**，build **9e2066aef7ef** |
| Python | **3.13.13**，Blender 内置解释器 |
| 进程架构 | **arm64**，`background=true` |
| SourceIO | **5.5.5**，最低 Blender **4.2.0** |
| 本机路径 | `.tools/SourceIO`，代码未改动 |
| 原生库 | `library/utils/pylib/macos/pylib.abi3.so`，实际加载成功 |
| 原生库 SHA-256 | **02a3e93bb20ed18944c099b25dbacaed7a54f45984c194d81e00287ab14b0ab0** |
| 原生接口 | VPKFile、compression、image、mesh、vtf，5/5 存在 |
| Blender 接口 | sourceio.mdl / bsp / vtf / vmt，4/4 RNA 可读 |
| MDL 参数默认 | import_animations=False；import_include_animations=False |
| import/register/unregister | 全通过，脚本内总耗时 **4.6403 s** |
| 用户首选项 addon 变更 | 新增项 **[]**，未保存偏好 |

产物：[执行脚本](../scripts/sourceio-smoke.py)、[完整 JSON 回执](../output/sourceio-smoke.json)、[原始 Blender 日志](../output/sourceio-smoke.log)。

仍需后续验证：真实 MDL/VVD/VTX 与 ANI 解码、源 FPS/秒时长、delta/sequence 层语义、Action slot 绑定、多动作 GLB 导出、VMT/VTF 材质映射、真实原作与浏览器对照。详见 [工具链调查](source1-to-glb-toolchain.md)。
