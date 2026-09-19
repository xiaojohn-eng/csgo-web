# 原 Redline 材质参数与 Phong 后续依据

本增量只新增 `scripts/probe-source-redline-phong.py` 和本文档；不修改运行时材质、合成参数或服务。私有产物在 `.reference-assets/source-exports/ak47-redline-programs/`。

## 已确认的参数修正

原 AK Redline 的合成强度必须先经过原材质参数调整：**schema intensity 10 → 除以原 AK `$phongboost=2` → 整数 5 → 原 `%f` 文本 `0.019608`**。旧探针从显式整数开始验证的 `10/255` 算术本身成立，但没有涵盖这一上游步骤；不能继续将它当成最终 Redline 参数。

本探针执行原 client ELF 的以下链条：

1. `0xd140c0…0xd1412e`：读取 schema 的 exponent/albedoBoost/intensity，写原字段 `+0xe9/+0xea/+0xeb`。Redline 缺失 albedoBoost 时，原默认 `-1` 经 `+1` 编码为 `0`；不是把缺失参数当作数值 `0`。
2. `0xf52d75…0xf52dad`：原对象字段赋值。原 `ea=0` 经 `-1` 恢复为 `object+0x9f4=-1`，指数为 `150`，强度为 `10`。
3. `0xf5277c…0xf5291c`：成功加载原武器材质后的完整参数分支。Redline style 7 + 原 AK albedoBoost 35 / boost 2 得到 `object+0xc44=35`、`object+0xc48=5`。
4. 同一对象进入原 `0xf52458…0xf5248a` / `0xf524a1…0xf524d2` / `0xf52421…0xf52441`，得到 intensity `0.019608`、exponent `0.588235`、albedoFactor `35.000000`。

**CustomWeapon 的 c3.x 还需要分段转换，不能直接上传 35 或固定为 1。** 原 `$PHONGALBEDOFACTOR` 名称位于 `0x2dfa0`，index 注册在 `0x2dfd0 → 0x361588`；原 info builder `0x64edd` 将它写入 `info+0x64`。`0x65abf…0x65ae4` 读取材料因子；`0x66633…0x667d6` 执行原常量上传，实测公式为 `factor > 1 ? float32(1 / float32(factor)) : float32(factor)`。Redline 对应 **c3.x = `0.02857142873108387`**。

该分支在 `0x666b9` 对阈值 1 执行 `jbe 0x67c90`；小于等于 1 时使用原值，大于 1 时由 `0x666bf/0x666cb/0x666cf/0x666d3` 执行 double 1 除以提升后的因子，再转回 float32。6 组原代码执行覆盖 `-1/0/0.25/1/2/35`，并核对完整 `[3,3,1,c3.x,c3.y,c3.z,c3.w]` 命令。

style 7 不走 style 4/5/6/8/9 的强制 albedoBoost/albedoTint setter。原 AK 的 **`phongBoost=2`、`phongAlbedoBoost=35`、`phongAlbedoTint=1` 保留**。该原分支同时把 `$envmaptint` 写成 `[0 0 0]`。这些值由实际执行分支得出，不能推广到其它武器或 paint style。

额外 10 组诊断覆盖原材质 albedoBoost 缺失、显式 paint kit albedoBoost、原 boost 为 0/1/2，以及不同 style 的除法和 setter 分支。KeyValues 的读写是固定原数据上的宿主 ABI；字段算术、条件判断、跳转、浮点除法和整数截断均执行原 x64。

## 调用先后与同一对象

原 client constructor `0xf53335/0xf53347` 安装虚表 `0x20d1108`，其中 `+0x18 → 0xf52710` 是原武器材质 clone 入口，`+0x20 → 0xf52040` 是 CustomWeapon 合成材料构建入口。

本探针还实际执行原 caller **`0xcd6717…0xcd6858`**：

- `0xcd672b` 执行原虚调用，进入完整 `0xf52710` 函数并正常返回；宿主只提供原 AK 材质加载和 KeyValues I/O。
- clone 返回的材料指针由 `0xcd6737` 保存；两个原 descriptor 均写入同一 paintable 对象。
- `0xcd6854` 提交材料管理器时，实测传入上述 clone 指针和 descriptor 列表，**同一对象的 intensity 已是 5**。记录中的 descriptor mode 分别为 0/1。

