// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

export type ProtocolErrorCode =
  | 'frame-too-large'
  | 'invalid-frame'
  | 'invalid-message'
  | 'not-rustdesk';

export class ProtocolError extends Error {
  readonly code: ProtocolErrorCode;

  constructor(code: ProtocolErrorCode, message: string) {
    super(message);
    this.name = 'ProtocolError';
    this.code = code;
  }
}
