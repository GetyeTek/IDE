import React, { useState, useEffect, useRef } from 'react';
import './MironChat.css';

const MironChat = ({ onClose, initialContext }) => {
    const [messages, setMessages] = useState(() => {
        const base = [
            {
                id: 1,
                side: 'miron',
                text: "I'm monitoring your cognitive path. Let's explore.",
                thought: null
            }
        ];
        
        if (initialContext) {
            base.push({
                id: 2,
                side: 'user',
                text: `Regarding this passage: "${initialContext}"`
            });
            base.push({
                id: 3,
                side: 'miron',
                thought: "Analyzing literature node...",
                text: "Ah, yes. This relation contains a deep thermodynamic constraint. Let's dissect the mathematical properties together."
            });
        }
        return base;
    });
    const [input, setInput] = useState('');
    const [isTyping, setIsTyping] = useState(false);
    const flowRef = useRef(null);

    const mironThoughts = [
        "Synthesizing knowledge nodes...",
        "Tracing cognitive patterns...",
        "Formulating elegant solutions..."
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

        setTimeout(() => {
            setIsTyping(false);
            const randomThought = mironThoughts[Math.floor(Math.random() * mironThoughts.length)];
            setMessages(prev => [...prev, {
                id: Date.now() + 1,
                side: 'miron',
                thought: randomThought,
                text: "I see exactly what you mean. Let's delve into the elegance of that thought and trace where the variables lead us."
            }]);
        }, 2000);
    };

    return (
        <div className="miron-chat-overlay">
            <div className="athena-bg"></div>

            <header className="athena-header">
                <div className="athena-brand">
                    <div className="athena-orb">
                        <i className="fa-solid fa-sparkles" style={{fontSize: '0.8rem'}}></i>
                    </div>
                    <h1 className="athena-title">Miron</h1>
                </div>
                <button className="athena-close" onClick={onClose}>
                    <i className="fas fa-times"></i>
                </button>
            </header>

            <main className="athena-flow" ref={flowRef}>
                {messages.map(m => (
                    <div key={m.id} className={`chat-node ${m.side}`}>
                        {m.side === 'miron' && m.thought && (
                            <span className="miron-thought">{m.thought}</span>
                        )}
                        <div className="athena-bubble">
                            {m.text}
                        </div>
                    </div>
                ))}
                
                {isTyping && (
                    <div className="chat-node miron">
                        <div className="athena-typing">
                            <div className="dot"></div>
                            <div className="dot"></div>
                            <div className="dot"></div>
                        </div>
                    </div>
                )}
            </main>

            <footer className="athena-input-area">
                <div className="capsule-dock">
                    <input 
                        type="text" 
                        placeholder="Message Miron..." 
                        value={input} 
                        onChange={(e) => setInput(e.target.value)}
                        onKeyPress={(e) => e.key === 'Enter' && handleSend()}
                    />
                    <button className="capsule-send" onClick={handleSend}>
                        <i className="fa-solid fa-arrow-up"></i>
                    </button>
                </div>
            </footer>
        </div>
    );
};

export default MironChat;