import React from 'react';
import './BookCard.css';

export const universityIconMap = {
    "Adama Science and Technology University": "fa-atom",
    "Addis Ababa Science and Technology University": "fa-microchip",
    "Addis Ababa University": "fa-landmark",
    "Ambo University": "fa-bottle-water",
    "Arba Minch University": "fa-fish-fins",
    "Arsi University": "fa-person-running",
    "Assosa University": "fa-gem",
    "Bahir Dar University": "fa-ship",
    "Bonga University": "fa-mug-hot",
    "Bule Hora University": "fa-horse",
    "Debark University": "fa-mountain-sun",
    "Debre Birhan University": "fa-lightbulb",
    "Debre Markos University": "fa-cross",
    "Debre Tabor University": "fa-gun",
    "Dilla University": "fa-monument",
    "Dire Dawa University": "fa-train",
    "Ethiopian Science and Technology Universities": "fa-vial-virus",
    "Gambella University": "fa-droplet",
    "General Collection": "fa-book-atlas",
    "Haramaya University": "fa-wheat-awn",
    "Hawassa University": "fa-fish",
    "Injibara University": "fa-tree",
    "Jimma University": "fa-leaf",
    "Madda Walabu University": "fa-scroll",
    "Mekdela Amba University": "fa-fort-awesome",
    "Metu University": "fa-coffee",
    "Mizan Tepi University": "fa-pepper-hot",
    "Salale University": "fa-music",
    "Samara University": "fa-hippo",
    "University of Gondar": "fa-chess-rook",
    "Wachemo University": "fa-mask",
    "Wolaita Sodo University": "fa-house",
    "Woldia University": "fa-shield-heart",
    "Wolkite University": "fa-plate-wheat",
    "Wollega University": "fa-coins",
    "Wollo University": "fa-feather"
};

export const getBookColor = (title) => {
    let hash = 0;
    for (let i = 0; i < title.length; i++) hash = title.charCodeAt(i) + ((hash << 5) - hash);
    return `linear-gradient(135deg, hsl(${Math.abs(hash) % 360}, 50%, 30%), hsl(${(Math.abs(hash) + 40) % 360}, 60%, 15%))`;
};

const BookCard = ({ item, isUniversity, isExamTrigger, previewMode, onClick }) => {
    return (
        <div 
            className={`book-immersive ${isExamTrigger ? 'is-stack' : ''} ${isUniversity ? 'is-heritage' : ''} ${previewMode ? 'preview-mode' : ''}`}
            style={{ 
                backgroundImage: (isUniversity || isExamTrigger) ? 'none' : (item.cover_url ? `url("${item.cover_url}")` : getBookColor(item.title)),
            }}
            onClick={onClick}
        >
            {isExamTrigger ? (
                <div className="exam-stack-content">
                    <div className="emblem"><i className="fas fa-university"></i></div>
                    <div className="stack-title">EXAMS</div>
                </div>
            ) : isUniversity ? (
                <>
                    <div className="tilet-border-sm"></div>
                    <div className="heritage-emblem">
                        <i className={`fa-solid ${universityIconMap[item.title] || 'fa-graduation-cap'}`}></i>
                    </div>
                    <div className="heritage-content">
                        <div className="heritage-label">Collection</div>
                        <div className="heritage-title">{item.title}</div>
                    </div>
                    <div className="tilet-border-sm bottom"></div>
                </>
            ) : (
                <div className="info-overlay">
                    <h3 className="title">{item.title}</h3>
                    <div className="progress-bar"><div className="progress" style={{ width: '0%' }}></div></div>
                </div>
            )}
        </div>
    );
};

export default BookCard;