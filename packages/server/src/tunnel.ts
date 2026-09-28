import { existsSync } from 'node:fs';
import { Tunnel, bin, install } from 'cloudflared';

export interface PublicTunnel {
  url: string;
  stop: () => void;
}

export async function openTunnel(target: string, timeoutMs = 45_000): Promise<PublicTunnel> {
  if (!existsSync(bin)) await install(bin);
  const tunnel = Tunnel.quick(target);
  const url = await new Promise<string>((resolve, reject) => {
    let address: string | null = null;
    const timer = setTimeout(() => {
      tunnel.stop();
      reject(new Error('o túnel não respondeu a tempo'));
    }, timeoutMs);
    const done = (value: string) => {
      clearTimeout(timer);
      resolve(value);
    };
    tunnel.once('url', (value) => {
      address = value;
    });
    tunnel.once('connected', () => {
      if (address) done(address);
      else tunnel.once('url', done);
    });
    tunnel.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    tunnel.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`cloudflared encerrou com código ${code}`));
    });
  });
  return { url, stop: () => void tunnel.stop() };
}
