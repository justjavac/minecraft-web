# kimi-mc

在浏览器里玩的 Minecraft 风体素沙盒：生存、创造、探索——无需安装，打开网页即玩。
支持电脑与手机，**离线也能玩**（PWA）。

## 开始游戏

```bash
pnpm install
pnpm dev         # 打开 http://localhost:3000
```

- **创建世界**：输入种子（留空随机），选**生存**或**创造**；相同的种子会生成相同的世界
- **继续游戏**：随时回到上次离开的位置——世界每 5 秒自动存档到浏览器本地（清浏览器数据会丢失存档）
- **离线玩**：首次访问后可「添加到主屏幕」，之后断网也能玩

## 操作

| 按键 | 动作 |
| --- | --- |
| WASD | 移动 |
| 空格 | 跳跃 / 游泳上浮 |
| Shift | 下降（水中/飞行） |
| F | 飞行开关（仅创造） |
| 按住左键 | 挖掘（带裂纹进度与碎块粒子） |
| 右键 | 放置方块 / 打开工作台、熔炉 |
| 1-9 / 滚轮 | 切换热键栏 |
| E | 生存：随身合成 · 创造：选块界面 |
| Esc | 暂停 · F3 调试面板 |

移动端：左下摇杆移动，拖动转视角，右侧按钮跳/挖/放/飞。着地行走自动走上 1 格台阶。

## 生存指南

- **活着**：注意生命与饥饿；摔落超过 3 格掉血，水下 15 秒氧气耗尽后持续掉血；**死亡时物品全部散落原地**，回去捡
- **挖掘**：不同方块硬度不同（土 0.75s、木 3s、石 7.5s）；**石头系方块必须用镐才有掉落**；工具按 MC 加速（木 2x / 石 4x）并有耐久（59/131）
- **合成**（配方与 MC 一致）：原木 → 木板 → 木棍 → 工作台 → 木/石工具；E 键随身 2×2，右键工作台 3×3
- **熔炉**：圆石 ×8 合成；烧石头→平滑石、沙子→玻璃、原木→木炭、生肉→熟肉，每件 10 秒；燃料分长短（木板 15s / 木炭 80s）
- **食物**：猎杀猪/牛/鸡获得生肉，烤熟后进食回复饥饿与饱和度
- **装备**：牛掉皮革，合成头盔/胸甲/护腿/靴子；全套皮甲减伤 28%，HUD 有护甲条
- **昼夜**：10 分钟一昼夜。夜晚刷出僵尸、骷髅（远程射箭）、蜘蛛（白天中立）、苦力怕（近身引爆，会炸坏方块），白天它们自燃；白天猪/牛/鸡在草地游荡，村庄附近有村民
- **水**：会流动——瀑布成柱、落地扩散（最多 7 级变浅）；可以游泳、也会溺水

## 创造指南

- **258 种方块**随便用：石头/深板岩/矿石/16 色羊毛混凝土陶瓦玻璃/8 种木材/海洋冰雪/功能块
- 按 **E** 打开选块界面：搜索 + 分类挑选，点击放入热键栏
- **F** 飞行；准星处有半透明的放置预览；基岩和强化深板岩放下去也挖不掉（生存规则）

## 世界

- **7 种群系**：平原（村庄）、森林（密林）、沙漠（全沙 + 沙漠村庄）、冰川（覆雪草 + 冰封水面 + 冰屋）、海洋（砾石海床）、河流（蜿蜒入海）、盆地（低洼湖泊）
- **结构**：平原/森林村庄、沙漠村庄、哨塔、冰屋，白天村庄附近有村民
- **地下**：基岩层打底，越深挖出深板岩；煤/铁/铜/金/红石/青金石/钻石/绿宝石 8 种矿脉越深处越稀有

## 自定义

- **贴图**：默认内置 Faithful 32x 高清贴图；设置里可导入自己的贴图包（自动识别现代 MC 包结构，仅保存在你的浏览器里）
- **界面**：像素风字体（MC 观感）；设置含音量、FOV、渲染距离、视角灵敏度、渲染器（默认 WebGPU，不支持自动降级 WebGL）

## 开发者

- 技术栈：Next.js (App Router) + shadcn/ui + Three.js (@react-three/fiber)，pnpm 管理
- 脚本：`pnpm dev` / `pnpm test`（vitest 100+ 用例）/ `pnpm lint` / `pnpm build`（静态导出 `out/`，离线可构建，可部署到任意静态托管）
- CI：GitHub Actions（push/PR 跑 lint + test + build）
- 世界生成：多噪声场群系（lib/noise.ts）+ 确定性矿脉（lib/oregen.ts）+ 流体传播（lib/fluids.ts）；chunk 网格化在 Web Worker 池中执行

## 资源署名

方块贴图来自 **Faithful 32x**（© Faithful Resource Pack 团队，[Faithful License V3](public/textures/pack/LICENSE.txt)）：
按其许可证要求署名并链接回 <https://faithfulpack.net/>，许可原文随贴图附带于 `public/textures/pack/LICENSE.txt`，
本项目为完全免费的非盈利内容。详见 [public/textures/CREDITS.md](public/textures/CREDITS.md)。

音效来自 [Minetest Game](https://github.com/luanti-org/minetest_game)（`mods/default/sounds/`），
媒体资源采用 [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/)，作者为 Various Minetest Game developers。
详见 [public/sounds/CREDITS.md](public/sounds/CREDITS.md)。

界面字体为本地自托管的像素字体（[OFL 1.1](https://openfontlicense.org/)）：
[Monocraft](https://github.com/IdreesInc/Monocraft)（拉丁/数字，© Idrees Hassan）与
[Fusion Pixel 缝合像素字体](https://github.com/TakWolf/fusion-pixel-font)（中文，© TakWolf 及上游作者），
许可文本见 `public/fonts/`。

设置中导入的自定义贴图包由用户自行获取并仅存于本地浏览器；导入第三方贴图包时请遵守其各自许可证。
