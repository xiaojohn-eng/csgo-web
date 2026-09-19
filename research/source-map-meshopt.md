# Dust2 GLB 存储无损 meshopt 压缩

日期：2026-09-09。**两个新私有GLB已经完成编码，并通过重新打开文件的独立Decoder逐字节回读。** 未覆盖原GLB，未修改game/public。收益是传输与存储体积；没有减少顶点、三角、道具或绘制调用。

| 文件 | 原bytes | 新bytes | 缩小 | 实测decode-only |
|---|---:|---:|---:|---:|
| world | 151,958,584（144.919MiB） | 140,367,324（133.865MiB） | 7.628% | 9.94ms |
| props | 543,629,080（518.445MiB） | 492,593,076（469.773MiB） | 9.388% | 96.74ms |

输出是 [world.meshopt.glb](../.reference-assets/source-exports/dust2/world.meshopt.glb) 和 [props.meshopt.glb](../.reference-assets/source-exports/dust2/props.meshopt.glb)。SHA256分别为：

```text
world original 2076cee4605904a0e912b3d7f19c2b18c676cd8e29f14f604007f0865b4bb47d
world meshopt  7ccfbbe23f7e20d0d2e731db447a67d2b9605c404f9c98463677a953487f02d4
props original 55937fce28a53461520fa2c531384f65f0f8b69df1a8205245466b6064ab5232
props meshopt  912af99fe6b5d0147d571c96f7793dcf1722d502f0d55f5c66301f6ca8e10c59
```

## 编码契约

使用已存在的MIT `meshoptimizer` 1.1.1，不安装依赖。直接对原GLB的bufferView编码，避免场景重建序列化引起网格、材质、extras重排。`MeshoptEncoder.encodeGltfBuffer` 对属性使用 **ATTRIBUTES / version0 / filter NONE**，原float32位模式保持；索引使用 **INDICES**，不做缓存排序、顶点重排、量化、过滤、简化或图片处理。

这是有意避开TRIANGLES模式：官方说明triangle codec可循环旋转每个三角的三个索引，虽然保持三角绕序，却不满足本任务逐字节相等。作者明确推荐需要精确保留索引顺序时使用`encodeIndexSequence`。[meshoptimizer v1.1原文](https://github.com/zeux/meshoptimizer/blob/v1.1/README.md#index-compression)

EXT使用物理buffer0保存编码块和原图片，placeholder buffer1保存原解码布局；其byteLength和各压缩view原byteOffset/byteLength/stride/target保持。扩展列为required，placeholder标fallback；不含未压缩备份。存储布局按[Khronos扩展规范](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Vendor/EXT_meshopt_compression/README.md)组织。

world有332个ATTRIBUTES、85个INDICES、93个RAW view；props有4355个ATTRIBUTES、1273个INDICES、353个RAW view。其中图片全RAW；8/70个很小的几何view编码不省空间，因此原样保留。原props中修复后未再被mesh引用的47个旧索引accessor也原样保留，未被清理。

整个原BIN和整个GLB容器并非逐字节相同：编码后存储地址、JSON包装与扩展声明必然改变；不被任何bufferView引用的128/734bytes对齐区域未带入新容器。**本次“无损”严格指每一个原bufferView/accessor及图片解码数据位级相同，所有非存储JSON结构和值相同。**

## 独立回读结果

[压缩脚本](../scripts/compress-source-map-lossless.mjs)只导入Encoder；[回读脚本](../scripts/validate-source-map-meshopt.mjs)独立实现GLB解析、重新打开源/输出文件，只导入Decoder，没有调用压缩器帮助函数。

- **6491/6491原bufferView逐字节相同**，并逐项留SHA256。
- **6123/6123原accessor逐字节相同**，没有浮点容差；负零或特殊浮点bit pattern也受同一字节约束。
- **368/368图片原压缩文件字节及SHA相同**，未重编码PNG、缩放或改变颜色空间。
- 所有非存储JSON deepEqual，包括mesh primitives及indices引用、node父子关系/变换、skins、动画、material、image元数据，以及各级extras。两文件本身没有新增或删除节点和mesh。
- world唯一mesh及mesh-node计数均302,307三角；props唯一mesh合计3,951,768三角、按实例mesh-node合计 **6,269,945三角**。精确索引值/顺序和非索引顶点序列保持，因此原反绕面、同绕面和重复面均保留。

完整回执：[world](../.reference-assets/source-exports/dust2/world.meshopt.verify.json)、[props](../.reference-assets/source-exports/dust2/props.meshopt.verify.json)。包含脚本与encoder/decoder模块SHA、逐view/accessor/image SHA、尺寸、计时。encode回执与日志也保留。

```sh
node scripts/compress-source-map-lossless.mjs
node scripts/validate-source-map-meshopt.mjs
```

两个命令均exit0。当前Node22.23.2、native Apple silicon；WASM模块ready之后逐view测量纯decode调用，不含分配输出、文件IO、JSON解析、SHA和比较。包含完整验证的回读耗时约288ms/1159ms。这里只记录一次最终完整回读；先前独立通过一轮为9.34ms/98.27ms，不能把这些本机CPU数字称为浏览器加载或GPU帧率提升。

## 加载接入与边界

本机Three GLTFLoader已包含EXT_meshopt_compression处理，现有Decoder `supported=true` 并支持async API。主任务接入时需在加载前显式设置：

```ts
import {MeshoptDecoder} from 'meshoptimizer/decoder';
loader.setMeshoptDecoder(MeshoptDecoder);
```

未接Decoder会因required扩展按预期失败，不能退回空placeholder。浏览器真实GLTFLoader+GPU渲染仍由主任务验收；本报告未宣称已接入运行时。

原图片占world135,109,758bytes、props392,350,430bytes，且本轮必须保持它们的编码字节，因此整体体积下降有限。纯几何编码实际减少较多，但解码后GPU接收的原顶点与draw结构完全相同；不能用这次压缩替代PVS、正确实例可见性或其他绘制性能工作。
