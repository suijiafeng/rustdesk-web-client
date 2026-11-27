import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import {initPwa} from './lib/pwa';

initPwa();
createRoot(document.getElementById('root')!).render(<App />);

const splash = document.getElementById('app-splash');
if (splash) {
  window.requestAnimationFrame(() => {
    splash.classList.add('is-hidden');
    window.setTimeout(() => splash.remove(), 240);
  });
}
