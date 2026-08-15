import React from 'react';
import { createRoot } from 'react-dom/client';
import './theme.css';
import { App } from './App';
import { StoreProvider } from './store';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <StoreProvider>
      <App />
    </StoreProvider>
  </React.StrictMode>,
);
