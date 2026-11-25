// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { ToastProvider } from './components/ToastProvider.tsx';
import './index.css';

const root = document.getElementById('root');
if (!root) throw new Error('missing root element');
createRoot(root).render(
  <ErrorBoundary>
    <ToastProvider>
      <App />
    </ToastProvider>
  </ErrorBoundary>,
);
