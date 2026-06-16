import React from 'react';
import { resolveStyles, formatText, renderAIExtension } from '../utils.js';
import './LogicBlocks.css';

const bulletCharMap = { 'arrow': '', 'diamond': '', 'check': '', 'dot': '', 'star': '', 'default': '•' };

export const renderLogicBlock = (block, idx, actions) => {
    const style = resolveStyles(block);

    switch(block.type) {
        case 'logic-header': 
            return <div key={idx} className="logic-header" style={style} />;
        case 'logic-footer': 
            return (
                <div key={idx} className="logic-footer" style={style}>
                    <span>{formatText(block.authors)}</span><span>Page {block.page}</span>
                </div>
            );
        case 'chapter-title': 
            return (
                <div key={idx} style={style}>
                    <span className="logic-chapter-num">CHAPTER {block.number}</span>
                    <span className="logic-chapter-title">{formatText(block.title)}</span>
                </div>
            );
        case 'title-page': 
            return (
                <div key={idx} className="logic-title-container" style={style}>
                    <div className="logic-title-main">{formatText(block.main)}</div>
                    {block.sub && <div className="logic-title-sub">{formatText(block.sub)}</div>}
                    {block.contributors && (
                        <div className="logic-contributors">
                            {formatText(block.contributors)}
                        </div>
                    )}
                </div>
            );
        case 'logic-toc':
            return (
                <div key={idx} className="logic-toc-container" style={style}>
                    {(block.entries || []).map((entry, entryIdx) => (
                        <div key={entryIdx} className={`logic-toc-entry logic-toc-level-${entry.level || 0}`}>
                            <span className="logic-toc-text">{formatText(entry.text)}</span>
                            <span className="logic-toc-dots"></span>
                            <span className="logic-toc-page">{entry.page || ''}</span>
                        </div>
                    ))}
                </div>
            );
        case 'bullet-list': 
            return (
                <div key={idx} className="logic-bullet-list" style={style}>
                    {(block.items || []).map((txt, bIdx) => (
                        <div key={bIdx} className="logic-bullet-item">
                            <div className="logic-bullet-char">{bulletCharMap[block.bullet] || bulletCharMap['default']}</div>
                            <div>{formatText(txt)}</div>
                        </div>
                    ))}
                    {renderAIExtension(block, actions)}
                </div>
            );
        case 'logic-formula':
            return (
                <div key={idx} className="logic-formula-box" style={style}>
                    {formatText(block.body)}
                    {renderAIExtension(block, actions)}
                </div>
            );
        case 'logic-activity': 
            return (
                <div key={idx} className={block.variant === 'nobox' || block.noBox ? 'logic-activity-nobox' : 'logic-activity-box'} style={style}>
                    <span className="logic-activity-label">{formatText(block.label)} </span>
                    <span>{formatText(block.body)}</span>
                    {renderAIExtension(block, actions)}
                </div>
            );
        case 'logic-argument': 
            return (
                <div key={idx} className="logic-argument-block" style={style}>
                    {(block.premises || []).map((p, pIdx) => <div key={pIdx} className="logic-argument-premise">{formatText(p)}</div>)}
                    <div className="logic-argument-line" />
                    <div className="logic-argument-conclusion">{formatText(block.conclusion)}</div>
                    {renderAIExtension(block, actions)}
                </div>
            );
        case 'logic-self-check':
            return (
                <div key={idx} className="logic-self-check" style={style}>
                    <div style={{ marginBottom: '10px' }}>
                        <b>{block.number}.</b> {formatText(block.question)}
                    </div>
                    {[...Array(block.lines || 2)].map((_, lineIdx) => (
                        <div key={lineIdx} className="logic-exercise-line"></div>
                    ))}
                </div>
            );
        case 'logic-quote':
            return (
                <div key={idx} className="logic-quote-block" style={style}>
                    {formatText(block.body)}
                </div>
            );
        case 'logic-note':
            return (
                <div key={idx} className={block.variant === 'nobox' || block.noBox ? 'logic-note-nobox' : 'logic-note-box'} style={style}>
                    <span className="logic-note-label">Note:</span>
                    <div style={{ display: 'inline', fontStyle: 'italic' }}>{formatText(block.body)}</div>
                </div>
            );
        case 'logic-example':
            return (
                <div key={idx} style={style}>
                    <span className="logic-example-label">{formatText(block.label) || 'Example'}:</span> {formatText(block.body) || ''}
                </div>
            );
        default: 
            return <div key={idx} style={{color:'red', fontSize:'10px'}}>Unsupported logic block: {block.type}</div>;
    }
};