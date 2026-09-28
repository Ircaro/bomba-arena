import type { PowerUpKind } from '@bomba/shared';

export interface AudioKit {
  context: BaseAudioContext;
  destination: AudioNode;
  noise: AudioBuffer;
  curve: Float32Array<ArrayBuffer>;
  pulse: PeriodicWave;
}

export interface VoiceOptions {
  when: number;
  pan?: number;
  intensity?: number;
  detune?: number;
  kind?: PowerUpKind;
}

export type SfxName =
  | 'explosion'
  | 'place'
  | 'crate'
  | 'pickup'
  | 'death'
  | 'round'
  | 'go'
  | 'win'
  | 'champion'
  | 'draw'
  | 'confirm'
  | 'pause'
  | 'tick';

interface ToneSpec {
  wave: Exclude<OscillatorType, 'custom'> | 'pulse';
  from: number;
  to?: number;
  glide?: number;
  when: number;
  duration: number;
  gain: number;
  attack?: number;
  pan?: number;
  lowpass?: number;
  vibrato?: { rate: number; depth: number };
}

interface NoiseSpec {
  when: number;
  duration: number;
  gain: number;
  attack?: number;
  filter: BiquadFilterType;
  from: number;
  to?: number;
  q?: number;
  pan?: number;
}

export function midiToFrequency(note: number): number {
  return 440 * Math.pow(2, (note - 69) / 12);
}

export function createKit(context: BaseAudioContext, destination: AudioNode): AudioKit {
  const length = Math.floor(context.sampleRate * 2);
  const noise = context.createBuffer(1, length, context.sampleRate);
  const samples = noise.getChannelData(0);
  for (let i = 0; i < length; i++) samples[i] = Math.random() * 2 - 1;

  const curve = new Float32Array(1024);
  const drive = 2.6;
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1;
    curve[i] = Math.tanh(drive * x) / Math.tanh(drive);
  }

  const harmonics = 32;
  const real = new Float32Array(harmonics);
  const imag = new Float32Array(harmonics);
  for (let n = 1; n < harmonics; n++) real[n] = (2 / (n * Math.PI)) * Math.sin(n * Math.PI * 0.25);
  const pulse = context.createPeriodicWave(real, imag);

  return { context, destination, noise, curve, pulse };
}

function route(kit: AudioKit, pan = 0): AudioNode {
  if (Math.abs(pan) < 0.02) return kit.destination;
  const panner = kit.context.createStereoPanner();
  panner.pan.value = Math.max(-1, Math.min(1, pan));
  panner.connect(kit.destination);
  return panner;
}

function envelope(param: AudioParam, when: number, peak: number, attack: number, duration: number): void {
  param.setValueAtTime(0, when);
  param.linearRampToValueAtTime(peak, when + attack);
  param.exponentialRampToValueAtTime(0.0001, when + Math.max(duration, attack + 0.01));
}

export function tone(kit: AudioKit, spec: ToneSpec): void {
  const { context } = kit;
  const oscillator = context.createOscillator();
  if (spec.wave === 'pulse') oscillator.setPeriodicWave(kit.pulse);
  else oscillator.type = spec.wave;
  oscillator.frequency.setValueAtTime(spec.from, spec.when);
  if (spec.to !== undefined) {
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, spec.to), spec.when + spec.duration * (spec.glide ?? 1));
  }
  const amp = context.createGain();
  envelope(amp.gain, spec.when, spec.gain, spec.attack ?? 0.004, spec.duration);
  let head: AudioNode = oscillator;
  if (spec.lowpass) {
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = spec.lowpass;
    head.connect(filter);
    head = filter;
  }
  head.connect(amp);
  amp.connect(route(kit, spec.pan));
  const end = spec.when + spec.duration + 0.05;
  if (spec.vibrato) {
    const lfo = context.createOscillator();
    lfo.frequency.value = spec.vibrato.rate;
    const depth = context.createGain();
    depth.gain.value = spec.vibrato.depth;
    lfo.connect(depth);
    depth.connect(oscillator.frequency);
    lfo.start(spec.when);
    lfo.stop(end);
  }
  oscillator.start(spec.when);
  oscillator.stop(end);
}

export function noise(kit: AudioKit, spec: NoiseSpec): void {
  const { context } = kit;
  const source = context.createBufferSource();
  source.buffer = kit.noise;
  const filter = context.createBiquadFilter();
  filter.type = spec.filter;
  filter.frequency.setValueAtTime(spec.from, spec.when);
  if (spec.to !== undefined) filter.frequency.exponentialRampToValueAtTime(Math.max(20, spec.to), spec.when + spec.duration);
  filter.Q.value = spec.q ?? 0.7;
  const amp = context.createGain();
  envelope(amp.gain, spec.when, spec.gain, spec.attack ?? 0.002, spec.duration);
  source.connect(filter);
  filter.connect(amp);
  amp.connect(route(kit, spec.pan));
  const room = Math.max(0, kit.noise.duration - spec.duration - 0.1);
  source.start(spec.when, Math.random() * room);
  source.stop(spec.when + spec.duration + 0.05);
}

