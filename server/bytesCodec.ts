import dns from 'node:dns/promises';
import net from 'node:net';
import nacl from 'tweetnacl';
import { blake2b } from '@noble/hashes/blake2.js';
import { privateTargetsAllowed, targetAddressAllowed, targetHostAllowed, targetPortAllowed } from './security.ts';

export const MAX_FRAME_LENGTH = 16 * 1024 * 1024;
export const MAX_RECEIVE_BYTES = MAX_FRAME_LENGTH * 2 + 8;
export const MAX_QUEUED_FRAMES = 256;
const RECEIVE_HIGH_BYTES = MAX_FRAME_LENGTH;
const RECEIVE_LOW_BYTES = RECEIVE_HIGH_BYTES / 2;
const RECEIVE_HIGH_FRAMES = MAX_QUEUED_FRAMES / 2;
const RECEIVE_LOW_FRAMES = RECEIVE_HIGH_FRAMES / 2;
const MAX_BUFFERED_CHUNKS = 32_768;
export const KX_VERSION_LATEST = 1;
export const KX_PARAMS_DOMAIN = Buffer.from('rdkx-params', 'utf8');
const KX_SPLIT_DOMAIN = Buffer.from('rdkx-spl', 'utf8');

export interface KxTranscript {
  initiatorPk: Uint8Array;
  responderPk: Uint8Array;
  advertised: number;
  picked: number;
}

export function kxVersionFor(advertised: number): number {
  return Math.min(advertised >>> 0, KX_VERSION_LATEST);
}

/**
 * Encodes payload with hbb_common::BytesCodec 1..4 byte little-endian length prefix.
 * Low 2 bits store (header_len - 1), upper bits store payload byte length.
 */
export function encodeBytesFrame(data: Uint8Array): Buffer {
  const len = data.byteLength;
  if (len > MAX_FRAME_LENGTH) {
    throw new Error(`frame length ${len} exceeds MAX_FRAME_LENGTH`);
  }
  let head: Buffer;
  if (len <= 0x3f) {
    head = Buffer.allocUnsafe(1);
    head[0] = (len << 2) & 0xff;
  } else if (len <= 0x3fff) {
    head = Buffer.allocUnsafe(2);
    head.writeUInt16LE(((len << 2) | 0x1) & 0xffff, 0);
  } else if (len <= 0x3fffff) {
    head = Buffer.allocUnsafe(3);
    const h = ((len << 2) | 0x2) >>> 0;
    head.writeUInt16LE(h & 0xffff, 0);
    head[2] = (h >>> 16) & 0xff;
  } else {
    head = Buffer.allocUnsafe(4);
    head.writeUInt32LE(((len << 2) | 0x3) >>> 0, 0);
  }
  return Buffer.concat([head, Buffer.from(data.buffer, data.byteOffset, data.byteLength)]);
}

/**
 * Streaming decoder for hbb_common::BytesCodec frames.
 */
export class BytesFrameDecoder {
  private chunks: Array<Buffer | undefined> = [];
  private headIndex = 0;
  private headOffset = 0;
  private bufferedBytes = 0;

  get pendingBytes(): number { return this.bufferedBytes; }

  clear(): void {
    this.chunks = [];
    this.headIndex = this.headOffset = this.bufferedBytes = 0;
  }

  // Returning false from onFrame stops parsing this batch without discarding its
  // tail, so a slow consumer can backpressure even a batch of tiny frames.
  push(chunk: Buffer, onFrame?: (frame: Buffer) => boolean): Buffer[] {
    try {
      return this.decode(chunk, onFrame);
    } catch (error) {
      this.clear();
      throw error;
    }
  }

