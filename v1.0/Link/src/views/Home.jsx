import React, { useState, useEffect } from 'react';

const Home = ({ onOpenActivity }) => {
    const [greeting, setGreeting] = useState('Hello');
    const [currentTaskIndex, setCurrentTaskIndex] = useState(0);
    const [isFading, setIsFading] = useState(false);

    const tasks = [
        { icon: 'fas fa-users', title: 'Physics Study Group', category: 'Collaboration', dueIn: '5d' },
        { icon: 'fas fa-book-open', title: 'Chapter 5 Reading', category: 'Literature', dueIn: '9d' },
        { icon: 'fas fa-flask', title: 'Lab Report Draft', category: 'Chemistry', dueIn: '12d' }
    ];

    useEffect(() => {
        // Greeting Logic
        const currentHour = new Date().getHours();
        if (currentHour < 12) setGreeting('Good Morning');
        else if (currentHour < 18) setGreeting('Good Afternoon');
        else setGreeting('Good Evening');

        // Task Rotation Logic
        const interval = setInterval(() => {
            setIsFading(true);
            setTimeout(() => {
                setCurrentTaskIndex((prev) => (prev + 1) % tasks.length);
                setIsFading(false);
            }, 400);
        }, 4000);

        return () => clearInterval(interval);
    }, []);

    const currentTask = tasks[currentTaskIndex];

    // Dynamic background based on time
    const getHeroImage = () => {
        const h = new Date().getHours();
        if (h < 12) return 'https://images.unsplash.com/photo-1500382017468-9049fed747ef?auto=format&fit=crop&w=1800&q=80';
        if (h < 18) return 'https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=1800&q=80';
        return 'https://images.unsplash.com/photo-1475924156734-496f6cac6ec1?auto=format&fit=crop&w=1800&q=80';
    };

    return (
        <div className="tab-content active" id="home-content">
            <div className="scrollable-content">
                <div className="hero-wrapper">
<header className="app-header">
                        <div className="welcome-text"><h1>{greeting}, Alex</h1></div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                            <button className="icon-button notification-btn" onClick={onOpenActivity}>
                                <i className="fas fa-bell"></i>
                                <span className="notification-badge">3</span>
                            </button>
                            <img 
                                src="https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?ixlib=rb-4.0.3&auto-format=fit&crop=w=80&q=80" 
                                alt="Profile" 
                                className="profile-avatar" 
                            />
                        </div>
                    </header>
                    <section 
                        className="welcome-hero" 
                        style={{ backgroundImage: `url('${getHeroImage()}')` }}
                    >
                        <div className="overlay"></div>
                        <div className="hero-summary">
                            <h2>You're on track.</h2>
                            <p>3 tasks are due this week.</p>
                        </div>
                    </section>
                </div>
                
                <div className="page-content">
                    <section className="priority-section">
                        <h2 className="section-label">Urgent</h2>
                        <div className="priority-scroll-wrapper">
                            <div className="priority-track">
                                <a href="#" className="priority-card card-base is-urgent">
                                    <div>
                                        <div className="card-header">
                                            <i className="fas fa-file-signature icon"></i>
                                            <span className="category">Exam</span>
                                        </div>
                                        <h3 className="title">Thermodynamics</h3>
                                    </div>
                                    <div className="countdown is-urgent-text">3<span className="label">days</span></div>
                                </a>
                                <a href="#" className="priority-card card-base">
                                    <div>
                                        <div className="card-header">
                                            <i className="fas fa-clipboard-list icon"></i>
                                            <span className="category">Assignment</span>
                                        </div>
                                        <h3 className="title">Problem Set 5 Due</h3>
                                    </div>
                                    <div className="countdown">7<span className="label">days</span></div>
                                </a>
                            </div>
                        </div>
                    </section>

                    <section className="whats-next-section">
                        <h2 className="section-label">What's Next</h2>
                        <div className="next-task-container card-base">
                            <div id="next-task-content" className={isFading ? 'is-fading' : ''}>
                                <div className="task-icon"><i className={currentTask.icon}></i></div>
                                <div className="task-details">
                                    <div className="title">{currentTask.title}</div>
                                    <div className="category">{currentTask.category}</div>
                                </div>
                                <div className="task-countdown">{currentTask.dueIn}</div>
                            </div>
                        </div>
                    </section>
                </div>
            </div>
        </div>
    );
};

export default Home;