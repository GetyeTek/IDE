import React, { useState, useEffect, useRef } from 'react';
import { invokeBookReader } from '../config/api.js';
import './BookReader.css';

const CONFIG = { friction: 0.93, velocityMult: 1.5, maxZoom: 4.0 };

// Helper to translate patcher styling logic into a valid React style object
const resolveStyles = (item) => {
    const rawStyle = item.style || {};
    const resolved = { ...rawStyle };

    // Align properties mapping
    if (rawStyle.align) {
        resolved.textAlign = rawStyle.align;
        if (rawStyle.align === 'center') {
            resolved.marginLeft = 'auto';
            resolved.marginRight = 'auto';
        } else if (rawStyle.align === 'right') {
            resolved.marginLeft = 'auto';
            resolved.marginRight = '0';
        }
    }

    // Custom toggle formatting helpers used in Patcher's applyStyles
    if (rawStyle.bold) resolved.fontWeight = 'bold';
    if (rawStyle.italic) resolved.fontStyle = 'italic';
    if (rawStyle.underline) resolved.textDecoration = 'underline';
    if (rawStyle.transform) resolved.textTransform = rawStyle.transform;
    if (rawStyle.size) resolved.fontSize = rawStyle.size;

    return resolved;
};

const BookReader = ({ book, onClose }) => {
    const [loading, setLoading] = useState(true);
    const [pages, setPages] = useState([]);
    const [isUiVisible, setIsUiVisible] = useState(true);
    const [isFabActive, setIsFabActive] = useState(false);
    const [currentTheme, setCurrentTheme] = useState('dark');
    const [contextMenu, setContextMenu] = useState(null);
    
    const viewportRef = useRef(null);
    const layerRef = useRef(null);
    const requestRef = useRef(null);
    const pageCountRef = useRef(null);
    
    const state = useRef({ x: 0, y: 0, scale: 1 });
    const velocity = useRef({ x: 0, y: 0 });
    const minScaleLimit = useRef(1.0);
    const baseCanvasWidth = 794; // Aligned with standard A4 base (patcher: 794px)
    
    const input = useRef({
        isDragging: false,
        startX: 0, startY: 0,
        lastX: 0, lastY: 0,
        lastTime: 0,
        initialPinchDist: 0,
        initialScale: 1,
        touchStartTime: 0
    });

    useEffect(() => {
        const fetchPages = async () => {
            try {
                setLoading(true);
                const data = await invokeBookReader({ action: 'get_book_pages', book_id: book.id });
                if (data.pages && data.pages.length > 0) {
                    setPages(data.pages);
                } else {
                    setPages([
                        { id: 'mock-1', page_key: 'page-1', content_json: [
                            { type: 'title-page', main: book.title || "Untitled Document", sub: "Rendered via JSON Engine" },
                            { type: 'spacer', height: '100px'},
                            { type: 'paragraph', body: "This document is missing structured JSON data. Please compile it using the Patcher Tool."}
                        ]}
                    ]);
                }
            } catch (error) {
                console.error("Error loading JSON pages:", error);
            } finally {
                setLoading(false);
            }
        };
        if (book?.id) fetchPages();
    }, [book]);

    useEffect(() => {
        if (!loading && pages.length > 0) {
            const vw = window.innerWidth;
            const scale = (vw - 20) / baseCanvasWidth;
            minScaleLimit.current = Math.min(scale, 1);
            state.current.scale = minScaleLimit.current;
            state.current.x = (vw - (baseCanvasWidth * state.current.scale)) / 2;
            state.current.y = 20;
        }
    }, [loading, pages]);

    const formatText = (text) => {
        if (!text) return null;
        return <span dangerouslySetInnerHTML={{__html: text.replace(/\^\{(.*?)\}/g, '<sup>$1</sup>').replace(/_\{(.*?)\}/g, '<sub>$1</sub>')}} />;
    };

    const renderBlock = (block, idx) => {
        const style = resolveStyles(block);
        const bulletCharMap = { 'arrow': '', 'diamond': '', 'check': '', 'dot': '', 'star': '', 'default': '•' };

        // AI Explore trigger button helper
        const renderAIExtension = (block) => {
            if (block.ai_ready) {
                return <button className="ai-btn-inline" onClick={() => alert("Exploring with AI...")}>✨ AI Explore</button>;
            }
            return null;
        };

        switch(block.type) {
            // --- UNIVERSAL BLOCKS ---
            case 'paragraph': 
                return <p key={idx} className="univ-p-block" style={style}>{formatText(block.body)}{renderAIExtension(block)}</p>;
            
            case 'header': 
                return <h2 key={idx} className="univ-h-block" style={style}>{formatText(block.body)}{renderAIExtension(block)}</h2>;
            
            case 'spacer': 
                return <div key={idx} style={{ height: block.height || '20px', flexGrow: block.flex || 0, ...style }} />;
            
            case 'graphic':
                return (
                    <div key={idx} className="univ-graphic-container" style={style}>
                        {block.svgCode ? (
                            <div dangerouslySetInnerHTML={{ __html: block.svgCode }} />
                        ) : (
                            <img src={block.url} alt={block.caption || ""} />
                        )}
                        {block.caption && <div className="univ-graphic-caption">{formatText(block.caption)}</div>}
                        {renderAIExtension(block)}
                    </div>
                );

            case 'grid':
                return (
                    <div key={idx} className="univ-grid" style={{ gridTemplateColumns: `repeat(${block.columns || 3}, 1fr)`, ...style }}>
                        {(block.items || []).map((val, gridIdx) => (
                            <div key={gridIdx} className="univ-grid-item">{formatText(val)}</div>
                        ))}
                        {renderAIExtension(block)}
                    </div>
                );

            case 'table':
                return (
                    <table key={idx} className={`univ-table ${block.tableClass || ''}`} style={style}>
                        <tbody>
                            {(block.rows || []).map((row, rowIdx) => (
                                <tr key={rowIdx}>
                                    {row.map((cell, cellIdx) => {
                                        const isHeader = (rowIdx === 0 && block.headerStyle);
                                        const CellTag = isHeader ? 'th' : 'td';
                                        const cellContent = typeof cell === 'object' ? cell.text : cell;
                                        const cellStyle = typeof cell === 'object' ? {
                                            backgroundColor: cell.bg || undefined,
                                            textAlign: cell.align || undefined
                                        } : {};

                                        return (
                                            <CellTag 
                                                key={cellIdx} 
                                                colSpan={cell.colSpan || undefined}
                                                rowSpan={cell.rowSpan || undefined}
                                                style={cellStyle}
                                            >
                                                {formatText(cellContent)}
                                            </CellTag>
                                        );
                                    })}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                );

            case 'footer':
                return <div key={idx} className="univ-footer" style={style}>{formatText(block.val || block.page)}</div>;

            // --- LOGIC SPECIFIC BLOCKS ---
            case 'logic-header': 
                return <div key={idx} className="logic-header" style={style} />;
            
            case 'logic-footer': 
                return (
                    <div key={idx} className="logic-footer" style={style}>
                        <span>{formatText(block.authors)}</span><span>Page {block.page}</span>
                    </div>
                );
            
            case 'chapter-title': 
                return (
                    <div key={idx} style={style}>
                        <span className="logic-chapter-num">CHAPTER {block.number}</span>
                        <span className="logic-chapter-title">{formatText(block.title)}</span>
                    </div>
                );
            
            case 'title-page': 
                return (
                    <div key={idx} className="logic-title-container" style={style}>
                        <div className="logic-title-main">{formatText(block.main)}</div>
                        {block.sub && <div className="logic-title-sub">{formatText(block.sub)}</div>}
                        {block.contributors && (
                            <div className="logic-contributors">
                                {formatText(block.contributors)}
                            </div>
                        )}
                    </div>
                );

            case 'logic-toc':
                return (
                    <div key={idx} className="logic-toc-container" style={style}>
                        {(block.entries || []).map((entry, entryIdx) => (
                            <div key={entryIdx} className={`logic-toc-entry logic-toc-level-${entry.level || 0}`}>
                                <span className="logic-toc-text">{formatText(entry.text)}</span>
                                <span className="logic-toc-dots"></span>
                                <span className="logic-toc-page">{entry.page || ''}</span>
                            </div>
                        ))}
                    </div>
                );

            case 'bullet-list': 
                return (
                    <div key={idx} className="logic-bullet-list" style={style}>
                        {(block.items || []).map((txt, bIdx) => (
                            <div key={bIdx} className="logic-bullet-item">
                                <div className="logic-bullet-char">{bulletCharMap[block.bullet] || bulletCharMap['default']}</div>
                                <div>{formatText(txt)}</div>
                            </div>
                        ))}
                        {renderAIExtension(block)}
                    </div>
                );

            case 'logic-formula':
                return (
                    <div key={idx} className="logic-formula-box" style={style}>
                        {formatText(block.body)}
                        {renderAIExtension(block)}
                    </div>
                );

            case 'logic-activity': 
                return (
                    <div key={idx} className={block.variant === 'nobox' || block.noBox ? 'logic-activity-nobox' : 'logic-activity-box'} style={style}>
                        <span className="logic-activity-label">{formatText(block.label)} </span>
                        <span>{formatText(block.body)}</span>
                        {renderAIExtension(block)}
                    </div>
                );
            
            case 'logic-argument': 
                return (
                    <div key={idx} className="logic-argument-block" style={style}>
                        {(block.premises || []).map((p, pIdx) => <div key={pIdx} className="logic-argument-premise">{formatText(p)}</div>)}
                        <div className="logic-argument-line" />
                        <div className="logic-argument-conclusion">{formatText(block.conclusion)}</div>
                        {renderAIExtension(block)}
                    </div>
                );

            case 'logic-self-check':
                return (
                    <div key={idx} className="logic-self-check" style={style}>
                        <div style={{ marginBottom: '10px' }}>
                            <b>{block.number}.</b> {formatText(block.question)}
                        </div>
                        {[...Array(block.lines || 2)].map((_, lineIdx) => (
                            <div key={lineIdx} className="logic-exercise-line"></div>
                        ))}
                    </div>
                );

            case 'logic-quote':
                return (
                    <div key={idx} className="logic-quote-block" style={style}>
                        {formatText(block.body)}
                    </div>
                );

            case 'logic-note':
                return (
                    <div key={idx} className={block.variant === 'nobox' || block.noBox ? 'logic-note-nobox' : 'logic-note-box'} style={style}>
                        <span className="logic-note-label">Note:</span>
                        <div style={{ display: 'inline', fontStyle: 'italic' }}>{formatText(block.body)}</div>
                    </div>
                );

            case 'logic-example':
                return (
                    <div key={idx} style={style}>
                        <span className="logic-example-label">{formatText(block.label) || 'Example'}:</span> {formatText(block.body) || ''}
                    </div>
                );

            default: 
                return <div key={idx} style={{color:'red', fontSize:'10px'}}>Unsupported block: {block.type}</div>;
        }
    };

    useEffect(() => {
        const handleSelection = () => {
            const selection = window.getSelection();
            if (selection && selection.toString().trim().length > 0) {
                try {
                    const range = selection.getRangeAt(0);
                    const rect = range.getBoundingClientRect();
                    if (rect.width === 0) return;
                    setContextMenu({
                        x: Math.max(10, rect.left + (rect.width / 2) - 140),
                        y: Math.max(50, rect.top - 80),
                        text: selection.toString()
                    });
                } catch(e) {}
            } else {
                setContextMenu(null);
            }
        };
        document.addEventListener('selectionchange', handleSelection);
        return () => document.removeEventListener('selectionchange', handleSelection);
    }, []);

    const applyConstraints = () => {
        if (!layerRef.current) return;
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const s = state.current;
        const v = velocity.current;
        const rect = layerRef.current.getBoundingClientRect();
        const contentWidth = rect.width / s.scale;
        const contentHeight = rect.height / s.scale;
        const visualW = contentWidth * s.scale;
        const visualH = contentHeight * s.scale;

        if (visualW < vw) {
            s.x = (vw - visualW) / 2;
            v.x = 0;
        } else {
            if (s.x > 0) { s.x = 0; v.x = 0; }
            if (s.x < vw - visualW) { s.x = vw - visualW; v.x = 0; }
        }

        if (visualH < vh) {
            s.y = (vh - visualH) / 2;
            v.y = 0;
        } else {
            if (s.y > 0) { s.y = 0; v.y = 0; }
            if (s.y < vh - visualH) { s.y = vh - visualH; v.y = 0; }
        }
    };

    const loop = () => {
        if (!input.current.isDragging) {
            const v = velocity.current;
            if (Math.abs(v.x) > 0.1 || Math.abs(v.y) > 0.1) {
                v.x *= CONFIG.friction;
                v.y *= CONFIG.friction;
                state.current.x += v.x;
                state.current.y += v.y;
            }
        }
        applyConstraints();
        if (layerRef.current) {
            const { x, y, scale } = state.current;
            layerRef.current.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${scale})`;
        }
        if (pageCountRef.current && layerRef.current && pages.length > 0) {
            const unscaledY = Math.abs(state.current.y) / state.current.scale;
            const approxPageHeight = 1183; // Adjusted (1123px height + 60px padding/margins)
            const current = Math.max(1, Math.floor((unscaledY + 200) / approxPageHeight) + 1);
            pageCountRef.current.innerText = `${Math.min(current, pages.length)} / ${pages.length}`;
        }
        requestRef.current = requestAnimationFrame(loop);
    };

    useEffect(() => {
        const viewport = viewportRef.current;
        if (!viewport) return;
        requestRef.current = requestAnimationFrame(loop);

        const onTouchStart = (e) => {
            if (e.target.closest('#ui-layer') || e.target.closest('.fab-container') || e.target.closest('.reader-ctx-menu')) return;
            if (window.getSelection().toString().length > 0) return;
            velocity.current = { x: 0, y: 0 };
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
            if (e.target.closest('#ui-layer') || e.target.closest('.reader-ctx-menu')) return;
            if (window.getSelection().toString().length > 0) return;
            e.preventDefault();

            if (input.current.isDragging && e.touches.length === 1) {
                const x = e.touches[0].clientX;
                const y = e.touches[0].clientY;
                const dt = Date.now() - input.current.lastTime;
                state.current.x = x - input.current.startX;
                state.current.y = y - input.current.startY;

                if (dt > 0) {
                    velocity.current.x = (x - input.current.lastX) * CONFIG.velocityMult;
                    velocity.current.y = (y - input.current.lastY) * CONFIG.velocityMult;
                }
                input.current.lastX = x;
                input.current.lastY = y;
                input.current.lastTime = Date.now();
            } else if (e.touches.length === 2) {
                const dist = Math.hypot(e.touches[0].pageX - e.touches[1].pageX, e.touches[0].pageY - e.touches[1].pageY);
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

        const onTouchEnd = () => { input.current.isDragging = false; };

        viewport.addEventListener('touchstart', onTouchStart, { passive: false });
        viewport.addEventListener('touchmove', onTouchMove, { passive: false });
        viewport.addEventListener('touchend', onTouchEnd);
        
        return () => {
            viewport.removeEventListener('touchstart', onTouchStart);
            viewport.removeEventListener('touchmove', onTouchMove);
            viewport.removeEventListener('touchend', onTouchEnd);
            if (requestRef.current) cancelAnimationFrame(requestRef.current);
        };
    }, []);

    const toggleTheme = () => {
        const themes = ['dark', 'sepia', 'light'];
        setCurrentTheme(themes[(themes.indexOf(currentTheme) + 1) % themes.length]);
        setIsFabActive(false);
    };

    const handleMenuAction = (action) => {
        if (action === 'ask_miron') alert("Sending to AI: " + contextMenu.text.substring(0, 40));
        if (action === 'copy') navigator.clipboard.writeText(contextMenu.text);
        window.getSelection().removeAllRanges();
        setContextMenu(null);
    };

    return (
        <div className={`reader-root theme-${currentTheme}`}>
            <div id="viewport" ref={viewportRef}>
                <div id="book-layer" ref={layerRef}>
                    {pages.map((page) => (
                        <div key={page.id} className="page-wrapper">
                            <div className="page-canvas">
                                {page.manual_flag && <div className="manual-flag">{page.manual_flag}</div>}
                                {(page.content_json || []).map((block, idx) => renderBlock(block, idx))}
                            </div>
                        </div>
                    ))}
                </div>
                {loading && <div className="loading-spinner">Calibrating Knowledge Engine...</div>}
            </div>

            {contextMenu && (
                <div className="reader-ctx-menu" style={{ left: contextMenu.x, top: contextMenu.y }}>
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
                <div className="fab-main" onClick={() => { setIsUiVisible(!isUiVisible); setIsFabActive(!isUiVisible); }}>
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
                    <span style={{flex: 1, textAlign: 'center', fontFamily: 'monospace', color: '#888'}} ref={pageCountRef}>1/--</span>
                    <div className="icon-btn"><i className="fa-solid fa-bookmark"></i></div>
                </div>
            </div>
        </div>
    );
};

export default BookReader;