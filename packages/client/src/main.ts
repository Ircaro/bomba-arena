import '@fontsource-variable/fredoka';
import './style.css';
import {
  BASE_BOMBS,
  BASE_RANGE,
  BASE_SPEED,
  EventTracker,
  MAX_ROOM_PLAYERS,
  NAME_MAX_LENGTH,
  PLAYER_COLOR_COUNT,
  TICK_RATE,
  WINS_TO_FINISH,
  createGame,
  createMatch,
  isRoomCode,
  normalizeRoomCode,
  randomSeed,
  startNextRound,
  stepMatch,
  type GameEvent,
  type GameState,
  type LobbyPlayer,
  type MatchState,
  type PlayerInput,
  type PlayerSetup,
} from '@bomba/shared';
import type { Expression } from './character';
import { Hud, createPingPill, updatePingPill, type HudView } from './hud';
import { BINDINGS, Keyboard, SOLO_BINDING } from './input';
import { OnlineClient, type FailureCode, type Position } from './online';
import { Portrait } from './portrait';
import { Renderer, type Banner } from './renderer';
import { SoundEngine } from './sound';
import { paletteFor } from './theme';

type Mode = 'local' | 'online';
type Screen = 'intro' | 'countdown' | 'playing' | 'paused' | 'roundOver' | 'connecting' | 'lobby' | 'failure';
type Face = { portrait: Portrait; expression: Expression };

const LOCAL_PLAYERS: PlayerSetup[] = [
  { id: 'p1', name: 'Jogador 1' },
  { id: 'p2', name: 'Jogador 2' },
];
const STEP_MS = 1000 / TICK_RATE;
const OVERLAY_GRACE_MS = 600;
const LOCAL_COUNTDOWN_MS = 1300;
const GO_BANNER_MS = 800;
const PREVIEW_SEED = 20260928;
const CONFIRM_KEYS = new Set(['Enter', 'NumpadEnter', 'Space']);
const FAILURE_TITLES: Record<FailureCode, string> = {
  'room-not-found': 'Sala não encontrada',
  'room-full': 'Sala cheia',
  'server-full': 'Servidor cheio',
  'too-many-attempts': 'Calma aí',
  unreachable: 'Sem conexão',
  lost: 'Conexão perdida',
};

function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Elemento #${id} não encontrado`);
  return element as T;
}

const overlay = byId('overlay');
const overlayPortraits = byId('overlay-portraits');
const overlayTitle = byId('overlay-title');
const overlayText = byId('overlay-text');
const overlayExtra = byId('overlay-extra');
const overlayCountdown = byId('overlay-countdown');
const overlayActions = byId('overlay-actions');
const overlayHint = byId('overlay-hint');
const soundButton = byId<HTMLButtonElement>('toggle-sound');
const musicButton = byId<HTMLButtonElement>('toggle-music');

const localKeyboard = new Keyboard(BINDINGS);
const soloKeyboard = new Keyboard([SOLO_BINDING]);
const localMatch = createMatch(LOCAL_PLAYERS, randomSeed());
const renderer = new Renderer(byId<HTMLCanvasElement>('board'), localMatch.game.width, localMatch.game.height);
const hud = new Hud(byId('hud'), byId('round'));
const tracker = new EventTracker();
const sound = new SoundEngine();
const previous = new Map<string, Position>();
const overlayFaces: Face[] = [];
const swatchFaces: Face[] = [];

let mode: Mode = 'local';
let online: OnlineClient | null = null;
let preview: { key: string; game: GameState } | null = null;
let screen: Screen = 'intro';
let screenSince = performance.now();
let banner: Banner | null = null;
let goAt: number | null = null;
let failure = { title: '', text: '' };
let lobbyRoom: string | null = null;
let accumulator = 0;
let countdownSecond: number | null = null;

function isFormTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLButtonElement || target instanceof HTMLInputElement;
}

function activeMatch(): MatchState | null {
  return mode === 'local' ? localMatch : online?.match ?? null;
}

