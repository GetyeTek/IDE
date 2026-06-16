import React from 'react';
import { resolveStyles, formatText, renderAIExtension } from '../utils.js';
import './CoreBlocks.css';

export const renderCoreBlock = (block, idx, actions) => {
    const style = resolveStyles(block);

    switch(block.type) {
        case 'paragraph': 
            return <p key={idx} className="univ-p-block" style={style}>{formatText(block.body)}{renderAIExtension(block, actions)}</p>;
        case 'header': 
            return <h2 key={idx} className="univ-h-block" style={style}>{formatText(block.body)}{renderAIExtension(block, actions)}</h2>;
        case 'spacer': 
            return <div key={idx} style={{ height: block.height || '20px', flexGrow: block.flex || 0, ...style }} />;
        case 'graphic':
            return (
                <div key={idx} className="univ-graphic-container" style={style}>
                    {block.svgCode ? (
                        <div dangerouslySetInnerHTML={{ __html: block.svgCode }} />
                    ) : (
                        <img src={block.url} alt={block.caption || ""} />
                    )}
                    {block.caption && <div className="univ-graphic-caption">{formatText(block.caption)}</div>}
                    {renderAIExtension(block, actions)}
                </div>
            );
        case 'grid':
            return (
                <div key={idx} className="univ-grid" style={{ gridTemplateColumns: `repeat(${block.columns || 3}, 1fr)`, ...style }}>
                    {(block.items || []).map((val, gridIdx) => (
                        <div key={gridIdx} className="univ-grid-item">{formatText(val)}</div>
                    ))}
                    {renderAIExtension(block, actions)}
                </div>
            );
        case 'table':
            return (
                <table key={idx} className={`univ-table ${block.tableClass || ''}`} style={style}>
                    <tbody>
                        {(block.rows || []).map((row, rowIdx) => (
                            <tr key={rowIdx}>
                                {row.map((cell, cellIdx) => {
                                    const isHeader = (rowIdx === 0 && block.headerStyle);
                                    const CellTag = isHeader ? 'th' : 'td';
                                    const cellContent = typeof cell === 'object' ? cell.text : cell;
                                    const cellStyle = typeof cell === 'object' ? {
                                        backgroundColor: cell.bg || undefined,
                                        textAlign: cell.align || undefined
                                    } : {};
                                    return (
                                        <CellTag key={cellIdx} colSpan={cell.colSpan} rowSpan={cell.rowSpan} style={cellStyle}>
                                            {formatText(cellContent)}
                                        </CellTag>
                                    );
                                })}
                            </tr>
                        ))}
                    </tbody>
                </table>
            );
        case 'footer':
            return <div key={idx} className="univ-footer" style={style}>{formatText(block.val || block.page)}</div>;
        default: 
            return <div key={idx} style={{color:'red', fontSize:'10px'}}>Unsupported core block: {block.type}</div>;
    }
};