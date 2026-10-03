export interface Channel {
  readonly open: boolean;
  readonly buffered: number;
  send(data: string): void;
  close(): void;
  onOpen(listener: () => void): void;
  onMessage(listener: (data: string) => void): void;
  onClose(listener: (reason: string | null) => void): void;
}

export class BaseChannel implements Channel {
  private readonly openListeners: (() => void)[] = [];
  private readonly messageListeners: ((data: string) => void)[] = [];
  private readonly closeListeners: ((reason: string | null) => void)[] = [];
  private readonly pending: string[] = [];
  private isOpen = false;
  private closed = false;
  private closeReason: string | null = null;

  constructor(
    private readonly transmit: (data: string) => void,
    private readonly measure: () => number = () => 0,
    private readonly shutdown: () => void = () => undefined,
  ) {}

  get open(): boolean {
    return this.isOpen && !this.closed;
  }

  get buffered(): number {
    return this.measure();
  }

  send(data: string): void {
    if (this.open) this.transmit(data);
  }

  close(): void {
    if (this.closed) return;
    this.shutdown();
    this.finish(null);
  }

  onOpen(listener: () => void): void {
    if (this.open) listener();
    else this.openListeners.push(listener);
  }

  onMessage(listener: (data: string) => void): void {
    this.messageListeners.push(listener);
    while (this.pending.length > 0) listener(this.pending.shift() as string);
  }

  onClose(listener: (reason: string | null) => void): void {
    if (this.closed) listener(this.closeReason);
    else this.closeListeners.push(listener);
  }

  markOpen(): void {
    if (this.isOpen || this.closed) return;
    this.isOpen = true;
    for (const listener of this.openListeners.splice(0)) listener();
  }

  deliver(data: string): void {
    if (this.closed) return;
    if (this.messageListeners.length === 0) this.pending.push(data);
    else for (const listener of this.messageListeners) listener(data);
  }

  finish(reason: string | null): void {
    if (this.closed) return;
    this.closed = true;
    this.closeReason = reason;
    for (const listener of this.closeListeners.splice(0)) listener(reason);
  }
}

export function localPair(): [BaseChannel, BaseChannel] {
  let left: BaseChannel | null = null;
  let right: BaseChannel | null = null;
  left = new BaseChannel(
    (data) => queueMicrotask(() => right?.deliver(data)),
    () => 0,
    () => right?.finish(null),
  );
  right = new BaseChannel(
    (data) => queueMicrotask(() => left?.deliver(data)),
    () => 0,
    () => left?.finish(null),
  );
  left.markOpen();
  right.markOpen();
  return [left, right];
}

export function signalingUrl(): string {
  const configured = import.meta.env.VITE_SERVER_URL;
  if (typeof configured === 'string' && configured) return configured;
  return `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`;
}
