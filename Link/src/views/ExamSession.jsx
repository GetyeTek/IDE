import React, { useState, useEffect } from 'react';
import { invokeBookReader } from '../config/api.js';
import { renderBookBlock } from './BookReader/subjects/Registry.jsx';
import BookReader from './BookReader/BookReader.jsx';
import ReportModal from '../components/ui/ReportModal.jsx';
import './ExamSession.css';

const getNormalizedMatchingData = (q) => {
    if (q.matching_data && q.matching_data.left_column && q.matching_data.left_column.length > 0) {
        return q.matching_data;
    }

    let opts = q.options;
    if (typeof opts === 'string') {
        try { opts = JSON.parse(opts); } catch(e) {}
    }

    if (opts && Array.isArray(opts) && opts.length > 0) {
        const getStr = (arr, prefix) => {
            const found = arr.find(o => {
                const text = typeof o === 'string' ? o : (o?.text || '');
                return typeof text === 'string' && text.includes(prefix);
            });
            return typeof found === 'string' ? found : found?.text;
        };
        
        const leftStr = getStr(opts, 'Column A');
        const rightStr = getStr(opts, 'Column B');
        
        if (leftStr && rightStr) {
            const parseStr = (str, prefix, splitRegex) => {
                const prefixMatch = new RegExp(`.*${prefix}:?`, 'i');
                const cleaned = str.replace(prefixMatch, '').trim();
                const parts = cleaned.split(splitRegex);
                
                const items = [];
                for (let i = 1; i < parts.length; i += 2) {
                    let item = (parts[i+1] || '').trim();
                    // Clean trailing commas or semicolons left over from the split
                    item = item.replace(/[,;]+$/, '').trim();
                    if (item) items.push(item);
                }
                return items;
            };
            
            return {
                left_column: parseStr(leftStr, 'Column A', /(\b\d+\.\s*)/),
                right_column: parseStr(rightStr, 'Column B', /(\b[A-Z]\.\s*)/)
            };
        }
    }
    
    return { left_column: [], right_column: [] };
};

