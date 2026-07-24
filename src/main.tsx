import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './context/AuthContext';
import { MaxDockProvider } from './context/MaxDockContext';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HashRouter>
      <AuthProvider>
        <MaxDockProvider>
          <App />
        </MaxDockProvider>
      </AuthProvider>
    </HashRouter>
  </React.StrictMode>,
);
