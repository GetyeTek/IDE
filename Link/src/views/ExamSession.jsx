import React, { useState, useEffect } from 'react';
import { invokeBookReader } from '../config/api.js';
import { renderBookBlock } from './BookReader/subjects/Registry.jsx';
import './ExamSession.css';

const ExamSession = ({ exam, onClose }) => {
    const [timeLeft, setTimeLeft] = useState(exam.time_allowed_minutes * 60 || 3600);
    const [answers, setAnswers] = useState({});
    const [flagged, setFlagged] = useState({});
    const [sections, setSections] = useState([]);
    const [hints, setHints] = useState({});
    const [loading, setLoading] = useState(true);

    const [examMeta, setExamMeta] = useState({ name: exam.course_name, code: exam.course_code });

    useEffect(() => {
        console.log("[SESSION] Fetching real questions from DB...");
        invokeBookReader({ action: 'get_exam_questions', exam_id: exam.id })
        .then(data => {
            if (data.sections) {
                setSections(data.sections);
                // Standardize title from joined data
                setExamMeta({ name: data.course_name, code: data.course_code });
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

    const toggleHint = async (qId) => {
        setHints(prev => {
            const current = prev[qId];
            // If already loaded or loading, just toggle visibility
            if (current?.data || current?.loading) {
                return { ...prev, [qId]: { ...current, open: !current.open } };
            }
            // Start loading state
            return { ...prev, [qId]: { loading: true, open: true, data: null } };
        });

        // Fire API request if not cached
        if (!hints[qId]?.data && !hints[qId]?.loading) {
            try {
                const res = await invokeBookReader({ action: 'get_question_hint', question_id: qId });
                setHints(prev => ({ ...prev, [qId]: { loading: false, open: prev[qId].open, data: res } }));
            } catch (err) {
                console.error("Hint mapping lookup failed:", err);
                setHints(prev => ({ ...prev, [qId]: { loading: false, open: prev[qId].open, data: { found: false } } }));
            }
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
                    <p>{examMeta.code}</p>
                    <h1>{examMeta.name}</h1>
                </div>
                <div className="session-header-actions">
                    <div className={`timer-pill ${timeLeft < 300 ? 'urgent' : ''}`}>
                        {formatTime(timeLeft)}
                    </div>
                    <button className="icon-button exit-session-btn" onClick={onClose} title="Exit Exam">
                        <i className="fas fa-times"></i>
                    </button>
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
                                <button 
                                    className={`hint ${hints[q.id]?.open ? 'active-hint' : ''}`} 
                                    onClick={() => toggleHint(q.id)}
                                >
                                    <i className="fas fa-wand-magic-sparkles"></i>
                                </button>
                                <button 
                                    className={flagged[q.id] ? 'active' : ''} 
                                    onClick={() => toggleFlag(q.id)}
                                >
                                    <i className={flagged[q.id] ? 'fas fa-flag' : 'far fa-flag'}></i>
                                </button>
                            </div>
                        </div>
                        <div className="q-text">{q.text}</div>
                        {q.question_type === 'true_false' ? (
                            <div className="tf-pad-container">
                                <div className="tf-wrapper">
                                    <input 
                                        type="radio" 
                                        name={`q-${q.id}`} 
                                        id={`q-${q.id}-true`} 
                                        hidden 
                                        checked={answers[q.id] === 'True' || answers[q.id]?.text === 'True'}
                                        onChange={() => handleSelect(q.id, q.options?.find(o => (o.text || o) === 'True') || 'True')}
                                    />
                                    <label htmlFor={`q-${q.id}-true`} className="tf-btn is-true">
                                        <i className="fa-solid fa-check"></i>
                                        <span>TRUE</span>
                                    </label>
                                </div>
                                <div className="tf-wrapper">
                                    <input 
                                        type="radio" 
                                        name={`q-${q.id}`} 
                                        id={`q-${q.id}-false`} 
                                        hidden 
                                        checked={answers[q.id] === 'False' || answers[q.id]?.text === 'False'}
                                        onChange={() => handleSelect(q.id, q.options?.find(o => (o.text || o) === 'False') || 'False')}
                                    />
                                    <label htmlFor={`q-${q.id}-false`} className="tf-btn is-false">
                                        <i className="fa-solid fa-xmark"></i>
                                        <span>FALSE</span>
                                    </label>
                                </div>
                            </div>
                        ) : (
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
                                    <div className="q-match-column q-column-b">
                                        {q.matching_data?.right_column?.map((item, i) => <div key={i} className="q-match-item">{item.text || item}</div>)}
                                    </div>
                                </div>
                            )}
                        </div>

                        {hints[q.id]?.open && (
                            <div className="explanation-wrapper">
                                {hints[q.id].loading ? (
                                    <div className="hint-loader"><i className="fas fa-circle-notch fa-spin"></i> Retrieving mapped text...</div>
                                ) : hints[q.id].data?.found ? (
                                    <div className="explanation-container">
                                        <div className="exp-header">
                                            <div className="exp-header-left">
                                                <span className="exp-badge">Text Mapping</span>
                                                <span className="exp-source">{hints[q.id].data.book_title} • Page {hints[q.id].data.page_number}</span>
                                            </div>
                                        </div>
                                        <div className="exp-body">
                                            {hints[q.id].data.block ? renderBookBlock(hints[q.id].data.block, 0, {}) : <p>{hints[q.id].data.snippet}</p>}
                                        </div>
                                    </div>
                                ) : (
                                    <div className="exp-not-found">
                                        <i className="fas fa-link-slash"></i> No direct book mapping found. Try an AI query.
                                    </div>
                                )}
                            </div>
                        )}
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