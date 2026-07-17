// WebAudio 音效：按组随机变体 + 随机音调，懒加载解码，首次用户手势后自动恢复

import type { SoundGroup } from './blocks';
import { useGameStore } from './store';

const GROUP_FILES: Record<SoundGroup, string[]> = {
  // 挖掘
  dig_cracky: ['default_dig_cracky.1.ogg', 'default_dig_cracky.2.ogg', 'default_dig_cracky.3.ogg'],
  dig_choppy: ['default_dig_choppy.1.ogg', 'default_dig_choppy.2.ogg', 'default_dig_choppy.3.ogg'],
  dig_glass: ['default_break_glass.1.ogg', 'default_break_glass.2.ogg', 'default_break_glass.3.ogg'],
  dig_dirt: ['default_dug_node.1.ogg', 'default_dug_node.2.ogg'],
  dig_leaves: ['default_grass_footstep.1.ogg', 'default_grass_footstep.2.ogg', 'default_grass_footstep.3.ogg'],
  // 放置
  place: ['default_place_node.1.ogg', 'default_place_node.2.ogg', 'default_place_node.3.ogg'],
  place_hard: ['default_place_node_hard.1.ogg', 'default_place_node_hard.2.ogg'],
  // 脚步
  step_grass: ['default_grass_footstep.1.ogg', 'default_grass_footstep.2.ogg', 'default_grass_footstep.3.ogg'],
  step_dirt: ['default_dirt_footstep.1.ogg', 'default_dirt_footstep.2.ogg'],
  step_sand: ['default_sand_footstep.1.ogg', 'default_sand_footstep.2.ogg', 'default_sand_footstep.3.ogg'],
  step_hard: ['default_hard_footstep.1.ogg', 'default_hard_footstep.2.ogg', 'default_hard_footstep.3.ogg'],
  step_wood: ['default_wood_footstep.1.ogg', 'default_wood_footstep.2.ogg'],
};

let ctx: AudioContext | null = null;
let preloadQueued = false;
const buffers = new Map<string, Promise<AudioBuffer>>();

/** 是否已发生用户手势（浏览器自动播放策略：无手势创建/恢复 AudioContext 会刷警告） */
let gestured = typeof navigator !== 'undefined' && navigator.userActivation?.hasBeenActive === true;

function audioCtx(): AudioContext | null {
  if (!ctx) {
    if (!gestured) return null; // 等首次手势，由下方监听器创建
    ctx = new AudioContext();
  }
  // 浏览器要求用户手势后才能出声：每次播放都尝试恢复
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function loadBuffer(file: string): Promise<AudioBuffer> {
  let p = buffers.get(file);
  if (!p) {
    const ac = audioCtx();
    if (!ac) return Promise.reject(new Error('AudioContext 等待用户手势'));
    p = fetch(`/sounds/${file}`)
      .then((r) => {
        if (!r.ok) throw new Error(`音效缺失: ${file}`);
        return r.arrayBuffer();
      })
      .then((ab) => ac.decodeAudioData(ab));
    buffers.set(file, p);
    // 失败不缓存 rejection，下次播放时重试
    p.catch(() => buffers.delete(file));
  }
  return p;
}

function preloadAll(): void {
  for (const files of Object.values(GROUP_FILES)) {
    for (const f of files) void loadBuffer(f).catch(() => {});
  }
}

/** 世界加载后预载全部音效（静默失败，播放时会再尝试；无用户手势则推迟到首次手势） */
export function preloadSounds(): void {
  if (gestured) preloadAll();
  else preloadQueued = true;
}

export function playSound(group: SoundGroup, volume = 1): void {
  const files = GROUP_FILES[group];
  const file = files[(Math.random() * files.length) | 0];
  void loadBuffer(file)
    .then((buffer) => {
      const ac = audioCtx();
      if (!ac) return;
      const src = ac.createBufferSource();
      src.buffer = buffer;
      // 每次播放随机音调，避免机械重复感
      src.playbackRate.value = 0.9 + Math.random() * 0.2;
      const gain = ac.createGain();
      gain.gain.value = useGameStore.getState().settings.volume * volume;
      src.connect(gain);
      gain.connect(ac.destination);
      src.start();
    })
    .catch(() => {});
}

// 首次手势（点击/按键）时创建/恢复 AudioContext 并补做预载，减少第一次播放的延迟
if (typeof window !== 'undefined') {
  const onGesture = () => {
    gestured = true;
    audioCtx();
    if (preloadQueued) {
      preloadQueued = false;
      preloadAll();
    }
  };
  window.addEventListener('pointerdown', onGesture, { once: true });
  window.addEventListener('keydown', onGesture, { once: true });
}
