import React, { useState, useEffect, useRef } from 'react';
import './MironChat.css';

const MironChat = ({ onClose }) => {
    const [messages, setMessages] = useState([
        {
            id: 1,
            side: 'miron',
            text: "Welcome back, Alex. I've been tracing your recent cognitive progress. The patterns in your work on Thermodynamics are showing remarkable symmetry. How shall we expand your horizon today?",
            thought: "Synchronizing with Alex's neural path..."
        }
    ]);
    const [input, setInput] = useState('');
    const [isTyping, setIsTyping] = useState(false);
    const flowRef = useRef(null);

    const mironThoughts = [
        "Accessing cosmic database...",
        "Synthesizing knowledge nodes...",
        "Tracing cognitive patterns...",
        "Formulating elegant solutions...",
        "Interpreting conceptual silence..."
    ];

    useEffect(() => {
        if (flowRef.current) {
            flowRef.current.scrollTo({
                top: flowRef.current.scrollHeight,
                behavior: 'smooth'
            });
        }
    }, [messages, isTyping]);

    const handleSend = () => {
        if (!input.trim()) return;

        const userMsg = { id: Date.now(), side: 'user', text: input };
        setMessages(prev => [...prev, userMsg]);
        setInput('');
        setIsTyping(true);

        // Simulate Miron's elegant response pattern
        setTimeout(() => {
            setIsTyping(false);
            const randomThought = mironThoughts[Math.floor(Math.random() * mironThoughts.length)];
            setMessages(prev => [...prev, {
                id: Date.now() + 1,
                side: 'miron',
                thought: randomThought,
                text: "That is a profound perspective. Let's delve deeper into the mathematical elegance of that thought and see where the variables lead us."
            }]);
        }, 2500);
    };

    return (
        <div className="miron-chat-overlay">
            <div className="nebula-bg">
                <div className="orb orb-1"></div>
                <div className="orb orb-2"></div>
                <div className="orb orb-3"></div>
            </div>

            <header className="miron-header">
                <div className="miron-identity">
                    <div className="miron-logo-lume">
                        <i className="fa-solid fa-wand-magic-sparkles"></i>
                    </div>
                    <h1 className="miron-title-text">The Miron Presence</h1>
                </div>
                
                <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
                    <div className="status-pill-kinetic">
                        <div className="status-dot-pulse"></div>
                        Neural Link Active
                    </div>
                    <button className="icon-button" onClick={onClose} style={{ color: 'white', opacity: 0.6 }}>
                        <i className="fas fa-times"></i>
                    </button>
                </div>
            </header>

            <main className="miron-flow" ref={flowRef}>
                {messages.map(m => (
                    <div key={m.id} className={`message-wrap ${m.side}`}>
                        {m.side === 'miron' && m.thought && (
                            <span className="thought-trace-serif">{m.thought}</span>
                        )}
                        <div className="bubble-luxe">
                            {m.text}
                        </div>
                    </div>
                ))}
                
                {isTyping && (
                    <div className="message-wrap miron">
                        <div className="typing-indicator-lux">
                            <div className="typing-dot-lux"></div>
                            <div className="typing-dot-lux"></div>
                            <div className="typing-dot-lux"></div>
                        </div>
                    </div>
                )}
            </main>

            <footer className="miron-input-wrapper">
                <div className="dock-glass">
                    <input 
                        type="text" 
                        placeholder="Whisper to the core..." 
                        value={input} 
                        onChange={(e) => setInput(e.target.value)}
                        onKeyPress={(e) => e.key === 'Enter' && handleSend()}
                    />
                    <button className="miron-send-btn" onClick={handleSend}>
                        <i className="fa-solid fa-paper-plane"></i>
                    </button>
                </div>
            </footer>
        </div>
    );
};

export default MironChat;