function lobbyPreview(): GameState {
  const setups = (online?.players ?? []).map((player) => ({ id: player.id, name: player.name, color: player.color }));
  const key = setups.map((setup) => `${setup.id}:${setup.color}:${setup.name}`).join(',');
  if (!preview || preview.key !== key) {
    const game = createGame(setups.length > 0 ? setups : [{ id: 'preview', name: '' }], PREVIEW_SEED);
    if (setups.length === 0) game.players = [];
    preview = { key, game };
  }
  return preview.game;
}

function activeGame(): GameState {
  if (mode === 'local') return localMatch.game;
  return online?.match?.game ?? lobbyPreview();
}

function colorOf(id: string | null): number {
  return activeGame().players.find((player) => player.id === id)?.color ?? 0;
}

function nameOf(id: string | null): string {
  return activeMatch()?.players.find((player) => player.id === id)?.name ?? '';
}

function setScreen(next: Screen, now = performance.now()): void {
  document.body.dataset.mode = mode;
  screen = next;
  screenSince = now;
  renderOverlay();
}

function showPortraits(entries: { color: number; expression: Expression }[]): void {
  overlayPortraits.replaceChildren();
  overlayFaces.length = 0;
  for (const entry of entries) {
    const portrait = new Portrait(entry.color, 84);
    overlayPortraits.append(portrait.element);
    overlayFaces.push({ portrait, expression: entry.expression });
  }
}

function setOverlay(title: string, text: string | Node, hint: string, portraits: { color: number; expression: Expression }[] = []): void {
  overlayTitle.textContent = title;
  if (typeof text === 'string') overlayText.textContent = text;
  else overlayText.replaceChildren(text);
  overlayHint.textContent = hint;
  showPortraits(portraits);
}

function addAction(label: string, action: () => void, primary: boolean): void {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = primary ? 'button primary' : 'button secondary';
  button.textContent = label;
  button.addEventListener('click', () => {
    sound.unlock();
    button.blur();
    action();
  });
  overlayActions.append(button);
}

function badge(text: string, className = 'badge'): HTMLElement {
  const element = document.createElement('span');
  element.className = className;
  element.textContent = text;
  return element;
}

function scoreline(match: MatchState): HTMLElement {
  const line = document.createElement('span');
  line.className = match.players.length > 2 ? 'scoreline many' : 'scoreline';
  match.players.forEach((player, index) => {
    if (index > 0 && match.players.length === 2) line.append(badge('×', 'versus'));
    const entry = document.createElement('span');
    entry.className = 'score-entry';
    entry.style.setProperty('--player', paletteFor(colorOf(player.id)).base);
    const name = badge(player.name, 'score-name');
    const value = document.createElement('b');
    value.textContent = String(match.wins[player.id] ?? 0);
    if (match.players.length === 2 && index === 1) entry.append(value, name);
    else entry.append(name, value);
    line.append(entry);
  });
  return line;
}

function inviteLink(): string {
  const base = (online?.publicUrl ?? location.origin).replace(/\/$/, '');
  return `${base}/?sala=${online?.room ?? ''}`;
}

function readyPill(ready: boolean): HTMLElement {
  const pill = badge(ready ? 'pronto' : 'esperando', 'ready-pill');
  pill.dataset.ready = String(ready);
  return pill;
}

function playerRow(player: LobbyPlayer, withPing: boolean): HTMLElement {
  const row = document.createElement('li');
  row.style.setProperty('--player', paletteFor(player.color).base);
  const dot = badge('', 'dot');
  const name = badge(player.name, 'roster-name');
  row.append(dot, name);
  if (player.id === online?.you) row.append(badge('você'));
  if (player.id === online?.host) row.append(badge('anfitrião'));
  const right = document.createElement('span');
  right.className = 'row-end';
  right.append(readyPill(player.ready));
  if (withPing) {
    const ping = createPingPill();
    updatePingPill(ping.root, ping.value, online?.pings[player.id] ?? player.ping);
    right.append(ping.root);
  }
  row.append(right);
  return row;
}

