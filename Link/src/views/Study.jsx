import React, { useState, useEffect, useRef } from 'react';

const Study = () => {
    const [isLibraryOpen, setIsLibraryOpen] = useState(false);
    const [isHeaderExpanded, setIsHeaderExpanded] = useState(false);
    const wavePathRef = useRef(null);

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
                                    <div className="book-group"><div className="book-immersive" style={{ backgroundImage: 'url("https://lh3.googleusercontent.com/aida-public/AB6AXuBSKoJ7w7cQ6PI2oFyC3j_mg9MfHEKfo8lWA_jJOigDE_jQkJsy4fgKWzzf6lCJgyR0GsTHLLv1BI7cdiWwx8KfnImDjXMLug-L3A02iTgpEGvOIiQNzOhevipS1X6I7Sko3GXXUipwN61Y6FaaHm8hTGmRSY9azBRR-dMA8s6EuRbmlSiijstFvLxbGbu8brkFZbVz1K_pF-1wh4Q7e-wXyLshoiIULo80IS1igIWDIFv5gW073G7Vp7HiZRDpfCE8gaiQbtspksEV")' }}></div></div>
                                    <div className="book-group"><div className="book-immersive" style={{ backgroundImage: 'url("https://lh3.googleusercontent.com/aida-public/AB6AXuCbbdjlKmxZ8oiLNL7YVukcTPZkJOwldbDQic8VEMy_g0iDA4A-r96ZHGr32FBcr6RUvs9anN8h39biqDPhCbVptH94SQe2-ri0L_Hu6XMsqfQkA77koJTf8LJGnBJ8rOV8P9ijUY9LtMhw2dGiOsRR6ehDcvKOI5Z12VToMs401ZsNCK8KG4hnWWJkEqZLp1brwAHkpq5YNdgDqdQNYdzYtmi3rdwU4_Prjf1QieIQBoPJidokDdKh2Oj5JGdNK1fjOby5Nd2SEG5F")' }}></div></div>
                                    <div className="book-group"><div className="book-immersive" style={{ backgroundImage: 'url("https://lh3.googleusercontent.com/aida-public/AB6AXuBGqSbDG0JQAHz2DmzmoHHQifAAo2AmSDV1X-T9V-6SAAdjhOgLR9yxVH61j4-jNqP3Kjw-fACv0NDHC6Fd0LKxFsPTfIxHsW1ML9UWh8dxnAH00c915S6HVP2qSbb_aZbyrH7DS2-M8amMQidaRI4YQq8xGqcguHvIZ26bXykLlGQ06KtzMeVNqTjstVM0qg6RpyYVnb04ge9zkXANflTDFvZEBTq6N0ZRIt4Quj5R54vhPfzctWVCxyiutPR-Wss6LKeYT9Jjtyqu")' }}></div></div>
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
                            <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '220px' }} className="bookshelf-perspective">
                                <div className="book-container">
                                    <div className="book-group">
                                        <div className="book-immersive" style={{ backgroundImage: 'url("https://lh3.googleusercontent.com/aida-public/AB6AXuBSKoJ7w7cQ6PI2oFyC3j_mg9MfHEKfo8lWA_jJOigDE_jQkJsy4fgKWzzf6lCJgyR0GsTHLLv1BI7cdiWwx8KfnImDjXMLug-L3A02iTgpEGvOIiQNzOhevipS1X6I7Sko3GXXUipwN61Y6FaaHm8hTGmRSY9azBRR-dMA8s6EuRbmlSiijstFvLxbGbu8brkFZbVz1K_pF-1wh4Q7e-wXyLshoiIULo80IS1igIWDIFv5gW073G7Vp7HiZRDpfCE8gaiQbtspksEV")' }}>
                                            <div className="info-overlay"><h3 className="title">Fantasy Novel</h3><div className="progress-bar"><div className="progress" style={{ width: '75%' }}></div></div></div>
                                        </div>
                                    </div>
                                    <div className="book-group">
                                        <div className="book-immersive" style={{ backgroundImage: 'url("https://lh3.googleusercontent.com/aida-public/AB6AXuCbbdjlKmxZ8oiLNL7YVukcTPZkJOwldbDQic8VEMy_g0iDA4A-r96ZHGr32FBcr6RUvs9anN8h39biqDPhCbVptH94SQe2-ri0L_Hu6XMsqfQkA77koJTf8LJGnBJ8rOV8P9ijUY9LtMhw2dGiOsRR6ehDcvKOI5Z12VToMs401ZsNCK8KG4hnWWJkEqZLp1brwAHkpq5YNdgDqdQNYdzYtmi3rdwU4_Prjf1QieIQBoPJidokDdKh2Oj5JGdNK1fjOby5Nd2SEG5F")' }}>
                                            <div className="info-overlay"><h3 className="title">Classic Literature</h3><div className="progress-bar"><div className="progress" style={{ width: '25%' }}></div></div></div>
                                        </div>
                                    </div>
                                    <div className="book-group">
                                        <div className="book-immersive" style={{ backgroundImage: 'url("https://lh3.googleusercontent.com/aida-public/AB6AXuBGqSbDG0JQAHz2DmzmoHHQifAAo2AmSDV1X-T9V-6SAAdjhOgLR9yxVH61j4-jNqP3Kjw-fACv0NDHC6Fd0LKxFsPTfIxHsW1ML9UWh8dxnAH00c915S6HVP2qSbb_aZbyrH7DS2-M8amMQidaRI4YQq8xGqcguHvIZ26bXykLlGQ06KtzMeVNqTjstVM0qg6RpyYVnb04ge9zkXANflTDFvZEBTq6N0ZRIt4Quj5R54vhPfzctWVCxyiutPR-Wss6LKeYT9Jjtyqu")' }}>
                                            <div className="info-overlay"><h3 className="title">Modern Poetry</h3><div className="progress-bar"><div className="progress" style={{ width: '90%' }}></div></div></div>
                                        </div>
                                    </div>
                                </div>
                                <div className="shelf-wood"></div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Study;