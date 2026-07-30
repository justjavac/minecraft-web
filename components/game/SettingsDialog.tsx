'use client';

import { useEffect, useRef, useState } from 'react';
import { useGameStore } from '@/lib/store';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { clearCustomPack, importPackFolder, importPackZip, loadCustomPack } from '@/lib/texturepack';
import { McButton } from './McButton';

interface SettingRowProps {
  label: string;
  display: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
}

function SettingRow({ label, display, min, max, step, value, onChange }: SettingRowProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>{label}</Label>
        <span className="text-sm tabular-nums text-white/60">{display}</span>
      </div>
      <Slider
        min={min}
        max={max}
        step={step}
        value={[value]}
        onValueChange={(v) => onChange(Array.isArray(v) ? v[0] : v)}
      />
    </div>
  );
}

/** 设置弹窗：音量 / FOV / 渲染距离 / 灵敏度 / 自动跳跃 / 云 / 粒子 / 渲染器 / 贴图包，改动即时生效并存 localStorage */
export function SettingsDialog() {
  const settings = useGameStore((s) => s.settings);
  const updateSettings = useGameStore((s) => s.updateSettings);
  const [packName, setPackName] = useState<string | null>(null);
  const [packMsg, setPackMsg] = useState('');
  const zipRef = useRef<HTMLInputElement>(null);
  const dirRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // 挂载后读取本地贴图包（避免 SSR 水合不一致；微任务绕过同步 setState 限制）
    queueMicrotask(() => setPackName(loadCustomPack()?.name ?? null));
  }, []);

  const onImport = async (importFn: () => Promise<{ name: string; found: number; tilePx: number }>) => {
    try {
      const r = await importFn();
      setPackName(r.name);
      setPackMsg(`已导入 ${r.found} 张贴图（${r.tilePx}px），刷新页面后生效`);
    } catch (e) {
      setPackMsg(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Dialog>
      <DialogTrigger render={<McButton className="w-full" />}>
        设置
      </DialogTrigger>
      <DialogContent className="mc-dirt border-2 border-t-white border-l-white border-b-[#555555] border-r-[#555555] text-white sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-white [text-shadow:2px_2px_0_#3f3f3f]">设置</DialogTitle>
          <DialogDescription className="text-white/60">改动即时生效，自动保存到浏览器本地</DialogDescription>
        </DialogHeader>
        <div className="max-h-[72vh] space-y-5 overflow-y-auto pt-1 pr-1">
          <SettingRow
            label="音量"
            display={`${Math.round(settings.volume * 100)}%`}
            min={0}
            max={1}
            step={0.01}
            value={settings.volume}
            onChange={(volume) => updateSettings({ volume })}
          />
          <SettingRow
            label="视野 (FOV)"
            display={`${settings.fov}°`}
            min={60}
            max={110}
            step={1}
            value={settings.fov}
            onChange={(fov) => updateSettings({ fov })}
          />
          <SettingRow
            label="渲染距离"
            display={`${settings.renderDistance} chunks`}
            min={2}
            max={8}
            step={1}
            value={settings.renderDistance}
            onChange={(renderDistance) => updateSettings({ renderDistance })}
          />
          <SettingRow
            label="视角灵敏度"
            display={`×${settings.sensitivity.toFixed(1)}`}
            min={0.5}
            max={2}
            step={0.1}
            value={settings.sensitivity}
            onChange={(sensitivity) => updateSettings({ sensitivity })}
          />
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="whitespace-nowrap">自动跳跃</Label>
              <span className="text-sm text-white/60">着地行走自动跨上 1 格台阶（MC 辅助功能）</span>
            </div>
            <div className="flex gap-2">
              {[true, false].map((v) => (
                <McButton
                  key={String(v)}
                  className={`flex-1 ${settings.autoJump === v ? 'outline outline-2 outline-white' : ''}`}
                  onClick={() => updateSettings({ autoJump: v })}
                >
                  {v ? '开' : '关'}
                </McButton>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>云</Label>
              <span className="text-sm text-white/60">MC 云开关</span>
            </div>
            <div className="flex gap-2">
              {[true, false].map((v) => (
                <McButton
                  key={String(v)}
                  className={`flex-1 ${settings.clouds === v ? 'outline outline-2 outline-white' : ''}`}
                  onClick={() => updateSettings({ clouds: v })}
                >
                  {v ? '开' : '关'}
                </McButton>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="whitespace-nowrap">粒子效果</Label>
              <span className="text-sm text-white/60">方块破坏碎屑等</span>
            </div>
            <div className="flex gap-2">
              {[true, false].map((v) => (
                <McButton
                  key={String(v)}
                  className={`flex-1 ${settings.particles === v ? 'outline outline-2 outline-white' : ''}`}
                  onClick={() => updateSettings({ particles: v })}
                >
                  {v ? '开' : '关'}
                </McButton>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="whitespace-nowrap">渲染器</Label>
              <span className="text-sm text-white/60">
                {settings.renderer === 'webgpu' ? 'WebGPU（不支持自动降级 WebGL）' : 'WebGL'}
              </span>
            </div>
            <div className="flex gap-2">
              {(['webgpu', 'webgl'] as const).map((r) => (
                <McButton
                  key={r}
                  className={`flex-1 ${settings.renderer === r ? 'outline outline-2 outline-white' : ''}`}
                  onClick={() => updateSettings({ renderer: r })}
                >
                  {r === 'webgpu' ? 'WebGPU（默认）' : 'WebGL'}
                </McButton>
              ))}
            </div>
            <p className="text-xs text-white/60">
              默认 WebGPU，浏览器不支持时自动降级 WebGL；切换后重新进入世界生效
            </p>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="whitespace-nowrap">贴图包</Label>
              <span className="text-sm text-white/60">{packName ?? '默认（Faithful 32x）'}</span>
            </div>
            <div className="flex gap-2">
              <McButton className="flex-1" onClick={() => zipRef.current?.click()}>
                导入 zip
              </McButton>
              <McButton className="flex-1" onClick={() => dirRef.current?.click()}>
                选择文件夹
              </McButton>
              {packName && (
                <McButton
                  onClick={() => {
                    clearCustomPack();
                    setPackName(null);
                    setPackMsg('已恢复默认贴图，刷新页面后生效');
                  }}
                >
                  恢复默认
                </McButton>
              )}
            </div>
            {packMsg && (
              <p className="text-xs text-white/60">
                {packMsg}{' '}
                <button type="button" className="underline" onClick={() => window.location.reload()}>
                  立即刷新
                </button>
              </p>
            )}
            <p className="text-xs text-white/60">
              自动识别 Faithful 等现代 MC 包结构；贴图仅保存在你的浏览器本地，不会上传或分发
            </p>
            <input
              ref={zipRef}
              type="file"
              accept=".zip"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onImport(() => importPackZip(f));
                e.target.value = '';
              }}
            />
            <input
              ref={dirRef}
              type="file"
              hidden
              {...({ webkitdirectory: '' } as object)}
              onChange={(e) => {
                if (e.target.files?.length) void onImport(() => importPackFolder(e.target.files!));
                e.target.value = '';
              }}
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
