// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import type { ClientMessage, CursorShape } from '@rustdesk-web/shared';
import { MousePointer2 } from 'lucide-react';
import { computeViewTransform, mapFromRemote, type ViewTransform } from '../lib/mapping.ts';
import { isImeEvent } from '../lib/keys.ts';
import {
  noteKeyDown,
  noteKeyUp,
  releaseTrackedKeys,
  textMessages,
  type TrackedKey,
} from '../lib/keyboard.ts';
import { shouldIsolateKeyboardEvent } from '../lib/inputIsolation.ts';
import {
  desktopPointerButton,
  pointerDownMessages,
  pointerMoveMessage,
  pointerUpMessages,
  releaseHeldButton,
  remotePoint,
  wheelMessages,
  type MouseButton,
} from '../lib/mouseInput.ts';

interface RemoteScreenProps {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  frameWidth: number;
  frameHeight: number;
  viewOnly: boolean;
  swapMouseButtons: boolean;
  reverseMouseWheel: boolean;
  showRemoteCursor: boolean;
  enlargeCursor: boolean;
  cursorEmbedded: boolean;
  cursor: { x: number; y: number } | null;
  cursorShape: CursorShape | null;
  onMouse: (messages: ClientMessage[]) => void;
  onKeyboard: (messages: ClientMessage[]) => void;
  onHeldRelease: (message: ClientMessage | null) => void;
  onArmKeys: (messages: ClientMessage[]) => void;
  onDisconnect: () => void;
}

interface Drag {
  pointerId: number;
  button: MouseButton;
  point: { x: number; y: number };
}

