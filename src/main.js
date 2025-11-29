// src/main.js
import { greet } from './module.js';

document.addEventListener('DOMContentLoaded', () => {
    const appDiv = document.getElementById('app');
    if (appDiv) {
        appDiv.innerHTML = greet('World');
    } else {
        console.error('App div not found');
    }
});