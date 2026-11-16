import React from 'react';
import ReactDOM from 'react-dom/client';
import { VrmOverlayPage } from './routes/VrmOverlayPage.js';
document.documentElement.dataset.vrmOverlay = '';
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><VrmOverlayPage /></React.StrictMode>);
