'use client';

import type { ButtonHTMLAttributes } from 'react';

/** MC Java 风格按钮：Faithful widgets/button 三态纹理（普通/悬停/禁用），样式见 globals.css .mc-btn */
export function McButton({ className = '', type, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type={type ?? 'button'} {...props} className={`mc-btn ${className}`} />;
}
