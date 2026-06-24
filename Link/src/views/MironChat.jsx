import React, { useState, useEffect, useRef } from 'react';
import { marked } from 'https://esm.sh/marked';
import { invokeMiron } from '../config/api.js';
import { renderBookBlock } from './BookReader/subjects/Registry.jsx';
import './MironChat.css';

const InlineChatQuiz = ({ quiz, onSubmit }) => {
    const [answers, setAnswers] = useState({});
    const [submitted, setSubmitted] = useState(false);

    const handleSelect = (qId, val) => {
        if (!submitted) setAnswers(prev => ({...prev, [qId]: val}));
    };

    const handleSubmit = () => {
        setSubmitted(true);
        const summary = quiz.questions.map((q, i) => `Q${i+1}: ${answers[q.id] || 'Skipped'}`).join('\n');
        onSubmit(`[Quiz Submission: ${quiz.title}]\n${summary}\n\nPlease evaluate my answers.`);
    };

    return (
        <div className="miron-quiz-card">
            <div className="mq-header"><i className="fas fa-clipboard-list"></i> {quiz.title}</div>
            <div className="mq-body">
                {quiz.questions.map((q, i) => (
                    <div key={q.id || i} className="mq-question">
                        <div className="mq-q-text"><span className="mq-q-num">{i+1}.</span> {q.text}</div>
                        
                        {q.question_type === 'true_false' ? (
                            <div className="mq-tf-pad">
                                <button className={`mq-tf-btn ${answers[q.id] === 'True' ? 'active-true' : ''}`} onClick={() => handleSelect(q.id, 'True')}>TRUE</button>
                                <button className={`mq-tf-btn ${answers[q.id] === 'False' ? 'active-false' : ''}`} onClick={() => handleSelect(q.id, 'False')}>FALSE</button>
                            </div>
                        ) : (
                            <div className="mq-options">
                                {q.options?.map((opt, oIdx) => {
                                    const optText = typeof opt === 'string' ? opt : opt.text;
                                    return (
                                        <button key={oIdx} className={`mq-opt-btn ${answers[q.id] === optText ? 'active' : ''}`} onClick={() => handleSelect(q.id, optText)}>
                                            <div className="mq-opt-ind"></div>
                                            <span>{optText}</span>
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                ))}
                <button className="mq-submit-btn" disabled={submitted} onClick={handleSubmit}>
                    {submitted ? 'Submitted for Grading' : 'Submit to Miron'} <i className="fas fa-paper-plane"></i>
                </button>
            </div>
        </div>
    );
};

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

    const sendMessage = async (textToSend) => {
        if (!textToSend.trim()) return;

        const userMsg = { id: Date.now(), side: 'user', text: textToSend };
        const currentHistory = [...messages];
        
        setMessages(prev => [...prev, userMsg]);
        setIsTyping(true);

        try {
            const data = await invokeMiron({
                prompt: textToSend,
                history: currentHistory,
                context: initialContext
            });

            const thoughtText = data.thoughts && data.thoughts.length > 0 
                ? data.thoughts.join(" | ") 
                : "Synthesizing response...";

            setMessages(prev => [...prev, {
                id: Date.now() + 1,
                side: 'miron',
                thought: thoughtText,
                text: data.response,
                snapshots: data.snapshots,
                quizzes: data.quizzes
            }]);

            if (data.ui_command && data.ui_command.action === 'open_page') {
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

    const handleSend = () => {
        sendMessage(input);
        setInput('');
    };

        // Logic moved to sendMessage wrapper
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
                            {m.text.split(/(\[SNAPSHOT_\d+\]|\[QUIZ_\d+\])/g).map((part, idx) => {
                                const quizMatch = part.match(/\[QUIZ_(\d+)\]/);
                                if (quizMatch) {
                                    const quizId = parseInt(quizMatch[1], 10);
                                    const quiz = m.quizzes?.find(q => q.id === quizId);
                                    if (!quiz) return <span key={idx} style={{color:'red'}}>[Quiz Error]</span>;
                                    return <InlineChatQuiz key={idx} quiz={quiz} onSubmit={sendMessage} />;
                                }

                                const snapMatch = part.match(/\[SNAPSHOT_(\d+)\]/);
                                if (snapMatch) {
                                    const snapId = parseInt(snapMatch[1], 10);
                                    const snap = m.snapshots?.find(s => s.id === snapId);
                                    if (!snap) return null;
                                    
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
                                
                                // Render Markdown Text safely via Marked.js
                                if (!part.trim()) return null;
                                return (
                                    <div 
                                        key={idx} 
                                        className="miron-markdown-chunk"
                                        dangerouslySetInnerHTML={{ __html: marked.parse(part) }} 
                                    />
                                );
                            })}
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