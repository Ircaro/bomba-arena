import { midiToFrequency, noise, tone, type AudioKit } from './sfx';

interface Bar {
  bass: number;
  chord: [number, number, number];
}

const BPM = 128;
export const STEP_SECONDS = 60 / BPM / 4;
const STEPS_PER_BAR = 16;
const ARPEGGIO = [0, 1, 2, 3, 2, 1, 0, 1, 0, 1, 2, 3, 2, 3, 2, 1];
const PROGRESSION: Bar[] = [
  { bass: 45, chord: [57, 60, 64] },
  { bass: 41, chord: [57, 60, 65] },
  { bass: 48, chord: [55, 60, 64] },
  { bass: 43, chord: [55, 59, 62] },
  { bass: 45, chord: [57, 60, 64] },
  { bass: 41, chord: [57, 60, 65] },
  { bass: 43, chord: [55, 59, 62] },
  { bass: 40, chord: [56, 59, 64] },
];
export const LOOP_STEPS = PROGRESSION.length * STEPS_PER_BAR;

function kick(kit: AudioKit, when: number): void {
  tone(kit, { wave: 'sine', from: 150, to: 42, glide: 0.6, when, duration: 0.2, gain: 0.45, attack: 0.002 });
}

function snare(kit: AudioKit, when: number): void {
  noise(kit, { when, duration: 0.14, gain: 0.14, filter: 'bandpass', from: 1900, q: 0.8 });
  tone(kit, { wave: 'triangle', from: 210, to: 130, when, duration: 0.07, gain: 0.08 });
}

function hat(kit: AudioKit, when: number, open: boolean): void {
  noise(kit, { when, duration: open ? 0.2 : 0.045, gain: open ? 0.035 : 0.045, filter: 'highpass', from: 7200 });
}

export function scheduleStep(kit: AudioKit, step: number, when: number): void {
  const barIndex = Math.floor(step / STEPS_PER_BAR) % PROGRESSION.length;
  const bar = PROGRESSION[barIndex];
  const position = step % STEPS_PER_BAR;

  if (position % 2 === 0) {
    const octave = position % 4 === 2 ? 12 : 0;
    tone(kit, {
      wave: 'square',
      from: midiToFrequency(bar.bass + octave),
      when,
      duration: STEP_SECONDS * 1.7,
      gain: 0.11,
      lowpass: 750,
    });
  }

  const notes = [bar.chord[0], bar.chord[1], bar.chord[2], bar.chord[0] + 12];
  tone(kit, {
    wave: 'pulse',
    from: midiToFrequency(notes[ARPEGGIO[position]] + 12),
    when,
    duration: STEP_SECONDS * 0.85,
    gain: 0.035,
    attack: 0.003,
    lowpass: 3600,
  });

  if (position === 0 || position === 8 || (position === 11 && barIndex % 2 === 1)) kick(kit, when);
  if (position === 4 || position === 12) snare(kit, when);
  if (position % 4 === 2) hat(kit, when, position === 14 && barIndex === PROGRESSION.length - 1);
}

export class MusicLoop {
  private timer: number | null = null;
  private step = 0;
  private nextTime = 0;

  constructor(private readonly kit: AudioKit) {}

  start(fromTop: boolean): void {
    if (fromTop) this.step = 0;
    if (this.timer !== null) return;
    this.nextTime = this.kit.context.currentTime + 0.06;
    this.timer = window.setInterval(() => this.pump(), 25);
    this.pump();
  }

  stop(): void {
    if (this.timer === null) return;
    window.clearInterval(this.timer);
    this.timer = null;
  }

  private pump(): void {
    const now = this.kit.context.currentTime;
    if (this.nextTime < now - 0.05) this.nextTime = now + 0.02;
    while (this.nextTime < now + 0.14) {
      scheduleStep(this.kit, this.step, this.nextTime);
      this.nextTime += STEP_SECONDS;
      this.step = (this.step + 1) % LOOP_STEPS;
    }
  }
}
