// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

/** What this package matches, and what it deliberately does not implement yet. */
export const PROTOCOL_COMPATIBILITY = {
  upstreamVersion: '1.5.3',
  sourceCommit: 'f784848f26b33453b0a6ff98f7b20748ecf32518',
  bytesCodec: 'hbb_common::BytesCodec',
  videoFrame: 'RDV1',
  protobuf: 'message.proto and rendezvous.proto',
  notIncluded: ['TCP sockets', 'NaCl handshake', 'WebCodecs decode'],
} as const;
