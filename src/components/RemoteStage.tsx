import type React from 'react';
import { MousePointer2 } from 'lucide-react';
import type { DisplayPrefs } from '../lib/displayPrefs';
import type { ViewTransform } from '../lib/mapping';

interface RemoteStageProps {
  stageRef: React.RefObject<HTMLElement | null>;
  live: boolean;
  stageViewport: { left: number; top: number; width: number; height: number } | null;
  keyboardAvoiding: boolean;
  remoteInput: boolean;
  pointer: {
    handlePointerDown: (event: React.PointerEvent<HTMLElement>) => void;
    handlePointerMove: (event: React.PointerEvent<HTMLElement>) => void;
    handlePointerUpOrCancel: (event: React.PointerEvent<HTMLElement>) => void;
    handleLostPointerCapture: (event: React.PointerEvent<HTMLElement>) => void;
  };
  canvas: {
    canvasRef: React.RefObject<HTMLCanvasElement | null>;
    remoteW: number;
    remoteH: number;
    view: ViewTransform;
  };
  cursor: {
    cursorElRef: React.RefObject<HTMLDivElement | null>;
    cursorCanvasRef: React.RefObject<HTMLCanvasElement | null>;
    cursorShape: { pixels: ImageData; hotX: number; hotY: number } | null;
    showRemoteCursor: boolean;
    enlargeCursor: boolean;
  };
  capture: {
    captureRef: React.RefObject<HTMLInputElement | null>;
    captureComposingRef: React.RefObject<boolean>;
    lastCompositionEndAtRef: React.RefObject<number>;
    displayPrefsRef: React.RefObject<DisplayPrefs>;
    sendText: (text: string) => void;
  };
  children: React.ReactNode;
}

export function RemoteStage({
  stageRef, live, stageViewport, keyboardAvoiding, remoteInput,
  pointer, canvas, cursor, capture, children,
}: RemoteStageProps) {
  const { handlePointerDown, handlePointerMove, handlePointerUpOrCancel, handleLostPointerCapture } = pointer;
  const { canvasRef, remoteW, remoteH, view } = canvas;
  const { cursorElRef, cursorCanvasRef, cursorShape, showRemoteCursor, enlargeCursor } = cursor;
  const { captureRef, captureComposingRef, lastCompositionEndAtRef, displayPrefsRef, sendText } = capture;

  return (
    <section
      ref={stageRef}
      className="stage"
      style={live && stageViewport ? {
        position: 'fixed', inset: 'auto', left: stageViewport.left, top: stageViewport.top,
        width: stageViewport.width, height: stageViewport.height,
      } : undefined}
      data-testid="stage"
      data-keyboard-avoiding={keyboardAvoiding ? 'true' : undefined}
      data-remote-active={remoteInput ? 'true' : 'false'}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUpOrCancel}
      onPointerCancel={handlePointerUpOrCancel}
      onLostPointerCapture={handleLostPointerCapture}
      onContextMenu={(e) => {
        if (remoteInput || e.target === stageRef.current || e.target === canvasRef.current) {
          e.preventDefault();
        }
      }}
    >
      <canvas
        ref={canvasRef}
        data-testid="canvas"
        width={remoteW}
        height={remoteH}
        style={{
          left: `${view.panX}px`,
          top: `${view.panY}px`,
          width: `${remoteW * view.scale}px`,
          height: `${remoteH * view.scale}px`,
        }}
      />

      <div
        ref={cursorElRef}
        className="remote-cursor"
        style={enlargeCursor ? { transform: 'scale(2)', transformOrigin: '0 0' } : undefined}
        data-testid="remote-cursor"
        hidden={!showRemoteCursor}
        aria-hidden="true"
      >
        {cursorShape ? (
          <canvas
            ref={cursorCanvasRef}
            width={cursorShape.pixels.width}
            height={cursorShape.pixels.height}
            style={{ left: -cursorShape.hotX, top: -cursorShape.hotY }}
          />
        ) : (
          <MousePointer2 size={18} fill="#fff" stroke="#171717" />
        )}
      </div>

      <input
        ref={captureRef}
        type="text"
        className="capture"
        data-testid="capture"
        aria-hidden="true"
        tabIndex={-1}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        onCompositionStart={() => {
          captureComposingRef.current = true;
        }}
        onCompositionEnd={(e) => {
          captureComposingRef.current = false;
          lastCompositionEndAtRef.current = performance.now();
          const committed = e.data || e.currentTarget.value;
          e.currentTarget.value = '';
          if (committed && !displayPrefsRef.current.viewOnly) {
            sendText(committed);
          }
        }}
        onInput={(e) => {
          if (captureComposingRef.current) return;
          const val = e.currentTarget.value;
          if (val) {
            e.currentTarget.value = '';
            if (!displayPrefsRef.current.viewOnly) {
              sendText(val);
            }
          }
        }}
      />

      {children}
    </section>
  );
}
