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

    const scrollToQuestion = (id) => {
        const el = document.getElementById(`q-box-${id}`);
        if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    };

    const allQuestions = sections.flatMap(s => s.questions);
    const totalCount = allQuestions.length || 1;
    const progress = (Object.keys(answers).length / totalCount) * 100;
    const flaggedCount = Object.values(flagged).filter(Boolean).length;
    const flaggedProgress = (flaggedCount / totalCount) * 100;

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
                {allQuestions.map((q, i) => (
                    <div 
                        key={q.id} 
                        onClick={() => scrollToQuestion(q.id)}
                        className={`nav-dot ${answers[q.id] ? 'answered' : ''} ${flagged[q.id] ? 'flagged' : ''}`}
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
                        {section.questions.map((q, idx) => (
                    <section className="q-row" key={q.id} id={`q-box-${q.id}`}>
                        <div className="q-meta">
                            <span className="q-label">Question {idx + 1}</span>
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
                        <div className={`options-cluster ${q.options?.some(o => (o.text || o).length > 45) ? 'vertical-layout' : ''}`}>
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
                        <span>{Object.keys(answers).length} / {totalCount} Answered</span>
                        <span>{Math.round(progress)}% Complete</span>
                    </div>
                    <div className="p-track">
                        <div className="p-bar-fill" style={{ width: `${progress}%` }}></div>
                        <div className="p-bar-flagged" style={{ width: `${flaggedProgress}%`, left: `${progress}%` }}></div>
                    </div>
                </div>
                <button className="finish-exam-btn" onClick={onClose}>Finish Exam</button>
            </footer>
        </div>
    );
};

export default ExamSession;