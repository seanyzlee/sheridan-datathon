import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { prewarm } from './api/client';
import { App } from './app/App';
import { ScenarioProvider } from './state/scenario';
import './styles/global.css';

prewarm();

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false } },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ScenarioProvider>
        <App />
      </ScenarioProvider>
    </QueryClientProvider>
  </StrictMode>,
);
