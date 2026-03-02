import React from 'react';
import './ActivityHub.css';

const ActivityHub = ({ onClose }) => {
    const notifications = [
        {
            id: 1,
            type: 'study',
            unread: true,
            title: 'Physics Review',
            time: '2m ago',
            desc: 'Your "Optics" quiz is ready. You typically perform better in the afternoon.',
            insight: 'Alex, focusing on wave-particle duality today will strengthen your foundation.',
            icon: 'fa-brain'
        },
        {
            id: 2,
            type: 'social',
            unread: true,
            title: 'Marcus Grant',
            time: '1h ago',
            desc: 'Shared a file: "Pendulum_Data_Draft.xlsx" in Physics Study Group.',
            icon: 'fa-message'
        },
        {
            id: 3,
            type: 'reward',
            unread: false,
            title: 'Milestone Reached',
            time: '4h ago',
            desc: '7-Day Streak! You\'ve earned 200 Linkoins.',
            icon: 'fa-medal'
        }
    ];

    return (
        <div className="activity-overlay" onClick={onClose}>
            <div className="pulse-container" onClick={e => e.stopPropagation()}>
                <header className="pulse-header">
                    <h1>Activity</h1>
                    <div style={{ display: 'flex', gap: '1rem' }}>
                        <button className="icon-button" onClick={onClose} style={{ color: 'white' }}>
                            <i className="fas fa-times"></i>
                        </button>
                    </div>
                </header>

                <main className="pulse-scroll">
                    <div className="pulse-section-label">Today</div>
                    {notifications.map(n => (
                        <div key={n.id} className={`pulse-item type-${n.type} ${n.unread ? 'unread' : ''}`}>
                            <div className="p-icon-box"><i className={`fa-solid ${n.icon}`}></i></div>
                            <div className="p-content">
                                <div className="p-meta">
                                    <h3>{n.title}</h3>
                                    <span className="p-time">{n.time}</span>
                                </div>
                                <p className="p-desc">{n.desc}</p>
                                {n.insight && (
                                    <div className="miron-insight-box">"{n.insight}"</div>
                                )}
                                <div className="p-action-row">
                                    <button className="p-btn primary">View</button>
                                    <button className="p-btn">Dismiss</button>
                                </div>
                            </div>
                        </div>
                    ))}
                </main>
            </div>
        </div>
    );
};

export default ActivityHub;