import React, { useState, useEffect } from 'react';
import './ExamPavilion.css';
import ExamSession from './ExamSession.jsx';

const ExamPavilion = ({ university, onClose }) => {
    const [exams, setExams] = useState([]);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState('Midterm'); // 'Midterm', 'Final', 'Mock'
    const [activeSession, setActiveSession] = useState(null);

    useEffect(() => {
        setLoading(true);
        fetch('https://xvldfsmxskhemkslsbym.supabase.co/functions/v1/book-reader', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'list_exams', university_id: university.id })
        })
        .then(res => res.json())
        .then(data => {
            if (data.exams) setExams(data.exams);
            setLoading(false);
        })
        .catch(err => {
            console.error(err);
            setLoading(false);
        });
    }, [university.id]);

    const filteredExams = exams.filter(e => {
        // Fallback for missing exam_type metadata
        const type = (e.exam_type || e.type || e.category || '').toLowerCase();
        if (activeTab === 'Midterm') return type.includes('mid');
        if (activeTab === 'Final') return type.includes('final');
        if (activeTab === 'Mock') {
            // If type is empty, we treat it as a Mock/Other exam by default
            return !type.includes('mid') && !type.includes('final');
        }
        return false;
    });

    const getTabTranslate = () => {
        if (activeTab === 'Midterm') return '0%';
        if (activeTab === 'Final') return '100%';
        return '200%';
    };

    return (
        <div className="pavilion-overlay">
            <header className="pavilion-header">
                <div className="pav-uni-identity">
                    <div className="pav-emblem-sm"><i className="fas fa-landmark"></i></div>
                    <div className="pav-header-text">
                        <h1>{university.name}</h1>
                        <p>Academic Pavilion</p>
                    </div>
                    <button className="icon-button" style={{ marginLeft: 'auto', color: 'white' }} onClick={onClose}>
                        <i className="fas fa-times"></i>
                    </button>
                </div>
            </header>

            <div className="pav-selector-area">
                <div className="pav-segmented-control">
                    <div className="pav-active-pill" style={{ transform: `translateX(${activeTab === 'Midterm' ? '0%' : activeTab === 'Final' ? '100%' : '200%'})` }}></div>
                    <div className={`pav-segment ${activeTab === 'Midterm' ? 'active' : ''}`} onClick={() => setActiveTab('Midterm')}>Midterm</div>
                    <div className={`pav-segment ${activeTab === 'Final' ? 'active' : ''}`} onClick={() => setActiveTab('Final')}>Final</div>
                    <div className={`pav-segment ${activeTab === 'Mock' ? 'active' : ''}`} onClick={() => setActiveTab('Mock')}>Other</div>
                </div>
            </div>

            <main className="pavilion-scroll">
                {loading ? (
                    <div className="pav-empty">Calibrating focus...</div>
                ) : filteredExams.length > 0 ? (
                    filteredExams.map((exam, idx) => {
                        // NORMALIZE DATA: Check for multiple field names and handle nulls
                        const displayCode = exam.course_code || "EXAM";
                        const displayTitle = exam.course_name || exam.title || displayCode || "Untitled Assessment";
                        const displayDate = exam.date || exam.year || "2024";
                        const displayTime = exam.time_allowed_minutes || "90";
                        const displayMarks = exam.total_marks || "100";

                        return (
                            <div 
                                className="pav-exam-card" 
                                key={exam.id} 
                                style={{ animationDelay: `${idx * 0.1}s` }}
                                onClick={() => setActiveSession(exam)}
                            >
                                <div className="pav-lume-gauge">
                                    <div className="pav-lume-fill" style={{ height: '0%' }}></div>
                                </div>
                                <div className="pav-card-top">
                                    <span className="pav-course-code">{displayCode}</span>
                                    <span className="pav-year">{displayDate}</span>
                                </div>
                                <h2 className="pav-exam-title">{displayTitle}</h2>
                                <div className="pav-meta-ribbon">
                                    <div className="pav-meta-item"><i className="far fa-clock"></i> {displayTime}m</div>
                                    <div className="pav-meta-item"><i className="far fa-file-alt"></i> {displayMarks} Marks</div>
                                    <div className="pav-meta-item"><i className="fas fa-bolt"></i> Practice</div>
                                </div>
                            </div>
                        );
                    })
                ) : (
                    <div className="pav-empty">No {activeTab} exams found in this archive.</div>
                )}
            </main>
            {activeSession && <ExamSession exam={activeSession} onClose={() => setActiveSession(null)} />}
        </div>
    );
};

export default ExamPavilion;