# 原 Dust2 T + 世界 AK 双 skin 私有样本

已把官方 `models/player/tm_leet_varianta.mdl` 与 `models/weapons/w_rif_ak47.mdl` 转换为可预览的角色持枪组合。保留各自原骨架和原 inverse bind，按同名骨世界矩阵跟随，未手工调整握持位置。转换与独立 Three 回读通过；左手握点仍有间距，原 IK 和最终 Source 光照尚未完成，不能宣布原作握持已通过。

## 文件与复现

- `scripts/import-source-world-ak.py`：由 `scripts/import-source-character.py -- --world-ak` 调用；只写 private。
- `scripts/validate-source-world-ak.mjs`：独立读取最终 GLB，核对骨矩阵、原 IBM、加权顶点和原 PNG。
- `.reference-assets/source-exports/character-ak/tm_leet_ak47-sdk-poses-basecolor-reference.glb`：9,452,032 bytes，SHA256 `554a697eabab950b5dcb65bb39dbd26dd57a660554cb9a9b1074e42aacb35c0c`。
- 同目录 `audit.json`：模型依赖 SHA、原骨/attachment、原 VMT 参数、原 PNG 通道、逐动作姿态快照、握点距离。
- 同目录 `three-readback.json`：最终文件独立数值回读与 Khronos 校验。
- `character-t/world-ak-metadata.json` 与 `world-ak-pose-probe.json`：完整世界模型元数据及更广的原姿态握点探针。
- `scripts/inspect-source-animation-cvar.py` 与 `character-t/combat/anim-3wayblend-default.json`：官方服务端编译默认值 1 的只读二进制证据。

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python-exit-code 1 --python scripts/import-source-character.py -- --world-ak
node scripts/validate-source-world-ak.mjs
python3 scripts/inspect-source-animation-cvar.py
```

原独立角色 GLB 未覆写。原 MDL/VVD/VTX/ANI/VMT/VTF 与 SourceIO 文件未修改。转换单位保持 1，轴变换为 `(x,y,z)→(x,z,-y)`；没有假设物理单位或归一化到人物身高。完整源坐标 bounds 写入 audit.imported[].sourceCoordinateBounds。

## 骨与枪关系

角色 71 骨，7,013 个导入顶点、11,320 三角形。世界 AK 94 骨，主体 3,661 顶点/3,137 三角形，弹匣 125 顶点/113 三角形，共 3,250 三角形。现代世界枪骨命名与老角色不同，不能按索引配对；它們恰有 3 个同名骨：

| 共同骨 | 世界枪索引 | 父骨 | 原 flags |
| --- | ---: | --- | ---: |
| weapon_hand_L | 32 | hand_L | 0x40200 |
| weapon_hand_R | 60 | hand_R | 0x40700 |
| ValveBiped.weapon_bone | 92 | hand_R | 0x200 |

原主体只由 weapon_hand_R、weapon_bolt、weapon_magrelease、weapon_trigger 加权；弹匣由 weapon_mag 加权。这些可见枪部件在 weapon_hand_R 分支。武器保留原非同名骨局部变换，不用角色 bind 覆盖枪 bind。原 `left_hand_attach` 位于世界枪骨83，`muzzle_flash`/`shell_eject`/`mag_eject` 对应84/87/89；全部原局部 attachment 矩阵在 audit。

组合路线依据固定 Valve SDK2013 [CBoneMergeCache](https://github.com/ValveSoftware/source-sdk-2013/blob/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/src/game/client/bone_merge_cache.cpp)：先按名字建立映射，再拷贝被请求骨的世界矩阵。样本展示全部骨与 attachment，覆盖这3个共同骨；这不是从 CSGO 私有客户端核实全部武器后处理。保持两套独立 skin，165 个最终 glTF IBM 均按真实导出基底使用 `source_pose_to_bone * inverse(C)`，逐矩阵回读误差0。

## 动作与差距

14 个 clips 为两种显式分支 `sdk-3way__` / `sdk-bilinear__`，各自带 `idle`、`walk`、`run`、`crouch_idle`、`crouch_walk`、`aim_fire`、`crouch_aim_fire`。走跑为原 move_x=1 网格方向；瞄准开火为原 body_yaw=20、body_pitch=25。lower、Upper/Aim/HandPos、Shoot 使用已有原帧与 SDK 合成器；枪械自身 default、rifle_fire、rifle_fire_crouch 来自世界 MDL 的原内嵌动画。角色和枪动画各按原30fps与自身时长采样，不把不同帧数强制同相位。

世界枪的非 FRAMEANIM delta 存在另一个已定位 SourceIO 问题：ANIMPOS/ANIMROT 通道仍加原 rest。仅本脚本进程在 `ANIM_DELTA` 下把原通道缺省设为零位置/单位旋转；保留源数据、原比例、原权重与 delta/post 乘法顺序。没有改 SourceIO，绝对动作不改变。

当前14 clips左握点最大间距：站立1.491、走3.768、跑2.946、静蹲2.178、蹲走3.185；站立瞄准开火两分支2.248/2.430，蹲瞄准开火2.779/2.891（均 Source 原单位）。此前40份更广含开火采样的最大差6.375，保留在 probe。原 legacy attachment 刚性对齐的对照方案反而为5.7–8.6，不能用它或常量手调假装修好。这里验证的是原数据转换与明确的骨跟随路线；原手 IK、脚 IK、客户端状态切换和 procedural bones 仍未实现。

## 实际验收

独立 Three 从最终 GLB 回读70个时刻、11,550个骨矩阵与23,940个按原权重/原IBM计算的顶点：最大骨矩阵差 `8.4322e-5`、顶点位置差 `8.6172e-5` 原单位，共同骨世界矩阵最大差 `5.371e-5`；165个IBM差0。4张嵌入底色 PNG 与原 VTF 解码 PNG 的 SHA256 逐一一致。Khronos 0 errors、3 warnings，均为 identity armature 根下面存在 skinned mesh；另5条未使用 tangent 信息对应 unlit 底色参考。

GLB 已交父任务进行 GPU 外观与握持审阅。本任务没有操作浏览器。数值读回证明原样本转换正确，不等于真实客户端全动作和最终光照验收。

## 原材质边界

组合 GLB 显式使用 KHR_materials_unlit，只看原底色，防止把 SourceIO 的失败PBR白化继续当原素材。角色原3套 VMT 和9张 PNG 通道、世界枪原 VMT 和2张 PNG 均在 audit/同目录 textures，没有生成假贴图。

角色 `tm_leet_upperbody_varianta`、`tm_leet_lowerbody_varianta`、`tm_elite_head_varianta` 的原参数为 phongboost25、fresnel[0,.1,1]、phongdisablehalflambert1；身体 rimlight1/rimmask1、head rimlight0。normal alpha 默认 Phong mask，exponent R/G/A 分别为指数、albedo tint、rim mask。

原世界 AK 材质 `materials/models/weapons/w_models/w_rif_ak47/ak47.vmt` 无 bumpmap；base alpha 明确为 `$basemapalphaphongmask 1`，exponent R/G，phongboost2、fresnel[.83,.83,1]、phongalbedoboost35、phongalbedotint1，envmap为原环境 cubemap。衣服与枪不是 metallic/roughness 材质。原 local lighting、ambient cube、cubemap、CSGO-specific albedo boost 和曝光尚需父任务的有界 Source Phong 实现及 GPU 审阅。
