// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

import { useEffect, useRef, useState, type RefObject } from 'react';
import { fitContain } from '../lib/frameFit.ts';

interface RemoteScreenProps {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  frameWidth: number;
  frameHeight: number;
  onDisconnect: () => void;
}

export function RemoteScreen({ canvasRef, frameWidth, frameHeight, onDisconnect }: RemoteScreenProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const measure = () => setBox({ width: stage.clientWidth, height: stage.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  const fitted = fitContain(box.width, box.height, frameWidth, frameHeight);

  const toggleFullscreen = () => {
    const stage = stageRef.current;
    if (!stage) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void stage.requestFullscreen();
    }
  };

  return (
    <div
      ref={stageRef}
      className="stage"
      data-testid="stage"
      style={{ position: 'fixed', inset: 0, background: '#101418' }}
    >
      <canvas
        ref={canvasRef}
        data-testid="canvas"
        style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          width: fitted.width || undefined,
          height: fitted.height || undefined,
          transform: 'translate(-50%, -50%)',
          background: '#101418',
        }}
      />
      <div style={{ position: 'absolute', top: 12, right: 12, display: 'flex', gap: 8 }}>
        <button type="button" onClick={toggleFullscreen}>
          Full screen
        </button>
        <button type="button" onClick={onDisconnect}>
          Disconnect
        </button>
      </div>
    </div>
  );
}