function buildLobby(): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'lobby';

  const inviteRow = document.createElement('div');
  inviteRow.className = 'invite-row';
  const input = document.createElement('input');
  input.id = 'invite-link';
  input.readOnly = true;
  input.value = inviteLink();
  input.setAttribute('aria-label', 'Link de convite');
  input.addEventListener('focus', () => input.select());
  const copy = document.createElement('button');
  copy.type = 'button';
  copy.className = 'button secondary';
  copy.textContent = 'Copiar';
  copy.addEventListener('click', () => {
    copy.blur();
    const selectLink = () => {
      input.focus();
      input.select();
    };
    if (!navigator.clipboard) {
      selectLink();
      return;
    }
    navigator.clipboard.writeText(input.value).then(() => {
      copy.textContent = 'Copiado!';
      window.setTimeout(() => (copy.textContent = 'Copiar'), 1600);
    }, selectLink);
  });
  inviteRow.append(input, copy);
  const note = document.createElement('p');
  note.id = 'invite-note';
  note.className = 'invite-note';

  const profile = document.createElement('div');
  profile.className = 'profile';
  const field = document.createElement('label');
  field.className = 'field';
  const label = badge('Seu nome', 'field-label');
  const nameInput = document.createElement('input');
  nameInput.id = 'profile-name';
  nameInput.maxLength = NAME_MAX_LENGTH;
  nameInput.autocomplete = 'off';
  nameInput.spellcheck = false;
  nameInput.value = online?.me?.name ?? '';
  const commitName = () => {
    const value = nameInput.value.trim();
    if (value && value !== online?.me?.name) online?.setProfile({ name: value });
  };
  nameInput.addEventListener('change', commitName);
  nameInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') nameInput.blur();
  });
  field.append(label, nameInput);

  const swatches = document.createElement('div');
  swatches.className = 'swatches';
  swatches.setAttribute('role', 'radiogroup');
  swatches.setAttribute('aria-label', 'Sua cor');
  swatchFaces.length = 0;
  for (let color = 0; color < PLAYER_COLOR_COUNT; color++) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'swatch';
    button.dataset.color = String(color);
    button.setAttribute('role', 'radio');
    button.style.setProperty('--player', paletteFor(color).base);
    const portrait = new Portrait(color, 40);
    swatchFaces.push({ portrait, expression: 'normal' });
    button.append(portrait.element, badge(paletteFor(color).label, 'swatch-label'));
    button.addEventListener('click', () => {
      button.blur();
      online?.setProfile({ color });
    });
    swatches.append(button);
  }
  profile.append(field, swatches);

  const roster = document.createElement('ul');
  roster.id = 'roster';
  roster.className = 'roster';
  wrapper.append(inviteRow, note, profile, roster);
  return wrapper;
}

function refreshLobby(): void {
  const client = online;
  if (!client) return;
  const input = document.getElementById('invite-link');
  if (input instanceof HTMLInputElement && document.activeElement !== input) {
    const link = inviteLink();
    if (input.value !== link) input.value = link;
  }
  const note = document.getElementById('invite-note');
  if (note) {
    const localOnly = !client.publicUrl && ['localhost', '127.0.0.1'].includes(location.hostname);
    note.textContent = localOnly
      ? 'Este link só abre neste computador. Para convidar alguém, inicie com "npm run rede" (Radmin VPN ou mesmo Wi-Fi) ou "npm run online".'
      : client.inviteHint ?? '';
  }
  const nameInput = document.getElementById('profile-name');
  if (nameInput instanceof HTMLInputElement && document.activeElement !== nameInput) {
    const current = client.me?.name ?? '';
    if (nameInput.value !== current) nameInput.value = current;
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>('.swatch')) {
    const color = Number(button.dataset.color);
    const owner = client.players.find((player) => player.color === color);
    const mine = owner?.id === client.you;
    button.setAttribute('aria-checked', String(mine));
    button.disabled = !!owner && !mine;
    button.title = owner && !mine ? `Escolhida por ${owner.name}` : paletteFor(color).label;
  }
  const roster = document.getElementById('roster');
  if (!roster) return;
  const rows = client.players.map((player) => playerRow(player, true));
  for (let index = client.players.length; index < MAX_ROOM_PLAYERS; index++) {
    const empty = document.createElement('li');
    empty.className = 'empty';
    empty.textContent = 'Vaga livre';
    rows.push(empty);
  }
  roster.replaceChildren(...rows);
}