  private decode(chunk: Buffer, onFrame?: (frame: Buffer) => boolean): Buffer[] {
    if (chunk.length > 0) {
      if (this.bufferedBytes + chunk.length > MAX_RECEIVE_BYTES ||
          this.chunks.length - this.headIndex >= MAX_BUFFERED_CHUNKS) {
        throw new Error('RustDesk receive buffer limit exceeded');
      }
      this.chunks.push(chunk);
      this.bufferedBytes += chunk.length;
    }
    const frames: Buffer[] = [];
    while (this.bufferedBytes > 0) {
      const headLen = (this.chunks[this.headIndex]![this.headOffset] & 0x03) + 1;
      if (this.bufferedBytes < headLen) break;

      // A prefix spans at most four bytes, even when every byte arrived separately.
      let n = 0;
      let index = this.headIndex;
      let offset = this.headOffset;
      for (let i = 0; i < headLen; i++) {
        const part = this.chunks[index]!;
        n |= part[offset++] << (8 * i);
        if (offset === part.length) {
          index++;
          offset = 0;
        }
      }
      const payloadLen = n >>> 2;
      if (payloadLen > MAX_FRAME_LENGTH) {
        throw new Error(`frame overflow: ${payloadLen}`);
      }
      if (this.bufferedBytes < headLen + payloadLen) break;
      if (!onFrame && frames.length >= MAX_QUEUED_FRAMES) throw new Error('RustDesk frame batch limit exceeded');

      this.consume(headLen);
      const frame = Buffer.allocUnsafe(payloadLen);
      this.consume(payloadLen, frame);

      if (this.headIndex === this.chunks.length) {
        this.chunks = [];
        this.headIndex = 0;
      } else if (this.headIndex >= 1024 && this.headIndex * 2 >= this.chunks.length) {
        // Amortize queue compaction instead of moving the remaining chunks per frame.
        this.chunks = this.chunks.slice(this.headIndex);
        this.headIndex = 0;
      }
      if (onFrame) {
        if (!onFrame(frame)) break;
      } else frames.push(frame);
    }
    return frames;
  }

  private consume(length: number, target?: Buffer): void {
    let written = 0;
    while (written < length) {
      const part = this.chunks[this.headIndex]!;
      const take = Math.min(length - written, part.length - this.headOffset);
      if (target) part.copy(target, written, this.headOffset, this.headOffset + take);
      this.headOffset += take;
      written += take;
      if (this.headOffset === part.length) {
        // Drop the payload reference immediately; the sparse prefix holds no TCP buffers.
        this.chunks[this.headIndex++] = undefined;
        this.headOffset = 0;
      }
    }
    this.bufferedBytes -= length;
  }
}

function makeSeqNonce(seq: bigint): Uint8Array {
  const nonce = new Uint8Array(24);
  const view = new DataView(nonce.buffer);
  view.setBigUint64(0, seq, true);
  return nonce;
}

/**
 * Derives directional split keys for kx_version = 1 matching hbb_common::tcp::Encrypt::new_split:
 * BLAKE2b-256(key=sharedKey, "rdkx-spl" || dirByte || advertised_le32 || picked_le32 || initiatorPk || responderPk)
 */
export function deriveSplitKeys(
  key: Uint8Array,
  transcript: KxTranscript,
): { initiatorToResponder: Uint8Array; responderToInitiator: Uint8Array } {
  const meta = Buffer.alloc(8);
  meta.writeUInt32LE(transcript.advertised >>> 0, 0);
  meta.writeUInt32LE(transcript.picked >>> 0, 4);

  const derive = (dirByte: number): Uint8Array => {
    const input = Buffer.concat([
      KX_SPLIT_DOMAIN,
      Buffer.from([dirByte]),
      meta,
      Buffer.from(transcript.initiatorPk),
      Buffer.from(transcript.responderPk),
    ]);
    return blake2b(input, { key, dkLen: 32 });
  };

  return {
    initiatorToResponder: derive(1),
    responderToInitiator: derive(2),
  };
}

export class StreamCipher {
  private sendKey: Uint8Array;
  private recvKey: Uint8Array;
  private sendSeq = 0n;
  private recvSeq = 0n;

  constructor(sendKey: Uint8Array, recvKey: Uint8Array) {
    this.sendKey = new Uint8Array(sendKey);
    this.recvKey = new Uint8Array(recvKey);
  }

  static fromNegotiated(
    key: Uint8Array,
    isInitiator: boolean,
    transcript: KxTranscript,
  ): StreamCipher {
    if (transcript.picked === 0) {
      return new StreamCipher(key, key);
    }
    if (transcript.picked === 1) {
      const split = deriveSplitKeys(key, transcript);
      return isInitiator
        ? new StreamCipher(split.initiatorToResponder, split.responderToInitiator)
        : new StreamCipher(split.responderToInitiator, split.initiatorToResponder);
    }
    throw new Error(`unsupported kx_version: ${transcript.picked}`);
  }

  seal(plain: Uint8Array): Uint8Array {
    this.sendSeq += 1n;
    return nacl.secretbox(plain, makeSeqNonce(this.sendSeq), this.sendKey);
  }

