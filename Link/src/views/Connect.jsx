import React, { useState } from 'react';
import MironChat from './MironChat.jsx';

const Connect = () => {
    const [activeView, setActiveView] = useState('messages'); // 'messages' or 'for-you'
    const [isMironOpen, setIsMironOpen] = useState(false);
    const [isHeaderCollapsed, setIsHeaderCollapsed] = useState(false);

    const handleScroll = (e) => {
        const scrollTop = e.currentTarget.scrollTop;
        if (scrollTop > 30) {
            setIsHeaderCollapsed(true);
        } else {
            setIsHeaderCollapsed(false);
        }
    };

    return (
        <div className={`tab-content active ${isHeaderCollapsed ? 'header-collapsed' : ''}`} id="connect-content">
            <header className="interactive-header">
                <div className="large-title-row">
                    <h2 className="large-title">Social Hub</h2>
                    <div className="header-actions">
                        <button className="icon-button notification-btn">
                            <i className="fas fa-bell"></i>
                            <span className="notification-badge">3</span>
                        </button>
                        <img src="https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto-format&fit=crop&w=880&q=80" alt="Profile" className="profile-avatar" />
                    </div>
                </div>
                <div className="main-nav-row">
                    <div className="orbiter-container">
                        <div className="icon-orbiter">
                            <div 
                                className={`option ${activeView === 'for-you' ? 'active' : ''}`} 
                                onClick={() => setActiveView('for-you')}
                            >
                                <div className="icon-wrapper">
                                    <div className="orbiter-indicator"></div>
                                    <i className="fa-solid fa-star"></i>
                                </div>
                                <span className="text-label">For You</span>
                            </div>
                            <div 
                                className={`option ${activeView === 'messages' ? 'active' : ''}`} 
                                onClick={() => setActiveView('messages')}
                            >
                                <div className="icon-wrapper">
                                    <div className="orbiter-indicator"></div>
                                    <i className="fa-solid fa-paper-plane"></i>
                                </div>
                                <span className="text-label">Messages</span>
                            </div>
                        </div>
                        <i className="fas fa-chevron-up pills-toggle-chevron"></i>
                    </div>
                    <div className="nav-actions-placeholder">
                        {/* Actions move here when collapsed via CSS if needed, or simply hide large-title-row */}
                    </div>
                </div>
                
                <div className="filter-pills-container">
                    <div className="filter-pills">
                        <div className="chip active">All</div>
                        <div className="chip">Miron</div>
                        <div className="chip">GibiNews</div>
                        <div className="chip">Physics</div>
                        <div className="chip">Events</div>
                    </div>
                </div>
            </header>

            <div className="content-panel">
                <div 
                    id="messages-view" 
                    className={`hub-view ${activeView === 'messages' ? 'active' : ''}`} 
                    onScroll={handleScroll}
                    style={{ overflowY: 'auto', height: '100%' }}
                >
                    <div className="messages-list">
                        <div className="messages-list-item miron-chat-card" onClick={() => setIsMironOpen(true)}>
                            <div className="miron-avatar-orb">
                                <span className="material-symbols-outlined">auto_awesome</span>
                            </div>
                            <div className="message-info">
                                <div className="name">Miron</div>
                                <div className="typewriter-wrapper">
                                    <span className="typewriter-text">Ask me anything about your courses...</span>
                                    <span className="blinking-cursor"></span>
                                </div>
                            </div>
                            <div className="message-meta"></div>
                        </div>

                        <div className="messages-list-item">
                            <img src="https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto-format=fit&crop&w=387&q=80" alt="Avatar" />
                            <div className="message-info">
                                <div className="name">Marcus Grant</div>
                                <div className="last-message">Hey, are you free to go over the lab notes?</div>
                            </div>
                            <div className="message-meta">
                                <span>10:42 AM</span>
                                <div className="unread-dot"></div>
                            </div>
                        </div>

                        <div className="messages-list-item">
                            <img src="https://images.unsplash.com/photo-1580489944761-15a19d654956?auto-format&fit&crop&w=461&q=80" alt="Avatar" />
                            <div className="message-info">
                                <div className="name">Physics Study Group</div>
                                <div className="last-message">Sarah: I attached the solution for Q3.</div>
                            </div>
                            <div className="message-meta">
                                <span>Yesterday</span>
                            </div>
                        </div>
                        
                        {/* Placeholder items to allow scrolling for effect test */}
                        {[1, 2, 3, 4, 5].map(i => (
                            <div className="messages-list-item" key={i}>
                                <div style={{width: 50, height: 50, borderRadius: '50%', background: '#333'}}></div>
                                <div className="message-info">
                                    <div className="name">User {i}</div>
                                    <div className="last-message">Content placeholder for scrolling...</div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
            {isMironOpen && <MironChat onClose={() => setIsMironOpen(false)} />}
        </div>
    );
};

export default Connect;