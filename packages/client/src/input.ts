import type { Direction, PlayerInput } from '@bomba/shared';

export interface KeyBindings {
  directions: Partial<Record<string, Direction>>;
  bomb: string[];
}

export const BINDINGS: KeyBindings[] = [
  {
    directions: { KeyW: 'up', KeyS: 'down', KeyA: 'left', KeyD: 'right' },
    bomb: ['Space'],
  },
  {
    directions: { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' },
    bomb: ['Enter', 'NumpadEnter', 'Numpad0'],
  },
];

export const SOLO_BINDING: KeyBindings = {
  directions: {
    KeyW: 'up',
    KeyS: 'down',
    KeyA: 'left',
    KeyD: 'right',
    ArrowUp: 'up',
    ArrowDown: 'down',
    ArrowLeft: 'left',
    ArrowRight: 'right',
  },
  bomb: ['Space', 'Enter', 'NumpadEnter', 'Numpad0'],
};

interface SlotState {
  held: Direction[];
  bomb: boolean;
}

export class Keyboard {
  private readonly slots: SlotState[];

  constructor(private readonly bindings: KeyBindings[]) {
    this.slots = bindings.map(() => ({ held: [], bomb: false }));
    window.addEventListener('keydown', (event) => this.onKey(event, true));
    window.addEventListener('keyup', (event) => this.onKey(event, false));
    window.addEventListener('blur', () => this.releaseAll());
  }

  read(slot: number): PlayerInput {
    const state = this.slots[slot];
    const input: PlayerInput = { dir: state.held.at(-1) ?? null, bomb: state.bomb };
    state.bomb = false;
    return input;
  }

  clearPendingBombs(): void {
    for (const slot of this.slots) slot.bomb = false;
  }

  releaseAll(): void {
    for (const slot of this.slots) {
      slot.held = [];
      slot.bomb = false;
    }
  }

  private onKey(event: KeyboardEvent, down: boolean): void {
    if (down && (event.target instanceof HTMLButtonElement || event.target instanceof HTMLInputElement)) return;
    this.bindings.forEach((binding, index) => {
      const slot = this.slots[index];
      const dir = binding.directions[event.code];
      if (dir) {
        event.preventDefault();
        slot.held = slot.held.filter((held) => held !== dir);
        if (down) slot.held.push(dir);
      } else if (binding.bomb.includes(event.code)) {
        event.preventDefault();
        if (down && !event.repeat) slot.bomb = true;
      }
    });
  }
}
