import { renderCoreBlock } from './Core/CoreBlocks.jsx';
import { renderLogicBlock } from './Logic/LogicBlocks.jsx';

export const renderBookBlock = (block, idx, actions) => {
    const logicTypes = [
        'logic-header', 'logic-footer', 'chapter-title', 'title-page', 
        'logic-toc', 'bullet-list', 'logic-formula', 'logic-activity', 
        'logic-argument', 'logic-self-check', 'logic-quote', 'logic-note', 'logic-example'
    ];

    if (logicTypes.includes(block.type) || block.type.startsWith('logic-')) {
        return renderLogicBlock(block, idx, actions);
    }
    
    // Fallback to core renders (Paragraphs, Tables, Headers, Spacers)
    return renderCoreBlock(block, idx, actions);
};