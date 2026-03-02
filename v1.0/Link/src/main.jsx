import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

console.log("Main.jsx loaded. Attempting to mount React app...");

const rootElement = document.getElementById('root');
if (!rootElement) console.error("FATAL: Could not find #root element!");

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)