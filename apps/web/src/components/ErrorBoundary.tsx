// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

import { Component, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  message: string;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { message: '' };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { message: error instanceof Error ? error.message : 'The page failed to render.' };
  }

  render() {
    if (!this.state.message) return this.props.children;
    return (
      <main>
        <h1>RustDesk Web Client</h1>
        <p>{this.state.message}</p>
        <button type="button" onClick={() => this.setState({ message: '' })}>
          Try again
        </button>
      </main>
    );
  }
}