const ExamSession = ({ exam, onClose }) => {
    const [timeLeft, setTimeLeft] = useState(exam.time_allowed_minutes * 60 || 3600);
    const [activeReferenceBook, setActiveReferenceBook] = useState(null);
    const [answers, setAnswers] = useState({});
    const [flagged, setFlagged] = useState({});
    const [sections, setSections] = useState([]);
    const [hints, setHints] = useState({});
    const [activeMatch, setActiveMatch] = useState({});
    const [loading, setLoading] = useState(true);
    const [reportQuestionId, setReportQuestionId] = useState(null);

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
                        {section.questions.map((q, idx) => {
                            // Only run normalizer if it's explicitly matching or implicitly looks like it
                            const isMatching = (q.question_type && q.question_type.toLowerCase() === 'matching') || 
                                               q.matching_data || 
                                               (Array.isArray(q.options) && q.options.some(o => typeof o === 'string' && o.includes('Column A')));
                            
                            const matchData = isMatching ? getNormalizedMatchingData(q) : null;
                            
                            return (
                            <section className="q-row" key={q.id} id={`q-box-${q.id}`}>
                                <div className="q-meta">
                                    <span className="q-label">Question {idx + 1}</span>
                                    <div className="q-actions">
                                        <button 
                                            className="report-btn" 
                                            onClick={() => setReportQuestionId(q.id)}
                                            title="Report an issue"
                                        >
                                            <i className="fas fa-triangle-exclamation"></i>
                                        </button>
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
                                {(q.question_type && q.question_type.toLowerCase() === 'true_false') ? (
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
                                ) : (matchData && matchData.left_column?.length > 0) ? (
                                    <div className={`interactive-match-container ${(matchData.right_column?.some(r => (r.text || r).length > 45) || matchData.left_column?.some(l => (l.text || l).length > 45)) ? 'vertical-match' : ''}`}>
                                        <div className="match-col match-left">
                                            {matchData.left_column?.map((item, idx) => {
                                                const qAnswers = answers[q.id] || {};
                                                const currentActive = activeMatch[q.id];
                                                const isPaired = qAnswers[idx] !== undefined;
                                                const isActive = currentActive === idx;
                                                const isDisabled = currentActive !== undefined && currentActive !== idx;
                                                
                                                return (
                                                    <div key={idx} className={`match-item-left ${isActive ? 'is-active' : ''} ${isPaired ? 'is-paired' : ''} ${isDisabled ? 'is-disabled' : ''}`} onClick={() => setActiveMatch(prev => ({ ...prev, [q.id]: isActive ? undefined : idx }))}>
                                                        <span className="match-index">{idx + 1}.</span>
                                                        <span className="match-text">{item.text || item}</span>
                                                        {isPaired && <span className="match-badge">{String.fromCharCode(65 + qAnswers[idx])}</span>}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                        <div className={`match-col match-right ${activeMatch[q.id] !== undefined ? 'is-listening' : ''}`}>
                                            {matchData.right_column?.map((item, idx) => {
                                                const qAnswers = answers[q.id] || {};
                                                const currentActive = activeMatch[q.id];
                                                const usedByLeftIdx = Object.keys(qAnswers).find(k => qAnswers[k] === idx);
                                                const isUsed = usedByLeftIdx !== undefined;

                                                return (
                                                    <div key={idx} className={`match-item-right ${isUsed ? 'is-used' : ''}`} onClick={() => {
                                                        if (currentActive !== undefined) {
                                                            const newAnswers = { ...qAnswers };
                                                            if (isUsed) delete newAnswers[usedByLeftIdx];
                                                            newAnswers[currentActive] = idx;
                                                            handleSelect(q.id, newAnswers);
                                                            setActiveMatch(prev => ({ ...prev, [q.id]: undefined }));
                                                        }
                                                    }}>
                                                        <span className="match-letter">{String.fromCharCode(65 + idx)}.</span>
                                                        <span className="match-text">{item.text || item}</span>
                                                    </div>
                                                );
                                            })}
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
                                    </div>
                                )}

                                                        {hints[q.id]?.open && (
                            <div className="rag-insight-container">
                                {hints[q.id].loading ? (
                                    <div className="hint-loader"><i className="fas fa-circle-notch fa-spin"></i> Locating document source...</div>
                                ) : hints[q.id].data?.found ? (
                                    <>
                                        <div className="document-snapshot">
                                            <div className="snapshot-topbar">
                                                <span><i className="fas fa-file-pdf"></i> {hints[q.id].data.book_title}</span>
                                                <span>Page {hints[q.id].data.page_number}</span>
                                            </div>
                                            <div className="snapshot-content">
                                                {hints[q.id].data.block ? renderBookBlock(hints[q.id].data.block, 0, {}) : <p>{hints[q.id].data.snippet}</p>}
                                            </div>
                                        </div>
                                        
                                        <div className="ai-explanation-box">
                                            <div className="ai-exp-header">
                                                <i className="fas fa-sparkles"></i> Miron Synthesis
                                            </div>
                                            <div className="ai-exp-body">
                                                <p>This is where the AI-generated explanation will be wired up. Miron will synthesize the textbook snapshot above to clarify why a certain choice is correct, directly addressing common misconceptions in this topic.</p>
                                            </div>
                                        </div>

                                        <div className="insight-actions">
                                            <button className="btn-insight-close" onClick={() => toggleHint(q.id)}>Close</button>
                                            <button className="btn-insight-book" onClick={() => setActiveReferenceBook(hints[q.id].data)}>
                                                Show in Book <i className="fas fa-external-link-alt" style={{marginLeft: '4px'}}></i>
                                            </button>
                                        </div>
                                    </>
                                ) : (
                                    <div className="exp-not-found">
                                        <i className="fas fa-link-slash"></i> No direct textbook source mapped for this question.
                                    </div>
                                )}
                            </div>
                        )}
                            </section>
                            );
                        })}
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
            
            {activeReferenceBook && (
                <BookReader 
                    book={{ id: activeReferenceBook.book_id, title: activeReferenceBook.book_title }} 
                    onClose={() => setActiveReferenceBook(null)}
                    targetPageNumber={activeReferenceBook.page_number}
                    targetBlockIndex={activeReferenceBook.content_index}
                    zIndexOverride={3500}
                />
            )}

            {reportQuestionId && (
                <ReportModal 
                    questionId={reportQuestionId} 
                    source="exam" 
                    onClose={() => setReportQuestionId(null)} 
                />
            )}
        </div>
    );
};

export default ExamSession;