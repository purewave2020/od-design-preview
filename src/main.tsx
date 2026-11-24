import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { I18nProvider, detectLocale } from './i18n';
import { ToastProvider } from './ui/Toast';
import { TooltipLayer } from './vendor/open-design/components/TooltipLayer';
import './styles/upstream.css';
import './styles/app.css';

const locale = detectLocale();
document.documentElement.lang = locale;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider initialLocale={locale}>
      <ToastProvider>
        <App />
        <TooltipLayer />
      </ToastProvider>
    </I18nProvider>
  </StrictMode>,
);
