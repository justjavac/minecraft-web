'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { loadWorldMeta } from '@/lib/persistence';
import { randomSeed, useGameStore, type WorldMode } from '@/lib/store';
import { SettingsDialog } from './SettingsDialog';

export function MainMenu() {
  const [seed, setSeed] = useState(() => randomSeed());
  const [mode, setMode] = useState<WorldMode>('survival');
  const [hasSave, setHasSave] = useState(false);
  const startNew = useGameStore((s) => s.startNew);
  const continueGame = useGameStore((s) => s.continueGame);

  useEffect(() => {
    void loadWorldMeta()
      .then((m) => setHasSave(m !== null))
      .catch(() => setHasSave(false));
  }, []);

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-gradient-to-b from-sky-400 via-sky-300 to-emerald-100 p-4">
      {/* 体素风格地面装饰 */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0">
        <div className="h-8 [background:repeating-linear-gradient(90deg,#6aa84f_0_40px,#5d9445_40px_80px,#63a049_80px_120px)]" />
        <div className="h-12 [background:repeating-linear-gradient(90deg,#8a6a48_0_40px,#7d5f40_40px_80px,#846645_80px_120px)]" />
      </div>

      <Card className="relative w-full max-w-md border-2 border-zinc-900/15 shadow-2xl">
        <CardHeader>
          <CardTitle className="font-mono text-4xl font-bold tracking-tight [text-shadow:2px_2px_0_#d4d4d8]">
            kimi-mc
          </CardTitle>
          <CardDescription>网页版体素沙盒 · Next.js + shadcn/ui + Three.js</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button
            className="w-full bg-emerald-600 text-white hover:bg-emerald-500"
            size="lg"
            disabled={!hasSave}
            onClick={continueGame}
          >
            继续游戏
          </Button>
          <Separator />
          <div className="space-y-2">
            <Label htmlFor="seed">新世界种子</Label>
            <div className="flex gap-2">
              <Input
                id="seed"
                value={seed}
                onChange={(e) => setSeed(e.target.value)}
                placeholder="留空则随机"
              />
              <Button variant="outline" onClick={() => setSeed(randomSeed())}>
                随机
              </Button>
            </div>
            <Button
              variant="secondary"
              className="w-full"
              onClick={() => startNew(seed.trim() || randomSeed(), mode)}
            >
              创建新世界{hasSave ? '（覆盖旧存档）' : ''}
            </Button>
            <div className="flex gap-2">
              {(['survival', 'creative'] as const).map((m) => (
                <Button
                  key={m}
                  type="button"
                  variant={mode === m ? 'default' : 'outline'}
                  className="flex-1"
                  onClick={() => setMode(m)}
                >
                  {m === 'survival' ? '生存模式' : '创造模式'}
                </Button>
              ))}
            </div>
          </div>
          <SettingsDialog />
          <Separator />
          <div className="space-y-1 text-sm text-muted-foreground">
            <p>WASD 移动 · 空格 跳跃/上浮 · Shift 下降 · F 飞行开关</p>
            <p>按住左键 挖掘（带裂纹进度）· 右键 放置 · 1-9 / 滚轮 选方块 · Esc 暂停 · F3 调试</p>
            <p>移动端：左下摇杆移动，拖动转视角，右侧按钮操作</p>
            <p>世界改动每 5 秒自动保存到浏览器本地</p>
          </div>
        </CardContent>
        <CardFooter className="text-xs text-muted-foreground">
          贴图 Faithful 32x（faithfulpack.net）· 音效 Minetest Game（CC BY-SA 3.0）· 详见 public/*/CREDITS.md
        </CardFooter>
      </Card>
    </div>
  );
}
