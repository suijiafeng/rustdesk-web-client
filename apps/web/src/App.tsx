// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

import { useEffect, useState } from 'react';
import { readGatewayHealth } from './health.ts';

export function App() {
  const [status, setStatus] = useState('Checking the gateway…');

  useEffect(() => {
    let cancelled = false;
    readGatewayHealth()
      .then((health) => {
        if (!cancelled) setStatus(`Gateway ${health.service} is up.`);
      })
      .catch(() => {
        if (!cancelled) setStatus('Gateway is not reachable.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main>
      <h1>RustDesk Web Client</h1>
      <p>Unofficial browser client for RustDesk.</p>
      <p className="status">{status}</p>
    </main>
  );
}
