import React, { useState, useEffect } from 'react';
import './ExamSession.css';

const ExamSession = ({ exam, onClose }) => {
    const [timeLeft, setTimeLeft] = useState(exam.time_allowed_minutes * 60 || 3600);
    const [answers, setAnswers] = useState({});
    const [flagged, setFlagged] = useState({});
    const [sections, setSections] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        console.log("[SESSION] Fetching real questions from DB...");
        fetch('https://xvldfsmxskhemkslsbym.supabase.co/functions/v1/book-reader', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'get_exam_questions', exam_id: exam.id })
        })
        .then(res => res.json())
        .then(data => {
            if (data.sections) {
                console.log(`[SESSION] Loaded ${data.sections.length} sections`);
                setSections(data.sections);
            }
            setLoading(false);
        })
        .catch(err => console.error("[SESSION_ERROR]", err));
    }, [exam.id]);

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
                {loading ? (
                    <div style={{padding: '2rem', textAlign: 'center'}}>Assembling Exam Papers...</div>
                ) : sections.map((section) => (
                    <div key={section.id} className="section-wrap">
                        <div className="section-header-display" style={{padding: '1rem 0', borderBottom: '1px solid rgba(255,255,255,0.1)', marginBottom: '1rem'}}>
                            <h3 style={{color: 'var(--accent-teal)'}}>{section.title}</h3>
                            <p style={{fontSize: '0.8rem', opacity: 0.6}}>{section.instructions}</p>
                        </div>
                        {section.questions.map((q) => (
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
                            {q.options?.map((opt, idx) => (
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
                                        <span>{opt.text || opt}</span>
                                    </label>
                                </div>
                            ))}

                            {(q.question_type === 'matching' || q.matching_data) && (
                                <div className="q-matching-container">
                                    <div className="q-match-column q-column-a">
                                        {q.matching_data?.left_column?.map((item, i) => <div key={i} className="q-match-item">{item.text || item}</div>)}
                                    </div>
                                    <div className="q-match-column q-column-b">
                                        {q.matching_data?.right_column?.map((item, i) => <div key={i} className="q-match-item">{item.text || item}</div>)}
                                    </div>
                                </div>
                            )}
                        </div>
                    </section>
                ))}
                </div>
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