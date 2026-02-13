import React, { useState, useEffect } from 'react';
import './ExamSession.css';

const ExamSession = ({ exam, onClose }) => {
    const [timeLeft, setTimeLeft] = useState(exam.time_allowed_minutes * 60 || 3600);
    const [answers, setAnswers] = useState({});
    const [flagged, setFlagged] = useState({});

    // Mock questions for demo
    const questions = [
        { id: 1, text: "What is the moment of a 50N force acting at a perpendicular distance of 2 meters from a pivot?", options: ["25 Nm", "50 Nm", "100 Nm", "200 Nm"] },
        { id: 2, text: "Which law states that for every action there is an equal and opposite reaction?", options: ["Newton's 1st", "Newton's 2nd", "Newton's 3rd", "Hooke's Law"] },
        { id: 3, text: "A 5kg block is pulled with 20N force across a frictionless surface. What is the acceleration?", options: ["2 m/s²", "4 m/s²", "10 m/s²", "5 m/s²"] },
        { id: 4, text: "Define a 'couple' in static equilibrium.", options: ["Single Force", "Two parallel forces", "Opposite forces", "Torque pair"] }
    ];

    useEffect(() => {
        const timer = setInterval(() => {
            setTimeLeft(prev => prev > 0 ? prev - 1 : 0);
        }, 1000);
        return () => clearInterval(timer);
    }, []);

    const formatTime = (seconds) => {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = seconds % 60;
        return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    };

    const handleSelect = (qId, opt) => {
        setAnswers(prev => ({ ...prev, [qId]: opt }));
    };

    const toggleFlag = (qId) => {
        setFlagged(prev => ({ ...prev, [qId]: !prev[qId] }));
    };

    const progress = (Object.keys(answers).length / 50) * 100;

    return (
        <div className="exam-session-overlay">
            <header className="session-header">
                <div className="session-title-box">
                    <p>{exam.course_code || 'PHYS 101'}</p>
                    <h1>{exam.course_name}</h1>
                </div>
                <div className={`timer-pill ${timeLeft < 300 ? 'urgent' : ''}`}>
                    {formatTime(timeLeft)}
                </div>
            </header>

            <nav className="question-nav-strip">
                {[...Array(50)].map((_, i) => (
                    <div 
                        key={i} 
                        className={`nav-dot ${answers[i+1] ? 'answered' : ''} ${flagged[i+1] ? 'flagged' : ''} ${i === 0 ? 'current' : ''}`}
                    >
                        {i + 1}
                    </div>
                ))}
            </nav>

            <main className="exam-viewport">
                {questions.map((q) => (
                    <section className="q-row" key={q.id}>
                        <div className="q-meta">
                            <span className="q-label">Question {q.id}</span>
                            <div className="q-actions">
                                <button className="hint"><i className="fas fa-wand-magic-sparkles"></i></button>
                                <button 
                                    className={flagged[q.id] ? 'active' : ''} 
                                    onClick={() => toggleFlag(q.id)}
                                >
                                    <i className={flagged[q.id] ? 'fas fa-flag' : 'far fa-flag'}></i>
                                </button>
                            </div>
                        </div>
                        <div className="q-text">{q.text}</div>
                        <div className="options-cluster">
                            {q.options.map((opt, idx) => (
                                <div className="opt-wrapper" key={idx}>
                                    <input 
                                        type="radio" 
                                        name={`q-${q.id}`} 
                                        id={`q-${q.id}-${idx}`} 
                                        hidden 
                                        checked={answers[q.id] === opt}
                                        onChange={() => handleSelect(q.id, opt)}
                                    />
                                    <label htmlFor={`q-${q.id}-${idx}`} className="opt-btn">
                                        <div className="opt-indicator"></div>
                                        <span>{opt}</span>
                                    </label>
                                </div>
                            ))}
                        </div>
                    </section>
                ))}
            </main>

            <footer className="session-footer">
                <div className="session-progress-block">
                    <div className="p-text">
                        <span>{Object.keys(answers).length} of 50 Answered</span>
                        <span>{Math.round(progress)}%</span>
                    </div>
                    <div className="p-track">
                        <div className="p-bar-fill" style={{ width: `${progress}%` }}></div>
                    </div>
                </div>
                <button className="finish-exam-btn" onClick={onClose}>Finish</button>
            </footer>
        </div>
    );
};

export default ExamSession;