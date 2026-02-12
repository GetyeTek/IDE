import React, { useState, useEffect, useRef } from 'react';
// We need to import ColorThief if we want that logic, but for React it's better to use a library or skip for now.
// Keeping structure identical to original.

const Discover = ({ onOpenActivity }) => {
    const [activeSubTab, setActiveSubTab] = useState('explore'); // 'explore' or 'feeds'
    const [appsCollapsed, setAppsCollapsed] = useState(false);
    
    // Ref for the indicator animation
    const navRef = useRef(null);
    const [indicatorStyle, setIndicatorStyle] = useState({});

    useEffect(() => {
        // Calculate indicator position
        if (navRef.current) {
            const activeEl = navRef.current.querySelector('.nav-item.active');
            if (activeEl) {
                setIndicatorStyle({
                    width: `${activeEl.offsetWidth}px`,
                    transform: `translateX(${activeEl.offsetLeft}px)`
                });
            }
        }
    }, [activeSubTab]);

    return (
        <div className="tab-content active" id="discover-content">
            <header id="discover-header">
                <h1 className="discover-title">Discover</h1>
                <div className="header-actions">
                    <button className="icon-button notification-btn" onClick={onOpenActivity}>
                        <i className="fas fa-bell"></i>
                        <span className="notification-badge">3</span>
                    </button>
                    <img src="https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto-format&fit=crop&w=80&q=80" alt="Profile" className="profile-avatar" />
                </div>
            </header>

            <nav className="discover-sub-nav" ref={navRef}>
                <div 
                    className={`nav-item ${activeSubTab === 'explore' ? 'active' : ''}`} 
                    onClick={() => setActiveSubTab('explore')}
                >
                    Explore
                </div>
                <div 
                    className={`nav-item ${activeSubTab === 'feeds' ? 'active' : ''}`} 
                    onClick={() => setActiveSubTab('feeds')}
                >
                    Feeds <span className="new-content-badge">New</span>
                </div>
                <div className="nav-indicator" style={indicatorStyle}></div>
            </nav>

            {/* Sub Tab: Explore */}
            <div className={`discover-sub-tab ${activeSubTab === 'explore' ? 'active' : ''}`} id="discover-explore">
                <section className="launcher-section">
                    <div className="recents-section">
                        <h3 className="section-title">RECENTS</h3>
                        <div className="launcher-row-wrapper">
                            <div className="launcher-row">
                                <a href="#" className="app-link app-link--recent" style={{ '--stagger-delay': '0.1s' }}>
                                    <div className="icon-wrapper icon-color-1"><i className="fas fa-atom"></i></div>
                                </a>
                                <a href="#" className="app-link app-link--recent" style={{ '--stagger-delay': '0.15s' }}>
                                    <div className="icon-wrapper icon-color-2"><i className="fas fa-chalkboard-user"></i></div>
                                </a>
                                <a href="#" className="app-link app-link--recent" style={{ '--stagger-delay': '0.2s' }}>
                                    <div className="icon-wrapper icon-color-3"><i className="fas fa-calendar-check"></i></div>
                                </a>
                            </div>
                        </div>
                    </div>
                    
                    <div className={`collapsible-section ${appsCollapsed ? 'is-collapsed' : ''}`} id="apps-section">
                        <div className="section-toggle-header" onClick={() => setAppsCollapsed(!appsCollapsed)}>
                            <h3 className="section-title">APPS</h3>
                            <i className="fas fa-chevron-up chevron-icon"></i>
                        </div>
                        <div className="collapsible-content-wrapper">
                            <div className="apps-grid">
                                {[ 
                                    { icon: 'fa-atom', color: 'icon-color-1', label: 'Simulations', delay: '0.25s' },
                                    { icon: 'fa-chalkboard-user', color: 'icon-color-2', label: 'Mentors', delay: '0.3s' },
                                    { icon: 'fa-calendar-check', color: 'icon-color-3', label: 'Events', delay: '0.35s' },
                                    { icon: 'fa-users-rays', color: 'icon-color-4', label: 'Clubs', delay: '0.4s' },
                                    { icon: 'fa-briefcase', color: 'icon-color-5', label: 'Careers', delay: '0.45s' },
                                    { icon: 'fa-book-sparkles', color: 'icon-color-6', label: 'GibiNews', delay: '0.5s' }
                                ].map((app, idx) => (
                                    <a key={idx} href="#" className="app-link app-link--grid" style={{ '--stagger-delay': app.delay }}>
                                        <div className={`icon-wrapper ${app.color}`}><i className={`fas ${app.icon}`}></i></div>
                                        <span className="app-label">{app.label}</span>
                                    </a>
                                ))}
                            </div>
                        </div>
                    </div>
                </section>
            </div>

            {/* Sub Tab: Feeds */}
            <div className={`discover-sub-tab ${activeSubTab === 'feeds' ? 'active' : ''}`} id="discover-feeds">
                <div className="filter-pills-container">
                    <div className="filter-pills">
                        <div className="chip active">All</div>
                        <div className="chip">Miron</div>
                        <div className="chip">GibiNews</div>
                        <div className="chip">Physics</div>
                        <div className="chip">Events</div>
                    </div>
                </div>
                
                <div className="feed-container">
                    <section className="feed-slide">
                        <div className="card-content-wrapper">
                            <div className="mission-card">
                                <canvas className="stars-canvas"></canvas>
                                <div className="mission-content">
                                    <div className="portal-graphic"><div className="portal-ring"></div></div>
                                    <p className="kicker">// GLOBAL CHALLENGE</p>
                                    <h2 className="title">Black Hole Information Paradox</h2>
                                </div>
                            </div>
                        </div>
                    </section>

                    <section className="feed-slide">
                        <div className="card-content-wrapper">
                            <div className="story-card">
                                <div className="background-image" style={{ backgroundImage: "url('https://images.unsplash.com/photo-1635070041078-e363dbe005cb?ixlib=rb-4.0.3&auto-format=fit&crop&w=1170&q=80')" }}></div>
                                <div className="content-overlay" style={{ background: 'linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.8) 100%)' }}>
                                    <p className="kicker"><i className="fas fa-link"></i> Miron Connects</p>
                                    <h2 className="title" style={{ color: 'white' }}>Quantum Entanglement Breakthrough</h2>
                                    <button className="story-cta-btn" style={{ color: 'white', borderColor: 'rgba(255,255,255,0.3)' }}>Explore Physics <i className="fas fa-arrow-right"></i></button>
                                </div>
                            </div>
                        </div>
                    </section>

                    <section className="feed-slide">
                        <div className="action-slide-content">
                            <i className="fas fa-brain action-icon"></i>
                            <p className="action-prompt">Miron noticed your scores in <strong>Projectile Motion</strong> are dropping...</p>
                            <button className="action-cta-btn">Review Topic</button>
                        </div>
                    </section>
                </div>
            </div>
        </div>
    );
};

export default Discover;