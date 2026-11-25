// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

import { FRAME_HEADER_LENGTH, hasRoomForHeader } from '@rustdesk-web/protocol';
import { GATEWAY_SERVICE, HEALTH_PATH, type HealthResponse } from '@rustdesk-web/shared';

export async function readGatewayHealth(fetchImpl: typeof fetch = fetch): Promise<HealthResponse> {
  if (!hasRoomForHeader(FRAME_HEADER_LENGTH)) {
    throw new Error('protocol frame header length is invalid');
  }
  const response = await fetchImpl(HEALTH_PATH);
  if (!response.ok) throw new Error(`health status ${response.status}`);
  const body = (await response.json()) as HealthResponse;
  if (body?.ok !== true || body.service !== GATEWAY_SERVICE) {
    throw new Error('unexpected health payload');
  }
  return body;
}
