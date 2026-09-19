# 抛壳与爆炸视觉模块

`game/combat-effects.ts` 是本项目自行编写的实例化几何和程序着色器特效，不是 CS:GO 原作特效或 Valve 素材。没有图片纹理、外部请求、生成图像、付费依赖或伤害/遮挡判定。当前模块未改 scene/runtime；由根代理接入后进行实际浏览器编译和画面验收。

```ts
const effects = new CombatEffects(worldScene, gunViewScene);
effects.eject(casingViewMatrix); // 已确认的本地射击事件；矩阵采用 gunViewScene 坐标。
effects.explode(new THREE.Vector3(x, y, z)); // 爆炸视觉中心采用地图世界坐标。
effects.update(frameDeltaSeconds);
effects.clear(); // 离开对局回到菜单；清空粒子并保留全部缓存供下次对局复用。
effects.dispose(); // 退出/更换 Art 场景时。
```

`eject` 的参数为请求约定的 `casingWorldMatrix` 名称，但坐标语义是 **view scene** 的完整位置和朝向。弹壳进入构造函数第二个 Scene，不进入地图 Scene；它不会从地图坐标自动转换到枪械视图，也不会根据相机转向反算地图弹道。调用者负责从第一人称抛壳参考位置提供矩阵，模块不查找 socket。

弹壳为有底缘、肩颈和开口的低面数黄铜壳体，约 32 mm 长；使用共享 PBR 黄铜材质。发射方向是所给姿态的 +X 向右、+Y 向上、少量 +Z 向后，叠加旋转与重力，0.62–0.78 秒退场。输入矩阵不修改；非有限或退化矩阵拒绝发射。

爆炸由三个实例层组成：短促高亮火团与扩散冲击环、10 团有程序噪声边缘和灰烬明暗的烟、14 块弹道碎片。烟与闪光卡片在 shader 中朝向当前渲染相机，不要求 update 接收相机。烟逐渐膨胀、上升减速并消散；闪光约 0.44 秒，烟最长约 2.8 秒，碎片最长约 1.7 秒。没有烟雾弹遮挡、flash 致盲、伤害或音效逻辑。

## 明确预算

| 池 | 最大活实例 | 资源与提交 |
| --- | ---: | --- |
| 弹壳 | 48 | 1 个 LatheGeometry / 1 个 PBR 材质 / 1 个 InstancedMesh |
| 爆炸烟 | 96 | 1 个 PlaneGeometry / 1 个 ShaderMaterial / 1 个 InstancedMesh |
| 碎片 | 192 | 1 个低面数 IcosahedronGeometry / 1 个 PBR 材质 / 1 个 InstancedMesh |
| 爆炸闪光 | 12 | 1 个 PlaneGeometry / 1 个 ShaderMaterial / 1 个 InstancedMesh |

一共固定 4 个几何、4 个材质、4 个实例网格，最多 4 个 draw call，不投射阴影。每个粒子的向量、四元数和状态预先分配；池满后环形覆盖最早的槽位，不按发射次数扩容，不为每发创建 geometry/material。烟卡片可能产生透明 overdraw；该预算不代表目标设备的 GPU 时间已经通过验收。

`update` 将正有限 dt 限为 0.05 秒，负数、NaN、Infinity 不推进。后台恢复大 dt 不会产生超大运动步或补发风暴；特效的消退时间因此按可见累计帧推进。粒子全部结束后 mesh.count 归零并隐藏。dispose 可重复调用，仅移除和释放本模块拥有的资源，之后 eject/explode/update 无效果。

`clear()` 将所有实例 count 归零、隐藏网格、停用粒子并重置环形写入位置；不移除网格，不销毁或重建 geometry、material、instanceMatrix。重复调用安全，随后可以再次发射。已销毁后的 clear 不会重建资源。

## 验证边界

`tests/combat-effects.test.ts` 验证 view-space 输入、原矩阵保持、500 次连续发射和爆炸的资源复用/容量上限、三层爆炸生命周期、120 秒 dt 的步长限制、非法/退化输入、退出时单次释放与无关场景节点保持。

```sh
./node_modules/.bin/vitest run tests/combat-effects.test.ts
```

单测使用真实 Three.js 对象与实例数据，但没有创建 GPU 上下文。实际着色器编译、透明排序、第一人称弹壳构图、近墙/楼梯/坡面穿插与多爆炸透明填充成本仍由接入后的浏览器验收确认。碎片仅作自由弹道，不查询场景碰撞；烟是多层程序卡片，不是真实体积流体。

当前 Three.js WebGLProgram 源码自审确认：instanceMatrix 与 uv 由 ShaderMaterial 前缀注入，模块没有重复声明它们；唯一额外属性 effectData 是每池独立的 InstancedBufferAttribute。WebGL2 前缀负责 attribute/varying/gl_FragColor 到 GLSL3 的适配。没有 sampler、位图或异步贴图分支。闪光中心另避开 atan(0,0) 的未定义值；输入拒绝无法表示为有限 Float32 的数值，避免 JS 有限而 GPU 溢出。透明 billboard 使用 FrontSide，避免 DoubleSide 默认双次提交使四次绘制预算失真。以上为源码/数值核对，尚非实际 GPU 编译证据。
