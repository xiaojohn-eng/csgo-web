# 原 T + AK 正式连续角色加载器

`game/source-character.ts` 与 `scripts/stage-source-character.py` 已交付。适配器读取 Player 的权威 `sourcePose/sourcePoseVersion`，直接连续采样原帧、合成两套原骨架，不播放原 GLB 内 14 条组合参考 clips，也不运行本地 AnimationMixer 时钟。主任务负责 GameAssets/Scene/Simulation 的接入和真实 GPU 验收。

## 最小正式 API

```ts
const characters = await loadSourceCharacter({
  baseUrl: '/source/csgo-12426148/character-ak/',
  signal: abortController.signal,
});
const actor = characters.createActor();
scene.add(actor.root);
// 每个权威/插值快照；此函数没有 dt 参数。
characters.updateActor(actor, player);
characters.disposeActor(actor);
characters.dispose(); // 关闭全部剩余角色，再释放四材质、原纹理和原 GLB 资源
```

加载结果包含 `gltf, poseIndex, manifest, surfaces, hashVerified, createActor, updateActor, disposeActor, dispose`。actor 暴露 `root, model, characterBones[71], weaponBones[94], sourceWeaponWorldMatrices, lastPose, status`。相同 pose input 缓存采样，actor 位置/朝向仍更新；缺失/版本错误/非有限权威变换时隐藏 actor 并返回 null，畸形 pose 抛错且隐藏，不用 C02 替换。

Root 已确认 `SourceActor` 的浏览器朝向是 `player.yaw + π/2`；Source+X 变换为游戏 forward `(-sin(yaw),0,-cos(yaw))`。模型子节点仅 `.0254` 比例一次，角色根坐标为玩家米制 x/y/z。71 角色根骨 locals 已含 C=(x,z,-y)，非根保持原 Source joint basis，所有骨 scale 固定1。`sourceCharacterBrowserBoneMatrices(actor.lastPose, actor.root.matrixWorld.elements)` 与实际角色骨 world 一致，可用于同骨回溯；原 MDL hitbox extension 仍未解释，不据此声称命中求交已实现。

角色和枪为独立165骨、两套原skin。只对原名精确匹配的 `weapon_hand_R`, `weapon_hand_L`, `ValveBiped.weapon_bone` 拷角色 Source-world 矩阵。武器其它骨保原 default/delta local，随后相对原 weapon parent 重建 local；不把94枪骨绑定进71角色skin，不移动原IBM。GLTFLoader 可能清洗原名，因此使用本组合 GLB 原 node ID/mapping，SkeletonUtils 克隆保留独立骨、独立 skeleton 和各IBM副本，几何与材质安全共享。

## 连续时钟、插值与射击尾段

权威版本为 `csgo-t-ak-12426148:b2106b26a407d0fa`。Player 必须含 `sourceContract='csgo-player-12426148'` 和相同版本。动作输入定义见 `research/source-character-pose.md`。

新增 `fireTimeSeconds`、`fireCycleRate` 为可选原射击事件经过秒数和原角色shoot CPS。Simulation driver 写这些字段；可视适配器不用本地 dt。原世界 AK `rifle_fire` / `rifle_fire_crouch` 是27帧@30fps，时长26/30秒；角色原shoot仅Run22帧(.7s)/其它25帧(.8s)，因此枪按独立权威 elapsed 保留末段，不能随角色 fireWeight归0提前截断。缺少 elapsed 的旧纯调用只可从角色 fireCycle/原rate恢复可知范围，无法还原已clamp后的枪尾段。

`interpolateSourcePoseInput(a,b,t,{spanSeconds})` 同state/mode时直接插值服务器的 unwrapped lower/upper clocks，不用最短相位倒退。state或mode不同保持 a 到快照边界 b，未知过渡不自创混合。已知shot clock/rate时以 `b.elapsed < a.elapsed + span - epsilon` 判断重置，最近事件位于 `span-b.elapsed`；事件前沿旧时钟，事件后重建新时钟，并使用已约定的 `fireCycle<1 ? 1 : 0` 角色权重。一个跨度内若有多个未报告射击事件，仅末次可从 elapsed 恢复；完整事件轨迹需要事件历史。调用方必须先检查 poseVersion 相同。

## 资源与复现

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python-exit-code 1 --python scripts/export-source-character-pose.py
npx tsx scripts/validate-source-character-pose.ts
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python-exit-code 1 --python scripts/stage-source-character.py
npx tsx scripts/validate-source-character-actor.ts
npx vitest run tests/source-character-pose.test.ts tests/source-character-actor.test.ts
npx tsc --noEmit
```

已暂存 `public/source/csgo-12426148/character-ak/`：17文件、27,634,434 bytes（含备用gzip帧副本），manifest另计。原组合 GLB 9,452,032 bytes，SHA 554a697eabab950b5dcb65bb39dbd26dd57a660554cb9a9b1074e42aacb35c0c；11张原PNG逐byte/sha保留。角色frame binary5,673,752 bytes，世界枪原3动画55帧binary289,520 bytes。`weapon-data.json` 是完整94骨/2rig映射/3准确bonemerge/原attachment及default/fire描述符，未复制多MB审计快照进入客户端。

Stage 从已完成 App740 原VPK读取 world MDL，并用此前独立验证的解码方案修正本进程 delta defaults；没有修改 SourceIO 源码。默认/站射/蹲射只读原 inline frames，绝对片段用原rest，delta缺省pos0/quatidentity；时间 normalized lerp 与 SDK QuaternionScale/POST右乘保留。所有165原IBM与组合GLB逐元素相等。

材质调用 root 提供的 `applySourceCharacterSurfaces`，安装3角色原材质与1世界枪原材质、11原PNG。加载器验证GLB/JSON/bin尺寸与关联hash；WebCrypto可用时还核对运行时SHA，普通HTTP LAN缺少secure context时 `hashVerified=false` 明示，保留字节长度和结构检查。纹理SHA由stage逐文件验证，运行时 TextureLoader 不另外计算11 PNG的SHA。没有把此限制隐藏为全运行时哈希验收。

## 独立 CPU 证据与边界

`continuous/actor-verification.json`：原组合70个 Python参考时刻，共4,970角色骨、6,580枪骨。矩阵最大差角色1.3582e-5/枪1.8567e-5 Source单位，实际Three actor变换后差3.56e-15/4.45e-15。165原IBM不变。短程70样本平均update约.40ms，不是整局性能结论。

`tests/source-character-pose.test.ts` 11项与 `tests/source-character-actor.test.ts` 5项共16/16通过。覆盖完整原Python姿态、任意内部方向/独立时钟、原3way/delta/masks、unaligned Buffer真实拷贝、时间wrap与shot重置、双骨架独立、共享资源生命周期、缺失权威拒绝和枪末段。最终 tsc 无错误。CPU fixture 仅在内存剥离材质以绕过Node无DOM，原GLB文件未更改；真正外观仍由root GPU验收。

本适配器是原 T tm_leet_varianta；暂给两队使用时不能称为原 CT。原 CT模型/ct_animations需后续独立扩展。手握IK、原client活动图（含jump/reload/death过渡）、root movement提取、未知hitbox extension、shader环境立方体/ambient cube等仍未实现；未补虚构骨偏移。原left_hand_attach与主手骨的已测握持差保留。原官方资源的本机技术使用与对外发布授权仍是不同事项，本次没有发布资源。
