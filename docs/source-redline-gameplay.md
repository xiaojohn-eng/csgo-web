# 红线皮肤运行接入

R4 的原 AK-47 可在武器库选择红线、输入0–1000图案编号、调整0.1–0.7实际磨损并恢复默认。选择保存在浏览器；训练和 LAN 都经过同一份最小参数合同。当前已运行原 style7 shader 与 seed→UV 移植，但仍是最终材质候选，不能据此宣称原客户端逐像素一致。

## 数据与所有权

`game/source-weapon-finish.ts` 只接受 AK (`vandal`)、paint kit282、整数种子及有限磨损，复制成独立参数对象。只有明确 `null` 才恢复默认；无效输入保持原选择。每个玩家的库存、快照和预测对象持有各自的副本。

服务器 `sourceFinish` 消息只修改发送者席位，限制请求速率并丢弃额外玩家/战斗字段。它是可选外观字段，不改变既有物理/动画仿真身份。第一人称和世界模型的 owner 只替换名称精确匹配的原 AK 枪体材质，保留手臂、人物及其他枪械。取消、换队、角色释放和销毁先恢复借用材质；异步旧请求不能覆盖新选择。相同失败请求不会逐帧重试，重新选择卡片可明确重试。

六张输入 PNG 和 manifest 经固定 SHA 验证。合成直接使用 RGBA 字节，保留底色 alpha 的高光遮罩；生成贴图按引用计数共享与释放，不累计保存过往种子。原输入纹理、程序、种子执行和采样边界详见 [原合成链](source-redline-worktree.md)。

## 主版本真实验证

- `output/playwright/source-r4-redline-contract-gameplay-gpu.json`：真实菜单从默认选择422/0.4、改为0/0.4和0/0.7，三份底色 SHA 不同；M4 不受影响；进入 T 训练、F 检视、恢复默认和刷新持久化均通过，页面错误为空。确认1024颜色/256指数、原clone强度与 albedoFactor 后的新输出 SHA，AK 独立高光参数2/35也进入实际材质。
- `output/playwright/source-r4-redline-contract-lan-gpu.json`：一台 Mac 上三个真实浏览器通过局域网 WebSocket 占用 T/CT/T 席位。三端收到相同 host 参数，旁观队友的原 AK 世界模型装备红线，另外两位玩家保持自身默认；host 清除后重新入房，各端同步默认。退出后房间为空。
- `output/tests/source-simulation-identity.json` 的 `sourceFinish`：隔离真实服务器和两个 SDK 客户端验证发送者绑定、最小字段、独立选择、17类无效包保持原值、种子/磨损端点及显式清除。原版本身份拒绝与资源条件请求304仍通过。
- `tests/source-weapon-finish.test.ts` 9项验证复制、输入、实际 runtime setter 与快照；owner 的异步取消、竞争、失败与资源释放另有独立测试。本批更新完整回归148文件780测试及类型检查通过。

真实画面为 `output/playwright/source-r4-redline-contract-training-inspect.png` 和 `source-r4-redline-contract-world-lan.png`。自动化只操作真实按钮、输入、鼠标和键盘；读取审计与像素，没有注入角色、种子、时钟或材质状态。初版2048输出仍保留在不带 `contract` 的旧证据文件中。

全量回归曾捕获 AK 工厂被其他枪复用的问题：USP世界枪和AWP镜片的编译合同失败，M4也会间接继承AK修正。现保留独立通用模板 `createSourceWeaponMaterial`，AK/default/Redline单独采用原2/35分支；M4的第一/第三人称、三种手枪和AWP继续各自有界适配。新增M4双视图隔离回归，原USP/AWP编译测试恢复通过，未把该AK依据推广为其他武器的完整shader。

## 尚未关闭的原版差异

本批已执行完整原clone→manager调用顺序、RT pool和最终VTF分配。候选颜色采用原pool最大1024，指数descriptor为256；clone先将intensity10除以原boost2并截断到5，再原六位文本归一化为0.019608；albedoFactor35经原分支变为c3.x=float32(1/35)。依据见 [输出合同](source-redline-render-contract-worktree.md) 和 [Phong参数](source-redline-phong-worktree.md)。原FP/world实际调用profile和picmip还未关闭，不将pool结果假称为所有游戏场景的固定分辨率。

原颜色/指数最终存储为DXT5_RUNTIME/DXT1_RUNTIME，当前网页为RGBA8；原压缩、mip字节、过滤、实际AK shader selector、最终客户端 D3D 输出、完整高光/环境光和物理第二台设备仍不在上述证据范围。种子算法与shader token的差分一致不代表最终照明或整体皮肤已达到原作一致。
