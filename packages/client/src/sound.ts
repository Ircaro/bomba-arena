import type { GameEvent, GameState } from '@bomba/shared';
import { MusicLoop } from './music';
import { VOICES, createKit, type AudioKit, type SfxName, type VoiceOptions } from './sfx';

interface Preferences {
  sound: boolean;
  music: boolean;
}

const STORAGE_KEY = 'bomba-arena:audio';
const MASTER_LEVEL = 0.8;
const MUSIC_LEVEL = 0.32;
const FUSE_PER_BOMB = 0.016;
const FUSE_MAX = 0.045;
const MIN_GAP: Partial<Record<SfxName, number>> = {
  place: 0.03,
  pickup: 0.04,
  explosion: 0.05,
  crate: 0.05,
  death: 0.08,
};

export function softClipCurve(): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(2048);
  const knee = 0.75;
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1;
    const magnitude = Math.abs(x);
    const shaped = magnitude < knee ? magnitude : knee + (1 - knee) * Math.tanh((magnitude - knee) / (1 - knee));
    curve[i] = Math.sign(x) * shaped;
  }
  return curve;
}

function loadPreferences(): Preferences {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<Preferences>;
    return { sound: stored.sound !== false, music: stored.music !== false };
  } catch {
    return { sound: true, music: true };
  }
}

function savePreferences(preferences: Preferences): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    return;
  }
}

export class SoundEngine {
  private context: AudioContext | null = null;
  private kit: AudioKit | null = null;
  private master: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private fuseLevel: GainNode | null = null;
  private loop: MusicLoop | null = null;
  private musicActive = false;
  private fuseBombs = -1;
  private readonly preferences = loadPreferences();
  private readonly lastPlayed = new Map<SfxName, number>();
  private readonly listeners = new Set<() => void>();

  get soundEnabled(): boolean {
    return this.preferences.sound;
  }

  get musicEnabled(): boolean {
    return this.preferences.music;
  }

  onChange(listener: () => void): void {
    this.listeners.add(listener);
  }

  unlock(): void {
    if (!this.context) this.build();
    if (this.context?.state === 'suspended') void this.context.resume().catch(() => undefined);
  }

  toggleSound(): void {
    this.preferences.sound = !this.preferences.sound;
    this.commit();
  }

  toggleMusic(): void {
    this.preferences.music = !this.preferences.music;
    this.commit();
  }

  setMusic(active: boolean, fromTop = false): void {
    this.musicActive = active;
    this.refreshMusic(fromTop);
  }

  setFuse(bombs: number): void {
    if (!this.context || !this.fuseLevel || bombs === this.fuseBombs) return;
    this.fuseBombs = bombs;
    const target = this.preferences.sound ? Math.min(FUSE_MAX, bombs * FUSE_PER_BOMB) : 0;
    this.fuseLevel.gain.setTargetAtTime(target, this.context.currentTime, 0.08);
  }

  play(name: SfxName, options: Omit<VoiceOptions, 'when'> = {}): void {
    if (!this.context || !this.kit || !this.preferences.sound || this.context.state === 'closed') return;
    const now = this.context.currentTime;
    if (now - (this.lastPlayed.get(name) ?? -Infinity) < (MIN_GAP[name] ?? 0.06)) return;
    this.lastPlayed.set(name, now);
    VOICES[name](this.kit, { detune: 0.93 + Math.random() * 0.14, ...options, when: now + 0.01 });
  }

  handle(events: readonly GameEvent[], state: GameState): void {
    if (events.length === 0) return;
    const pan = (worldX: number) => (worldX / state.width) * 1.4 - 0.7;
    let blasts = 0;
    let blastX = 0;
    let crates = 0;
    let crateX = 0;
    for (const event of events) {
      switch (event.type) {
        case 'bombExploded':
          blasts++;
          blastX += event.x + 0.5;
          break;
        case 'blockDestroyed':
          crates++;
          crateX += event.x + 0.5;
          break;
        case 'bombPlaced':
          this.play('place', { pan: pan(event.x + 0.5) });
          break;
        case 'powerUpCollected':
          this.play('pickup', { pan: pan(event.x + 0.5), kind: event.kind });
          break;
        case 'playerDied':
          this.play('death', { pan: pan(event.x) });
          break;
        default:
          break;
      }
    }
    if (blasts > 0) this.play('explosion', { pan: pan(blastX / blasts), intensity: blasts });
    if (crates > 0) this.play('crate', { pan: pan(crateX / crates), intensity: crates });
  }

  private commit(): void {
    savePreferences(this.preferences);
    if (this.context && this.master) {
      this.master.gain.setTargetAtTime(this.preferences.sound ? MASTER_LEVEL : 0, this.context.currentTime, 0.03);
    }
    this.refreshMusic(false);
    this.fuseBombs = -1;
    for (const listener of this.listeners) listener();
  }

  private refreshMusic(fromTop: boolean): void {
    if (!this.context || !this.loop || !this.musicBus) return;
    const audible = this.musicActive && this.preferences.music && this.preferences.sound;
    this.musicBus.gain.setTargetAtTime(audible ? MUSIC_LEVEL : 0, this.context.currentTime, audible ? 0.05 : 0.12);
    if (audible) this.loop.start(fromTop);
    else this.loop.stop();
  }

  private build(): void {
    if (typeof AudioContext === 'undefined') return;
    const context = new AudioContext({ latencyHint: 'interactive' });
    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -14;
    compressor.knee.value = 10;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.2;
    const limiter = context.createWaveShaper();
    limiter.curve = softClipCurve();
    limiter.oversample = '2x';
    compressor.connect(limiter);
    limiter.connect(context.destination);
    const master = context.createGain();
    master.gain.value = this.preferences.sound ? MASTER_LEVEL : 0;
    master.connect(compressor);
    const sfxBus = context.createGain();
    sfxBus.connect(master);
    const musicBus = context.createGain();
    musicBus.gain.value = 0;
    musicBus.connect(master);

    const kit = createKit(context, sfxBus);
    this.context = context;
    this.master = master;
    this.musicBus = musicBus;
    this.kit = kit;
    this.loop = new MusicLoop({ ...kit, destination: musicBus });
    this.fuseLevel = this.buildFuse(kit);
    this.refreshMusic(true);
  }

  private buildFuse(kit: AudioKit): GainNode {
    const { context } = kit;
    const source = context.createBufferSource();
    source.buffer = kit.noise;
    source.loop = true;
    const band = context.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 5200;
    band.Q.value = 0.9;
    const flutter = context.createGain();
    flutter.gain.value = 0.65;
    const lfo = context.createOscillator();
    lfo.frequency.value = 13;
    const depth = context.createGain();
    depth.gain.value = 0.35;
    lfo.connect(depth);
    depth.connect(flutter.gain);
    const level = context.createGain();
    level.gain.value = 0;
    source.connect(band);
    band.connect(flutter);
    flutter.connect(level);
    level.connect(kit.destination);
    source.start();
    lfo.start();
    return level;
  }
}
