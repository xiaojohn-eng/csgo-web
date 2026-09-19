import { describe, expect, it } from 'vitest';
import { DEFAULT_KEYBINDS, keybindLabel, normalizeKeybind, readKeybinds } from '../game/keybinds';

describe('keybinds', () => {
  it('normalizes compact keyboard labels to KeyboardEvent.code', () => {
    expect(normalizeKeybind('w', 'KeyX')).toBe('KeyW');
    expect(normalizeKeybind('space', 'KeyX')).toBe('Space');
    expect(normalizeKeybind('5', 'KeyX')).toBe('Digit5');
    expect(normalizeKeybind('ShiftLeft', 'KeyX')).toBe('ShiftLeft');
  });

  it('rejects unsupported or missing persisted values', () => {
    expect(readKeybinds({ forward: 'KeyI', interact: '???' })).toMatchObject({
      forward: 'KeyI',
      interact: DEFAULT_KEYBINDS.interact,
      buy: DEFAULT_KEYBINDS.buy,
    });
  });

  it('renders compact labels for the settings and HUD', () => {
    expect(keybindLabel('KeyW')).toBe('W');
    expect(keybindLabel('Digit2')).toBe('2');
    expect(keybindLabel('ControlLeft')).toBe('Ctrl');
  });
});
