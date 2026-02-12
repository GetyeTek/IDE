import React, { useState, useEffect, useRef } from 'react';
import BookReader from './BookReader.jsx';

const Study = () => {
    const [isLibraryOpen, setIsLibraryOpen] = useState(false);
    const [isHeaderExpanded, setIsHeaderExpanded] = useState(false);
    const [activeBook, setActiveBook] = useState(null);
    const [books, setBooks] = useState([]);
    const wavePathRef = useRef(null);

    useEffect(() => {
        fetch('https://xvldfsmxskhemkslsbym.supabase.co/functions/v1/book-reader', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ action: 'list_books' })
        })
        .then(res => res.json())
        .then(data => { if(data.books) setBooks(data.books); })
        .catch(err => console.error(err));
    }, []);

    const getBookColor = (title) => {
        let hash = 0;
        for (let i = 0; i < title.length; i++) hash = title.charCodeAt(i) + ((hash << 5) - hash);
        return `linear-gradient(135deg, hsl(${Math.abs(hash) % 360}, 50%, 30%), hsl(${(Math.abs(hash) + 40) % 360}, 60%, 15%))`;
    };

    // Wave Animation Logic for the Observatory Widget
    useEffect(() => {
        const wavePath = wavePathRef.current;
        if (!wavePath) return;

        let animationFrameId;
        const size = 140;
        // Get progress from CSS variable or default to 0.76
        const progress = 0.76;
        const surfaceLevel = size * (1 - progress);
        let time = 0;
        const waves = [{ freq: 10, amp: 1.5, speed: 0.05 }, { freq: 6, amp: 0.8, speed: -0.03 }];

        const updateWave = () => {
            let pathData = [`M 0 ${size}`];
            for (let i = 0; i <= size; i += 5) {
                let y = 0;
                waves.forEach(wave => { y += wave.amp * Math.sin(i / wave.freq + time * wave.speed); });
                pathData.push(`L ${i} ${surfaceLevel + y}`);
            }
            pathData.push(`L ${size} ${size}`, 'Z');
            if (wavePath) wavePath.setAttribute('d', pathData.join(' '));
            time++;
            animationFrameId = requestAnimationFrame(updateWave);
        };

        updateWave();
        return () => cancelAnimationFrame(animationFrameId);
    }, []);

    return (
        <div className="tab-content active" id="study-content">
            <div className="study-hub-view">
                <header className="study-header">
                    <h2 className="large-title">Study Hub</h2>
                    <div className="header-actions">
                        <button className="icon-button notification-btn">
                            <i className="fas fa-bell"></i>
                            <span className="notification-badge">3</span>
                        </button>
                        <img src="https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto-format&fit=crop&w=880&q=80" alt="Profile" className="profile-avatar" style={{ width: '36px', height: '36px' }} />
                    </div>
                </header>
                
                <div className="study-hub-content scrollable-content">
                    {/* Library Preview / Trigger */}
                    <div id="library-preview-wrapper" className="library-preview-wrapper" onClick={() => setIsLibraryOpen(true)}>
                        <div className="library-fade-overlay"></div>
                        <div className="expand-prompt"><span className="material-symbols-outlined">open_in_full</span> Tap to expand</div>
                        <div className="vignette-bg pt-4">
                            <div style={{ height: '220px', position: 'relative', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }} className="bookshelf-perspective">
                                <div className="book-container">
                                    {books.length === 0 ? (
                                        <div style={{color:'rgba(255,255,255,0.5)', gridColumn:'span 3', textAlign:'center', paddingTop:'2rem'}}>Loading...</div>
                                    ) : (
                                        books.slice(0, 3).map((book, i) => (
                                            <div className="book-group" key={i}>
                                                <div className="book-immersive" style={{ 
                                                    backgroundImage: book.cover_url ? `url("${book.cover_url}")` : getBookColor(book.title),
                                                    backgroundSize: 'cover',
                                                    backgroundPosition: 'center',
                                                    backgroundRepeat: 'no-repeat',
                                                    display: 'flex', 
                                                    alignItems: 'flex-end', 
                                                    padding: '10px' 
                                                }}>
                                                    <div className="info-overlay" style={{opacity: 1, transform: 'none', background:'linear-gradient(to top, rgba(0,0,0,0.9), transparent)'}}>
                                                        <h3 className="title" style={{fontSize:'0.7rem', whiteSpace:'normal', lineHeight:'1.2'}}>{book.title}</h3>
                                                    </div>
                                                </div>
                                            </div>
                                        ))
                                    )}
                                </div>
                                <div className="shelf-wood"></div>
                            </div>
                        </div>
                    </div>

                    <div className="study-section">
                        {/* AI Planner Trigger */}
                        <div className="compact-trigger">
                            <div className="compact-orb"><span className="material-symbols-outlined">auto_awesome</span></div>
                            <div className="compact-text-content">
                                <h3 className="compact-title">Plan My Day</h3>
                                <div className="compact-subtitle">
                                    <div className="typewriter-wrapper">
                                        <span className="typewriter-text">Let Miron structure your session...</span>
                                        <span className="blinking-cursor"></span>
                                    </div>
                                </div>
                            </div>
                            <i className="fas fa-chevron-right action-chevron"></i>
                        </div>

                        {/* Guidance Path */}
                        <div className="guidance-path">
                            <h3 className="guidance-title">Miron's Next Steps</h3>
                            <div className="timeline">
                                <div className="timeline-item is-priority">
                                    <div className="timeline-marker"><i className="fas fa-brain fa-xs"></i></div>
                                    <div className="timeline-content">
                                        <div className="item-text"><h4 className="item-title">Review Projectile Motion</h4><p className="item-reason">Weakest topic this week</p></div>
                                        <button className="item-action-btn">Start</button>
                                    </div>
                                </div>
                                <div className="timeline-item">
                                    <div className="timeline-marker"><i className="fas fa-file-alt fa-xs"></i></div>
                                    <div className="timeline-content">
                                        <div className="item-text"><h4 className="item-title">Practice Chemistry Quiz</h4><p className="item-reason">Chapter 5 is overdue</p></div>
                                        <button className="item-action-btn">Start</button>
                                    </div>
                                </div>
                            </div>
                            <div className="expand-footer"><button className="show-all-btn"><i className="fas fa-chevron-down fa-xs"></i> Show All Recommendations</button></div>
                        </div>

                        {/* Observatory Widget */}
                        <div className="observatory-widget" id="observatoryWidget">
                            <div className="portal-cutout">
                                <span className="portal-percentage">76%</span>
                                <div className="well-aperture">
                                    <div className="particles-container"></div>
                                    <div className="progress-fill">
                                        <svg className="wave-svg"><path className="wave-path" ref={wavePathRef}></path></svg>
                                    </div>
                                </div>
                            </div>
                            <div className="widget-info">
                                <h3 className="widget-title">Global Challenge</h3>
                                <p className="widget-subtitle">Collective Progress</p>
                                <div className="widget-progress-bar"><div className="widget-progress-fill"></div></div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* --- FULLSCREEN LIBRARY OVERLAY --- */}
            <div className={`library-fullscreen ${isLibraryOpen ? 'is-expanded' : ''}`}>
                <div style={{ position: 'relative', display: 'flex', height: '100%', flexDirection: 'column' }}>
                    <header className="fullscreen-header">
                        <div className="header-main-row">
                            <button className="icon-button" onClick={() => setIsLibraryOpen(false)}>
                                <span className="material-symbols-outlined">arrow_back</span>
                            </button>
                            <div 
                                className={`header-title-wrapper ${isHeaderExpanded ? 'expanded' : ''}`} 
                                onClick={() => setIsHeaderExpanded(!isHeaderExpanded)}
                            >
                                <h2>My Library</h2>
                                <span className="material-symbols-outlined chevron-icon">expand_more</span>
                            </div>
                            <button className="icon-button"><span className="material-symbols-outlined">search</span></button>
                        </div>
                        <div className={`filter-pills-container ${isHeaderExpanded ? 'expanded' : ''}`}>
                            <div className="filter-pills library-filters">
                                <div className="chip active">All Books</div><div className="chip">Textbooks</div><div className="chip">Reference</div><div className="chip">Exams</div>
                            </div>
                        </div>
                    </header>
                    <div className="flex-grow overflow-y-auto py-4 vignette-bg" style={{ flexGrow: 1, overflowY: 'auto', padding: '1rem', position: 'relative' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
                            <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', height: 'auto', paddingBottom: '2rem' }} className="bookshelf-perspective">
{(() => {
                                    const rows = [];
                                    for (let i = 0; i < books.length; i += 3) rows.push(books.slice(i, i + 3));
                                    if(rows.length === 0) return <div style={{color:'rgba(255,255,255,0.3)', textAlign:'center', padding:'2rem'}}>Library Empty</div>;
                                    
                                    return rows.map((row, rowIndex) => (
                                        <div key={rowIndex} style={{ marginBottom: '1.5rem' }}>
                                            <div className="book-container">
                                                {row.map((book, i) => (
                                                    <div className="book-group" key={i}>
                                                        <div 
                                                            className="book-immersive" 
                                                            style={{ 
                                                                backgroundImage: book.cover_url ? `url("${book.cover_url}")` : getBookColor(book.title),
                                                                backgroundSize: 'cover',
                                                                backgroundPosition: 'center',
                                                                backgroundRepeat: 'no-repeat'
                                                            }}
                                                            onClick={() => setActiveBook(book)}
                                                        >
                                                            <div className="info-overlay">
                                                                <h3 className="title">{book.title}</h3>
                                                                <div className="progress-bar"><div className="progress" style={{ width: '0%' }}></div></div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                            <div className="shelf-wood"></div>
                                        </div>
                                    ));
                                })()}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            {activeBook && <BookReader book={activeBook} onClose={() => setActiveBook(null)} />}
        </div>
    );
};

export default Study;