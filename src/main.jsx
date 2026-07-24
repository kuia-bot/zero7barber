import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'

ReactDOM.createRoot(document.getElementById('root')).render(<App />)

// Registrar service worker para notificações
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/zero7barber/sw.js')
      .then(reg => console.log('SW registrado:', reg))
      .catch(err => console.log('SW erro:', err));
  });
}