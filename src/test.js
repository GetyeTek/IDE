// src/test.js

document.addEventListener('DOMContentLoaded', () => {
    const appDiv = document.getElementById('app');
    if (appDiv) {
        appDiv.innerHTML = 'ES Module Test Successful!';
    } else {
        console.error('App div not found');
    }
});
