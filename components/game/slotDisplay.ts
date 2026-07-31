// 槽位显示辅助：各对话框（物品栏/容器/熔炉）共用

import { BLOCKS } from '@/lib/blocks';
import { armorDefOf } from '@/lib/armor';
import { materialName, materialTile } from '@/lib/materials';
import type { Slot } from '@/lib/slots';
import { TOOLS } from '@/lib/tools';

export function slotName(slot: Slot): string {
  if (!slot) return '';
  if (slot.kind === 'block') return BLOCKS[slot.id].name;
  if (slot.kind === 'material') return materialName(slot.material);
  if (slot.kind === 'tool') return TOOLS[slot.tool].name;
  return armorDefOf(slot).name;
}

export function slotTile(slot: Slot): number {
  if (!slot) return 0;
  if (slot.kind === 'block') return BLOCKS[slot.id].side;
  if (slot.kind === 'material') return materialTile(slot.material);
  if (slot.kind === 'tool') return TOOLS[slot.tool].iconTile;
  return armorDefOf(slot).iconTile;
}

export function slotDurabilityPct(slot: Slot): number | null {
  if (!slot) return null;
  if (slot.kind === 'tool') return slot.durability / TOOLS[slot.tool].durability;
  if (slot.kind === 'armor') return slot.durability / armorDefOf(slot).durability;
  return null;
}
