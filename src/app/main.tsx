import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { store } from './store';
import { registerOffline } from './offline';
import { SessionProvider } from './ui';
import './styles.css';

void store.init();
registerOffline();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SessionProvider>
      <App />
    </SessionProvider>
  </StrictMode>,
);
