# 原 Leet A / 世界 AK 材质候选

`game/source-character-materials.ts` 是原私有组合 GLB 的有界 Phong 候选，未修改既有 `source-materials.ts`，尚未自动接入游戏。保留原底色和原控制图，去除失败的通用PBR映射；是否消除实际白化和接近原衣料外观，由父任务 GPU 审阅确认。

## 接口与输入

```ts
const upper = createSourceCharacterMaterial('upperbody', {base, normal, exponent});
const lower = createSourceCharacterMaterial('lowerbody', {base, normal, exponent});
const head  = createSourceCharacterMaterial('head', {base, normal, exponent});
const gun   = createSourceWorldAKMaterial({base, exponent});
mesh.material = upper.material;
// 离开世界或释放这套资产缓存时：
upper.dispose(); // 幂等，不释放传入的缓存贴图
```

只针对当前 `tm_leet_varianta` 原3套 VMT 和 `w_rif_ak47`，不把这些参数推广到其他角色或枪皮。输入为原 VTF 解码的 PNG Texture；工厂内部创建独立 GPU texture view，底色设 sRGB、normal/exponent 设 NoColorSpace、flipY=false，image像素继续共享，不复制或修改原色。返回材质需要直接共享给 actor clones；不要对返回材质调用普通 `Material.clone()`，该 API 不保证保留自定义 shader callback。

| part | 原材质名 | private textures 路径前缀 |
| --- | --- | --- |
| upperbody | tm_leet_upperbody_variantA | character-ak/textures/tm_leet_upperbody_varianta |
| lowerbody | tm_leet_lowerbody_variantA | character-ak/textures/tm_leet_lowerbody_varianta |
| head | tm_elite_head_variantA | character-ak/textures/tm_elite_head_varianta |
| 世界 AK | ak47 | character-ak/textures/ak47 |

前3行各为 `.png`、`_normal.png`、`_exponent.png`；AK只有 `.png`、`_exponent.png`，原 VMT 无 bumpmap，不补造法线图。

## 已按原依据实现

原 Leet 三材质均为 phongboost25、fresnel[0,.1,1]、phongdisablehalflambert1。默认 normal alpha 为高光遮罩，指数使用 exponent.R 的 `1 + 149R`；原输入法线绿色按 Source→glTF 切线方向转换。人物 VMT 没有启用 phongalbedotint；固定 SDK helper 的 bHasPhongTintMap/默认 tint 路径使用白色 specular tint，因此候选不套用 AK 的 exponent.G 混底色分支。

身体两材质用原 rimlight/rimmask，exponent.A 乘四次 Fresnel，与直接光高光项取 max；头部禁 rim。原 rim exponent1.2。原 rimlightboost0.6 在 SDK 中只乘 ambient-cube rim，本候选没有伪造 ambient cube，故保留参数并明确不把0.6错乘直接 rim 项。

公式依据固定 Valve SDK2013 [skin_ps20b.fxc](https://github.com/ValveSoftware/source-sdk-2013/blob/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/src/materialsystem/stdshaders/skin_ps20b.fxc)、[skin_dx9_helper.cpp](https://github.com/ValveSoftware/source-sdk-2013/blob/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/src/materialsystem/stdshaders/skin_dx9_helper.cpp)、[common_vertexlitgeneric_dx9.h](https://github.com/ValveSoftware/source-sdk-2013/blob/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/src/materialsystem/stdshaders/common_vertexlitgeneric_dx9.h)。本地固定文件在 `.reference-assets/shader-reference/`，原 VMT 参数在组合 audit.materials。

世界 AK 复用已交付 `createSourceAKMaterial`，保留原 boost2、fresnel[.83,.83,1]、base alpha mask、exponent R/G。包装层只管理原图取向、色彩空间和资源所有权。

## 预算、测试与边界

每角色材质拥有1个 MeshPhongMaterial 和3个 GPU texture view；世界枪1个材质和2个实际上传纹理。每套角色+枪共4材质/11贴图，可由资产缓存共享给多个角色。工厂与 shader 编译阶段分配，逐帧没有JS分配。材质和自有视图退出时各释放一次，输入纹理不释放；法线、底色与控制图不做昂贵的运行时重采样或修改。

`tests/source-character-materials.test.ts` 先在未适配工厂上7项失败，再在候选上7项通过。覆盖真实 Three 材质/texture行为、底色与控制图不同色彩空间、原3材质的 shader hooks/uniforms、禁止错误的 tint 分支、共享输入不变、清理幂等和 shader chunk 不兼容时显式报错。它不冒充GPU编译或像素验收。最终全 TypeScript 检查、候选两文件 oxlint 均 exit0；先前外部 visibility 脚本诊断已由其所有者修复。

仍使用 Three 光照衰减、阴影、Lambert diffuse/环境辐照与 tone mapping；没有原 Source ambient cube、ambient rim、原局部反射 cubemap、CSGO-specific phongalbedoboost 或原客户端曝光。手 IK 与动作也不由材质模块处理。原PNG/原VMT保持不变，不能用白平衡、手调衣服颜色或姿态偏移补偿这些差距。

```sh
npx vitest run tests/source-character-materials.test.ts
npx tsc --noEmit
```

## 私有浏览器加载脚本

新增 `scripts/preview-source-character.ts`，构建为 `character-ak/preview-source-character.js`（15,227 bytes，SHA256 `a1e2fdcd9c87ab548b2aeb255c1862912e9037e229a59322b6e0a6e769f1ae93`）。仅 external `three`，使用已有 preview importmap，不修改 HTML 或主游戏。

```js
const {applySourceCharacterPreview} = await import('/assets/source-exports/character-ak/preview-source-character.js');
const audit = await applySourceCharacterPreview(gltf, '/assets/source-exports/character-ak/');
// 卸载这套预览：audit.dispose();
```

脚本严格匹配4个原完整材质名，全部必需，未知名/近似后缀/缺失即抛错；全部11图请求成功后才原子替换。失败会释放已完成的贴图并保持原场景，防止半个角色新材质、半个角色旧材质。audit包含原名、替换名、匹配槽数、原VMT/参数、11图URL和资源清理入口。

实际 GLB 独立集成读回 `character-ak/validate-preview-module.mjs` 已通过：3个人物材质各1槽、AK2槽，11张真实PNG逐SHA匹配，全部骨/mesh世界矩阵逐项不变，dispose恢复原材质。Node测试仅绕过DOM图片解码，不生成任何位图，不冒充GPU验收；结果为 `character-ak/preview-readback.json`。预览3项测试与材质7项合计10项通过，全tsc与限定oxlint通过。

```sh
npx esbuild scripts/preview-source-character.ts --bundle --format=esm --platform=browser --target=es2022 --external:three '--external:three/*' --outfile=.reference-assets/source-exports/character-ak/preview-source-character.js
node .reference-assets/source-exports/character-ak/validate-preview-module.mjs
```
