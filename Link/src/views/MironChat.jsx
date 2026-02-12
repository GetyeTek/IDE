import React, { useState, useEffect, useRef } from 'react';
import './MironChat.css';

const MironChat = ({ onClose }) => {
    const [messages, setMessages] = useState([
        { id: 1, side: 'miron', text: "Welcome to the neural bridge, Alex. I'm ready to synthesize our next breakthrough. What's on your mind?", thought: "Calibrating interface..." }
    ]);
    const [input, setInput] = useState('');
    const flowRef = useRef(null);

    useEffect(() => {
        if (flowRef.current) flowRef.current.scrollTop = flowRef.current.scrollHeight;
    }, [messages]);

    const handleSend = () => {
        if (!input.trim()) return;
        const userMsg = { id: Date.now(), side: 'user', text: input };
        setMessages(prev => [...prev, userMsg]);
        setInput('');

        // Mock AI response
        setTimeout(() => {
            setMessages(prev => [...prev, {
                id: Date.now() + 1,
                side: 'miron',
                thought: "Analyzing cognitive patterns...",
                text: "Interesting inquiry. That perspective adds a unique vector to our current data set. Let's explore the implications."
            }]);
        }, 1500);
    };

    return (
        <div className="miron-chat-overlay">
            <div className="nebula-bg">
                <div className="nebula-orb orb-1"></div>
                <div className="nebula-orb orb-2"></div>
            </div>

            <header className="miron-header">
                <div className="miron-identity">
                    <div className="miron-logo-box"><i className="fa-solid fa-wand-magic-sparkles"></i></div>
                    <h2 className="miron-title">Miron Presence</h2>
                </div>
                <button className="icon-button" onClick={onClose}><i className="fas fa-times"></i></button>
            </header>

            <main className="chat-flow" ref={flowRef}>
                {messages.map(m => (
                    <div key={m.id} className={`msg-bubble msg-${m.side}`}>
                        {m.thought && <span className="thought-trace">{m.thought}</span>}
                        {m.text}
                    </div>
                ))}
            </main>

            <footer className="miron-input-area">
                <div className="input-glass-dock">
                    <input 
                        type="text" 
                        placeholder="Speak to the core..." 
                        value={input} 
                        onChange={(e) => setInput(e.target.value)}
                        onKeyPress={(e) => e.key === 'Enter' && handleSend()}
                    />
                    <button className="send-miron-btn" onClick={handleSend}>
                        <i className="fa-solid fa-paper-plane"></i>
                    </button>
                </div>
            </footer>
        </div>
    );
};

export default MironChat;