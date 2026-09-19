# 原 Olive 材质与风摆候选

当前已完成独立私有 GPU 验证与原数据 SHA staging，接入 `loadSourceDust2` 的显式 `enableOlive:true`；已通过实际训练与双客户端 LAN 复测。现有 70 个 palm/sumac 与 R5 材质保留；64 个 olive mesh / 10,016 三角形中，48 个在原 3D sky，另 16 个在主地图。目标是修复真实 T 出生点截图里的远景黑色叶片，不能以整图滤镜或更改原透明阈值替代原光照。

## 原参数与选定范围

原 `olive_branch_01` VMT SHA 为 `14f38cc79d5d1b7cc7680c0c526d10a7bc7780c9afa131e62a1f58f4b6032662`。完整参数集合逐项匹配，包括 `.3` alpha test、双面、原 `vertexcolorpower=.7`、height 10、radius 100、strength/scrumble strength .15、speed lerp end 800。近景 palm/sumac 的 height 100、radius 200 等常量不能复用。

`scripts/inspect-source-olive-color-power.py` 从当前 `stdshader_dx9_client.so` 验证 `$VERTEXCOLORPOWER` 名称指针 `0x122666`、注册全局槽 `0x373988`、真实 draw-info builder 的 `info+0x200`。21 个 sentinel/实值组合执行原 `0xc7b35..0xc7bd6`，证明其输出命令为 `(3,13,1,max(0,power),0,0,other)`。普通命令解释器的 3/4 分别到 `0x4ea90/0x4ea60`，并调用 `0x52890/0x521f0`，与 per-instance 调色命令表分开。

原 generic PS0/dynamic0 和 dynamic16 都不读取 c13；另一个含 CSM 的原 static1107482/dynamic0 程序，存在 `g_bCSMEnabled` 条件内的 log2 → 乘 c13.x → exp2。该程序带其他静态特征，不能据它宣称已找到了本棵树的完整实际 selector。

因此新 owner **强制显式 `csm:false`**，只重建已有原首路 VHV diffuse 与 no-CSM 材质路径，记录 `.7` 原参数而不擅自给底图或光照增加无条件幂操作。完整原 CSM 开关、动态光/环境项、雾、alpha mip coverage 仍未恢复。这个受限选择不等于原游戏全场景选择完全相同。

## 原字节与顶点

- `scripts/inspect-source-olive-treesway.py` 执行原 selector、常量上传和独立 DX9 token 解释器，覆盖 64 实例 × 4 原顶点 × 5 时间/风输入，共 1,280 案。原 VS128/dynamic0 SHA `fd2c99952aeab40ff76657d19bba4140e9bb575061dafc3040b0b688670611e0`；零风回到 rest，静态颜色最大绝对差 1.192e-7。
- 独立 oracle SHA `82460c69222f7c0f626ce240e0cdcb94405bc894642e9f561138f5b15ad88cdb`。实例矩阵、原 VVD 与 VHV 按原硬件顶点索引配对，没有最近点匹配。
- `scripts/build-source-olive-foliage.py` 验证所有 16,314 实例顶点的 Source→GLB 完整变换，最大位置差 0.000048454 m；所有位置非零，最短长度 0.11344 Source unit；原实例 uniformScale 都为 1。
- 黑块对应候选 `static_prop_65` 原首路 VHV BGR 实际范围约 `[138..139,136,136]`，不是原数据全黑。此统计不能单独证明最终曝光或图像颜色。

私有目录 `.reference-assets/source-exports/dust2-vhv/olive-foliage/`：

| 文件 | 字节 | SHA256 |
| --- | ---: | --- |
| bindings.json | 111635 | bc59f6b9b1705bbd539fd402ec7f8e6826af86081f8db379b63f926b967460ab |
| remap.u32 | 35208 | 6ec60c9fcaca88bb75099771a25fca500730502a2d2e22e90b377d622fe68075 |
| lighting.bin | 235248 | 41ca73a4d23e0cd66c759f88d2fb9e3e2f3df3a510158f9808a48661c2f0f99c |

