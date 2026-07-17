'use client';

import { useGameStore } from '@/lib/store';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';

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
        <span className="text-sm tabular-nums text-muted-foreground">{display}</span>
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

/** 设置弹窗：音量 / FOV / 渲染距离 / 灵敏度，改动即时生效并存 localStorage */
export function SettingsDialog() {
  const settings = useGameStore((s) => s.settings);
  const updateSettings = useGameStore((s) => s.updateSettings);

  return (
    <Dialog>
      <DialogTrigger render={<Button variant="outline" className="w-full" />}>
        设置
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>设置</DialogTitle>
          <DialogDescription>改动即时生效，自动保存到浏览器本地</DialogDescription>
        </DialogHeader>
        <div className="space-y-5 pt-1">
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
              <Label>渲染器</Label>
              <span className="text-sm text-muted-foreground">
                {settings.renderer === 'webgpu' ? 'WebGPU（不支持自动降级 WebGL）' : 'WebGL'}
              </span>
            </div>
            <div className="flex gap-2">
              {(['webgpu', 'webgl'] as const).map((r) => (
                <Button
                  key={r}
                  type="button"
                  variant={settings.renderer === r ? 'default' : 'outline'}
                  className="flex-1"
                  onClick={() => updateSettings({ renderer: r })}
                >
                  {r === 'webgpu' ? 'WebGPU（默认）' : 'WebGL'}
                </Button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              默认 WebGPU，浏览器不支持时自动降级 WebGL；切换后重新进入世界生效
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
