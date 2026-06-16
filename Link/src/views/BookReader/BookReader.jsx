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
    const cachedDocHeight = useRef(0);

    const pinchState = useRef({
        isPinching: false,
        initialDist: 0,
        initialScale: 1,
        viewportLeft: 0,
        viewportTop: 0,
        docHeight: 0,
        docX: 0,
        docY: 0
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

    // 2. Initial Setup & Adapting to Screen Size
    useEffect(() => {
        if (!loading && pages.length > 0) {
            requestAnimationFrame(() => {
                if (!layerRef.current || !scrollContainerRef.current) return;
                
                const vw = window.innerWidth;
                const fitScale = (vw - 20) / baseCanvasWidth;
                minScale.current = Math.min(fitScale, 1.0);
                currentScale.current = minScale.current;

                const unscaledH = layerRef.current.offsetHeight;
                cachedDocHeight.current = unscaledH;

                scrollContainerRef.current.style.width = `${baseCanvasWidth * currentScale.current}px`;
                scrollContainerRef.current.style.height = `${unscaledH * currentScale.current}px`;
                layerRef.current.style.transform = `scale(${currentScale.current})`;

                if (viewportRef.current) {
                    viewportRef.current.scrollTop = 0;
                    viewportRef.current.scrollLeft = 0;
                }
            });
        }
    }, [loading, pages]);

    // 3. Smart ResizeObserver (Debounced to prevent layout thrashing)
    useEffect(() => {
        if (loading || !layerRef.current || !scrollContainerRef.current) return;
        const ro = new ResizeObserver((entries) => {
            for (let entry of entries) {
                const unscaledH = entry.target.offsetHeight;
                // Only update if height changed significantly (e.g. images loaded)
                if (unscaledH > 0 && Math.abs(unscaledH - cachedDocHeight.current) > 50) {
                    cachedDocHeight.current = unscaledH;
                    if (!pinchState.current.isPinching) {
                        scrollContainerRef.current.style.height = `${unscaledH * currentScale.current}px`;
                    }
                }
            }
        });
        ro.observe(layerRef.current);
        return () => ro.disconnect();
    }, [loading]);

    // 4. Track page numbers (Native Scroll)
    let scrollTicking = false;
    const handleScroll = () => {
        if (!pageCountRef.current || pages.length === 0 || !viewportRef.current) return;
        
        if (!scrollTicking) {
            window.requestAnimationFrame(() => {
                const unscaledY = viewportRef.current.scrollTop / currentScale.current;
                const approxPageHeight = 1183;
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

    // 5. DOM-Readless Pinch Physics
    useEffect(() => {
        const viewport = viewportRef.current;
        const container = scrollContainerRef.current;
        const layer = layerRef.current;
        if (!viewport || !container || !layer) return;

        let ticking = false;

        const onTouchStart = (e) => {
            if (e.target.closest('#ui-layer') || e.target.closest('.fab-container') || e.target.closest('.reader-ctx-menu')) return;

            if (e.touches.length > 1) {
                window.getSelection()?.removeAllRanges();
                setContextMenu(null);
            }

            if (e.touches.length === 2) {
                e.preventDefault(); 
                const t1 = e.touches[0];
                const t2 = e.touches[1];
                
                const cx = (t1.clientX + t2.clientX) / 2;
                const cy = (t1.clientY + t2.clientY) / 2;
                
                // Read the DOM exactly ONCE before the pinch starts
                const rect = viewport.getBoundingClientRect();
                const pinchX = cx - rect.left;
                const pinchY = cy - rect.top;

                pinchState.current = {
                    isPinching: true,
                    initialDist: Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY),
                    initialScale: currentScale.current,
                    viewportLeft: rect.left,
                    viewportTop: rect.top,
                    docHeight: cachedDocHeight.current,
                    // The exact unscaled document pixel resting beneath their fingers
                    docX: (pinchX + viewport.scrollLeft) / currentScale.current,
                    docY: (pinchY + viewport.scrollTop) / currentScale.current
                };
            }
        };

        const onTouchMove = (e) => {
            if (e.touches.length === 2 && pinchState.current.isPinching) {
                e.preventDefault(); 
                
                if (!ticking) {
                    // Extract coordinates synchronously
                    const t1 = e.touches[0];
                    const t2 = e.touches[1];
                    const cx = (t1.clientX + t2.clientX) / 2;
                    const cy = (t1.clientY + t2.clientY) / 2;
                    const dist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);

                    // Offload pure math to animation frame
                    requestAnimationFrame(() => {
                        const state = pinchState.current;
                        const ratio = dist / state.initialDist;
                        let newScale = state.initialScale * ratio;
                        newScale = Math.max(minScale.current, Math.min(newScale, 4.0));

                        // Find where the pinch center moved to (pan tracking)
                        const pinchX = cx - state.viewportLeft;
                        const pinchY = cy - state.viewportTop;

                        // Apply new scale mathematically
                        container.style.width = `${baseCanvasWidth * newScale}px`;
                        container.style.height = `${state.docHeight * newScale}px`;
                        layer.style.transform = `scale(${newScale})`;
                        currentScale.current = newScale;

                        // Instantly shift scrollbars so the original document pixel stays glued under their fingers
                        viewport.scrollLeft = (state.docX * newScale) - pinchX;
                        viewport.scrollTop = (state.docY * newScale) - pinchY;

                        ticking = false;
                    });
                    ticking = true;
                }
            }
        };

        const onTouchEnd = (e) => {
            if (e.touches.length < 2) pinchState.current.isPinching = false;
        };

        viewport.addEventListener('touchstart', onTouchStart, { passive: false });
        viewport.addEventListener('touchmove', onTouchMove, { passive: false });
        viewport.addEventListener('touchend', onTouchEnd);
        
        return () => {
            viewport.removeEventListener('touchstart', onTouchStart);
            viewport.removeEventListener('touchmove', onTouchMove);
            viewport.removeEventListener('touchend', onTouchEnd);
        };
    }, []);

    // 6. Context Menu Logic (Zero-Latency Tracking)
    // 7. Context Menu Logic (Finger-Release Tracking)
    const isUserTouching = useRef(false);

    useEffect(() => {
        let evaluateTimer;

        const checkSelection = () => {
            if (pinchState.current.isPinching || isUserTouching.current) return;
            
            const selection = window.getSelection();
            if (selection && selection.toString().trim().length > 0) {
                try {
                    const range = selection.getRangeAt(0);
                    const rect = range.getBoundingClientRect();
                    if (rect.width === 0 && rect.height === 0) return;
                    
                    const menuWidth = 280; const menuHeight = 100;
                    let x = rect.left + (rect.width / 2) - (menuWidth / 2);
                    let y = rect.top - menuHeight - 15; 
                    
                    x = Math.max(10, Math.min(x, window.innerWidth - menuWidth - 10));
                    y = Math.max(50, y);
                    
                    setContextMenu({ x, y, text: selection.toString() });
                } catch(e) {}
            } else {
                setContextMenu(null);
            }
        };

        const handleSelectionChange = () => {
            // Instantly hide the menu while the user is actively dragging handles
            setContextMenu(null);
            clearTimeout(evaluateTimer);
            
            // Only evaluate the selection if the user is not actively touching the screen
            if (!isUserTouching.current) {
                evaluateTimer = setTimeout(checkSelection, 100);
            }
        };

        const handleTouchStart = () => {
            isUserTouching.current = true;
            setContextMenu(null); // Ensure menu hides immediately on screen touch
        };

        const handleTouchEnd = () => {
            isUserTouching.current = false;
            // Wait a tiny fraction of a second for the OS selection engine to finalize
            clearTimeout(evaluateTimer);
            evaluateTimer = setTimeout(checkSelection, 100);
        };

        // We attach these to the document to catch interactions even if they start outside the viewport
        document.addEventListener('selectionchange', handleSelectionChange);
        document.addEventListener('touchstart', handleTouchStart, { passive: true });
        document.addEventListener('touchend', handleTouchEnd, { passive: true });

        return () => { 
            clearTimeout(evaluateTimer); 
            document.removeEventListener('selectionchange', handleSelectionChange); 
            document.removeEventListener('touchstart', handleTouchStart);
            document.removeEventListener('touchend', handleTouchEnd);
        };
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
            <div 
                id="viewport" 
                ref={viewportRef} 
                onScroll={handleScroll}
                onContextMenu={(e) => e.preventDefault()} /* Kills native right-click/long-press menu on Android/Desktop */
            >
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