新 `source-prop-olive.ts`、`source-olive-lighting.ts`、`source-olive-loader.ts` 为独立 owner，默认不启用。所有原矩阵/几何与二进制 SHA 在换材质前验证；按实例独立查 VHV；仅拥有两张 lookup、替换材质和临时 frustum 标记。6 项测试覆盖错误 CSM/参数、坏矩阵/字节、取消与资源恢复；类型检查通过。

## GPU 在建记录

`scripts/build-source-olive-preview.mjs` 生成新 `olive-preview`，使用当前天空→清深度→主场景路径。候选预览额外按原 prop/child 对应关系给 48 个 sky copy 借用同一实例材质；卸载先恢复 sky copy，再释放 olive，最后释放地图。生产加载器尚未改动。

初版 1,280 案 GPU transform feedback 全部有限，GL error 0、零风误差 0，但对独立逐步 f32 oracle 的最差差异 0.018341 Source unit / 0.000465863 m，超过当次 0.4 mm 阈值。没有把失败记录改为通过。第二版对 MAD、dot、lerp 的中间乘积增加值为零的 uniform bit-cast 舍入屏障，误差反而升至 0.0238317 Source unit / 0.000605325 m；因此不能把“加屏障”称为修复。需要逐阶段回读，原 GPU/FMA 位级一致仍不能宣称。视觉脚本已经改为先保留静态零风图和卸载证据，再在末尾报告精度未通过；它不会把数值失败悄悄降为成功。

取证复制时曾漏改新脚本的 OUT，临时将旧私有 `treesway/oracle.json` 写成 64 实例。已将新 OUT 固定到 `olive-power/treesway` 并重跑旧原脚本恢复 **70 实例/1400 案**，旧 oracle SHA `db523954173ab66c948e55fa76c6c2c1a0ce25dc811a2d4048bcbb7f9cba7fd6`，旧三文件六项测试重新通过。未改变任何原安装、GLB、public、生产70材质或服务。

## 精度修复与集成验证

逐 token GPU 寄存器回读证据 `output/playwright/source-olive-trace-gpu.json` 发现最坏样本 278 在 word367 首次出现一 ULP 相位差；仅包住 MAD 的乘法不足以保留之前 word359 的目的寄存器舍入。`build-source-olive-treesway-glsl.py` 现对**每条原指令的目的结果**增加动态零掩码 bit conversion 屏障，保留独立 float32 token oracle 的指令边界，禁止编译器穿过边界重排。

实际 WebGL2 1,280 样本最大差降至 **3.814697265625e-6 Source unit / 9.6893310546875e-8 m**；三个诊断样本十个检查点全部相同，零风严格零差，GL error 0。初版与部分屏障失败证据均保留；仍使用原定 .4mm 门槛，未放宽。原 D3D 驱动运行精度不等于这个 scalar oracle，不能宣称逐位还原原 GPU。

完整私有场景证据 `source-olive-register-private-gpu.json`：64 owner、48天空副本、错误为空、卸载0几何/2环境贴图/0程序。root查看同机位静态和风动态图，部分 olive 黑叶已恢复颜色；其他上层黑块属于尚未处理材质。`scripts/stage-source-olive.py` 验证该证据和三份原二进制 SHA，再以独立 immutable URL 写入并逐字节回读5文件。

实际集成先挂64材质，再创建天空副本，自然借用相同实例材质；不再需要私有预览的补绑过程。现有70叶与新64叶由**同一个**原 env_wind 更新，R5的2325计数不变、总2459。`source-olive-integrated-gpu.json` 验证134个实际编译后的GPU风uniform完全相同，48天空副本正确；rest和t8两张PNG与私有候选**字节完全相同**，卸载回0/2/0。两项新增集成测试先失败后通过，涵盖共用风场、原资源释放顺序与后续SHA失败回滚；19相关测试通过，完整102文件/594测试通过，source:build和typecheck通过。

实际27019候选 PID91396：`source-r4-olive-gameplay-gpu.json` 和 `source-r4-olive-lan-gpu.json` 均 errors[]、rooms[]；T默认Glock/CT购买、单发三连发、原换弹检视/移动/主副槽完整回归，两端原SHA和2459/64覆盖确认。root已看训练原T Glock检视图，局域网证据仍是同一台Mac上两个浏览器。
