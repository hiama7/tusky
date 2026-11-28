import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import SiteMeta from './components/SiteMeta';
import App from './App';
import { AuthProvider } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import './styles/style.css';

// Normal page addresses, so search engines can index them. The host must answer any
// unknown path with index.html (see deploy/Caddyfile).
// Links from the earlier "#/page" addresses, such as old reset emails, still work.
if (window.location.hash.startsWith('#/')) window.history.replaceState(null, '', window.location.hash.slice(1));

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <SiteMeta />
      <ToastProvider>
        <AuthProvider>
          <App />
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  </StrictMode>,
);
