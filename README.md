# kimi-mc

网页版体素沙盒（Minecraft 风格，创造 + 生存双模式），技术栈：**Next.js (App Router) + shadcn/ui + Three.js (@react-three/fiber)**。

## 运行

```bash
npm install
npm run dev      # http://localhost:3000
```

其他脚本：

```bash
npm test         # vitest：mesher 面剔除 / DDA 射线 / 地形确定性 / 世界读写
npm run lint
npm run build    # 静态导出到 out/
npm start        # 用 python3 静态服务预览 out/（http://localhost:3000）
```

贴图与音效已随仓库提交；如需重新拉取：`bash scripts/fetch-textures.sh` 和 `bash scripts/fetch-sounds.sh`。图标重新生成：`node scripts/generate-icons.mjs`。

## PWA 与部署

- 已配置 Web App Manifest 与图标（192/512/apple-touch-icon），移动端可「添加到主屏幕」全屏运行
- Service Worker（`public/sw.js`，仅生产环境注册）：首次访问后所有静态资源写入缓存，之后**离线可玩**；页面 network-first，静态资源 cache-first
- `next.config.ts` 开启 `output: 'export'`，`npm run build` 产物 `out/` 为纯静态文件，可直接部署到 Vercel / Netlify / GitHub Pages / 任意静态服务器
- Service Worker 更新策略：缓存按版本号命名（`kimi-mc-v1`），改 SW 逻辑时递增版本号以刷新缓存

## 玩法

- 主菜单输入种子创建新世界（可选**生存 / 创造**模式，模式随存档保存），或「继续游戏」读取本地存档并回到上次离开时的位置
- 生存模式（机制对齐 MC 原版）：生命/饥饿/隐藏饱和度/消耗度系统、掉落伤害（>3 格）、溺水（15 秒氧气，耗尽 2 点/秒）、挖掘掉落物实体（0.5 秒延时拾取、5 分钟消失）、**死亡物品全部散落死亡点**、夜晚僵尸（20HP / 普通难度 2 心）白天自燃、徒手挖掘时间与 MC 一致（石头 7.5s、圆石/砖 10s、木头 3s）
- **合成系统**：E 键随身 2×2、右键工作台 3×3，配方与 MC 一致（原木→木板→木棍→工作台→木/石工具）；工具加速对应方块（木 2x / 石 4x）并有耐久（59/131）；**石头系方块必须用镐才有掉落**；剑按 MC 伤害（木 4 / 石 5）与攻速
- **熔炉烧炼**：圆石 8 合成熔炉，右键打开（烧炼物/燃料/产出三槽）；圆石→石头、沙子→玻璃、原木→木炭、生肉→熟肉，每件 10 秒；燃料按 MC 燃烧时长（木板 15s、木炭 80s）；破坏熔炉掉落内容物，炉状态随存档
- **食物与进食**：猪/牛/鸡掉落生肉，熔炉烤熟，右键进食回复饥饿与饱和度（MC 回复量）
- **生物**：僵尸/骷髅（8-16 距离射箭）/蜘蛛（白天中立）/苦力怕（近身 1.5s 引信爆炸，破坏方块）夜晚生成；猪/牛/鸡白天草地生成、游走、受击逃跑
- **皮甲装备**：牛掉皮革（0-2），工作台合成头盔/胸甲/护腿/靴子（MC 用量 5/8/7/4），右键穿上；全套 7 护甲点 = 28% 减伤，受伤扣耐久（55/80/75/65），HUD 护甲条
- **村庄**：64 格区域 12% 概率生成（平坦陆地），中心水井 + 环形 3-6 栋小屋（圆石基座、原木角柱、玻璃窗、门洞、土路相连），确定性布局跨 chunk 一致；村庄附近白天生成村民游走
- WASD 移动 · 空格 跳跃/游泳上浮 · Shift 下降 · **F** 飞行开关（仅创造）
- **按住左键** 挖掘（不同方块时长不同，带裂纹进度动画与碎块粒子）· 右键 放置 · 1-9 / 滚轮 切换热键栏 · Esc 暂停 · **F3** 调试面板
- 着地行走自动走上 1 格台阶（天花板下不触发）
- 准星处半透明显示将放置的方块，水面为 MC 风格的 0.875 格下沉
- 移动端：左下虚拟摇杆移动，空白区域拖动转视角，右侧按钮 跳/挖/放/飞行
- 主菜单 / 暂停页可打开设置：音量、FOV、渲染距离、视角灵敏度（存 localStorage）
- 设置里可导入自定义贴图包：自动识别 Faithful 等现代 MC 包结构（`assets/minecraft/textures/block/`），支持 zip 或解压文件夹，16/32px 自适应；贴图仅存本地浏览器，刷新后生效
- 方块改动每 5 秒自动保存到 IndexedDB，关闭页面前兜底保存

## 实现要点

- **世界**：chunk 16×64×16，渲染半径 6，按玩家位置动态生成/卸载；simplex 噪声高度图 + 确定性树木
- **网格化**：隐藏面剔除，每 chunk 两个 BufferGeometry（不透明 + 半透明水），方块修改只重建相关 chunk
- **渲染器**：默认 **WebGPU**（`requestAdapter` 能力检测 + 初始化失败兜底），浏览器不支持时全链路自动降级 WebGL；也可在设置里手动固定 WebGL
- **贴图**：浏览器端 canvas 合成 4×4 atlas（`NearestFilter` 像素风），草方块侧面为 dirt + 透明层合成
- **操作**：PointerLock 第一人称，AABB 逐轴碰撞，体素 DDA 射线选块
- **音效**：WebAudio 播放挖掘/放置/脚步声，按方块材质分组，随机变体 + 随机音调
- **昼夜**：10 分钟一循环，太阳/月亮轨道 + 像素云层漂移，光照与雾色随时间渐变

## 目录结构

```
app/                    — 入口页面 / manifest
components/game/        — Canvas / World / Player / DayNight / HUD / 触控层 / 粒子 / 预览 / 主菜单 / 设置
components/ui/          — shadcn/ui
lib/                    — blocks / noise / world / mesher / raycast / persistence / store / game / actions / textures / texturepack / sound
lib/__tests__/          — vitest 单元测试
public/textures/        — 贴图 + CREDITS.md
public/sounds/          — 音效 + CREDITS.md
scripts/                — fetch-textures.sh / fetch-sounds.sh / generate-icons.mjs
```

## 资源署名

贴图与音效来自 [Minetest Game](https://github.com/luanti-org/minetest_game)（`mods/default/`），
媒体资源采用 [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/)，作者为 Various Minetest Game developers。
详见 [public/textures/CREDITS.md](public/textures/CREDITS.md) 与 [public/sounds/CREDITS.md](public/sounds/CREDITS.md)。

设置中导入的自定义贴图包由用户自行获取并仅存于本地浏览器，本项目不分发任何第三方贴图。
使用 Faithful 32x 时请遵守其[许可证](https://faithfulpack.net/)的要求（署名 + 链接回 https://faithfulpack.net/）。