function readyHint(): string {
  const client = online;
  if (!client) return '';
  if (client.startsAt !== null) return '';
  if (client.players.length < 2) return 'Esperando alguém entrar pelo link…';
  if (client.me?.ready) return 'Esperando os outros ficarem prontos';
  return 'Enter ou Espaço para ficar pronto';
}

function addReadyAction(): void {
  const client = online;
  if (!client) return;
  const ready = client.me?.ready ?? false;
  addAction(ready ? 'Não estou pronto' : 'Estou pronto', () => toggleReady(), !ready);
}

function toggleReady(): void {
  const client = online;
  if (!client || (screen !== 'lobby' && screen !== 'roundOver')) return;
  const ready = !(client.me?.ready ?? false);
  client.setReady(ready);
  sound.play(ready ? 'confirm' : 'pause');
}

function renderOverlay(): void {
  const spectating =
    mode === 'online' && (screen === 'countdown' || screen === 'playing') && !!online?.match && !online.inCurrentMatch;
  overlay.hidden = (screen === 'playing' || screen === 'countdown') && !spectating;
  overlay.dataset.screen = spectating ? 'spectate' : screen;
  overlay.classList.toggle('spectate', spectating);
  if (screen !== 'lobby') {
    overlayExtra.replaceChildren();
    swatchFaces.length = 0;
    lobbyRoom = null;
  }
  overlayActions.replaceChildren();
  updateStartCountdown(performance.now());
  if (spectating) {
    setOverlay('Partida em andamento', 'Você entra na próxima partida. Assista enquanto isso!', '');
    return;
  }
  switch (screen) {
    case 'intro':
      setOverlay(
        'Bomba Arena',
        `Exploda caixas, pegue power-ups e derrube o adversário. Vence a partida quem ganhar ${WINS_TO_FINISH} rodadas.`,
        'Enter para jogar no mesmo teclado',
        LOCAL_PLAYERS.map((_, color) => ({ color, expression: 'normal' })),
      );
      addAction('Mesmo teclado', () => startLocal(performance.now()), true);
      addAction('Jogar online', () => goOnline(null), false);
      break;
    case 'paused':
      setOverlay('Pausado', 'A partida está congelada.', 'Esc para continuar');
      break;
    case 'roundOver':
      renderRoundOver();
      break;
    case 'connecting':
      setOverlay('Conectando…', online?.room ? `Entrando na sala ${online.room}` : 'Preparando sua sala', '');
      break;
    case 'lobby':
      renderLobby();
      break;
    case 'failure':
      setOverlay(failure.title, failure.text, '');
      addAction('Voltar ao início', () => (location.href = location.pathname), true);
      break;
    default:
      break;
  }
}

function renderRoundOver(): void {
  const match = activeMatch();
  if (!match) return;
  const winner = match.game.winner;
  const next = match.champion ? 'jogar de novo' : 'a próxima rodada';
  const hint = mode === 'online' ? readyHint() : `Enter ou Espaço para ${next}`;
  if (match.champion) {
    setOverlay(`${nameOf(match.champion)} venceu a partida!`, scoreline(match), hint, [
      { color: colorOf(match.champion), expression: 'happy' },
    ]);
  } else if (winner) {
    setOverlay(`${nameOf(winner)} venceu a rodada`, scoreline(match), hint, [{ color: colorOf(winner), expression: 'happy' }]);
  } else {
    setOverlay(
      'Empate!',
      scoreline(match),
      hint,
      match.players.map((player) => ({ color: colorOf(player.id), expression: 'dead' as Expression })),
    );
  }
  if (mode === 'local') {
    addAction(match.champion ? 'Jogar de novo' : 'Próxima rodada', () => advanceLocal(performance.now()), true);
    return;
  }
  const list = document.createElement('ul');
  list.className = 'roster compact';
  list.append(...(online?.players ?? []).map((player) => playerRow(player, false)));
  overlayExtra.replaceChildren(list);
  addReadyAction();
}

