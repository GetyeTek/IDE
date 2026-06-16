import React, { useState, useEffect, useRef } from 'react';
import { invokeBookReader } from '../config/api.js';
import BookReader from './BookReader/BookReader.jsx';
import BookShelf from '../components/books/BookShelf.jsx';
import BookCard from '../components/books/BookCard.jsx';
import ExamPavilion from './ExamPavilion.jsx';



const Study = ({ onOpenActivity }) => {
    const [isLibraryOpen, setIsLibraryOpen] = useState(false);
    const [isHeaderExpanded, setIsHeaderExpanded] = useState(false);
    const [activeBook, setActiveBook] = useState(null);
    const [books, setBooks] = useState([]);
    const [universities, setUniversities] = useState([]);
    const [shelfLevel, setShelfLevel] = useState('main'); // 'main' or 'universities'
    const [selectedUniversity, setSelectedUniversity] = useState(null);
    const wavePathRef = useRef(null);

    useEffect(() => {
        // Fetch Main Books
        invokeBookReader({ action: 'list_books' })
        .then(data => {
            if(data.books) {
                // Inject a special 'Exam' book at the start
                const examBook = { 
                    id: "exam-trigger-001",
                    title: "Exams", 
                    isExamTrigger: true, 
                    cover_url: null 
                };
                setBooks([examBook, ...data.books]);
            }
        })
        .catch(err => console.error(err));

        // Fetch Universities
        invokeBookReader({ action: 'list_universities' })
        .then(data => { if(data.universities) setUniversities(data.universities); })
        .catch(err => console.error(err));
    }, []);



    // Wave Animation Logic for the Observatory Widget
    useEffect(() => {
        const wavePath = wavePathRef.current;
        if (!wavePath) return;

        let animationFrameId;
        const size = 140;
        // Sync with CSS variable --progress-percentage (e.g., '76%')
        const rootStyle = getComputedStyle(document.documentElement);
        const cssProgress = rootStyle.getPropertyValue('--progress-percentage').trim() || '76%';
        const progressValue = parseFloat(cssProgress) / 100;
        
        const surfaceLevel = size * (1 - progressValue);
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
                        <button className="icon-button notification-btn" onClick={onOpenActivity}>
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
                            <div style={{ height: '220px', position: 'relative', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
                                <BookShelf 
                                    items={books.slice(0, 3)} 
                                    previewMode={true} 
                                    onBookClick={setActiveBook} 
                                    onExamTrigger={() => { setIsLibraryOpen(true); setShelfLevel('universities'); }} 
                                />
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
                            <button className="icon-button" onClick={() => {
                                if (shelfLevel === 'universities') {
                                    setShelfLevel('main');
                                } else {
                                    setIsLibraryOpen(false);
                                }
                            }}>
                                <span className="material-symbols-outlined">{shelfLevel === 'universities' ? 'arrow_back_ios' : 'arrow_back'}</span>
                            </button>
                            <div 
                                className={`header-title-wrapper ${isHeaderExpanded ? 'expanded' : ''}`} 
                                onClick={() => setIsHeaderExpanded(!isHeaderExpanded)}
                            >
                                <h2>{shelfLevel === 'main' ? 'My Library' : 'Select University'}</h2>
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
                            <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', height: 'auto', paddingBottom: '2rem' }}>
                                <BookShelf 
                                    items={shelfLevel === 'main' ? books : universities} 
                                    isUniversity={shelfLevel === 'universities'}
                                    onBookClick={setActiveBook}
                                    onUniversityClick={setSelectedUniversity}
                                    onExamTrigger={() => setShelfLevel('universities')}
                                />
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            {activeBook && <BookReader book={activeBook} onClose={() => setActiveBook(null)} />}
            {selectedUniversity && <ExamPavilion university={selectedUniversity} onClose={() => setSelectedUniversity(null)} />}
        </div>
    );
};

export default Study;