因此调整确实先于材料管理器合成请求。该有界执行没有运行完整材料管理器、文件加载、动态数组分配或 GPU 调度；这些接口的替身与实际调用顺序分别记录，没有把人工先运行两段代码当成原 caller 顺序。

## 原 Phong 字节码及共享接口依据

已从本安装的 platform VPK 读取 `phong_ps30.vcs`，选取 **static 2 / dynamic 16 诊断程序**。它不是已经确认的最终 AK 运行 selector。原 shader 名称 xref 为 stdshader `0xaf85b`；使用固定 DX9 SHA 和精确 DWORD token 元组，防止串用不同 combo。

| 内容 | 该诊断程序的原公式 | DWORD offset |
| --- | --- | --- |
| exponent R | 显式 override 为 0 时，`(1-R)+150R`；否则使用 override | 445、449、453、458 |
| Phong mask | `c27.x` 选择 base alpha / normal alpha；后续 `c10.y` 还可选择底色亮度 | 382、694 |
| direct albedo tint | `c26.x<0 ? mix(vec3(c19.w), baseRGB*c0.w, exponent.G) : c19.w*c26.rgb` | 668…685 |
| direct lobe | `sqrt(saturate(NdotL)) * pow(saturate(dot(N,normalize(V+L))), exponent)` | 404…467 |

其中 c19.w 的 Phong boost 与 c0.w 的 albedoBoost 不能合并为 `boost * mix(1,baseRGB,G)`。原 G 分支对 AK 参数对应 **`mix(vec3(2), baseRGB*35, exponent.G)`**。指数图必须按线性数据读取；base RGB 在上述公式中是着色器采样后的值。

原 `$PHONGALBEDOBOOST` index 注册写入 `0x375048`；原 VLG info builder `0xc28f4…0xc2df1` 将其映射到 `info+0xa8`。原 `0xb2580…0xb25b8` 读取材料值，`0xaff1b…0xafffa` 发 `[3,0,1,c0.r,c0.g,c0.b,c0.w]`。4 组实跑确认 albedoBoost `0/1/2/35` 原样进入 c0.w，没有预乘 Phong boost。原 baseAlpha 开关也执行 2 组，并连接到原 token 382 验证。

共享材质接口应能表达 `{boost:2, albedoBoost:35, albedoTint:true}`；这里只提供原始依据，未改 `source-materials.ts`。实际 lobe/Fresnel/光照及其它枪材质仍需要按各自正确 selector 验证。

## 复现与身份

```sh
.tools/source-binary-venv/bin/python scripts/probe-source-redline-phong.py
```

本轮实际通过：4 组原 c0 上传、6 组原 CustomWeapon albedoFactor → c3 上传、2 组原 mask 控制、11 组原 client 参数分支、1 组原 caller 虚调用顺序、36 组原 token 切片数值。切片解释器包含原寄存器复用和再次纹理采样，不能保留半角向量计算前旧 r7 内容作为指数样本。

| 产物 | SHA256 |
| --- | --- |
| stdshader ELF | `0383c51766a4681b5de26aa79b67ade5d3a867a8622185abe8a090877bac7c2e` |
| client ELF | `c47c64c38a066e02bdc006ac4db4fe6e9a318fdd896153accb7af9bd065b7fb5` |
| 原 AK VMT（437 bytes） | `dc01f61f77b650bf36a4115a9b5e2f2ebf1e4fcf7fb2c953c2fc5c28c04d0a30` |
| `phong_ps30.vcs` | `3d705e8aaa456803e05014383f940818367d53027b14cbe70d97115e9fa5799a` |
| `phong_ps30-static2-dynamic16.dx9` | `1afefbe01b7291f0f08404fe7f6aecfabf419d130ebd7e54f04eca5bb1bf9b95` |
| `phong-parameters.json`（55,456 bytes） | `182c7dcc4715f6257697ca87e4cd502fc3f60287da8e3fe7dcf2fc8f972a8665` |

原 DX9、token 文本和 JSON 各自保存在私有产物目录。没有复制 117 MB 的整份 Phong VCS；重跑直接从现有原 VPK 提取。

完整 KeyValues 分配与文件加载、最终 AK shader selector、原 D3D 浮点/纹理采样精度、完整场景光照、最终原客户端像素仍未验收。宿主 `%f` 格式化、float32 解析、normalize/pow 与原 GPU 执行分开记录。