type Voice = (kit: AudioKit, options: VoiceOptions) => void;

export const VOICES: Record<SfxName, Voice> = {
  explosion(kit, { when, pan = 0, intensity = 1, detune = 1 }) {
    const power = Math.min(1.5, 1 + (intensity - 1) * 0.18);
    const { context } = kit;
    const boom = context.createOscillator();
    boom.type = 'sine';
    boom.frequency.setValueAtTime(150 * detune, when);
    boom.frequency.exponentialRampToValueAtTime(40 * detune, when + 0.5);
    const shaper = context.createWaveShaper();
    shaper.curve = kit.curve;
    const amp = context.createGain();
    envelope(amp.gain, when, 0.7 * power, 0.004, 0.75);
    boom.connect(shaper);
    shaper.connect(amp);
    amp.connect(route(kit, pan * 0.5));
    boom.start(when);
    boom.stop(when + 0.8);
    noise(kit, { when, duration: 0.95, gain: 0.6 * power, filter: 'lowpass', from: 4200 * detune, to: 160, q: 0.8, pan });
    noise(kit, { when, duration: 0.14, gain: 0.3 * power, filter: 'highpass', from: 2200, q: 0.5, pan });
    noise(kit, { when: when + 0.06, duration: 0.6, gain: 0.1 * power, attack: 0.08, filter: 'bandpass', from: 3400, to: 1600, q: 1.3, pan });
  },

  place(kit, { when, pan = 0, detune = 1 }) {
    tone(kit, { wave: 'sine', from: 280 * detune, to: 85, glide: 0.6, when, duration: 0.16, gain: 0.6, attack: 0.002, pan });
    tone(kit, { wave: 'triangle', from: 560 * detune, to: 200, when, duration: 0.07, gain: 0.2, attack: 0.001, pan });
    tone(kit, { wave: 'triangle', from: 950 * detune, to: 620, when, duration: 0.04, gain: 0.26, attack: 0.001, pan });
    noise(kit, { when, duration: 0.03, gain: 0.22, filter: 'bandpass', from: 2400, q: 1.5, pan });
  },

  crate(kit, { when, pan = 0, intensity = 1, detune = 1 }) {
    const power = Math.min(1.6, 0.85 + intensity * 0.15);
    noise(kit, { when: when + 0.012, duration: 0.24, gain: 0.62 * power, filter: 'bandpass', from: 1300 * detune, to: 520, q: 2.2, pan });
    for (let i = 0; i < 3; i++) {
      tone(kit, {
        wave: 'triangle',
        from: (300 + Math.random() * 280) * detune,
        to: 130,
        when: when + 0.015 + i * 0.038 + Math.random() * 0.012,
        duration: 0.07,
        gain: 0.28 * power,
        attack: 0.001,
        pan,
      });
    }
  },

  pickup(kit, { when, pan = 0, kind = 'bomb' }) {
    if (kind === 'speed') {
      tone(kit, { wave: 'sawtooth', from: 420, to: 1700, when, duration: 0.16, gain: 0.26, lowpass: 3200, pan });
      tone(kit, { wave: 'pulse', from: midiToFrequency(88), when: when + 0.12, duration: 0.2, gain: 0.24, lowpass: 6000, pan });
      tone(kit, { wave: 'sine', from: midiToFrequency(100), when: when + 0.16, duration: 0.3, gain: 0.1, pan });
      return;
    }
    const notes = kind === 'bomb' ? [76, 80, 83, 88] : [74, 79, 83, 86];
    notes.forEach((note, index) => {
      tone(kit, {
        wave: 'pulse',
        from: midiToFrequency(note),
        when: when + index * 0.05,
        duration: index === notes.length - 1 ? 0.22 : 0.1,
        gain: 0.26,
        attack: 0.002,
        lowpass: 5200,
        pan,
      });
    });
    tone(kit, { wave: 'sine', from: midiToFrequency(notes[notes.length - 1] + 12), when: when + 0.18, duration: 0.3, gain: 0.1, pan });
  },

  death(kit, { when, pan = 0 }) {
    noise(kit, { when, duration: 0.38, gain: 0.45, filter: 'lowpass', from: 1600, to: 260, pan });
    tone(kit, {
      wave: 'sawtooth',
      from: 680,
      to: 140,
      when: when + 0.02,
      duration: 0.6,
      gain: 0.3,
      attack: 0.01,
      lowpass: 1900,
      vibrato: { rate: 11, depth: 22 },
      pan,
    });
    tone(kit, { wave: 'sine', from: 520, to: 760, when: when + 0.45, duration: 0.75, gain: 0.16, attack: 0.18, vibrato: { rate: 5.5, depth: 14 }, pan });
  },

  round(kit, { when }) {
    noise(kit, { when, duration: 0.55, gain: 0.14, attack: 0.35, filter: 'bandpass', from: 350, to: 2800, q: 1.4 });
    [72, 79].forEach((note, index) => {
      tone(kit, { wave: 'triangle', from: midiToFrequency(note), when: when + 0.3 + index * 0.15, duration: 0.32, gain: 0.3 });
    });
  },

  go(kit, { when }) {
    for (const note of [72, 76, 79, 84]) {
      tone(kit, { wave: 'pulse', from: midiToFrequency(note), when, duration: 0.5, gain: 0.11, lowpass: 3800 });
    }
    tone(kit, { wave: 'triangle', from: midiToFrequency(48), when, duration: 0.5, gain: 0.32 });
    noise(kit, { when, duration: 0.28, gain: 0.14, filter: 'highpass', from: 3500 });
  },

  win(kit, { when }) {
    const melody: [number, number, number][] = [
      [72, 0, 0.12],
      [76, 0.11, 0.12],
      [79, 0.22, 0.12],
      [84, 0.34, 0.6],
    ];
    for (const [note, offset, length] of melody) {
      tone(kit, { wave: 'pulse', from: midiToFrequency(note), when: when + offset, duration: length, gain: 0.16, lowpass: 4500 });
    }
    tone(kit, { wave: 'triangle', from: midiToFrequency(48), when: when + 0.34, duration: 0.6, gain: 0.26 });
    tone(kit, { wave: 'triangle', from: midiToFrequency(76), when: when + 0.34, duration: 0.6, gain: 0.1 });
  },

  champion(kit, { when }) {
    const melody: [number, number, number][] = [
      [67, 0, 0.1],
      [72, 0.1, 0.1],
      [76, 0.2, 0.1],
      [79, 0.3, 0.2],
      [76, 0.5, 0.1],
      [79, 0.6, 0.1],
      [84, 0.72, 0.9],
    ];
    for (const [note, offset, length] of melody) {
      tone(kit, { wave: 'pulse', from: midiToFrequency(note), when: when + offset, duration: length, gain: 0.16, lowpass: 4500 });
    }
    for (const note of [48, 55, 64]) {
      tone(kit, { wave: 'triangle', from: midiToFrequency(note), when: when + 0.72, duration: 0.9, gain: 0.16 });
    }
    noise(kit, { when: when + 0.72, duration: 0.6, gain: 0.08, filter: 'highpass', from: 6000 });
  },

  draw(kit, { when }) {
    tone(kit, { wave: 'triangle', from: midiToFrequency(67), when, duration: 0.2, gain: 0.28 });
    tone(kit, { wave: 'triangle', from: midiToFrequency(63), when: when + 0.22, duration: 0.2, gain: 0.28 });
    tone(kit, {
      wave: 'triangle',
      from: midiToFrequency(60),
      to: midiToFrequency(59),
      when: when + 0.44,
      duration: 0.6,
      gain: 0.28,
      vibrato: { rate: 6, depth: 6 },
    });
  },

  confirm(kit, { when }) {
    tone(kit, { wave: 'pulse', from: midiToFrequency(84), when, duration: 0.07, gain: 0.24, lowpass: 5000 });
    tone(kit, { wave: 'pulse', from: midiToFrequency(91), when: when + 0.06, duration: 0.1, gain: 0.24, lowpass: 5000 });
  },

  tick(kit, { when, intensity = 1 }) {
    const last = intensity >= 2;
    tone(kit, { wave: 'pulse', from: midiToFrequency(last ? 84 : 76), when, duration: last ? 0.2 : 0.09, gain: 0.22, lowpass: 5000 });
    tone(kit, { wave: 'sine', from: midiToFrequency(last ? 96 : 88), when, duration: last ? 0.25 : 0.1, gain: 0.08 });
  },

  pause(kit, { when }) {
    tone(kit, { wave: 'pulse', from: midiToFrequency(79), when, duration: 0.08, gain: 0.24, lowpass: 4000 });
    tone(kit, { wave: 'pulse', from: midiToFrequency(72), when: when + 0.07, duration: 0.12, gain: 0.24, lowpass: 4000 });
  },
};
