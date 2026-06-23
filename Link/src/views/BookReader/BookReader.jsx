import React, { useState, useEffect, useRef } from 'react';
import { invokeBookReader } from '../../config/api.js';
import './BookReader.css';
import { renderBookBlock } from './subjects/Registry.jsx';

const BookReader = ({ book, onClose, targetPageNumber, targetBlockIndex, zIndexOverride }) => {
    const [loading, setLoading] = useState(true);
    const [pages, setPages] = useState([]);
    const [isUiVisible, setIsUiVisible] = useState(true);
    const [currentTheme, setCurrentTheme] = useState('dark');
    const [contextMenu, setContextMenu] = useState(null);
    const [mappedQuestions, setMappedQuestions] = useState({});
    const [activeExplanations, setActiveExplanations] = useState({});
    
    const viewportRef = useRef(null);
    const scrollContainerRef = useRef(null);
    const layerRef = useRef(null);
    const pageCountRef = useRef(null);
    const menuRef = useRef(null);
    const miniFlowRef = useRef(null);

    // Mini Miron Local States
    const [miniMironText, setMiniMironText] = useState(null);
    const [miniMessages, setMiniMessages] = useState([]);
    const [isMiniTyping, setIsMiniTyping] = useState(false);
    const [miniInput, setMiniInput] = useState('');
    
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
                
                // Fetch injected RAG questions for this book
                const qData = await invokeBookReader({ action: 'get_book_mapped_questions', book_id: book.id });
                if (qData.questions) {
                    const grouped = {};
                    qData.questions.forEach(q => {
                        if (!grouped[q.page_key]) grouped[q.page_key] = [];
                        grouped[q.page_key].push(q);
                    });
                    setMappedQuestions(grouped);
                }

            } catch (error) {
                console.error("Error loading JSON pages:", error);
            } finally {
                setLoading(false);
            }
        };
        if (book?.id) fetchPages();
    }, [book?.id]);

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
    // 7. Context Menu Logic (500ms Solid Debounce Tracking)
    useEffect(() => {
        let debounceTimer;

        const checkSelection = () => {
            if (pinchState.current.isPinching) return;
            
            const selection = window.getSelection();
            if (selection && selection.toString().trim().length > 0) {
                try {
                    const range = selection.getRangeAt(0);
                    const rect = range.getBoundingClientRect();
                    if (rect.width === 0 && rect.height === 0) return;
                    
                    const menuWidth = 280; 
                    const menuHeight = 140; // Updated to account for the taller, overhauled UI
                    const verticalGap = 65; // High clearance to prevent overlapping OS teardrops/selection handles
                    
                    // Center the menu horizontally over the selection box
                    let x = rect.left + (rect.width / 2) - (menuWidth / 2);
                    let y = rect.top - menuHeight - verticalGap; 
                    
                    // Constrain horizontally to viewport boundaries
                    x = Math.max(10, Math.min(x, window.innerWidth - menuWidth - 10));
                    
                    // SMART VERTICAL COLLISION DETECTOR
                    if (rect.height > window.innerHeight - 150) {
                        // Case A: Page-spanning selection. Center the menu vertically on screen
                        // so it is always reachable and doesn't get pushed into off-screen voids.
                        y = (window.innerHeight - menuHeight) / 2;
                    } else if (y < 60) {
                        // Case B: Selection is too close to the top. Flip menu to render BELOW selection.
                        y = rect.bottom + verticalGap;
                        
                        // Failsafe: If flipping below also pushes it off the bottom of the screen, center it
                        if (y + menuHeight > window.innerHeight - 20) {
                            y = (window.innerHeight - menuHeight) / 2;
                        }
                    }
                    
                    setContextMenu({ x, y, text: selection.toString() });
                } catch(e) {}
            }
        };

        const handleSelectionChange = () => {
            // Instantly hide the menu while dragging.
            // Using a callback ensures we don't trigger unnecessary React re-renders if it's already null.
            setContextMenu(prev => prev !== null ? null : prev);
            
            clearTimeout(debounceTimer);
            
            // 500ms is the sweet spot for mobile. Because OS teardrops swallow touch events, 
            // we must wait exactly half a second of complete stillness to guarantee you stopped dragging.
            debounceTimer = setTimeout(checkSelection, 500);
        };

        const handleScrollOrTouch = (e) => {
            // Do not dismiss if the user is actually tapping the custom context menu itself
            if (e && e.target && e.target.closest && e.target.closest('.reader-ctx-menu')) return;
            setContextMenu(prev => prev !== null ? null : prev);
        };

        document.addEventListener('selectionchange', handleSelectionChange);
        document.addEventListener('touchstart', handleScrollOrTouch, { passive: true });
        
        const viewport = viewportRef.current;
        if (viewport) {
            viewport.addEventListener('scroll', handleScrollOrTouch, { passive: true });
        }

        return () => { 
            clearTimeout(debounceTimer); 
            document.removeEventListener('selectionchange', handleSelectionChange); 
            document.removeEventListener('touchstart', handleScrollOrTouch);
            if (viewport) {
                viewport.removeEventListener('scroll', handleScrollOrTouch);
            }
        };
    }, []);

    // 8. Zero-Latency Hardware Accelerated Dragging (With Tactile Feedback)
    const handleDragStart = (e) => {
        const isTouch = e.type === 'touchstart';
        const clientX = isTouch ? e.touches[0].clientX : e.clientX;
        const clientY = isTouch ? e.touches[0].clientY : e.clientY;
        
        if (!menuRef.current) return;

        // Progressive Enhancement: Micro-haptic tick on touch devices
        if (navigator.vibrate) {
            try {
                navigator.vibrate(12); // High-fidelity taptic "tick"
            } catch (err) {}
        }
        
        const rect = menuRef.current.getBoundingClientRect();
        
        const startX = clientX;
        const startY = clientY;
        const startLeft = rect.left;
        const startTop = rect.top;

        const onDragMove = (moveEvt) => {
            const moveTouch = moveEvt.type === 'touchmove';
            const moveX = moveTouch ? moveEvt.touches[0].clientX : moveEvt.clientX;
            const moveY = moveTouch ? moveEvt.touches[0].clientY : moveEvt.clientY;
            
            const dx = moveX - startX;
            const dy = moveY - startY;
            
            if (menuRef.current) {
                // Instantly update layout positions directly in the DOM for maximum speed
                menuRef.current.style.left = `${startLeft + dx}px`;
                menuRef.current.style.top = `${startTop + dy}px`;
            }
            
            if (moveEvt.cancelable) moveEvt.preventDefault();
            moveEvt.stopPropagation();
        };

        const onDragEnd = () => {
            document.removeEventListener('mousemove', onDragMove);
            document.removeEventListener('mouseup', onDragEnd);
            document.removeEventListener('touchmove', onDragMove);
            document.removeEventListener('touchend', onDragEnd);
        };

        document.addEventListener('mousemove', onDragMove);
        document.addEventListener('mouseup', onDragEnd);
        document.addEventListener('touchmove', onDragMove, { passive: false });
        document.addEventListener('touchend', onDragEnd);
        
        e.stopPropagation();
    };

    const toggleTheme = () => {
        const themes = ['dark', 'sepia', 'light'];
        setCurrentTheme(themes[(themes.indexOf(currentTheme) + 1) % themes.length]);
    };

    const handleMenuAction = (action) => {
        if (!contextMenu) return; // Prevent crashes if selection clears milliseconds before tap
        if (action === 'ask_miron') {
            setMiniMironText(contextMenu.text);
            window.getSelection()?.removeAllRanges();
            setContextMenu(null);
        }
        if (action === 'copy') {
            navigator.clipboard.writeText(contextMenu.text);
            window.getSelection()?.removeAllRanges();
            setContextMenu(null);
        }
    };

    // Auto-populate thread when passage context is locked
    useEffect(() => {
        if (miniMironText) {
            setMiniMessages([
                { id: 1, side: 'user', text: miniMironText },
                { id: 2, side: 'miron', thought: "Synthesizing synced literature node...", text: `I have mapped this text, Alex. Thermodynamics dictate deep constraints here. What specific variables shall we unpack?` }
            ]);
        }
    }, [miniMironText]);

    // Keep mini-thread scrolled to bottom
    useEffect(() => {
        if (miniFlowRef.current) {
            miniFlowRef.current.scrollTo({ top: miniFlowRef.current.scrollHeight, behavior: 'smooth' });
        }
    }, [miniMessages, isMiniTyping]);

    const handleMiniSend = () => {
        if (!miniInput.trim()) return;
        const userMsg = { id: Date.now(), side: 'user', text: miniInput };
        setMiniMessages(prev => [...prev, userMsg]);
        setMiniInput('');
        setIsMiniTyping(true);

        setTimeout(() => {
            setIsMiniTyping(false);
            setMiniMessages(prev => [...prev, {
                id: Date.now() + 1,
                side: 'miron',
                thought: "Resolving conceptual references...",
                text: "That is an elegant question. This correlation heavily affects the entropy thresholds we charted in the previous page. Let me display the relation."
            }]);
        }, 1800);
    };

    const handleMiniExpand = () => {
        // Dispatch system-wide event triggering full screen Miron with this passage
        window.dispatchEvent(new CustomEvent('open-full-miron-chat', {
            detail: { text: miniMironText }
        }));
        setMiniMironText(null); // Close the mini overlay
    };

    const extractTextFromBlock = (b) => {
        if (!b) return '';
        let text = [];
        if (b.main) text.push(b.main);
        if (b.sub) text.push(b.sub);
        if (b.title) text.push(b.title);
        if (b.body) text.push(b.body);
        if (b.text) text.push(b.text);
        if (b.items && Array.isArray(b.items)) text.push(b.items.join(' '));
        if (b.premises) text.push(b.premises.join(' '));
        if (b.conclusion) text.push(b.conclusion);
        if (b.question) text.push(b.question);
        
        // Combine and strip any basic HTML tags (like <sup>) for pure text context
        return text.join(' ').replace(/<[^>]+>/g, '').trim(); 
    };

    const handleAIExplore = (pageIdx, targetIdx) => {
        console.group(`🧠 [AI Context Analyzer] Page ${pageIdx + 1} | Target Block ${targetIdx}`);
        
        const pageContent = pages[pageIdx].content_json || [];
        const collectedBlocks = [];
        let topReached = targetIdx;
        
        // 1. Anchor: Include the block that was actually tapped
        collectedBlocks.push(pageContent[targetIdx]);
        
        // 2. Climb UP: Grab related content until we hit another AI tag or page top
        for (let i = targetIdx - 1; i >= 0; i--) {
            if (pageContent[i].ai_ready) break;
            collectedBlocks.unshift(pageContent[i]);
            topReached = i;
        }
        console.log(`[Climb UP] Reached block index: ${topReached}`);
        
        // 3. Climb DOWN: Grab related content until we hit another AI tag or page bottom
        let bottomReached = targetIdx;
        for (let i = targetIdx + 1; i < pageContent.length; i++) {
            if (pageContent[i].ai_ready) break;
            collectedBlocks.push(pageContent[i]);
            bottomReached = i;
        }
        console.log(`[Climb DOWN] Reached block index: ${bottomReached}`);
        
        // 4. Synthesize the context
        let combinedText = collectedBlocks
            .map(extractTextFromBlock)
            .filter(t => t.length > 0)
            .join('\n\n');

        // 5. Cross-page Tail Check
        if (topReached === 0 && pageIdx > 0) {
            console.log(`[Boundary Event] Hit top of Page ${pageIdx + 1}. Analyzing Page ${pageIdx}...`);
            const prevPageContent = pages[pageIdx - 1].content_json || [];
            
            // Loop backwards on the previous page to skip empty footers/spacers
            let lastRealText = '';
            for (let j = prevPageContent.length - 1; j >= 0; j--) {
                const tempText = extractTextFromBlock(prevPageContent[j]).trim();
                if (tempText) {
                    lastRealText = tempText;
                    console.log(`[Boundary Data] Found actual text at block ${j} of previous page.`);
                    break;
                }
            }

            if (lastRealText) {
                // Heuristic check: does it end without a terminal punctuation mark?
                const hasTerminalPunctuation = /[.!?]['"]?$/.test(lastRealText);
                console.log(`[Punctuation Check] String: "...${lastRealText.slice(-15)}"`);
                console.log(`[Punctuation Check] Has terminal punctuation? ${hasTerminalPunctuation}`);
                
                if (!hasTerminalPunctuation) {
                    console.log(`[Action] Sentence is fractured! Stitching previous paragraph to current context.`);
                    combinedText = lastRealText + ' ' + combinedText;
                } else {
                    console.log(`[Action] Sentence is whole. No cross-page stitching required.`);
                }
            } else {
                console.log(`[Boundary Data] Previous page contained no viable text blocks.`);
            }
        }
        
        console.log(`[Final Output] ${combinedText.substring(0, 100)}...`);
        console.groupEnd();
            
        // 6. Open Mini Miron with the unified context
        setMiniMironText(combinedText);
    };

    // Target Scrolling & Highlighting
    useEffect(() => {
        if (!loading && pages.length > 0 && targetPageNumber !== undefined) {
            const timer = setTimeout(() => {
                const targetId = `page-${targetPageNumber}-block-${targetBlockIndex}`;
                const targetEl = document.getElementById(targetId);
                if (targetEl && viewportRef.current) {
                    targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    targetEl.classList.add('highlight-block-anim');
                    setTimeout(() => targetEl.classList.remove('highlight-block-anim'), 4000);
                }
            }, 800);
            return () => clearTimeout(timer);
        }
    }, [loading, pages, targetPageNumber, targetBlockIndex]);

    return (
        <div className={`reader-root theme-${currentTheme}`} style={zIndexOverride ? { zIndex: zIndexOverride } : {}}>
            <div 
                id="viewport" 
                ref={viewportRef} 
                onScroll={handleScroll}
                onContextMenu={(e) => e.preventDefault()} /* Kills native right-click/long-press menu on Android/Desktop */
            >
                <div id="scroll-container" ref={scrollContainerRef}>
                    <div id="book-layer" ref={layerRef}>
                        {pages.map((page, pageIdx) => (
                            <div key={page.id} className="page-wrapper">
                                <div className="page-canvas">
                                    {page.manual_flag && <div className="manual-flag">{page.manual_flag}</div>}
                                    {(page.content_json || []).map((block, idx) => {
                                        const blockActions = {
                                            onAIExplore: () => handleAIExplore(pageIdx, idx)
                                        };
                                        const expKey = `${page.page_key}_${idx}`;
                                        return (
                                            <React.Fragment key={idx}>
                                                <div id={`page-${page.page_number}-block-${idx}`} className="block-target-wrapper">
                                                    {renderBookBlock(block, idx, blockActions)}
                                                </div>
                                                {activeExplanations[expKey] && (
                                                    <div className="inline-book-explanation">
                                                        <div className="inline-exp-header">
                                                            <span><i className="fas fa-sparkles"></i> Miron Synthesis</span>
                                                            <button onClick={() => setActiveExplanations(p => ({...p, [expKey]: false}))}>
                                                                <i className="fas fa-times"></i>
                                                            </button>
                                                        </div>
                                                        <div className="inline-exp-body">
                                                            <p>This is where the AI-generated explanation will be wired up. Miron will synthesize the textbook snapshot above to clarify why a certain choice is correct, directly addressing common misconceptions in this topic.</p>
                                                        </div>
                                                    </div>
                                                )}
                                            </React.Fragment>
                                        );
                                    })}
                                </div>
                                {mappedQuestions[page.page_key] && (
                                    <PageQuestionsBlock 
                                        questions={mappedQuestions[page.page_key]} 
                                        pageNumber={page.page_number}
                                        pageKey={page.page_key}
                                        onExplain={(contentIndex) => {
                                            const key = `${page.page_key}_${contentIndex}`;
                                            setActiveExplanations(prev => ({ ...prev, [key]: true }));
                                            setTimeout(() => {
                                                const el = document.getElementById(`page-${page.page_number}-block-${contentIndex}`);
                                                if (el) {
                                                    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                                    el.classList.add('highlight-block-anim');
                                                    setTimeout(() => el.classList.remove('highlight-block-anim'), 4000);
                                                }
                                            }, 100);
                                        }}
                                    />
                                )}
                            </div>
                        ))}
                    </div>
                </div>
                {loading && <div className="loading-spinner">Calibrating Knowledge Engine...</div>}
            </div>

            {/* --- MINI MIRON OVERLAY --- */}
            {miniMironText && (
                <div className="mini-miron-overlay" onTouchStart={(e) => e.stopPropagation()}>
                    <header className="mini-miron-header">
                        <div className="mini-miron-title">Miron Passage Sync</div>
                        <div className="mini-miron-actions">
                            <button className="icon-button" style={{color: 'white', opacity: 0.6, width: '32px', height: '32px', fontSize: '1rem'}} onClick={handleMiniExpand} title="Expand to Full Chat">
                                <i className="fa-solid fa-expand"></i>
                            </button>
                            <button className="icon-button" style={{color: 'white', opacity: 0.6, width: '32px', height: '32px', fontSize: '1rem'}} onClick={() => setMiniMironText(null)} title="Dismiss">
                                <i className="fa-solid fa-times"></i>
                            </button>
                        </div>
                    </header>
                    <main className="mini-miron-flow" ref={miniFlowRef}>
                        {miniMessages.map((m) => (
                            <div key={m.id} className={`mini-bubble-wrap ${m.side}`}>
                                {m.side === 'miron' && m.thought && (
                                    <span className="thought-trace-serif" style={{fontSize: '0.75rem', marginBottom: '2px'}}>{m.thought}</span>
                                )}
                                <div className="mini-bubble">
                                    {m.text}
                                </div>
                            </div>
                        ))}
                        {isMiniTyping && (
                            <div className="mini-bubble-wrap miron">
                                <div className="typing-indicator-lux" style={{padding: '0.6rem 1.1rem', borderRadius: '18px'}}>
                                    <div className="typing-dot-lux"></div>
                                    <div className="typing-dot-lux"></div>
                                    <div className="typing-dot-lux"></div>
                                </div>
                            </div>
                        )}
                    </main>
                    <footer className="mini-miron-input-wrapper">
                        <div className="mini-dock">
                            <input 
                                type="text" 
                                placeholder="Consult the sync..." 
                                value={miniInput}
                                onChange={(e) => setMiniInput(e.target.value)}
                                onKeyPress={(e) => e.key === 'Enter' && handleMiniSend()}
                            />
                            <button className="mini-send-btn" onClick={handleMiniSend}>
                                <i className="fa-solid fa-paper-plane"></i>
                            </button>
                        </div>
                    </footer>
                </div>
            )}

            {contextMenu && (
                <div 
                    className="reader-ctx-menu" 
                    ref={menuRef}
                    style={{ left: contextMenu.x, top: contextMenu.y }}
                    onMouseDown={(e) => e.preventDefault()}
                    onTouchStart={(e) => e.stopPropagation()}
                >
                    <div 
                        className="ctx-drag-handle"
                        onMouseDown={handleDragStart}
                        onTouchStart={handleDragStart}
                    >
                        <div className="ctx-drag-bar"></div>
                    </div>
                    <div 
                        className="ctx-primary" 
                        onMouseDown={(e) => { e.preventDefault(); handleMenuAction('ask_miron'); }}
                        onTouchStart={(e) => { e.preventDefault(); e.stopPropagation(); handleMenuAction('ask_miron'); }}
                    >
                        <i className="fa-solid fa-wand-magic-sparkles"></i> <span>Ask Miron</span>
                    </div>
                    <div className="ctx-grid" style={{marginTop: '8px'}}>
                        <div 
                            className="ctx-btn" 
                            onMouseDown={(e) => { e.preventDefault(); handleMenuAction('copy'); }}
                            onTouchStart={(e) => { e.preventDefault(); e.stopPropagation(); handleMenuAction('copy'); }}
                        >
                            <i className="fa-regular fa-copy"></i><span>Copy</span>
                        </div>
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

// --- INLINE BOOK QUESTIONS COMPONENT ---
const getNormalizedMatchingData = (q) => {
    if (q.matching_data && q.matching_data.left_column && q.matching_data.left_column.length > 0) {
        return q.matching_data;
    }
    if (q.options && Array.isArray(q.options) && q.options.length > 0) {
        const getStr = (arr, prefix) => {
            const found = arr.find(o => {
                const text = typeof o === 'string' ? o : o.text;
                return typeof text === 'string' && text.startsWith(prefix);
            });
            return typeof found === 'string' ? found : found?.text;
        };
        
        const leftStr = getStr(q.options, 'Column A:');
        const rightStr = getStr(q.options, 'Column B:');
        
        if (leftStr && rightStr) {
            const parseStr = (str, prefix, splitRegex) => {
                const cleaned = str.replace(prefix, '').trim();
                const parts = cleaned.split(splitRegex);
                const items = [];
                for (let i = 1; i < parts.length; i += 2) {
                    let item = (parts[i+1] || '').trim();
                    if (item.endsWith(',')) item = item.slice(0, -1).trim();
                    items.push(item);
                }
                return items;
            };
            
            return {
                left_column: parseStr(leftStr, 'Column A:', /(\b\d+\.\s+)/),
                right_column: parseStr(rightStr, 'Column B:', /(\b[A-Z]\.\s+)/)
            };
        }
    }
    return { left_column: [], right_column: [] };
};

const PageQuestionsBlock = ({ questions, pageNumber, pageKey, onExplain }) => {
    const [qIndex, setQIndex] = useState(0);
    const [answers, setAnswers] = useState({});
    const [activeMatch, setActiveMatch] = useState({});
    
    if (!questions || questions.length === 0) return null;
    const q = questions[qIndex];
    const ans = answers[q.id];
    const matchData = getNormalizedMatchingData(q);

    return (
        <div className="bpq-container">
            <div className="bpq-header">
                <div className="bpq-title"><i className="fas fa-clipboard-check"></i> Knowledge Check</div>
                <div className="bpq-counter">{qIndex + 1} of {questions.length}</div>
            </div>
            <div className="bpq-body">
                <div className="bpq-text">{q.text}</div>
                {(q.question_type && q.question_type.toLowerCase() === 'true_false') ? (
                    <div className="bpq-tf-pad">
                        <label className={`bpq-tf-btn ${ans === 'True' || ans?.text === 'True' ? 'active-true' : ''}`}>
                            <input type="radio" hidden onChange={() => setAnswers({...answers, [q.id]: 'True'})} />
                            <i className="fa-solid fa-check"></i> TRUE
                        </label>
                        <label className={`bpq-tf-btn ${ans === 'False' || ans?.text === 'False' ? 'active-false' : ''}`}>
                            <input type="radio" hidden onChange={() => setAnswers({...answers, [q.id]: 'False'})} />
                            <i className="fa-solid fa-xmark"></i> FALSE
                        </label>
                    </div>
                ) : ((q.question_type && q.question_type.toLowerCase() === 'matching') || matchData.left_column?.length > 0) ? (
                    <div className={`interactive-match-container ${(matchData.right_column?.some(r => (r.text || r).length > 45) || matchData.left_column?.some(l => (l.text || l).length > 45)) ? 'vertical-match' : ''}`}>
                        <div className="match-col match-left">
                            {matchData.left_column?.map((item, idx) => {
                                const qAnswers = ans || {};
                                const currentActive = activeMatch[q.id];
                                const isPaired = qAnswers[idx] !== undefined;
                                const isActive = currentActive === idx;
                                const isDisabled = currentActive !== undefined && currentActive !== idx;
                                
                                return (
                                    <div key={idx} className={`match-item-left ${isActive ? 'is-active' : ''} ${isPaired ? 'is-paired' : ''} ${isDisabled ? 'is-disabled' : ''}`} onClick={() => setActiveMatch(prev => ({ ...prev, [q.id]: isActive ? undefined : idx }))}>
                                        <span className="match-index">{idx + 1}.</span>
                                        <span className="match-text">{item.text || item}</span>
                                        {isPaired && <span className="match-badge">{String.fromCharCode(65 + qAnswers[idx])}</span>}
                                    </div>
                                );
                            })}
                        </div>
                        <div className={`match-col match-right ${activeMatch[q.id] !== undefined ? 'is-listening' : ''}`}>
                            {matchData.right_column?.map((item, idx) => {
                                const qAnswers = ans || {};
                                const currentActive = activeMatch[q.id];
                                const usedByLeftIdx = Object.keys(qAnswers).find(k => qAnswers[k] === idx);
                                const isUsed = usedByLeftIdx !== undefined;

                                return (
                                    <div key={idx} className={`match-item-right ${isUsed ? 'is-used' : ''}`} onClick={() => {
                                        if (currentActive !== undefined) {
                                            const newAnswers = { ...qAnswers };
                                            if (isUsed) delete newAnswers[usedByLeftIdx];
                                            newAnswers[currentActive] = idx;
                                            setAnswers({...answers, [q.id]: newAnswers});
                                            setActiveMatch(prev => ({ ...prev, [q.id]: undefined }));
                                        }
                                    }}>
                                        <span className="match-letter">{String.fromCharCode(65 + idx)}.</span>
                                        <span className="match-text">{item.text || item}</span>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                ) : (
                    <div className="bpq-mc-pad">
                        {q.options?.map((opt, i) => {
                            const isSelected = ans === opt || ans?.text === opt?.text;
                            return (
                                <label key={i} className={`bpq-mc-btn ${isSelected ? 'active' : ''}`}>
                                    <input type="radio" hidden onChange={() => setAnswers({...answers, [q.id]: opt})} />
                                    <div className="bpq-mc-indicator"></div> <span>{opt.text || opt}</span>
                                </label>
                            );
                        })}
                    </div>
                )}
            </div>
            <div className="bpq-footer">
                <div className="bpq-nav">
                    <button disabled={qIndex === 0} onClick={() => setQIndex(qIndex - 1)}><i className="fas fa-chevron-left"></i></button>
                    <button disabled={qIndex === questions.length - 1} onClick={() => setQIndex(qIndex + 1)}><i className="fas fa-chevron-right"></i></button>
                </div>
                <div className="bpq-actions">
                    <button className="bpq-btn-explain" onClick={() => onExplain(q.content_index)}>
                        <i className="fas fa-sparkles"></i> Explain
                    </button>
                    {q.exam_meta && (
                        <button className="bpq-btn-goto" onClick={() => window.dispatchEvent(new CustomEvent('open-exam-from-book', { detail: { exam: q.exam_meta } }))}>
                            Go To Exam <i className="fas fa-arrow-right"></i>
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default BookReader;