export function RemoteScreen({
  canvasRef,
  frameWidth,
  frameHeight,
  viewOnly,
  swapMouseButtons,
  reverseMouseWheel,
  showRemoteCursor,
  enlargeCursor,
  cursorEmbedded,
  cursor,
  cursorShape,
  onMouse,
  onKeyboard,
  onHeldRelease,
  onArmKeys,
  onDisconnect,
}: RemoteScreenProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const captureRef = useRef<HTMLInputElement>(null);
  const cursorCanvasRef = useRef<HTMLCanvasElement>(null);
  const trackedKeysRef = useRef<TrackedKey[]>([]);
  const composingRef = useRef(false);
  const compositionEndedAtRef = useRef(0);
  const dragRef = useRef<Drag | null>(null);
  const queuedMoveRef = useRef<{ x: number; y: number } | null>(null);
  const moveFrameRef = useRef<number | null>(null);
  const wheelAccumRef = useRef({ x: 0, y: 0 });
  const [box, setBox] = useState({ width: 0, height: 0 });

  const viewOnlyRef = useRef(viewOnly);
  const swapRef = useRef(swapMouseButtons);
  const reverseRef = useRef(reverseMouseWheel);
  const frameRef = useRef({ width: frameWidth, height: frameHeight });
  const transformRef = useRef<ViewTransform>({ scale: 1, panX: 0, panY: 0 });
  const onMouseRef = useRef(onMouse);
  const onKeyboardRef = useRef(onKeyboard);
  const onHeldRef = useRef(onHeldRelease);
  const onArmKeysRef = useRef(onArmKeys);
  viewOnlyRef.current = viewOnly;
  swapRef.current = swapMouseButtons;
  reverseRef.current = reverseMouseWheel;
  frameRef.current = { width: frameWidth, height: frameHeight };
  onMouseRef.current = onMouse;
  onKeyboardRef.current = onKeyboard;
  onHeldRef.current = onHeldRelease;
  onArmKeysRef.current = onArmKeys;

  const transform = computeViewTransform(box.width, box.height, frameWidth, frameHeight, 'fit', 1, {
    panX: 0,
    panY: 0,
  });
  transformRef.current = transform;

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const measure = () => setBox({ width: stage.clientWidth, height: stage.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  const showCursor = showRemoteCursor && !cursorEmbedded && cursor !== null && frameWidth > 0 && frameHeight > 0;

  useEffect(() => {
    const canvas = cursorCanvasRef.current;
    if (!canvas || !cursorShape || !showCursor) return;
    let bytes: Uint8ClampedArray;
    try {
      bytes = Uint8ClampedArray.from(atob(cursorShape.rgba), (char) => char.charCodeAt(0));
    } catch {
      return;
    }
    if (bytes.length !== cursorShape.width * cursorShape.height * 4) return;
    const image = new ImageData(cursorShape.width, cursorShape.height);
    image.data.set(bytes);
    canvas.getContext('2d')?.putImageData(image, 0, 0);
  }, [cursorShape, showCursor]);

  const cancelQueuedMove = () => {
    if (moveFrameRef.current !== null) cancelAnimationFrame(moveFrameRef.current);
    moveFrameRef.current = null;
    queuedMoveRef.current = null;
  };

  const queueMove = (point: { x: number; y: number }) => {
    queuedMoveRef.current = point;
    if (moveFrameRef.current !== null) return;
    moveFrameRef.current = requestAnimationFrame(() => {
      moveFrameRef.current = null;
      const next = queuedMoveRef.current;
      queuedMoveRef.current = null;
      if (!next) return;
      const message = pointerMoveMessage(next, viewOnlyRef.current);
      if (message) onMouseRef.current([message]);
    });
  };

  const releaseDrag = (point: { x: number; y: number } | null) => {
    const drag = dragRef.current;
    dragRef.current = null;
    onHeldRef.current(null);
    if (!drag || viewOnlyRef.current) return;
    cancelQueuedMove();
    onMouseRef.current(releaseHeldButton(drag.button, point ?? drag.point));
  };

  useEffect(() => {
    const onBlur = () => releaseDrag(dragRef.current?.point ?? null);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('blur', onBlur);
      cancelQueuedMove();
    };
  }, []);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const onWheel = (event: WheelEvent) => {
      if (event.target instanceof Element && event.target.closest('button')) return;
      event.preventDefault();
      if (event.ctrlKey || event.altKey || event.metaKey) return;
      const rect = stage.getBoundingClientRect();
      const remote = frameRef.current;
      const pos = remotePoint(
        event.clientX - rect.left,
        event.clientY - rect.top,
        remote.width,
        remote.height,
        transformRef.current,
        false,
      );
      if (pos && !viewOnlyRef.current) {
        cancelQueuedMove();
        const move = pointerMoveMessage(pos, false);
        if (move) onMouseRef.current([move]);
      }
      const wheel = wheelMessages(
        event.deltaX,
        event.deltaY,
        event.deltaMode,
        wheelAccumRef.current.x,
        wheelAccumRef.current.y,
        reverseRef.current,
        viewOnlyRef.current,
      );
      wheelAccumRef.current = { x: wheel.nextAccumX, y: wheel.nextAccumY };
      if (wheel.messages.length > 0) onMouseRef.current(wheel.messages);
    };
    stage.addEventListener('wheel', onWheel, { passive: false });
    return () => stage.removeEventListener('wheel', onWheel);
  }, []);

  useEffect(() => {
    const publish = (tracked: TrackedKey[]) => {
      trackedKeysRef.current = tracked;
      onArmKeysRef.current(tracked.map((item) => item.release));
    };
    const foreignField = (target: EventTarget | null) => {
      if (!(target instanceof Element)) return false;
      const capture = captureRef.current;
      if (capture && (target === capture || capture.contains(target))) return false;
      return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
    };
    const onKeyDown = (event: KeyboardEvent) => {
      const isolate = shouldIsolateKeyboardEvent({
        phase: 'live',
        chromeOpen: false,
        insideChromeInput: foreignField(event.target),
      });
      if (!isolate) return;
      if (composingRef.current || isImeEvent(event)) return;
      event.preventDefault();
      event.stopPropagation();
      const next = noteKeyDown(trackedKeysRef.current, event, viewOnlyRef.current);
      publish(next.tracked);
      if (next.messages.length > 0) onKeyboardRef.current(next.messages);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      const isolate = shouldIsolateKeyboardEvent({
        phase: 'live',
        chromeOpen: false,
        insideChromeInput: foreignField(event.target),
      });
      if (!isolate) return;
      if (composingRef.current || isImeEvent(event) || performance.now() - compositionEndedAtRef.current < 80) return;
      event.preventDefault();
      event.stopPropagation();
      const next = noteKeyUp(trackedKeysRef.current, event, viewOnlyRef.current);
      publish(next.tracked);
      if (next.messages.length > 0) onKeyboardRef.current(next.messages);
    };
    const onBlur = () => {
      composingRef.current = false;
      const released = releaseTrackedKeys(trackedKeysRef.current);
      publish(released.tracked);
      if (released.messages.length > 0) onKeyboardRef.current(released.messages);
    };
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
      window.removeEventListener('blur', onBlur);
      const released = releaseTrackedKeys(trackedKeysRef.current);
      publish(released.tracked);
      if (released.messages.length > 0) onKeyboardRef.current(released.messages);
    };
  }, []);

  const localPoint = (clientX: number, clientY: number) => {
    const stage = stageRef.current;
    if (!stage) return null;
    const rect = stage.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.target instanceof Element && event.target.closest('button')) return;
    if (viewOnlyRef.current) return;
    const local = localPoint(event.clientX, event.clientY);
    if (!local) return;
    const remote = frameRef.current;
    const pos = remotePoint(local.x, local.y, remote.width, remote.height, transformRef.current, false);
    if (!pos) return;
    const button = desktopPointerButton(event.button, swapRef.current);
    if (!button) return;
    event.preventDefault();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // The pointer can already be gone on a synthetic event.
    }
    cancelQueuedMove();
    dragRef.current = { pointerId: event.pointerId, button, point: pos };
    onHeldRef.current({ type: 'mouse', action: 'up', button, x: pos.x, y: pos.y });
    onMouseRef.current(pointerDownMessages(button, pos, false));
    captureRef.current?.focus({ preventScroll: true });
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (viewOnlyRef.current) return;
    const local = localPoint(event.clientX, event.clientY);
    if (!local) return;
    const remote = frameRef.current;
    const drag = dragRef.current;
    const dragging = Boolean(drag && drag.pointerId === event.pointerId);
    const pos = remotePoint(local.x, local.y, remote.width, remote.height, transformRef.current, dragging);
    if (!pos) return;
    if (dragging && drag) {
      drag.point = pos;
      cancelQueuedMove();
      onHeldRef.current({ type: 'mouse', action: 'up', button: drag.button, x: pos.x, y: pos.y });
      const move = pointerMoveMessage(pos, false);
      if (move) onMouseRef.current([move]);
      return;
    }
    queueMove(pos);
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const local = localPoint(event.clientX, event.clientY);
    const remote = frameRef.current;
    const pos = local
      ? remotePoint(local.x, local.y, remote.width, remote.height, transformRef.current, true)
      : drag.point;
    dragRef.current = null;
    onHeldRef.current(null);
    if (viewOnlyRef.current || !pos) return;
    cancelQueuedMove();
    onMouseRef.current(pointerUpMessages(drag.button, pos, false));
  };

  const cursorScreen = showCursor && cursor ? mapFromRemote(cursor.x, cursor.y, transform) : null;

  return (
    <div
      ref={stageRef}
      className="stage"
      data-testid="stage"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onLostPointerCapture={onPointerUp}
      onContextMenu={(event) => event.preventDefault()}
      style={{
        position: 'fixed',
        inset: 0,
        background: '#101418',
        touchAction: 'none',
        cursor: showCursor ? 'none' : 'default',
      }}
    >
      <canvas
        ref={canvasRef}
        data-testid="canvas"
        style={{
          position: 'absolute',
          left: transform.panX,
          top: transform.panY,
          width: frameWidth > 0 ? frameWidth * transform.scale : undefined,
          height: frameHeight > 0 ? frameHeight * transform.scale : undefined,
          background: '#101418',
        }}
      />
      {showCursor && cursorScreen ? (
        <div
          data-testid="remote-cursor"
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: cursorScreen.x,
            top: cursorScreen.y,
            pointerEvents: 'none',
            zIndex: 2,
            transform: enlargeCursor ? 'scale(2)' : undefined,
            transformOrigin: '0 0',
          }}
        >
          {cursorShape ? (
            <canvas
              ref={cursorCanvasRef}
              width={cursorShape.width}
              height={cursorShape.height}
              style={{ position: 'absolute', left: -cursorShape.hotX, top: -cursorShape.hotY }}
            />
          ) : (
            <MousePointer2 size={18} fill="#fff" stroke="#171717" />
          )}
        </div>
      ) : null}
      <input
        ref={captureRef}
        type="text"
        data-testid="capture"
        aria-hidden="true"
        tabIndex={-1}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={(event) => {
          composingRef.current = false;
          compositionEndedAtRef.current = performance.now();
          const committed = event.data || event.currentTarget.value;
          event.currentTarget.value = '';
          const messages = textMessages(committed, viewOnlyRef.current);
          if (messages.length > 0) onKeyboardRef.current(messages);
        }}
        onInput={(event) => {
          if (composingRef.current) return;
          const value = event.currentTarget.value;
          if (!value) return;
          event.currentTarget.value = '';
          const messages = textMessages(value, viewOnlyRef.current);
          if (messages.length > 0) onKeyboardRef.current(messages);
        }}
        style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', width: 1, height: 1 }}
      />
      <div style={{ position: 'absolute', top: 12, right: 12, display: 'flex', gap: 8, zIndex: 3 }}>
        <button type="button" onClick={() => toggleFullscreen(stageRef.current)} style={{ cursor: 'pointer' }}>
          Full screen
        </button>
        <button type="button" onClick={onDisconnect} style={{ cursor: 'pointer' }}>
          Disconnect
        </button>
      </div>
    </div>
  );
}

function toggleFullscreen(stage: HTMLElement | null) {
  if (!stage) return;
  if (document.fullscreenElement) {
    void document.exitFullscreen();
  } else {
    void stage.requestFullscreen();
  }
}
