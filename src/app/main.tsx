import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { store } from './store';
import { SessionProvider } from './ui';
import './styles.css';

void store.init();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SessionProvider>
      <App />
    </SessionProvider>
  </StrictMode>,
);
