import React, { useState, useEffect, useRef } from 'react';
import './BookReader.css';

const CONFIG = { friction: 0.93, velocityMult: 1.5, maxZoom: 6.0 };

const BookReader = ({ book, onClose }) => {
    const [loading, setLoading] = useState(true);
    const [iframeSrc, setIframeSrc] = useState(null);
    const [isUiVisible, setIsUiVisible] = useState(true);
    const [isFabActive, setIsFabActive] = useState(false);
    const [currentTheme, setCurrentTheme] = useState('light'); // light, sepia, dark
    
    const viewportRef = useRef(null);
    const iframeRef = useRef(null);
    const layerRef = useRef(null);
    const requestRef = useRef(null);
    const sliderRef = useRef(null);
    const pageCountRef = useRef(null);
    
    // Physics State
    const state = useRef({ x: 0, y: 0, scale: 1 });
    const velocity = useRef({ x: 0, y: 0 });
    const contentDims = useRef({ width: 0, height: 0 });
    const minScaleLimit = useRef(1.0);
    
    // Input State
    const input = useRef({
        isSliderDragging: false,
        isDragging: false,
        startX: 0, startY: 0,
        lastX: 0, lastY: 0,
        lastTime: 0,
        initialPinchDist: 0,
        initialScale: 1,
        dragTotalDistance: 0,
        touchStartTime: 0
    });

    // Fetch Book Data
    useEffect(() => {
        const fetchBook = async () => {
            console.log("[READER] Initializing fetch for:", book.path);
            try {
                setLoading(true);
                const response = await fetch('https://xvldfsmxskhemkslsbym.supabase.co/functions/v1/book-reader', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        action: 'get_book_compressed',
                        book_path: book.path
                    })
                });
                
                if (!response.ok) throw new Error("Failed to fetch book");
                
                const blob = await response.blob();
                console.log("[READER] Blob received, size:", blob.size);
                const url = URL.createObjectURL(blob);
                setIframeSrc(url);
            } catch (error) {
                console.error("Error loading book:", error);
                alert("Failed to load book content.");
                onClose();
            } finally {
                setLoading(false);
            }
        };

        if (book?.path) fetchBook();
        
        return () => {
            if (iframeSrc) URL.revokeObjectURL(iframeSrc);
        };
    }, [book]);

    // Handle interactions inside the iframe (since buttons are injected HTML)
    useEffect(() => {
        const handleIframeClick = (e) => {
            const target = e.target;
            console.log("[IFRAME_CLICK]", target.tagName, target.className);
            if (target.classList.contains('q-opt-btn')) {
                // Visual feedback for selection
                const parent = target.parentElement;
                parent.querySelectorAll('.q-opt-btn').forEach(btn => btn.style.borderColor = 'rgba(255,255,255,0.1)');
                target.style.borderColor = '#42d7b8';
                target.style.background = 'rgba(66, 215, 184, 0.1)';
            }
            if (target.classList.contains('q-submit')) {
                target.innerText = "Correct! +5 Linkoins";
                target.style.background = "#b1d34b";
                // Future: Call Supabase to increment balance
            }
        };

        const iframe = document.getElementById('book-iframe');
        if (iframe) {
            iframe.contentWindow.addEventListener('click', handleIframeClick);
        }
        return () => {
            if (iframe && iframe.contentWindow) iframe.contentWindow.removeEventListener('click', handleIframeClick);
        };
    }, [iframeSrc]);

    // Handle Iframe Load & Sizing
    const handleIframeLoad = (e) => {
        console.log("[IFRAME] Content Loaded");
        const iframe = e.target;
        iframeRef.current = iframe;
        
        // Small delay to ensure the blob document is fully parsed by the browser
        setTimeout(() => {
            try {
                const doc = iframe.contentDocument || iframe.contentWindow.document;
                if (!doc) return;

                const docBody = doc.body;
                const docEl = doc.documentElement;

                // Standardize the iframe internal layout
                docBody.style.margin = '0';
                docBody.style.padding = '0';
                docBody.style.overflow = 'hidden';

                // --- DYNAMIC SCALING ENGINE ---
                // Calculate the ratio between the Screen Width and the Book Content Width.
                const fitScale = window.innerWidth / w;
                
                // We want the text to visually appear as ~18px on the user's screen, 
                // regardless of how much the book is zoomed out.
                // Formula: CSS_Size = Target_Visual_Size / Zoom_Level
                const targetVisualSize = 18;
                const baseFontSize = Math.max(16, targetVisualSize / fitScale);

                const style = doc.createElement('style');
                style.textContent = `
                    @import url('https://fonts.googleapis.com/css2?family=Poppins:wght@500;700&display=swap');

                    /* --- THEME ENGINE --- */
                    body { transition: background-color 0.3s ease, color 0.3s ease; }
                    
                    /* Dark Theme */
                    body.theme-dark, 
                    body.theme-dark .page, 
                    body.theme-dark .page-container, 
                    body.theme-dark .text-container {
                        background-color: #121212 !important;
                        color: #d0d0d0 !important;
                    }
                    body.theme-dark span, 
                    body.theme-dark p, 
                    body.theme-dark div {
                        color: #d0d0d0 !important;
                        background-color: transparent !important;
                    }
                    body.theme-dark img { opacity: 0.85; mix-blend-mode: normal; }

                    /* Sepia Theme */
                    body.theme-sepia, 
                    body.theme-sepia .page, 
                    body.theme-sepia .page-container {
                        background-color: #f4ecd8 !important;
                        color: #5b4636 !important;
                    }
                    body.theme-sepia span, 
                    body.theme-sepia p {
                        color: #5b4636 !important;
                        background-color: transparent !important;
                    }
                    body.theme-sepia .miron-question-card {
                        background: #eaddcf !important;
                        border-color: #d3c4b1 !important;
                        color: #5b4636 !important;
                    }
                    body.theme-sepia .q-label { color: #8a6a4b !important; }
                    body.theme-sepia .miron-orb-mini { background: #8a6a4b !important; }
                    body.theme-sepia .q-opt-btn { background: rgba(91, 70, 54, 0.05) !important; border-color: rgba(91, 70, 54, 0.15) !important; color: #5b4636 !important; }
                    body.theme-sepia .q-submit { background: #8a6a4b !important; color: #f4ecd8 !important; }
                    body.theme-sepia .q-match-item {
                        background: rgba(91, 70, 54, 0.05) !important;
                        border-color: rgba(91, 70, 54, 0.2) !important;
                        color: #5b4636 !important;
                    }
                    body.theme-sepia .q-column-b .q-match-item {
                        background: rgba(138, 106, 75, 0.1) !important;
                        border-color: #8a6a4b !important;
                    }
                    
                    /* The Root Container sets the Base Font Size */
                    .miron-portal-container {
                        width: 90%;
                        max-width: 800px;
                        margin: 3em auto;
                        font-family: 'Poppins', sans-serif;
                        font-size: ${baseFontSize}px; /* Dynamic Base */
                        position: relative;
                        z-index: 100;
                    }

                    /* All children use 'em' to scale relative to the dynamic base */
                    .miron-question-card {
                        background: #1a1a1a;
                        border: 1px solid rgba(66, 215, 184, 0.3);
                        border-radius: 1.5em;
                        padding: 2em;
                        box-shadow: 0 1em 3em rgba(0,0,0,0.6);
                        color: #e0e0e0;
                    }
                    .q-header {
                        display: flex;
                        align-items: center;
                        margin-bottom: 1.5em;
                        gap: 0.75em;
                    }
                    .miron-orb-mini {
                        width: 1em;
                        height: 1em;
                        background: #42d7b8;
                        border-radius: 50%;
                        box-shadow: 0 0 0.8em rgba(66, 215, 184, 0.6);
                    }
                    .q-label {
                        color: #42d7b8;
                        font-weight: 700;
                        letter-spacing: 0.1em;
                        font-size: 0.85em; 
                        text-transform: uppercase;
                    }
                    .q-points-badge {
                        margin-left: auto;
                        font-size: 0.75em;
                        opacity: 0.6;
                        font-family: monospace;
                    }
                    .q-text {
                        font-size: 1.3em; 
                        line-height: 1.5;
                        margin-bottom: 1.2em;
                        font-weight: 500;
                    }
                    .q-media-content {
                        width: 100%;
                        border-radius: 1em;
                        margin-bottom: 1.5em;
                        border: 1px solid rgba(255,255,255,0.1);
                        display: block;
                    }
                    /* Matching Layout */
                    .q-matching-container {
                        display: grid;
                        grid-template-columns: 1fr 1fr;
                        gap: 1em;
                        margin-bottom: 1.5em;
                    }
                    .q-match-column {
                        display: flex;
                        flex-direction: column;
                        gap: 0.6em;
                    }
                    .q-match-item {
                        padding: 0.8em 1em;
                        border-radius: 0.6em;
                        font-size: 0.9em;
                        background: rgba(255,255,255,0.03);
                        border: 1px dashed rgba(255,255,255,0.1);
                        min-height: 3em;
                        display: flex;
                        align-items: center;
                    }
                    .q-column-b .q-match-item {
                        border-style: solid;
                        border-color: rgba(66, 215, 184, 0.2);
                        background: rgba(66, 215, 184, 0.02);
                    }
                    .q-options {
                        display: flex;
                        flex-direction: column;
                        gap: 0.75em;
                    }
                    .q-opt-btn {
                        background: rgba(255,255,255,0.05);
                        border: 2px solid rgba(255,255,255,0.1);
                        padding: 1em 1.25em;
                        border-radius: 0.8em;
                        color: #fff;
                        font-size: 1em;
                        font-family: inherit;
                        text-align: left;
                        cursor: pointer;
                        transition: all 0.2s;
                    }
                    .q-opt-btn:active, .q-opt-btn:hover {
                        background: rgba(66, 215, 184, 0.1);
                        border-color: #42d7b8;
                    }
                    .q-submit {
                        margin-top: 1.5em;
                        width: 100%;
                        padding: 1em;
                        background: #42d7b8;
                        color: #0c0c0c;
                        font-weight: 700;
                        font-size: 1.1em;
                        font-family: inherit;
                        border: none;
                        border-radius: 0.8em;
                        cursor: pointer;
                        box-shadow: 0 0.25em 1em rgba(66, 215, 184, 0.4);
                    }
                `;
                doc.head.appendChild(style);
                
                // Apply initial theme
                doc.body.className = `theme-${currentTheme}`;

                // Measure the actual full content size
                const w = Math.max(docBody.scrollWidth, docBody.offsetWidth, docEl.clientWidth, docEl.scrollWidth);
                const h = Math.max(docBody.scrollHeight, docBody.offsetHeight, docEl.clientHeight, docEl.scrollHeight);

                contentDims.current = { width: w, height: h };

                const mironCount = doc.querySelectorAll('.miron-question-card').length;
                console.log(`[IFRAME] Dimensions: ${w}x${h}. Miron Challenges detected: ${mironCount}`);
                
                if (layerRef.current) {
                    layerRef.current.style.width = `${w}px`;
                    layerRef.current.style.height = `${h}px`;
                }

                // Calculate initial scale to fit width
                const vw = window.innerWidth;
                minScaleLimit.current = vw / w;
                state.current.scale = minScaleLimit.current;
                
                // Centering initial view
                state.current.x = 0;
                state.current.y = 0;

                console.log("Book Content Initialized:", w, "x", h);
            } catch (err) {
                console.error("Iframe Load Error:", err);
            }
        }, 100);
    };

    // Apply Theme Changes
    useEffect(() => {
        if (iframeRef.current) {
            const doc = iframeRef.current.contentDocument || iframeRef.current.contentWindow.document;
            if (doc && doc.body) {
                doc.body.className = `theme-${currentTheme}`;
            }
        }
    }, [currentTheme]);

    const toggleTheme = () => {
        const themes = ['light', 'sepia', 'dark'];
        const nextIndex = (themes.indexOf(currentTheme) + 1) % themes.length;
        setCurrentTheme(themes[nextIndex]);
        setIsFabActive(false);
    };

    const handleFitPage = () => {
        // Reset Zoom to Width Fit
        const currentRealY = state.current.y / state.current.scale;
        state.current.scale = minScaleLimit.current;
        state.current.x = 0;
        state.current.y = currentRealY * state.current.scale; // Maintain relative Y position
        velocity.current = { x: 0, y: 0 };
        setIsFabActive(false);
    };

    // --- OPTIMIZED PHYSICS ENGINE ---

    const applyConstraints = () => {
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const { width, height } = contentDims.current;
        const s = state.current;
        const v = velocity.current;
        
        const visualW = width * s.scale;
        const visualH = height * s.scale;

        // X Constraint
        if (visualW < vw) {
            s.x = (vw - visualW) / 2;
            v.x = 0;
        } else {
            if (s.x > 0) { s.x = 0; v.x = 0; }
            if (s.x < vw - visualW) { s.x = vw - visualW; v.x = 0; }
        }

        // Y Constraint
        if (visualH < vh) {
            s.y = (vh - visualH) / 2;
            v.y = 0;
        } else {
            if (s.y > 0) { s.y = 0; v.y = 0; }
            if (s.y < vh - visualH) { s.y = vh - visualH; v.y = 0; }
        }
    };

    // The Single Render Loop
    // Decouples input frequency from screen refresh rate for buttery smooth motion
    const loop = () => {
        // 1. Apply Physics if not dragging
        if (!input.current.isDragging) {
            const v = velocity.current;
            if (Math.abs(v.x) > 0.1 || Math.abs(v.y) > 0.1) {
                v.x *= CONFIG.friction;
                v.y *= CONFIG.friction;
                state.current.x += v.x;
                state.current.y += v.y;
            }
        }

        // 2. Apply Constraints (Borders)
        applyConstraints();

        // 3. Render to DOM
        if (layerRef.current) {
            const { x, y, scale } = state.current;
            // Using transform3d for hardware acceleration
            layerRef.current.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${scale})`;
        }

        // 4. Update UI (Slider & Pages)
        if (sliderRef.current && pageCountRef.current && contentDims.current.height > 0) {
            // Use Unscaled values for stability across Zoom levels
            const unscaledTotalH = contentDims.current.height;
            const unscaledY = Math.abs(state.current.y) / state.current.scale;
            const viewHeight = window.innerHeight / state.current.scale;
            
            // Slider Progress (0-100%)
            // We compare unscaled position against the maximum possible unscaled scroll
            const maxScroll = Math.max(1, unscaledTotalH - viewHeight);
            
            if (!input.current.isSliderDragging) {
                const progress = (unscaledY / maxScroll) * 100;
                sliderRef.current.value = Math.max(0, Math.min(100, progress));
            }

            // Page Count Logic (Standard Book Ratio 1.3)
            // This calculates pages based on content dimensions (like an ebook), not screen height.
            // It ensures the count is stable (doesn't change with zoom) and more accurate (higher count on mobile).
            const bookPageHeight = contentDims.current.width * 1.3;
            const totalPages = Math.max(1, Math.ceil(unscaledTotalH / bookPageHeight));
            
            // Calculate current page based on the top visible edge
            const currentPage = Math.min(totalPages, Math.max(1, Math.floor((unscaledY + (bookPageHeight * 0.3)) / bookPageHeight) + 1));
            
            pageCountRef.current.innerText = `${currentPage}/${totalPages}`;
        }

        // 5. Continue Loop
        requestRef.current = requestAnimationFrame(loop);
    };

    const onSliderInput = (e) => {
        const val = parseFloat(e.target.value);
        // We reverse the math: calculate Y based on unscaled percentage
        const unscaledTotalH = contentDims.current.height;
        const viewHeight = window.innerHeight / state.current.scale;
        const maxScroll = Math.max(1, unscaledTotalH - viewHeight);
        
        const targetUnscaledY = (val / 100) * maxScroll;
        
        // Apply back to state (negate because Y is negative for scrolling down)
        state.current.y = -(targetUnscaledY * state.current.scale);
        velocity.current = { x: 0, y: 0 }; // Stop momentum
    };

    // Event Handlers
    useEffect(() => {
        const viewport = viewportRef.current;
        if (!viewport) return;

        // Start the render loop on mount
        requestRef.current = requestAnimationFrame(loop);

        const onTouchStart = (e) => {
            if (e.target.closest('#ui-layer') || e.target.closest('.fab-container')) return;
            e.preventDefault();
            
            velocity.current = { x: 0, y: 0 };
            input.current.dragTotalDistance = 0;
            input.current.touchStartTime = Date.now();

            if (e.touches.length === 1) {
                input.current.isDragging = true;
                input.current.startX = e.touches[0].clientX - state.current.x;
                input.current.startY = e.touches[0].clientY - state.current.y;
                input.current.lastX = e.touches[0].clientX;
                input.current.lastY = e.touches[0].clientY;
                input.current.lastTime = Date.now();
            } else if (e.touches.length === 2) {
                input.current.isDragging = false;
                input.current.initialPinchDist = Math.hypot(
                    e.touches[0].pageX - e.touches[1].pageX,
                    e.touches[0].pageY - e.touches[1].pageY
                );
                input.current.initialScale = state.current.scale;
            }
        };

        const onTouchMove = (e) => {
            if (e.target.closest('#ui-layer')) return;
            e.preventDefault();

            // NOTE: We do NOT call render() here. We only update data.
            // The loop() running on RAF will pick this up automatically.

            if (input.current.isDragging && e.touches.length === 1) {
                const x = e.touches[0].clientX;
                const y = e.touches[0].clientY;
                const dt = Date.now() - input.current.lastTime;
                
                input.current.dragTotalDistance += Math.hypot(x - input.current.lastX, y - input.current.lastY);
                
                // Direct update of position state (Loop will render it)
                state.current.x = x - input.current.startX;
                state.current.y = y - input.current.startY;

                // Calculate velocity for throw effect later
                if (dt > 0) {
                    velocity.current.x = (x - input.current.lastX) * CONFIG.velocityMult;
                    velocity.current.y = (y - input.current.lastY) * CONFIG.velocityMult;
                }
                
                input.current.lastX = x;
                input.current.lastY = y;
                input.current.lastTime = Date.now();
            } 
            else if (e.touches.length === 2) {
                input.current.dragTotalDistance += 100;
                const dist = Math.hypot(
                    e.touches[0].pageX - e.touches[1].pageX,
                    e.touches[0].pageY - e.touches[1].pageY
                );
                const cx = (e.touches[0].pageX + e.touches[1].pageX) / 2;
                const cy = (e.touches[0].pageY + e.touches[1].pageY) / 2;
                
                const ratio = dist / input.current.initialPinchDist;
                let newScale = input.current.initialScale * ratio;
                newScale = Math.max(minScaleLimit.current, Math.min(newScale, CONFIG.maxZoom));

                const contentX = (cx - state.current.x) / state.current.scale;
                const contentY = (cy - state.current.y) / state.current.scale;

                state.current.x = cx - (contentX * newScale);
                state.current.y = cy - (contentY * newScale);
                state.current.scale = newScale;
            }
        };

        const onTouchEnd = (e) => {
            if (e.target.closest('#ui-layer')) return;
            const duration = Date.now() - input.current.touchStartTime;
            
            if (input.current.isDragging && duration < 300 && input.current.dragTotalDistance < 10) {
                setIsUiVisible(prev => !prev);
                setIsFabActive(false);
            }
            
            if (input.current.isDragging && e.touches.length === 0) {
                input.current.isDragging = false;
                // Loop continues automatically and will now pick up velocity
            }
        };

        // Mouse Fallbacks (Simplified for brevity, logic remains same)
        const onMouseDown = (e) => {
            if(e.target.closest('#ui-layer')) return;
            input.current.isDragging = true;
            input.current.dragTotalDistance = 0;
            input.current.touchStartTime = Date.now();
            input.current.startX = e.clientX - state.current.x;
            input.current.startY = e.clientY - state.current.y;
            input.current.lastX = e.clientX;
            input.current.lastY = e.clientY;
        };

        const onMouseMove = (e) => {
            if (input.current.isDragging) {
                e.preventDefault();
                input.current.dragTotalDistance += Math.hypot(e.clientX - input.current.lastX, e.clientY - input.current.lastY);
                input.current.lastX = e.clientX;
                input.current.lastY = e.clientY;
                state.current.x = e.clientX - input.current.startX;
                state.current.y = e.clientY - input.current.startY;
            }
        };

        const onMouseUp = () => {
            if (input.current.isDragging) {
                const duration = Date.now() - input.current.touchStartTime;
                if (duration < 300 && input.current.dragTotalDistance < 5) setIsUiVisible(prev => !prev);
                input.current.isDragging = false;
            }
        };
        
        const onWheel = (e) => {
            e.preventDefault();
            if (e.ctrlKey) {
                let s = state.current.scale - e.deltaY * 0.01;
                state.current.scale = Math.max(minScaleLimit.current, Math.min(s, CONFIG.maxZoom));
            } else {
                state.current.y -= e.deltaY;
                state.current.x -= e.deltaX;
            }
        };

        viewport.addEventListener('touchstart', onTouchStart, { passive: false });
        viewport.addEventListener('touchmove', onTouchMove, { passive: false });
        viewport.addEventListener('touchend', onTouchEnd);
        viewport.addEventListener('mousedown', onMouseDown);
        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
        viewport.addEventListener('wheel', onWheel, { passive: false });

        return () => {
            viewport.removeEventListener('touchstart', onTouchStart);
            viewport.removeEventListener('touchmove', onTouchMove);
            viewport.removeEventListener('touchend', onTouchEnd);
            viewport.removeEventListener('mousedown', onMouseDown);
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
            viewport.removeEventListener('wheel', onWheel);
            if (requestRef.current) cancelAnimationFrame(requestRef.current);
        };
    }, []);

    return (
        <div className="reader-root">
            <div id="viewport" ref={viewportRef}>
                <div id="book-layer" ref={layerRef}>
                    {iframeSrc && (
                        <iframe 
                            id="book-iframe" 
                            src={iframeSrc} 
                            onLoad={handleIframeLoad}
                            title="Book Content"
                        />
                    )}
                </div>
                {loading && <div className="loading-spinner">Loading Book...</div>}
            </div>

            <div id="ui-layer" className={isUiVisible ? '' : 'hidden'}>
                {/* HEADER */}
                <div className="ui-bar reader-header">
                    <div className="header-left">
                        <div className="icon-btn" onClick={onClose}>
                            <svg className="reader-svg" viewBox="0 0 24 24"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg>
                        </div>
                        <div className="header-title">{book?.title || 'Loading...'}</div>
                    </div>
                    <div className="header-right">
                        <div className="icon-btn">
                            <svg className="reader-svg" viewBox="0 0 24 24"><path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/></svg>
                        </div>
                    </div>
                </div>

                {/* FAB MENU */}
                <div className={`fab-container ${isFabActive ? 'active' : ''}`}>
                    <div className="fab-options">
                        <div className="fab-mini" data-label="Theme: Light/Sepia/Dark" onClick={toggleTheme}>
                            <svg className="reader-svg" viewBox="0 0 24 24"><path d="M12 3c-4.97 0-9 4.03-9 9s4.03 9 9 9c.83 0 1.5-.67 1.5-1.5 0-.39-.15-.74-.39-1.01-.23-.26-.38-.61-.38-.99 0-.83.67-1.5 1.5-1.5H16c2.76 0 5-2.24 5-5 0-4.42-4.03-8-9-8zm-5.5 9c-.83 0-1.5-.67-1.5-1.5S5.67 9 6.5 9 8 9.67 8 10.5 7.33 12 6.5 12zm3-4C8.67 8 8 7.33 8 6.5S8.67 5 9.5 5s1.5.67 1.5 1.5S10.33 8 9.5 8zm5 0c-.83 0-1.5-.67-1.5-1.5S13.67 5 14.5 5s1.5.67 1.5 1.5S15.33 8 14.5 8zm3 4c-.83 0-1.5-.67-1.5-1.5S16.67 9 17.5 9s1.5.67 1.5 1.5-.67 1.5-1.5 1.5z"/></svg>
                        </div>
                        <div className="fab-mini" data-label="Reset Zoom" onClick={handleFitPage}>
                            <svg className="reader-svg" viewBox="0 0 24 24"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V5h14v14zm-5-7l-3 3.72L9 13l-3 4h12l-4-5z"/></svg>
                        </div>
                    </div>
                    <div className="fab-main" onClick={(e) => { e.stopPropagation(); setIsFabActive(!isFabActive); }}>
                        <svg className="reader-svg" style={{width:'32px', height:'32px', fill:'#1a1a1a'}} viewBox="0 0 24 24"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
                    </div>
                </div>

                {/* FOOTER */}
                <div className="ui-bar reader-footer">
                    <div className="icon-btn">
                        <svg className="reader-svg" viewBox="0 0 24 24"><path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>
                    </div>
                    <div className="slider-container">
                        <div className="track-bg"></div>
                        <input 
                            ref={sliderRef}
                            type="range" 
                            min="0" 
                            max="100" 
                            step="0.1"
                            defaultValue="0"
                            onInput={onSliderInput}
                            onTouchStart={() => input.current.isSliderDragging = true}
                            onTouchEnd={() => input.current.isSliderDragging = false}
                            onMouseDown={() => input.current.isSliderDragging = true}
                            onMouseUp={() => input.current.isSliderDragging = false}
                        />
                    </div>
                    <span className="page-count" ref={pageCountRef}>1/--</span>
                    <div className="icon-btn">
                        <svg className="reader-svg" viewBox="0 0 24 24"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default BookReader;