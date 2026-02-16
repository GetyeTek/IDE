import React, { useState, useEffect } from 'react';
import './ExamPavilion.css';
import ExamSession from './ExamSession.jsx';

const ExamPavilion = ({ university, onClose }) => {
    const [exams, setExams] = useState([]);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState('Midterm'); // 'Midterm', 'Final', 'Mock'
    const [activeSession, setActiveSession] = useState(null);

    useEffect(() => {
        console.group(`%c ARCHIVE DIAGNOSTICS: ${university.name} `, 'background: #42d7b8; color: #000; font-weight: bold;');
        console.log("University ID:", university.id);
        setLoading(true);

        fetch('https://xvldfsmxskhemkslsbym.supabase.co/functions/v1/book-reader', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'list_exams', university_id: university.id })
        })
        .then(res => res.json())
        .then(data => {
            if (data.exams) {
                console.log(`Successfully fetched ${data.exams.length} exams.`);
                console.log("Raw Sample Data (First Item):", data.exams[0]);
                
                // Comprehensive Schema Audit
                const missingFields = [];
                if (data.exams.length > 0) {
                    const keys = Object.keys(data.exams[0]);
                    ['course_name', 'course_code', 'exam_type', 'total_marks'].forEach(f => {
                        if (!keys.includes(f)) missingFields.push(f);
                    });
                }
                
                if (missingFields.length > 0) {
                    console.warn("SCHEMA DISCREPANCY: The following expected fields are missing from DB response:", missingFields);
                    console.info("System: Fallback logic will be used to maintain Intended Design.");
                } else {
                    console.log("SCHEMA VALIDATED: Database metadata matches UI requirements.");
                }

                setExams(data.exams);
            } else {
                console.error("DATA FAILURE: Fetch succeeded but 'exams' array is missing from response.", data);
            }
            setLoading(false);
            console.groupEnd();
        })
        .catch(err => {
            console.error("NETWORK/SERVER FAILURE:", err);
            setLoading(false);
            console.groupEnd();
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
                        // NORMALIZE DATA: Smarter Fallbacks
                        // If course_name is missing, we use exam_type as title since it's more descriptive than 'Untitled'
                        const displayCode = exam.course_code || "EXAM";
                        const displayTitle = exam.course_name || exam.exam_type || "General Assessment";
                        const displayDate = exam.date || "Unknown Date";
                        const displayTime = exam.time_allowed_minutes ? `${exam.time_allowed_minutes}m` : "N/A";
                        const displayMarks = exam.total_marks ? `${exam.total_marks}` : "---";

                        return (
                            <div 
                                className="pav-exam-card" 
                                key={exam.id} 
                                style={{ animationDelay: `${idx * 0.1}s` }}
                                onClick={() => setActiveSession(exam)}
                            >
                                <div className="pav-lume-gauge">
                                    {/* Calculated progress placeholder */}
                                    <div className="pav-lume-fill" style={{ height: '0%' }}></div>
                                </div>
                                <div className="pav-card-top">
                                    <span className="pav-course-code">{displayCode}</span>
                                    <span className="pav-year">{displayDate}</span>
                                </div>
                                <h2 className="pav-exam-title">{displayTitle}</h2>
                                <div className="pav-meta-ribbon">
                                    <div className="pav-meta-item">
                                        <i className="far fa-clock"></i> {displayTime}
                                    </div>
                                    <div className="pav-meta-item">
                                        <i className="far fa-file-alt"></i> {displayMarks} Marks
                                    </div>
                                    <div className="pav-meta-item">
                                        <i className="fas fa-bolt"></i> Practice
                                    </div>
                                </div>
                            </div>
                        );
                    })
                ) : (
                    <div className="pav-empty">No {activeTab} exams found in this archive.</div>
                )}
                
                {filteredExams.length > 0 && (
                    <div className="pav-archive-end">
                        <div className="pav-divider"></div>
                        <div className="pav-end-seal">
                            <i className="fas fa-scroll"></i>
                            <span>End of Academic Archive</span>
                        </div>
                    </div>
                )}
            </main>
            {activeSession && <ExamSession exam={activeSession} onClose={() => setActiveSession(null)} />}
        </div>
    );
};

export default ExamPavilion;