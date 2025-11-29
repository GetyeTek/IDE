import { greet } from './greeting.js';

document.addEventListener('DOMContentLoaded', () => {
    const appDiv = document.getElementById('app');
    if (appDiv) {
        appDiv.textContent = greet();
    }
});