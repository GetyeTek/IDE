import React from 'react';

export const resolveStyles = (item) => {
    const rawStyle = item.style || {};
    const resolved = { ...rawStyle };

    if (rawStyle.align) {
        resolved.textAlign = rawStyle.align;
        if (rawStyle.align === 'center') {
            resolved.marginLeft = 'auto';
            resolved.marginRight = 'auto';
        } else if (rawStyle.align === 'right') {
            resolved.marginLeft = 'auto';
            resolved.marginRight = '0';
        }
    }

    if (rawStyle.bold) resolved.fontWeight = 'bold';
    if (rawStyle.italic) resolved.fontStyle = 'italic';
    if (rawStyle.underline) resolved.textDecoration = 'underline';
    if (rawStyle.transform) resolved.textTransform = rawStyle.transform;
    if (rawStyle.size) resolved.fontSize = rawStyle.size;

    return resolved;
};

export const formatText = (text) => {
    if (!text) return null;
    return <span dangerouslySetInnerHTML={{__html: text.replace(/\^\{(.*?)\}/g, '<sup>$1</sup>').replace(/_\{(.*?)\}/g, '<sub>$1</sub>')}} />;
};

export const renderAIExtension = (b, actions) => {
    if (b.ai_ready) {
        return <button className="ai-btn-inline" onClick={actions?.onAIExplore}>✨ AI Explore</button>;
    }
    return null;
};