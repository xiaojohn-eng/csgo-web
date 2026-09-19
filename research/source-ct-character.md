# Dust2 原 IDF CT baseline 与正式连续加载

原 App740 build12426148 的 Dust2 配置是 **IDF**。严格解析本机 `gamemodes.txt → maps → de_dust2`：ct_models依次为 `ctm_idf`, `ctm_idf_variantb`, `ctm_idf_variantc`, `ctm_idf_variantd`, `ctm_idf_variante`，ct_arms为 `models/weapons/ct_arms_idf.mdl`。本轮选配置首项 `models/player/ctm_idf.mdl`，没有预设 SAS，也没有把 T 角色改色当 CT。

原配置 SHA：664a20160282f1c19a18528d790017898cec7e407205fac3834c3023d5db46a4。CT MDL 92,372 bytes，SHA 585f84b763f49c0682c715978569e1e0c7dade6f2335b20a36841c2c301b3a24；ct_animations.mdl 1,226,704 bytes，SHA 6d6ab1612f3b266f603f6b27e2af83f0c6f11a7dba70aa887f420da48bf6f9f7。

## 交付

- `.reference-assets/source-exports/character-ct/metadata-preflight.json`：实际配置、include图、940 sequences与2654描述符元数据、原骨/材质/参数。
- 同目录 `combat/`：原 CT 92 描述符/1397帧、28 selected sequences，原9way/3way/骨mask/layers、40 Python world矩阵样本；NPZ SHA aad157f59b34009c157ee46e75b973600eb169c04864430a6c9334cde2b05cae。
- 同目录 `continuous/`：`pose-data.json` SHA 178e2ac5368ecf055f7de3746aaedde28e67f8f47c7d324bf8266444925e242e；`frames.f64.bin` 5,476,240 bytes，SHA 9253d03fd666b5d0ed114e73fb52a834b20b5ac7ed4787e2d6ff9cb8f263eae2；gzip 1,385,501 bytes。无量化。额外40任意内部方向/分离时钟Python fixtures以及独立verification。
- `.reference-assets/source-exports/character-ct-ak/ctm_idf_ak47-sdk-poses-basecolor-reference.glb`：15,327,036 bytes，SHA 3409f61089d364cae700ae9d0fb45b0c78523b718facd1be5c4b2fb4cb674084；CT74+世界AK94两skin，4原材质、4嵌入原base PNG、11原base/normal/exponent独立PNG。GLB含14明确标名的SDK参考clips；正式runtime使用连续原帧，不播放这些固定组合。
- `public/source/csgo-12426148/character-ct-ak/`：17文件共39,084,825 bytes（含备用gzip），另有manifest。每个原GLB/PNG/数据包均逐byte/sha读回，不覆盖T资源。

CT主模型有74骨，ct_animations有70骨，69同名骨父链一致；主独有两weapon_hand helpers及三根 `jigglebone_beret*`，动画独有 `ValveBiped.ValveBiped`。CT动画1397帧不同于T1427帧，索引、骨数、帧数据均不能共用T副本。原CT mesh为8,314顶点/12,767三角形，保留原geometry、权重、法线和UV。

## 正式 API 与两队分派

```ts
const tOwner = await loadSourceCharacter({baseUrl:'/source/csgo-12426148/character-ak/'});
const ctOwner = await loadSourceCharacter({baseUrl:'/source/csgo-12426148/character-ct-ak/'});
const actor = ctOwner.createActor();
scene.add(actor.root);
ctOwner.updateActor(actor, player); // 只读权威sourcePose/version，无本地dt
ctOwner.disposeActor(actor);
ctOwner.dispose();
```

父任务按实际team映射选择owner，服务器同步选择同队poseIndex/poseDriver。加载器不猜team，旧T实例也不会自行变为CT。调用契约仍为 `gltf,poseIndex,manifest,surfaces,hashVerified,createActor,updateActor,disposeActor,dispose`。

manifest显式字段：

| profile | bodyBoneCount | animationBoneCount | poseVersion |
|---|---:|---:|---|
| tm_leet_varianta | 71 | 71 | csgo-t-ak-12426148:b2106b26a407d0fa |
| ctm_idf | 74 | 70 | csgo-ct-ak-12426148:178e2ac5368ecf05 |

`game/source-character.ts` 的profile注册表仍严格验证各自原mainModel、animationModel、骨数、组合GLB SHA与version前缀；不是把原T的71断言删除。跨profile/错骨数/错文件身份会拒绝。T17个payload及原poseVersion保持原值，只给manifest增加显式profile字段。actor朝向仍为player.yaw+π/2，模型子节点只乘.0254一次，每骨scale1，原IBM=Source inverseBind*inverse(C)。CT74骨与AK94骨分别克隆独立骨架，3个真实同名world骨合并；无本地AnimationMixer，无猜测握持偏移。