  open(ciphertext: Uint8Array): Uint8Array {
    if (ciphertext.byteLength <= 1) {
      return ciphertext;
    }
    this.recvSeq += 1n;
    const plain = nacl.secretbox.open(ciphertext, makeSeqNonce(this.recvSeq), this.recvKey);
    if (!plain) {
      throw new Error('decryption failed on encrypted RustDesk stream');
    }
    return plain;
  }
}

/**
 * Detects common non-RustDesk server banners/responses (HTTP, HTML, TLS, SSH) on the initial TCP bytes
 * so users receive a clear diagnostic instead of a raw protobuf wire-type error.
 */
export function detectNonRustDeskProtocol(chunk: Uint8Array): 'http' | 'tls' | 'ssh' | null {
  if (!chunk || chunk.length < 4) return null;

  // TLS record header: Handshake (0x16) or Alert (0x15) with TLS 1.0..1.3 version bytes (0x03 0x01..0x04)
  if (
    (chunk[0] === 0x16 || chunk[0] === 0x15) &&
    chunk[1] === 0x03 &&
    chunk[2] >= 0x00 &&
    chunk[2] <= 0x04
  ) {
    return 'tls';
  }

  const head = Buffer.from(chunk.subarray(0, Math.min(chunk.length, 32))).toString('ascii');
  if (
    /^(?:HTTP\/\d\.\d|GET |POST |HEAD |PUT |DELETE |OPTIONS |<!DOCTYPE|<html|400 Bad Request|404 Not Found)/i.test(
      head,
    )
  ) {
    return 'http';
  }
  if (/^SSH-\d\.\d/i.test(head)) {
    return 'ssh';
  }
  return null;
}

/**
 * Framed TCP stream supporting hbb_common BytesCodec and optional NaCl secretbox encryption.
 */
export class EncryptedFramedStream {
  private readonly socket: net.Socket;
  private readonly decoder = new BytesFrameDecoder();
  private readonly queue: Buffer[] = [];
  private queuedBytes = 0;
  private receivePaused = false;
  private waiters: Array<{
    resolve: (frame: Buffer | null) => void;
    reject: (err: Error) => void;
  }> = [];
  private closed = false;
  private fatalErr: Error | null = null;
  private cipher: StreamCipher | null = null;
  private checkedInitialProtocol = false;

  constructor(socket: net.Socket) {
    this.socket = socket;
    socket.setNoDelay(true);

    socket.on('data', (chunk: Buffer) => {
      if (this.closed) return;
      try {
        if (this.queuedBytes + this.decoder.pendingBytes + chunk.length > MAX_RECEIVE_BYTES) {
          throw new Error('RustDesk receive buffer limit exceeded');
        }
        if (!this.checkedInitialProtocol && !this.cipher && chunk.length > 0) {
          this.checkedInitialProtocol = true;
          const foreign = detectNonRustDeskProtocol(chunk);
          if (foreign === 'http') {
            this.fail(
              new Error(
                'Not a RustDesk server: received an HTTP response instead of RustDesk protocol data.',
              ),
            );
            return;
          }
          if (foreign === 'tls') {
            this.fail(
              new Error(
                'Not a RustDesk server: received a TLS/HTTPS response instead of RustDesk protocol data.',
              ),
            );
            return;
          }
          if (foreign === 'ssh') {
            this.fail(
              new Error(
                'Not a RustDesk server: target is an SSH service instead of RustDesk.',
              ),
            );
            return;
          }
        }
        this.decodeIncoming(chunk);
      } catch (err) {
        this.fail(err instanceof Error ? err : new Error(String(err)));
      }
    });

    socket.on('error', (err) => {
      this.fail(err);
    });

    socket.on('close', () => {
      this.closed = true;
      // Complete frames already queued remain readable after a remote FIN.
      // A partial frame can never be completed once the socket is closed.
      if (!this.receivePaused) this.decoder.clear();
      while (this.waiters.length > 0) {
        const waiter = this.waiters.shift()!;
        if (this.fatalErr) waiter.reject(this.fatalErr);
        else waiter.resolve(null);
      }
    });
  }

