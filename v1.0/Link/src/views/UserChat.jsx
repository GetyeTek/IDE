import React, { useState, useEffect, useRef } from 'react';
import './UserChat.css';

const UserChat = ({ user, onClose }) => {
    const [messages, setMessages] = useState([
        { id: 1, side: 'received', text: `Hey Alex! Are you coming to the Physics lab tomorrow? Dr. Aris mentioned we're doing the pendulum experiment.`, time: '10:42 AM' },
        { id: 2, side: 'sent', text: `Definitely. I've been reviewing the formulas Miron sent over. Check this out!`, time: '10:45 AM', read: true }
    ]);
    const [input, setInput] = useState('');
    const flowRef = useRef(null);

    useEffect(() => {
        if (flowRef.current) flowRef.current.scrollTop = flowRef.current.scrollHeight;
    }, [messages]);

    const handleSend = () => {
        if (!input.trim()) return;
        const now = new Date();
        const timeStr = now.getHours() + ":" + now.getMinutes().toString().padStart(2, '0');
        
        const newMsg = { id: Date.now(), side: 'sent', text: input, time: timeStr, read: false };
        setMessages(prev => [...prev, newMsg]);
        setInput('');
    };

    return (
        <div className="user-chat-overlay">
            <div className="ambient-prism-light"></div>

            <header className="prism-header">
                <div className="contact-profile">
                    <div className="avatar-ring">
                        <img src={user.avatar} alt={user.name} />
                        <div className="online-dot"></div>
                    </div>
                    <div className="contact-details">
                        <h2>{user.name}</h2>
                        <p>Active Now</p>
                    </div>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button className="icon-button" style={{ color: 'white', opacity: 0.6 }} onClick={onClose}>
                        <i className="fas fa-times"></i>
                    </button>
                </div>
            </header>

            <main className="prism-flow" ref={flowRef}>
                <div className="date-pill">Today</div>
                
                {messages.map(m => (
                    <div key={m.id} className={`msg-prism-group ${m.side}`}>
                        <div className="prism-bubble">{m.text}</div>
                        <div className="prism-time">
                            {m.time} 
                            {m.side === 'sent' && (
                                <i className={`fa-solid ${m.read ? 'fa-check-double' : 'fa-check'}`} 
                                   style={{ marginLeft: '4px', color: m.read ? '#42d7b8' : 'inherit' }}></i>
                            )}
                        </div>
                    </div>
                ))}
            </main>

            <footer className="prism-input-wrapper">
                <div className="prism-dock">
                    <button className="add-btn"><i className="fa-solid fa-plus"></i></button>
                    <input 
                        type="text" 
                        placeholder={`Message ${user.name.split(' ')[0]}...`} 
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyPress={(e) => e.key === 'Enter' && handleSend()}
                    />
                    <button className="prism-send-btn" onClick={handleSend}>
                        <i className="fa-solid fa-arrow-up"></i>
                    </button>
                </div>
            </footer>
        </div>
    );
};

export default UserChat;