function renderLobby(): void {
  const client = online;
  if (!client) return;
  const code = client.room ?? '';
  const text = client.isHost
    ? 'Mande o link para quem vai jogar com você. Quando todos marcarem que estão prontos, a partida começa em 5 segundos.'
    : 'Escolha seu nome e sua cor. Quando todos marcarem que estão prontos, a partida começa em 5 segundos.';
  setOverlay(`Sala ${code}`, text, readyHint());
  if (lobbyRoom !== code) {
    overlayExtra.replaceChildren(buildLobby());
    lobbyRoom = code;
  }
  refreshLobby();
  addReadyAction();
}

function updateStartCountdown(now: number): void {
  const startsAt = mode === 'online' && (screen === 'lobby' || screen === 'roundOver') ? online?.startsAt ?? null : null;
  if (startsAt === null) {
    overlayCountdown.hidden = true;
    countdownSecond = null;
    return;
  }
  const seconds = Math.max(1, Math.ceil((startsAt - now) / 1000));
  if (seconds !== countdownSecond) {
    const nextRound = screen === 'roundOver' && online?.match && !online.match.champion;
    overlayCountdown.replaceChildren(
      badge(nextRound ? 'Próxima rodada em' : 'A partida começa em', 'countdown-label'),
      badge(String(seconds), 'countdown-number'),
    );
    if (countdownSecond !== null || seconds <= 5) sound.play('tick', { intensity: seconds === 1 ? 2 : 1 });
    countdownSecond = seconds;
  }
  overlayCountdown.hidden = false;
}

function serverUrl(): string {
  const configured = import.meta.env.VITE_SERVER_URL;
  if (typeof configured === 'string' && configured) return configured;
  return `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`;
}

function goOnline(room: string | null): void {
  online?.close();
  mode = 'online';
  preview = null;
  goAt = null;
  banner = null;
  const client = new OnlineClient(serverUrl(), room, {
    lobby: () => onLobby(client),
    round: (countdownMs) => onRound(client, countdownMs),
    failure: (code, message) => onFailure(client, code, message),
  });
  online = client;
  setScreen('connecting');
}

function onLobby(client: OnlineClient): void {
  if (client !== online) return;
  if (client.room && new URLSearchParams(location.search).get('sala') !== client.room) {
    history.replaceState(null, '', `${location.pathname}?sala=${client.room}`);
  }
  if (client.status === 'lobby' && !client.match && screen !== 'lobby') setScreen('lobby');
  else if (screen === 'lobby' || screen === 'roundOver' || screen === 'connecting') renderOverlay();
}

function onRound(client: OnlineClient, countdownMs: number): void {
  if (client !== online) return;
  previous.clear();
  soloKeyboard.clearPendingBombs();
  if (countdownMs <= 0) {
    goAt = null;
    setScreen('playing');
    return;
  }
  const now = performance.now();
  renderer.beginEntrance(now);
  banner = {
    title: `Rodada ${client.match?.round ?? 1}`,
    subtitle: `Primeiro a ${client.match?.winsToFinish ?? WINS_TO_FINISH} vitórias`,
    start: now,
    duration: countdownMs,
  };
  goAt = now + countdownMs;
  sound.setMusic(false);
  sound.play('round');
  setScreen('countdown', now);
}

function onFailure(client: OnlineClient, code: FailureCode, message: string): void {
  if (client !== online) return;
  failure = { title: FAILURE_TITLES[code], text: message };
  goAt = null;
  sound.setMusic(false);
  setScreen('failure');
}

function syncAudioButtons(): void {
  soundButton.setAttribute('aria-pressed', String(sound.soundEnabled));
  musicButton.setAttribute('aria-pressed', String(sound.musicEnabled));
  musicButton.classList.toggle('inactive', !sound.soundEnabled);
}

function bindAudioButton(button: HTMLButtonElement, toggle: () => void): void {
  button.addEventListener('click', () => {
    sound.unlock();
    toggle();
    button.blur();
  });
}

