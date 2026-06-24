import React, { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'https://esm.sh/react-markdown@9';
import { invokeMiron } from '../config/api.js';
import { renderBookBlock } from './BookReader/subjects/Registry.jsx';
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

    const handleSend = async () => {
        if (!input.trim()) return;

        const promptText = input.trim();
        const userMsg = { id: Date.now(), side: 'user', text: promptText };
        
        // Save current history before adding new message
        const currentHistory = [...messages];
        
        setMessages(prev => [...prev, userMsg]);
        setInput('');
        setIsTyping(true);

        try {
            const data = await invokeMiron({
                prompt: promptText,
                history: currentHistory,
                context: initialContext
            });

            // If Miron used tools, map them to the thought bubble
            const thoughtText = data.thoughts && data.thoughts.length > 0 
                ? data.thoughts.join(" | ") 
                : "Synthesizing response...";

            setMessages(prev => [...prev, {
                id: Date.now() + 1,
                side: 'miron',
                thought: thoughtText,
                text: data.response,
                snapshots: data.snapshots
            }]);

            // Handle UI Commands
            if (data.ui_command && data.ui_command.action === 'open_page') {
                // In a real scenario, this would dispatch an event the BookReader listens for
                console.log("Miron instructed UI to open page:", data.ui_command);
            }

        } catch (error) {
            console.error("Miron Communication Error:", error);
            setMessages(prev => [...prev, {
                id: Date.now() + 1,
                side: 'miron',
                thought: "Connection unstable...",
                text: "My cognitive link to the mainframe encountered an anomaly. Please try asking again."
            }]);
        } finally {
            setIsTyping(false);
        }
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
                            {(!m.snapshots || m.snapshots.length === 0) ? (
                                <ReactMarkdown>{m.text}</ReactMarkdown>
                            ) : (
                                m.text.split(/(\[SNAPSHOT_\d+\])/g).map((part, idx) => {
                                    const snapMatch = part.match(/\[SNAPSHOT_(\d+)\]/);
                                    if (snapMatch) {
                                        const snapId = parseInt(snapMatch[1], 10);
                                        const snap = m.snapshots.find(s => s.id === snapId);
                                        if (!snap) return <span key={idx} style={{color:'red'}}>[Snapshot Error]</span>;
                                        
                                        return (
                                            <div key={idx} className="inline-chat-snapshot">
                                                <div className="snapshot-topbar">
                                                    <span><i className="fas fa-file-pdf"></i> {snap.book_title || snap.course_code}</span>
                                                    <span>Page {snap.page_number}</span>
                                                </div>
                                                <div className="snapshot-content">
                                                    {snap.blocks.map((b, i) => renderBookBlock(b, i, {}))}
                                                </div>
                                            </div>
                                        );
                                    }
                                    return part.trim() ? <ReactMarkdown key={idx}>{part}</ReactMarkdown> : null;
                                })
                            )}
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