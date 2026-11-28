import { errorPayload } from '../shared/errors.ts';
import { createSharedVideoPipeline } from '../shared/hostSession.ts';
import type { ConnectedHost } from './rustdeskClient.ts';
import type { SessionContext } from './sessionState.ts';
import type { EncodedVideo } from '../shared/video.ts';

export interface VideoFrameHandler {
  handleFrame: (conn: ConnectedHost, vf: EncodedVideo) => void;
  dispose: () => void;
}

export function createVideoFrameHandler(context: SessionContext): VideoFrameHandler {
  const { state, ws, videoBuffer, sendJson, sendBinary, cleanup } = context;
  return createSharedVideoPipeline<ConnectedHost>({
    state,
    videoBuffer,
    getQueuedBytes: () => ws.bufferedAmount,
    isLive: (conn) => state.phase === 'live' && state.hostConn === conn,
    sendJson,
    sendBinary,
    ignoreAckErrors: true,
    onSendError: (conn, err) => {
      if (state.phase === 'live' && state.hostConn === conn) {
        sendJson({ type: 'status', state: 'error', ...errorPayload(err) });
        cleanup(false);
      }
    },
  });
}
