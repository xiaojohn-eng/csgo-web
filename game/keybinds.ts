/** Browser KeyboardEvent.code bindings used by the local input mapper. */
export type Keybinds = {
  forward: string;
  back: string;
  left: string;
  right: string;
  jump: string;
  interact: string;
  buy: string;
  spectatorNext: string;
};

export const DEFAULT_KEYBINDS: Readonly<Keybinds> = Object.freeze({
  forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD',
  jump: 'Space', interact: 'KeyE', buy: 'KeyB', spectatorNext: 'Space',
});

const aliases: Record<string, string> = {
  SPACE: 'Space', ' ': 'Space', SPACEBAR: 'Space',
  SHIFT: 'ShiftLeft', CTRL: 'ControlLeft', CONTROL: 'ControlLeft',
};

/** Accept a code (`KeyW`, `Space`) or a compact user spelling (`w`, `space`). */
export function normalizeKeybind(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const raw = value.trim();
  if (!raw) return fallback;
  const upper = raw.toUpperCase();
  if (aliases[upper]) return aliases[upper];
  if (/^KEY[A-Z]$/.test(upper)) return `Key${upper.slice(3)}`;
  if (/^[A-Z]$/.test(upper)) return `Key${upper}`;
  if (/^DIGIT[0-9]$/.test(upper)) return `Digit${upper.slice(5)}`;
  if (/^[0-9]$/.test(upper)) return `Digit${upper}`;
  if (/^(SPACE|SHIFTLEFT|SHIFTRIGHT|CONTROLLEFT|CONTROLRIGHT|TAB|ESCAPE)$/.test(upper)) {
    return upper[0] + upper.slice(1).toLowerCase().replace(/left|right/, (side) => side[0].toUpperCase() + side.slice(1));
  }
  return fallback;
}

export function keybindLabel(code: string): string {
  if (code === 'Space') return 'Space';
  if (code.startsWith('Key')) return code.slice(3).toUpperCase();
  if (code.startsWith('Digit')) return code.slice(5);
  if (code === 'ControlLeft' || code === 'ControlRight') return 'Ctrl';
  if (code === 'ShiftLeft' || code === 'ShiftRight') return 'Shift';
  return code;
}

export function readKeybinds(value: unknown): Keybinds {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    forward: normalizeKeybind(source.forward, DEFAULT_KEYBINDS.forward),
    back: normalizeKeybind(source.back, DEFAULT_KEYBINDS.back),
    left: normalizeKeybind(source.left, DEFAULT_KEYBINDS.left),
    right: normalizeKeybind(source.right, DEFAULT_KEYBINDS.right),
    jump: normalizeKeybind(source.jump, DEFAULT_KEYBINDS.jump),
    interact: normalizeKeybind(source.interact, DEFAULT_KEYBINDS.interact),
    buy: normalizeKeybind(source.buy, DEFAULT_KEYBINDS.buy),
    spectatorNext: normalizeKeybind(source.spectatorNext, DEFAULT_KEYBINDS.spectatorNext),
  };
}
