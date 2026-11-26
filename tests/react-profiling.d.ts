// The installed React DOM profiling build exports these existing APIs, but
// @types/react-dom does not declare its profiling entry point.
declare module 'react-dom/profiling' {
  export { createRoot } from 'react-dom/client';
  export { flushSync } from 'react-dom';
}