  static async connect(
    host: string,
    port: number,
    timeoutMs: number,
    { signal, peerConnection = false }: { signal?: AbortSignal; peerConnection?: boolean } = {},
  ): Promise<EncryptedFramedStream> {
    const cleanHost = host.trim();
    if (!targetHostAllowed(cleanHost)) {
      throw new Error('That target address is not allowed.');
    }
    if (!targetPortAllowed(port, peerConnection, process.env)) {
      throw new Error('That target port is not allowed.');
    }

    signal?.throwIfAborted();
    const resolved = await resolveDialTargets(cleanHost, Math.min(timeoutMs, 5_000));
    signal?.throwIfAborted();
    const allowPrivate = privateTargetsAllowed(process.env);
    const targets = resolved.filter(({ address }) => targetAddressAllowed(address, allowPrivate));
    if (targets.length === 0) throw new Error('That target address is not allowed.');

    const deadline = Date.now() + timeoutMs;
    let lastError: Error | null = null;

    for (let i = 0; i < targets.length; i++) {
      signal?.throwIfAborted();
      const target = targets[i];
      const remaining = deadline - Date.now();
      if (remaining <= 50) {
        break;
      }
      // Give each candidate a fair share of the remaining budget so a dead IPv6/IPv4 record never starves the fallback
      const slotsLeft = targets.length - i;
      const attemptTimeout = slotsLeft > 1 ? Math.max(1_500, Math.floor(remaining / slotsLeft)) : remaining;

      try {
        return await dialSingleAddress(target.address, target.family, cleanHost, port, attemptTimeout, signal);
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
      }
    }

    throw lastError ?? new Error(`timed out connecting to ${cleanHost}:${port}`);
  }

  get remoteAddress(): string | undefined {
    return this.socket.remoteAddress;
  }

  private fail(err: Error) {
    if (!this.fatalErr) this.fatalErr = err;
    this.closed = true;
    this.clearReceived();
    this.socket.destroy();
    while (this.waiters.length > 0) {
      this.waiters.shift()!.reject(err);
    }
  }

  private clearReceived(): void {
    this.queue.length = 0;
    this.queuedBytes = 0;
    this.decoder.clear();
    this.receivePaused = false;
  }

  private decodeIncoming(chunk: Buffer): void {
    this.decoder.push(chunk, frame => {
      if (this.waiters.length) {
        // Keep the waiter registered until decryption succeeds, so fail() also
        // rejects it when a corrupted encrypted frame arrives.
        const decrypted = this.cipher ? Buffer.from(this.cipher.open(frame)) : frame;
        this.waiters.shift()!.resolve(decrypted);
      } else {
        if (this.queue.length >= MAX_QUEUED_FRAMES || this.queuedBytes + frame.length > MAX_RECEIVE_BYTES) {
          throw new Error('RustDesk receive queue limit exceeded');
        }
        this.queue.push(frame);
        this.queuedBytes += frame.length;
      }
      if (this.queue.length >= RECEIVE_HIGH_FRAMES || this.queuedBytes >= RECEIVE_HIGH_BYTES) {
        this.receivePaused = true;
        this.socket.pause();
        return false;
      }
      return true;
    });
  }

  private resumeReceiving(): void {
    if (!this.receivePaused || this.queue.length > RECEIVE_LOW_FRAMES || this.queuedBytes > RECEIVE_LOW_BYTES) return;
    this.receivePaused = false;
    this.decodeIncoming(Buffer.alloc(0));
    if (this.closed && !this.receivePaused) this.decoder.clear();
    if (!this.receivePaused && !this.closed) this.socket.resume();
  }

  isSecured(): boolean {
    return this.cipher !== null;
  }

  setNegotiatedKey(key: Uint8Array, isInitiator: boolean, transcript: KxTranscript): void {
    this.cipher = StreamCipher.fromNegotiated(key, isInitiator, transcript);
  }