function announceResult(events: readonly GameEvent[]): void {
  const match = activeMatch();
  for (const event of events) {
    if (event.type !== 'roundDecided') continue;
    sound.setMusic(false);
    if (!event.winner) {
      sound.play('draw');
      continue;
    }
    const champion = (match?.wins[event.winner] ?? 0) + 1 >= (match?.winsToFinish ?? WINS_TO_FINISH);
    sound.play(champion ? 'champion' : 'win');
  }
}

function startLocal(now: number): void {
  mode = 'local';
  previous.clear();
  localKeyboard.clearPendingBombs();
  renderer.beginEntrance(now);
  sound.setMusic(false);
  sound.play('round');
  banner = {
    title: `Rodada ${localMatch.round}`,
    subtitle: `Primeiro a ${localMatch.winsToFinish} vitórias`,
    start: now,
    duration: LOCAL_COUNTDOWN_MS,
  };
  setScreen('countdown', now);
}

function advanceLocal(now: number): void {
  startNextRound(localMatch);
  startLocal(now);
}

function go(now: number): void {
  localKeyboard.clearPendingBombs();
  soloKeyboard.clearPendingBombs();
  banner = { title: 'Valendo!', start: now, duration: GO_BANNER_MS };
  accumulator = 0;
  sound.play('go');
  sound.setMusic(true, true);
  setScreen('playing', now);
}

function handleLocalKey(event: KeyboardEvent, now: number): void {
  if (event.code === 'Escape') {
    if (screen === 'playing') {
      sound.play('pause');
      sound.setMusic(false);
      setScreen('paused', now);
    } else if (screen === 'paused') {
      localKeyboard.clearPendingBombs();
      sound.play('confirm');
      sound.setMusic(localMatch.game.phase === 'playing');
      setScreen('playing', now);
    }
    return;
  }
  if (!CONFIRM_KEYS.has(event.code) || now - screenSince < OVERLAY_GRACE_MS) return;
  if (screen === 'intro') startLocal(now);
  else if (screen === 'roundOver') advanceLocal(now);
}

function handleOnlineKey(event: KeyboardEvent, now: number): void {
  if (!CONFIRM_KEYS.has(event.code) || now - screenSince < OVERLAY_GRACE_MS) return;
  if (screen === 'lobby' || screen === 'roundOver') toggleReady();
}

window.addEventListener('keydown', (event) => {
  if (event.repeat) return;
  sound.unlock();
  if (isFormTarget(event.target) && (CONFIRM_KEYS.has(event.code) || event.code === 'KeyM')) return;
  const now = performance.now();
  if (event.code === 'KeyM') {
    sound.toggleSound();
    return;
  }
  if (mode === 'local') handleLocalKey(event, now);
  else handleOnlineKey(event, now);
});

window.addEventListener('pointerdown', () => sound.unlock());

document.addEventListener('visibilitychange', () => {
  if (!document.hidden || mode !== 'local' || screen !== 'playing') return;
  sound.setMusic(false);
  setScreen('paused');
});

bindAudioButton(soundButton, () => sound.toggleSound());
bindAudioButton(musicButton, () => sound.toggleMusic());
sound.onChange(syncAudioButtons);
syncAudioButtons();

function readLocalInputs(): Record<string, PlayerInput> {
  return Object.fromEntries(LOCAL_PLAYERS.map((player, slot) => [player.id, localKeyboard.read(slot)]));
}

function localPositions(alpha: number): Map<string, Position> {
  const positions = new Map<string, Position>();
  for (const player of localMatch.game.players) {
    const from = previous.get(player.id);
    positions.set(
      player.id,
      from ? { x: from.x + (player.x - from.x) * alpha, y: from.y + (player.y - from.y) * alpha } : { x: player.x, y: player.y },
    );
  }
  return positions;
}

