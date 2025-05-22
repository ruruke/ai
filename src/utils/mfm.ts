/**
 * 指定した色でテキストを装飾します。
 * @param text 装飾するテキスト
 * @param colorCode カラーコード (例: ff0000)
 * @returns MFM装飾された文字列
 */
export function color(text: string, colorCode: string): string {
  return `$[fg.color=${colorCode} ${text}]`;
}

/**
 * テキストに背景色を指定します。
 * @param text 装飾するテキスト
 * @param colorCode カラーコード (例: ff0000)
 * @returns MFM装飾された文字列
 */
export function bgColor(text: string, colorCode: string): string {
  return `$[bg.color=${colorCode} ${text}]`;
}

/**
 * テキストを太字にします。
 * @param text 太字にするテキスト
 * @returns MFM装飾された文字列
 */
export function bold(text: string): string {
  return `**${text}**`;
}

/**
 * テキストを虹色アニメーションで表示します。
 * @param text 装飾するテキスト
 * @param speed アニメーション速度 (例: 5s) - optional
 * @returns MFM装飾された文字列
 */
export function rainbow(text: string, speed?: string): string {
  if (speed) {
    return `$[rainbow.speed=${speed} ${text}]`;
  }
  return `$[rainbow ${text}]`;
}

/**
 * テキストを反転させます。
 * @param text 装飾するテキスト
 * @param direction 反転方向 (v: 垂直, h: 水平, hv: 垂直および水平)  - optional
 * @returns MFM装飾された文字列
 */
export function flip(text: string, direction?: 'v' | 'h' | 'hv'): string {
  if (direction) {
    const directions = direction.split('').join(',');
    return `$[flip.${directions} ${text}]`;
  }
  return `$[flip ${text}]`;
}

/**
 * テキストを指定したフォントで表示します。
 * @param text 装飾するテキスト
 * @param fontName フォント名
 * @returns MFM装飾された文字列
 */
export function font(
  text: string,
  fontName: 'serif' | 'monospace' | 'cursive' | 'fantasy'
): string {
  return `$[font.${fontName} ${text}]`;
}

/**
 * テキストを指定したサイズで表示します。
 * @param text 装飾するテキスト
 * @param size サイズ (2, 3, 4など)
 * @returns MFM装飾された文字列
 */
export function size(text: string, size: 2 | 3 | 4): string {
  return `$[x${size} ${text}]`;
}

/**
 * テキストに動き(tada)を加えます。
 * @param text 装飾するテキスト
 * @param speed アニメーション速度 (例: 5s) - optional
 * @returns MFM装飾された文字列
 */
export function tada(text: string, speed?: string): string {
  if (speed) {
    return `$[tada.speed=${speed} ${text}]`;
  }
  return `$[tada ${text}]`;
}

/**
 * テキストに動き(spin)を加えます。
 * @param text 装飾するテキスト
 * @param options スピンのオプション (left, alternate, x, y, speedなど) - optional
 * @returns MFM装飾された文字列
 */
export function spin(
  text: string,
  options?: {
    direction?: 'left' | 'alternate';
    axis?: 'x' | 'y';
    speed?: string;
  }
): string {
  let tag = 'spin';
  if (options) {
    if (options.axis) tag += `.${options.axis}`;
    if (options.direction) tag += `.${options.direction}`;
    if (options.speed) tag += `.speed=${options.speed}`;
  }
  return `$[${tag} ${text}]`;
}

/**
 * テキストに動き(jump)を加えます。
 * @param text 装飾するテキスト
 * @param speed アニメーション速度 (例: 5s) - optional
 * @returns MFM装飾された文字列
 */
export function jump(text: string, speed?: string): string {
  if (speed) {
    return `$[jump.speed=${speed} ${text}]`;
  }
  return `$[jump ${text}]`;
}

/**
 * テキストに動き(bounce)を加えます。
 * @param text 装飾するテキスト
 * @param speed アニメーション速度 (例: 5s) - optional
 * @returns MFM装飾された文字列
 */
export function bounce(text: string, speed?: string): string {
  if (speed) {
    return `$[bounce.speed=${speed} ${text}]`;
  }
  return `$[bounce ${text}]`;
}

/**
 * テキストに動き(shake)を加えます。
 * @param text 装飾するテキスト
 * @param speed アニメーション速度 (例: 5s) - optional
 * @returns MFM装飾された文字列
 */
export function shake(text: string, speed?: string): string {
  if (speed) {
    return `$[shake.speed=${speed} ${text}]`;
  }
  return `$[shake ${text}]`;
}

/**
 * テキストに動き(jelly)を加えます。
 * @param text 装飾するテキスト
 * @param speed アニメーション速度 (例: 5s) - optional
 * @returns MFM装飾された文字列
 */
export function jelly(text: string, speed?: string): string {
  if (speed) {
    return `$[jelly.speed=${speed} ${text}]`;
  }
  return `$[jelly ${text}]`;
}

/**
 * テキストに動き(twitch)を加えます。
 * @param text 装飾するテキスト
 * @param speed アニメーション速度 (例: 5s) - optional
 * @returns MFM装飾された文字列
 */
export function twitch(text: string, speed?: string): string {
  if (speed) {
    return `$[twitch.speed=${speed} ${text}]`;
  }
  return `$[twitch ${text}]`;
}

/**
 * テキストにぼかし効果を加えます。
 * @param text 装飾するテキスト
 * @returns MFM装飾された文字列
 */
export function blur(text: string): string {
  return `$[blur ${text}]`;
}

/**
 * テキストをイタリックにします。
 * @param text イタリックにするテキスト
 * @returns MFM装飾された文字列
 */
export function italic(text: string): string {
  return `*${text}*`;
}

/**
 * テキストに打ち消し線を引きます。
 * @param text 打ち消し線を引くテキスト
 * @returns MFM装飾された文字列
 */
export function strike(text: string): string {
  return `~~${text}~~`;
}

/**
 * テキストを小さく表示します。
 * @param text 小さく表示するテキスト
 * @returns MFM装飾された文字列
 */
export function small(text: string): string {
  return `<small>${text}</small>`;
}

/**
 * テキストをルビ付きで表示します。
 * @param text 本文
 * @param rubyText ルビ
 * @returns MFM装飾された文字列
 */
export function ruby(text: string, rubyText: string): string {
  return `$[ruby ${text} ${rubyText}]`;
}

/**
 * テキストを指定した角度で回転させます。
 * @param text 装飾するテキスト
 * @param degrees 回転角度
 * @returns MFM装飾された文字列
 */
export function rotate(text: string, degrees: number): string {
  return `$[rotate.deg=${degrees} ${text}]`;
}

/**
 * テキストにキラキラ効果を加えます。
 * @param text 装飾するテキスト
 * @returns MFM装飾された文字列
 */
export function sparkle(text: string): string {
  return `$[sparkle ${text}]`;
}

/**
 * 内側のMFM構文を無効にします。
 * @param text 対象のテキスト
 * @returns MFM装飾された文字列
 */
export function plain(text: string): string {
  return `<plain>${text}</plain>`;
}
