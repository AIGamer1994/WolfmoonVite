import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import { RenderErrorBoundary } from './components/RenderErrorBoundary.jsx';
import './styles/theme.css';
import './styles/index.css';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <RenderErrorBoundary>
    <App />
  </RenderErrorBoundary>
);