新增 `game/source-ct-character-materials.ts`，shared `game/source-character-surfaces.ts` 按显式profile选择3个原IDF材质与同一原世界AK。IDF三材质Phongboost65、rimlight1、rim exponent2、ambient rim boost1，与T的boost25/head rim0有明确差异。原控制纹理保持NoColorSpace，base sRGB，normal alpha作原mask；未将exponent RGB变为绿色高光。CT上身base2048²，其余body/head base1024²，normal1024²，exponent128²；未缩图。GPU材质外观由root再验收。

## 独立验证

纯CT连续模块直接使用已验 `game/source-character-pose.ts` 的通用骨数逻辑。40×74=2960原Python矩阵比对最大差1.312e-5 Source单位；40个内部斜向/分离时钟样本最大位置2.23e-16、四元数3.34e-16。576角点、20权重0、320 mask0、72原时钟角点检查过。实际Three角色world对同Source姿态最大差4.80e-14，带actor位移/旋转/米制比例后最大3.56e-15。

独立完整GLB读回：14参考clips、11,760骨矩阵和26,740原加权顶点；最大骨差8.63e-5/顶点9.34e-5 Source单位；168原IBM精确相同，3同名merge骨差≤5.01e-5单位。glTF validator为0 errors/3 warnings；警告是SkinnedMesh有父节点，实际Three带父旋转平移/scale已独立数值验证，并未忽略该变换。

正式连续owner再验70原参考时刻：5,180 CT骨+6,580枪骨，最大CT差1.424e-5/枪差1.813e-5单位；实际actorworld最大2.67e-15/5.33e-15。T同70样本回归保持原结果，165原IBM不变。5套T/CT pose、actor、材质测试共31/31通过，最终全tsc通过。每个CT更新短程约.43ms仅为本机CPU观测，不是10人整局性能验收。

## 保留的真实边界

三根贝雷帽骨有原procedural type5，但尚未执行原jiggle动态，现保持原local rest并随头骨；没有删骨或去掉帽子。原rule starts为16648/16768/16888，**实际间隔120 bytes**。较新的公开SDK2013结构有额外boing字段而长140 bytes；套入会误读下一条rule，已依据本机真实offset更正。最终metadata仅保留3×120B原字节、原flags/29float原数组，不借新SDK字段冒称完整CSGO物理语义。SourceIO的`procedural_rule_type`字段还误传了rule对象，因此最终type5从原bone +164读回；没有修改SourceIO代码。

22个原CT hitbox的bone/group/min/max/name及68B raw/32B extension已保留，索引属于CT74骨。后续由network审阅的原server.so指令证据解释旋转/形状；本baseline不改raw字段，也不把未验证扩展当作胶囊。

原left hand attachment差仍为3.358–5.368 Source单位（约8.5–13.6cm），当前没有手握IK，不能称两手握持验收通过。缺失 `taunt_animations.mdl` 仍单独记录；原client活动图、jump/death/reload切换、root movement提取、CT其它四变体及原手臂viewmodel、ambient cube/rim与cubemap等不属于本baseline已完成项。

## 可复现命令与来源

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python-exit-code 1 --python scripts/import-source-ct.py -- --sample-combat --world-ak
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python-exit-code 1 --python scripts/export-source-ct-pose.py
npx tsx scripts/validate-source-ct-pose.ts
node scripts/validate-source-ct-world-ak.mjs
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python-exit-code 1 --python scripts/stage-source-ct-character.py
npx tsx scripts/validate-source-character-actor.ts --ct
```

固定SourceIO commit cfc2591d096628a35f570aa830ab75cc8665108b，Blender5.2.1 factory-startup；新CT脚本以此前T的已验frame decode/SDK组合路径派生，所有原资源选择来自本build实际metadata，不修改原T脚本或源游戏包。官方固定[studio.h](https://github.com/ValveSoftware/source-sdk-2013/blob/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/src/public/studio.h)、[bone_setup.cpp](https://github.com/ValveSoftware/source-sdk-2013/blob/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/src/public/bone_setup.cpp)、[bone_merge_cache.cpp](https://github.com/ValveSoftware/source-sdk-2013/blob/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/src/game/client/bone_merge_cache.cpp)作为公开算法参考；本机原BSP/gamemodes/MDL/ANI和最终GLB数据为本build事实。