function stepLocal(now: number, elapsed: number): Map<string, Position> {
  if (screen === 'countdown' && now - screenSince >= LOCAL_COUNTDOWN_MS) go(now);
  if (screen === 'playing') {
    accumulator += elapsed;
    while (accumulator >= STEP_MS) {
      for (const player of localMatch.game.players) previous.set(player.id, { x: player.x, y: player.y });
      stepMatch(localMatch, readLocalInputs());
      accumulator -= STEP_MS;
      if (localMatch.game.phase === 'ended') {
        accumulator = 0;
        setScreen('roundOver', now);
        break;
      }
    }
  } else {
    accumulator = 0;
  }
  return localPositions(screen === 'playing' ? accumulator / STEP_MS : 1);
}

function stepOnline(now: number): Map<string, Position> {
  const client = online;
  if (!client) return new Map();
  if (screen === 'countdown' && goAt !== null && now >= goAt) {
    goAt = null;
    go(now);
  }
  if (screen === 'playing' || screen === 'countdown') client.sendInput(soloKeyboard.read(0));
  const positions = client.frame(now);
  if (screen === 'playing' && client.match?.game.phase === 'ended') setScreen('roundOver', now);
  updateStartCountdown(now);
  return positions;
}

function hudView(game: GameState): HudView {
  const match = activeMatch();
  if (mode === 'online' && online && !online.match) {
    const client = online;
    return {
      chip: { strong: client.room ? `Sala ${client.room}` : 'Online', rest: `${client.players.length} de ${MAX_ROOM_PLAYERS} jogadores` },
      winsToFinish: WINS_TO_FINISH,
      players: client.players.map((player) => ({
        id: player.id,
        name: player.name,
        color: player.color,
        alive: true,
        maxBombs: BASE_BOMBS,
        range: BASE_RANGE,
        speed: BASE_SPEED,
        wins: 0,
        ping: client.pings[player.id] ?? player.ping,
        you: player.id === client.you,
      })),
      celebrating: false,
      showPing: true,
    };
  }
  const survivors = game.players.filter((player) => player.alive);
  const winsToFinish = match?.winsToFinish ?? WINS_TO_FINISH;
  return {
    chip: {
      strong: `Rodada ${match?.round ?? 1}`,
      rest: mode === 'online' && online?.room ? `sala ${online.room} · primeiro a ${winsToFinish}` : `primeiro a ${winsToFinish} vitórias`,
    },
    winsToFinish,
    players: game.players.map((player) => ({
      id: player.id,
      name: player.name,
      color: player.color,
      alive: player.alive,
      maxBombs: player.maxBombs,
      range: player.range,
      speed: player.speed,
      wins: match?.wins[player.id] ?? 0,
      ping: mode === 'online' ? online?.pings[player.id] ?? null : null,
      you: mode === 'online' && player.id === online?.you,
    })),
    celebrating: game.phase !== 'playing' && game.players.length > 1 && survivors.length === 1,
    showPing: mode === 'online',
  };
}

let last = performance.now();

function frame(now: number): void {
  requestAnimationFrame(frame);
  const elapsed = Math.min(now - last, 250);
  last = now;
  const positions = mode === 'local' ? stepLocal(now, elapsed) : stepOnline(now);
  if (banner && now - banner.start > banner.duration) banner = null;
  const game = activeGame();
  const events = tracker.update(game);
  announceResult(events);
  sound.handle(events, game);
  sound.setFuse(screen === 'playing' ? game.bombs.length : 0);
  renderer.draw(game, { now, positions, banner, events });
  hud.update(hudView(game), now);
  if (!overlay.hidden) {
    for (const face of overlayFaces) face.portrait.draw(now, face.expression);
    for (const face of swatchFaces) face.portrait.draw(now, face.expression);
  }
}

if (import.meta.env.DEV) {
  Object.assign(window, {
    __bomba: {
      match: localMatch,
      renderer,
      sound,
      get online() {
        return online;
      },
    },
  });
}

const requestedRoom = new URLSearchParams(location.search).get('sala');
if (requestedRoom !== null) {
  const code = normalizeRoomCode(requestedRoom);
  if (isRoomCode(code)) goOnline(code);
  else {
    mode = 'online';
    failure = { title: 'Link inválido', text: 'Esse link de sala não parece certo. Peça um novo para quem te convidou.' };
    setScreen('failure');
  }
} else {
  renderOverlay();
}
requestAnimationFrame(frame);