  sendRaw(payload: Uint8Array): Promise<void> {
    if (this.closed || this.socket.destroyed) {
      return Promise.reject(this.fatalErr ?? new Error('host closed the connection'));
    }
    const body = this.cipher ? this.cipher.seal(payload) : payload;
    const framed = encodeBytesFrame(body);
    return new Promise((resolve, reject) => {
      this.socket.write(framed, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  next(timeoutMs?: number): Promise<Buffer | null> {
    if (this.fatalErr) return Promise.reject(this.fatalErr);
    if (this.queue.length > 0) {
      const raw = this.queue.shift()!;
      this.queuedBytes -= raw.length;
      try {
        const decrypted = this.cipher ? Buffer.from(this.cipher.open(raw)) : raw;
        this.resumeReceiving();
        return Promise.resolve(decrypted);
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        this.fail(e);
        return Promise.reject(e);
      }
    }
    if (this.closed) {
      return Promise.resolve(null);
    }
    return new Promise((resolve, reject) => {
      const entry = {
        resolve: (val: Buffer | null) => {
          if (timer) clearTimeout(timer);
          resolve(val);
        },
        reject: (err: Error) => {
          if (timer) clearTimeout(timer);
          reject(err);
        },
      };
      const timer =
        timeoutMs && timeoutMs > 0
          ? setTimeout(() => {
              const idx = this.waiters.indexOf(entry);
              if (idx !== -1) this.waiters.splice(idx, 1);
              reject(new Error('timed out waiting for host response'));
            }, timeoutMs)
          : null;
      this.waiters.push(entry);
    });
  }

  close(): void {
    this.closed = true;
    this.clearReceived();
    while (this.waiters.length) {
      const waiter = this.waiters.shift()!;
      if (this.fatalErr) waiter.reject(this.fatalErr);
      else waiter.resolve(null);
    }
    this.socket.destroy();
  }
}

export function formatNetError(err: unknown): string {
  if (err && typeof err === 'object' && 'errors' in err && Array.isArray((err as AggregateError).errors)) {
    const inner = (err as AggregateError).errors
      .map((item) => formatNetError(item))
      .filter(Boolean);
    if (inner.length > 0) {
      return inner[0];
    }
  }
  if (err instanceof Error) {
    const code = (err as NodeJS.ErrnoException).code;
    if (err.message) return err.message;
    if (code) return code;
  }
  return String(err ?? 'unknown network error');
}

export async function resolveDialTargets(
  host: string,
  timeoutMs: number,
): Promise<Array<{ address: string; family: 4 | 6 }>> {
  const ipFamily = net.isIP(host);
  if (ipFamily === 4 || ipFamily === 6) {
    return [{ address: host, family: ipFamily }];
  }

  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    const records = await Promise.race([
      dns.lookup(host, { all: true }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          const timeoutErr = new Error(`DNS lookup timed out for "${host}" (EAI_AGAIN)`) as NodeJS.ErrnoException;
          timeoutErr.code = 'EAI_AGAIN';
          reject(timeoutErr);
        }, Math.max(1_000, timeoutMs));
      }),
    ]);

    if (!Array.isArray(records) || records.length === 0) {
      throw new Error(`DNS lookup failed for "${host}" (ENOTFOUND)`);
    }

    // Prefer IPv4 records first, then IPv6, deduplicated to prevent dead IPv6 routes from breaking connections
    const seen = new Set<string>();
    const v4: Array<{ address: string; family: 4 | 6 }> = [];
    const v6: Array<{ address: string; family: 4 | 6 }> = [];
    for (const rec of records) {
      if (!rec.address || seen.has(rec.address)) continue;
      seen.add(rec.address);
      if (rec.family === 4) v4.push({ address: rec.address, family: 4 });
      else if (rec.family === 6) v6.push({ address: rec.address, family: 6 });
    }
    const ordered = [...v4, ...v6];
    if (ordered.length === 0) {
      throw new Error(`DNS lookup failed for "${host}" (ENOTFOUND)`);
    }
    return ordered;
  } catch (err) {
    const msg = formatNetError(err);
    if (msg.startsWith('DNS lookup')) {
      throw err instanceof Error ? err : new Error(msg);
    }
    const code = (err as NodeJS.ErrnoException | undefined)?.code ?? 'ENOTFOUND';
    throw new Error(`DNS lookup failed for "${host}" (${code})`);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function dialSingleAddress(
  address: string,
  family: 4 | 6,
  displayHost: string,
  port: number,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<EncryptedFramedStream> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: address, port, family, signal });
    let settled = false;

    const onError = (err: Error) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        socket.destroy();
        reject(new Error(`failed to connect to ${displayHost}:${port}: ${formatNetError(err)}`));
      }
    };

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        socket.destroy();
        reject(new Error(`timed out connecting to ${displayHost}:${port}`));
      }
    }, timeoutMs);

    socket.on('error', onError);

    socket.once('connect', () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        const stream = new EncryptedFramedStream(socket);
        // Remove dial error listener AFTER EncryptedFramedStream attaches its own error listener
        socket.off('error', onError);
        resolve(stream);
      }
    });
  });
}
