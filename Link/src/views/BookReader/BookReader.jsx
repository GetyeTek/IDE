import React, { useState, useEffect, useRef } from 'react';
import { invokeBookReader } from '../../config/api.js';
import './BookReader.css';
import { renderBookBlock } from './subjects/Registry.jsx';

const BookReader = ({ book, onClose }) => {
    const [loading, setLoading] = useState(true);
    const [pages, setPages] = useState([]);
    const [isUiVisible, setIsUiVisible] = useState(true);
    const [currentTheme, setCurrentTheme] = useState('dark');
    const [contextMenu, setContextMenu] = useState(null);
    
    const viewportRef = useRef(null);
    const scrollContainerRef = useRef(null);
    const layerRef = useRef(null);
    const pageCountRef = useRef(null);
    
    const baseCanvasWidth = 794; 
    const currentScale = useRef(1.0);
    const minScale = useRef(1.0);
    const lastDisplayPage = useRef(1);

    const pinchState = useRef({
        isPinching: false,
        initialDist: 0,
        initialScale: 1
    });

    // 1. Fetch Pages
    useEffect(() => {
        const fetchPages = async () => {
            try {
                setLoading(true);
                const data = await invokeBookReader({ action: 'get_book_pages', book_id: book.id });
                if (data.pages && data.pages.length > 0) {
                    setPages(data.pages);
                } else {
                    setPages([{ id: 'mock-1', page_key: 'page-1', content_json: [
                        { type: 'title-page', main: book.title || "Untitled Document", sub: "Rendered via JSON Engine" },
                        { type: 'spacer', height: '100px'},
                        { type: 'paragraph', body: "This document is missing structured JSON data."}
                    ]}]);
                }
            } catch (error) {
                console.error("Error loading JSON pages:", error);
            } finally {
                setLoading(false);
            }
        };
        if (book?.id) fetchPages();
    }, [book]);

    // 2. Core Scaler Function
    const applyScale = (newScale) => {
        if (!scrollContainerRef.current || !layerRef.current) return;
        
        // Use scrollHeight to get the full unscaled height of all pages rendered
        const unscaledW = baseCanvasWidth;
        const unscaledH = layerRef.current.offsetHeight || layerRef.current.scrollHeight;

        // Force the invisible scroll container to expand physically, triggering native scrollbars
        scrollContainerRef.current.style.width = `${unscaledW * newScale}px`;
        scrollContainerRef.current.style.height = `${unscaledH * newScale}px`;
        
        // Scale the visual content flawlessly using CSS transforms
        layerRef.current.style.transform = `scale(${newScale})`;
        currentScale.current = newScale;
    };

    // 3. Initial Scale calculation to fit mobile screen width smoothly
    useEffect(() => {
        if (!loading && pages.length > 0) {
            // Slight delay ensures the DOM has painted the heights correctly before calculation
            requestAnimationFrame(() => {
                const vw = window.innerWidth;
                const fitScale = (vw - 20) / baseCanvasWidth;
                minScale.current = Math.min(fitScale, 1.0);
                currentScale.current = minScale.current;

                applyScale(currentScale.current);

                if (viewportRef.current) {
                    viewportRef.current.scrollTop = 0;
                    viewportRef.current.scrollLeft = 0;
                }
            });
        }
    }, [loading, pages]);

    // 4. Adapt to late-loading elements (like images) automatically
    useEffect(() => {
        if (loading || !layerRef.current || !scrollContainerRef.current) return;
        const ro = new ResizeObserver((entries) => {
            for (let entry of entries) {
                const unscaledH = entry.target.offsetHeight;
                if (unscaledH > 0) {
                    scrollContainerRef.current.style.height = `${unscaledH * currentScale.current}px`;
                }
            }
        });
        ro.observe(layerRef.current);
        return () => ro.disconnect();
    }, [loading]);

    // 5. Track page numbers using native scroll event (Throttled for performance)
    let scrollTicking = false;
    const handleScroll = () => {
        if (!pageCountRef.current || pages.length === 0 || !viewportRef.current) return;
        
        if (!scrollTicking) {
            window.requestAnimationFrame(() => {
                const unscaledY = viewportRef.current.scrollTop / currentScale.current;
                const approxPageHeight = 1183; // 1123px height + 60px gaps
                const current = Math.max(1, Math.floor((unscaledY + 200) / approxPageHeight) + 1);
                const displayPage = Math.min(current, pages.length);
                
                if (lastDisplayPage.current !== displayPage) {
                    lastDisplayPage.current = displayPage;
                    pageCountRef.current.innerText = `${displayPage} / ${pages.length}`;
                }
                scrollTicking = false;
            });
            scrollTicking = true;
        }
    };

    // 6. Flawless Multi-Touch Native Math
    useEffect(() => {
        const viewport = viewportRef.current;
        if (!viewport) return;

        const onTouchStart = (e) => {
            if (e.target.closest('#ui-layer') || e.target.closest('.fab-container') || e.target.closest('.reader-ctx-menu')) return;

            // Clear any text selection when pinching starts
            if (e.touches.length > 1) {
                window.getSelection()?.removeAllRanges();
                setContextMenu(null);
            }

            // ONLY intercept 2-finger pinches. Let the browser handle 1-finger scrolling naturally!
            if (e.touches.length === 2) {
                e.preventDefault(); 
                const t1 = e.touches[0];
                const t2 = e.touches[1];
                pinchState.current.isPinching = true;
                pinchState.current.initialDist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
                pinchState.current.initialScale = currentScale.current;
            }
        };

        const onTouchMove = (e) => {
            if (e.touches.length === 2 && pinchState.current.isPinching) {
                e.preventDefault(); // Stop native viewport zooming
                
                const t1 = e.touches[0];
                const t2 = e.touches[1];
                
                const dist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
                const cx = (t1.clientX + t2.clientX) / 2;
                const cy = (t1.clientY + t2.clientY) / 2;

                const ratio = dist / pinchState.current.initialDist;
                let newScale = pinchState.current.initialScale * ratio;
                newScale = Math.max(minScale.current, Math.min(newScale, 4.0)); // Min fit, Max 4.0x zoom

                // DOCUMENT-RELATIVE POINT LOCKING MATH
                const scrollLeft = viewport.scrollLeft;
                const scrollTop = viewport.scrollTop;
                const viewportRect = viewport.getBoundingClientRect();
                
                // 1. Where did the user pinch relative to the viewport window?
                const pinchX = cx - viewportRect.left;
                const pinchY = cy - viewportRect.top;

                // 2. Unscale that coordinate to find the exact raw pixel on the document
                const docX = (pinchX + scrollLeft) / currentScale.current;
                const docY = (pinchY + scrollTop) / currentScale.current;

                // 3. Apply the scale physically expanding the container
                applyScale(newScale);

                // 4. Calculate where that document pixel sits NOW after scaling
                const newScrollLeft = (docX * newScale) - pinchX;
                const newScrollTop = (docY * newScale) - pinchY;

                // 5. Instantly shift the scrollbar under their fingers to lock the zoom center
                viewport.scrollLeft = newScrollLeft;
                viewport.scrollTop = newScrollTop;
            }
        };

        const onTouchEnd = (e) => {
            if (e.touches.length < 2) pinchState.current.isPinching = false;
        };

        // Passive false is required to allow e.preventDefault() to stop native zooming
        viewport.addEventListener('touchstart', onTouchStart, { passive: false });
        viewport.addEventListener('touchmove', onTouchMove, { passive: false });
        viewport.addEventListener('touchend', onTouchEnd);
        
        return () => {
            viewport.removeEventListener('touchstart', onTouchStart);
            viewport.removeEventListener('touchmove', onTouchMove);
            viewport.removeEventListener('touchend', onTouchEnd);
        };
    }, []);

    // 7. Context Menu Logic
    useEffect(() => {
        let debounceTimer;
        const handleSelection = () => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                if (pinchState.current.isPinching) return;
                
                const selection = window.getSelection();
                if (selection && selection.toString().trim().length > 0) {
                    try {
                        const range = selection.getRangeAt(0);
                        const rect = range.getBoundingClientRect();
                        if (rect.width === 0 && rect.height === 0) return;
                        
                        const menuWidth = 280; const menuHeight = 100;
                        let x = rect.left + (rect.width / 2) - (menuWidth / 2);
                        let y = rect.top - menuHeight;
                        
                        x = Math.max(10, Math.min(x, window.innerWidth - menuWidth - 10));
                        y = Math.max(50, y);
                        
                        setContextMenu({ x, y, text: selection.toString() });
                    } catch(e) {}
                } else {
                    setContextMenu(null);
                }
            }, 150);
        };
        
        document.addEventListener('selectionchange', handleSelection);
        return () => { clearTimeout(debounceTimer); document.removeEventListener('selectionchange', handleSelection); };
    }, []);

    const toggleTheme = () => {
        const themes = ['dark', 'sepia', 'light'];
        setCurrentTheme(themes[(themes.indexOf(currentTheme) + 1) % themes.length]);
    };

    const handleMenuAction = (action) => {
        if (action === 'ask_miron') alert("Sending to AI: " + contextMenu.text.substring(0, 40));
        if (action === 'copy') navigator.clipboard.writeText(contextMenu.text);
        window.getSelection()?.removeAllRanges();
        setContextMenu(null);
    };

    const readerActions = {
        onAIExplore: () => alert("Exploring with AI...")
    };

    return (
        <div className={`reader-root theme-${currentTheme}`}>
            <div id="viewport" ref={viewportRef} onScroll={handleScroll}>
                <div id="scroll-container" ref={scrollContainerRef}>
                    <div id="book-layer" ref={layerRef}>
                        {pages.map((page) => (
                            <div key={page.id} className="page-wrapper">
                                <div className="page-canvas">
                                    {page.manual_flag && <div className="manual-flag">{page.manual_flag}</div>}
                                    {(page.content_json || []).map((block, idx) => renderBookBlock(block, idx, readerActions))}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
                {loading && <div className="loading-spinner">Calibrating Knowledge Engine...</div>}
            </div>

            {contextMenu && (
                <div 
                    className="reader-ctx-menu" 
                    style={{ left: contextMenu.x, top: contextMenu.y }}
                    onMouseDown={(e) => e.preventDefault()}
                    onTouchStart={(e) => e.stopPropagation()}
                >
                    <div className="ctx-primary" onClick={() => handleMenuAction('ask_miron')}>
                        <i className="fa-solid fa-wand-magic-sparkles"></i> <span>Ask Miron</span>
                    </div>
                    <div className="ctx-grid" style={{marginTop: '8px'}}>
                        <div className="ctx-btn" onClick={() => handleMenuAction('copy')}><i className="fa-regular fa-copy"></i><span>Copy</span></div>
                        <div className="ctx-btn"><i className="fa-solid fa-highlighter"></i><span>Highlight</span></div>
                        <div className="ctx-btn"><i className="fa-solid fa-share-nodes"></i><span>Share</span></div>
                    </div>
                </div>
            )}

            <div id="main-fab" className={`fab-container ${isUiVisible ? 'active' : ''}`}>
                <div className="fab-options">
                    <div className="fab-mini" onClick={toggleTheme}>
                        <i className="fa-solid fa-palette"></i>
                    </div>
                </div>
                <div className="fab-main" onClick={() => setIsUiVisible(!isUiVisible)}>
                    <i className="fa-solid fa-layer-group"></i>
                </div>
            </div>

            <div id="ui-layer" className={isUiVisible ? '' : 'hidden'}>
                <div className="ui-bar reader-header">
                    <div className="header-left">
                        <div className="icon-btn" onClick={onClose}><i className="fa-solid fa-arrow-left"></i></div>
                        <div className="header-title">{book?.title || 'Loading Document'}</div>
                    </div>
                </div>

                <div className="ui-bar reader-footer">
                    <div className="icon-btn"><i className="fa-solid fa-list"></i></div>
                    <span style={{flex: 1, textAlign: 'center', fontFamily: 'monospace', color: '#888'}} ref={pageCountRef}>1 / {pages.length || '--'}</span>
                    <div className="icon-btn"><i className="fa-solid fa-bookmark"></i></div>
                </div>
            </div>
        </div>
    );
};

export default BookReader;