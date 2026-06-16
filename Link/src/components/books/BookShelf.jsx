import React from 'react';
import './BookShelf.css';
import BookCard from './BookCard.jsx';

const BookShelf = ({ items, isUniversity, previewMode, onBookClick, onExamTrigger, onUniversityClick }) => {
    const handleAction = (item) => {
        if (item.isExamTrigger && onExamTrigger) onExamTrigger();
        else if (isUniversity && onUniversityClick) onUniversityClick(item);
        else if (!isUniversity && onBookClick) onBookClick(item);
    };

    if (previewMode) {
        return (
            <div className="bookshelf-perspective">
                <div className="book-container">
                    {items.length === 0 ? (
                        <div style={{color:'rgba(255,255,255,0.5)', gridColumn:'span 3', textAlign:'center', paddingTop:'2rem'}}>Loading...</div>
                    ) : (
                        items.map((item, i) => (
                            <div className="book-group" key={i}>
                                <BookCard 
                                    item={item} 
                                    isUniversity={false} 
                                    isExamTrigger={item.isExamTrigger} 
                                    previewMode={true}
                                    onClick={() => handleAction(item)}
                                />
                            </div>
                        ))
                    )}
                </div>
                <div className="shelf-wood"></div>
            </div>
        );
    }

    const rows = [];
    for (let i = 0; i < items.length; i += 3) {
        rows.push(items.slice(i, i + 3));
    }

    if(rows.length === 0) return (
        <div style={{ marginBottom: '1.5rem' }}>
            <div style={{color:'rgba(255,255,255,0.2)', textAlign:'center', padding:'4rem 0', fontSize: '0.9rem'}}>No items discovered yet</div>
            <div className="shelf-wood"></div>
        </div>
    );

    return (
        <div className="bookshelf-perspective">
            {rows.map((row, rowIndex) => (
                <div key={rowIndex} style={{ marginBottom: '1.5rem' }}>
                    <div className="book-container">
                        {row.map((item, index) => (
                            <div className="book-group" key={index}>
                                <BookCard 
                                    item={item} 
                                    isUniversity={isUniversity} 
                                    isExamTrigger={item.isExamTrigger}
                                    onClick={() => handleAction(item)}
                                />
                            </div>
                        ))}
                    </div>
                    <div className="shelf-wood"></div>
                </div>
            ))}
        </div>
    );
};

export default BookShelf;