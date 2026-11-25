// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

import {
  buildRefreshVideoMessage,
  buildVideoReceivedMessage,
  decodeMessage,
  encodeBase64,
  encodeMessage,
  HostPermission,
  humanizeError,
  normalizeChatText,
  selectCodecs,
  toHostMessage,
  type ClientMessage,
  type CodecCaps,
} from '@rustdesk-web/protocol';
import type { ServerMessage } from '@rustdesk-web/shared';
import { decodeClipboard } from './clipboard.ts';
import { CursorShapes } from './cursor.ts';
import { activeDisplaySize, hostAllowsRestart, peerInfoMessage, sessionPermissions, usesModernDisplayCommands, type NativeConnection } from './peerInfo.ts';
import { createNativeVideo } from './video.ts';

const MAX_AUDIO_PACKET_BYTES = 8192;

// Translate browser-side WebRTC traffic into the same UI events as the gateway.
export function createNativeSession(
  connection: NativeConnection, availableCodecs: Partial<CodecCaps> | undefined,
  onData: (data: string | ArrayBuffer) => void, onClose: () => void,
) {
  const sessionCodecs = selectCodecs(availableCodecs);
  let state: 'live' | 'closed' = 'live';
  let displayWithResolutionOptions = 0;
  let supportedResolutions: { width: number; height: number }[] = [];
  let privacyImplementation = '';
  let audioRequested = false;
  let audioAllowed = true;
  let audioFormat: { sampleRate: number; channels: number } | null = null;
  const sendJson = (value: ServerMessage) => { if (state === 'live') onData(JSON.stringify(value)); };
  const sendBinary = (value: Uint8Array) => { if (state === 'live') onData(new Uint8Array(value).buffer); };
  const video = createNativeVideo(sendJson, sendBinary);
  const sendHostMessage = (message: Record<string, unknown>) => connection.stream.sendRaw(encodeMessage(message));

  const close = () => {
    if (state === 'closed') return;
    state = 'closed';
    connection.stream.close();
    onClose();
  };
  const fail = (error: unknown) => {
    if (state === 'closed') return;
    sendJson({ type: 'status', state: 'error', detail: humanizeError(error) });
    close();
  };
  const readHostMessages = async () => {
    const publishResolutions = (display: number, supported?: { resolutions?: typeof supportedResolutions }) => {
      displayWithResolutionOptions = display;
      supportedResolutions = (supported?.resolutions ?? []).filter(({ width, height }) =>
        Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0);
      sendJson({ type: 'resolutions', display, sizes: supportedResolutions });
    };
    const cursorShapes = new CursorShapes();
    video.setDisplaySize(activeDisplaySize(connection.peerInfo));
    sendJson(peerInfoMessage(connection.peerInfo, connection));
    publishResolutions(Number(connection.peerInfo.current_display ?? 0), connection.peerInfo.resolutions);
    sendJson({
      type: 'status',
      state: 'live',
      detail: connection.encrypted ? 'encrypted' : 'direct',
      username: connection.username,
    });

    try {
      while (state === 'live') {
        const hostPacket = await connection.stream.next();
        if (!hostPacket) {
          if (state === 'live') {
            throw new Error('host closed the connection');
          }
          break;
        }
        const hostMessage = decodeMessage(hostPacket);

        const delayProbe = hostMessage.test_delay;
        if (delayProbe?.from_client) {
          sendJson({ type: 'pong', seq: Number(delayProbe.time), clientTs: 0, serverTs: Date.now() });
        }
        if (delayProbe && !delayProbe.from_client) {
          void sendHostMessage({ test_delay: delayProbe }).catch(fail);
          const roundTripMs = Number(delayProbe.last_delay ?? 0);
          if (roundTripMs > 0) {
            sendJson({ type: 'rtt', ms: roundTripMs });
          }
        }

        const hostEvent = hostMessage.misc;
        if (hostEvent) {
          if (Number.isInteger(hostEvent.follow_current_display)) {
            sendJson({ type: 'focusedDisplay', display: hostEvent.follow_current_display });
          }
          if (hostEvent.switch_display) {
            const switchedDisplay = hostEvent.switch_display;
            const width = Number(switchedDisplay.width ?? 0);
            const height = Number(switchedDisplay.height ?? 0);
            if (width > 0 && height > 0) {
              video.setDisplaySize({ width, height });
            }
            sendJson({
              type: 'display',
              display: Number(switchedDisplay.display ?? 0),
              width,
              height,
              x: Number(switchedDisplay.x ?? 0),
              y: Number(switchedDisplay.y ?? 0),
              cursorEmbedded: Boolean(switchedDisplay.cursor_embedded),
              name: '',
            });
            publishResolutions(Number(switchedDisplay.display ?? 0), switchedDisplay.resolutions);
          }
          if (hostEvent.close_reason) {
            fail(String(hostEvent.close_reason));
            return;
          }
        }

        const permission = hostEvent?.permission_info;
        if (permission?.permission === HostPermission.PrivacyMode || permission?.permission === HostPermission.Clipboard) {
          if (permission.permission === HostPermission.PrivacyMode) connection.privacyAllowed = permission.enabled === true;
          else connection.clipboardAllowed = permission.enabled === true;
          sendJson({ type: 'permissions', ...sessionPermissions(connection) });
        }
        const chat = hostEvent?.chat_message?.text;
        if (typeof chat === 'string' && normalizeChatText(chat)) sendJson({ type: 'chat', text: chat });
        const notice = hostEvent?.back_notification;
        if (typeof notice?.privacy_mode_state === 'number') {
          const code = notice.privacy_mode_state;
          if (code === 4) privacyImplementation = notice.impl_key || '';
          if (code === 3) {
            connection.privacyAllowed = false;
            sendJson({ type: 'permissions', ...sessionPermissions(connection) });
          }
          const enabled = code === 4 ? true : [3, 5, 6, 7, 8, 9, 11].includes(code) ? false : undefined;
          sendJson({ type: 'privacyResult', enabled, failed: ![4, 8, 9].includes(code) });
        }
        if (permission?.permission === HostPermission.Restart) {
          connection.restartAllowed = permission.enabled === true;
          sendJson({ type: 'restartPermission', allowed: hostAllowsRestart(connection) });
        }
        if (permission?.permission === HostPermission.Audio) {
          audioAllowed = permission.enabled === true;
          if (!audioAllowed && audioRequested) {
            audioRequested = false;
            sendJson({ type: 'audioDenied' });
          }
        }
        if (hostEvent?.audio_format) {
          const { sample_rate: sampleRate, channels } = hostEvent.audio_format;
          audioFormat = { sampleRate, channels };
          if (audioRequested && audioAllowed) sendJson({ type: 'audioFormat', ...audioFormat });
        }
        const audioPacket = hostMessage.audio_frame?.data;
        if (audioAllowed && audioRequested && audioPacket?.length > 0 && audioPacket.length <= MAX_AUDIO_PACKET_BYTES) {
          sendJson({ type: 'audioFrame', packet: encodeBase64(Uint8Array.from(audioPacket)) });
        }

        // Accept the first supported text format from single-item and multi-item clipboard messages.
        if (connection.clipboardAllowed) {
          const clips = [hostMessage.clipboard, ...(hostMessage.multi_clipboards?.clipboards ?? [])];
          for (const clip of clips) {
            const text = decodeClipboard(clip);
            if (text !== null) {
              sendJson({ type: 'clipboard', text });
              break;
            }
          }
        }

        if (hostMessage.cursor_data) {
          sendJson({ type: 'cursorShape', shape: cursorShapes.decode(hostMessage.cursor_data) });
        } else if (hostMessage.cursor_id !== undefined) {
          sendJson({ type: 'cursorShape', shape: cursorShapes.get(hostMessage.cursor_id) });
        } else if (hostMessage.cursor_position) {
          sendJson({
            type: 'cursor',
            x: Number(hostMessage.cursor_position.x ?? 0),
            y: Number(hostMessage.cursor_position.y ?? 0),
          });
        }

        // A host can send updated display information after a monitor is connected.
        if (hostMessage.peer_info) {
          const updatedSize = activeDisplaySize(hostMessage.peer_info);
          if (updatedSize.width > 0 && updatedSize.height > 0) {
            video.setDisplaySize(updatedSize);
          }
          sendJson(peerInfoMessage(hostMessage.peer_info, connection));
          publishResolutions(Number(hostMessage.peer_info.current_display ?? 0), hostMessage.peer_info.resolutions);
        }

        if (hostMessage.video_frame && video.handleVideoFrame(hostMessage.video_frame)) {
          // RustDesk 1.5 expects one acknowledgement per message, even for a batch.
          void sendHostMessage(buildVideoReceivedMessage()).catch(fail);
        }
      }
    } catch (error) {
      fail(error);
    }
  };

  const sendControl = async (command: ClientMessage) => {
    if (command.type === 'ping') {
      await sendHostMessage({ test_delay: { time: command.seq, from_client: true } });
      return;
    }
    if (command.type === 'disconnect') {
      close();
      return;
    }
    if (command.type === 'clipboard' && (!connection.clipboardAllowed || typeof command.text !== 'string')) return;
    if (command.type === 'privacy') {
      if (!sessionPermissions(connection).privacyAllowed || typeof command.enabled !== 'boolean') {
        sendJson({ type: 'privacyResult', failed: true });
        return;
      }
      const misc = usesModernDisplayCommands(connection.peerInfo)
        ? { toggle_privacy_mode: { on: command.enabled, impl_key: privacyImplementation } }
        : { option: { privacy_mode: command.enabled ? 2 : 1 } };
      try {
        await sendHostMessage({ misc });
      } catch {
        sendJson({ type: 'privacyResult', failed: true });
      }
      return;
    }
    if (command.type === 'restart') {
      if (!hostAllowsRestart(connection)) {
        sendJson({ type: 'restartResult', sent: false });
        return;
      }
      try {
        await sendHostMessage({ misc: { restart_remote_device: true } });
        sendJson({ type: 'restartResult', sent: true });
      } catch {
        sendJson({ type: 'restartResult', sent: false });
      }
      return;
    }
    if (command.type === 'audio') {
      if (typeof command.enabled !== 'boolean') return;
      if (command.enabled && !audioAllowed) {
        sendJson({ type: 'audioDenied' });
        return;
      }
      audioRequested = command.enabled;
      if (audioRequested && audioFormat) sendJson({ type: 'audioFormat', ...audioFormat });
    }
    let hostCommand: Record<string, unknown> | null;
    if (command.type === 'chat') {
      const text = normalizeChatText(command.text);
      if (!text) return;
      hostCommand = { misc: { chat_message: { text } } };
    } else if (command.type === 'resolution') {
      const { display, width, height } = command;
      if (display !== displayWithResolutionOptions || !supportedResolutions.some(size => size.width === width && size.height === height)) {
        sendJson({ type: 'error', message: 'The active display does not offer that resolution.' });
        return;
      }
      const resolution = { width, height };
      hostCommand = { misc: usesModernDisplayCommands(connection.peerInfo)
        ? { change_display_resolution: { display, resolution } }
        : { change_resolution: resolution } };
    } else {
      hostCommand = toHostMessage(command, sessionCodecs);
    }
    if (!hostCommand) return;
    void sendHostMessage(hostCommand).catch(fail);
    if (command.type === 'quality') {
      void sendHostMessage(buildRefreshVideoMessage()).catch(fail);
    }
  };
  return {
    start: () => { void readHostMessages().catch(fail); },
    send: (message: ClientMessage) => { if (state === 'live') void sendControl(message).catch(fail); },
    close,
  };
}
