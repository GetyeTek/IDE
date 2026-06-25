import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../config/supabaseClient.js';
import './UserChat.css';

const UserChat = ({ chat, currentUser, isOnline, onClose }) => {
    const [messages, setMessages] = useState([]);
    const [otherReadAt, setOtherReadAt] = useState(null);
    const [isOtherTyping, setIsOtherTyping] = useState(false);
    const [activeMenuId, setActiveMenuId] = useState(null);
    const [editingMessage, setEditingMessage] = useState(null);
    const [replyingTo, setReplyingTo] = useState(null);
    const [input, setInput] = useState('');
    const flowRef = useRef(null);
    const typingTimeoutRef = useRef(null);
    const roomChannelRef = useRef(null);

    const chatTitle = chat.type === 'dm' ? chat.other_user_name : chat.title;
    const chatAvatar = chat.type === 'dm' ? chat.other_user_avatar : chat.avatar_url;

    const formatLastSeen = (dateStr) => {
        if (!dateStr) return 'Offline';
        const date = new Date(dateStr);
        const now = new Date();
        const diffInMs = now - date;
        const diffInMins = Math.floor(diffInMs / 60000);
        const diffInHours = Math.floor(diffInMs / 3600000);

        if (diffInMins < 1) return 'last seen just now';
        if (diffInMins < 60) return `last seen ${diffInMins}m ago`;
        if (diffInHours < 24) return `last seen ${diffInHours}h ago`;
        return `last seen ${date.toLocaleDateString()}`;
    };

    useEffect(() => {
        fetchMessages();
        fetchOtherReadReceipt();
        markAsRead();

        // 1. Unified Room Channel for Messages (CRUD) AND Presence
        const channel = supabase.channel(`room_${chat.conversation_id}`, {
            config: { presence: { key: currentUser.id } }
        });

        roomChannelRef.current = channel;

        channel
            // Listen for ALL message changes (Insert, Update, Delete)
            .on('postgres_changes', { 
                event: '*', schema: 'public', table: 'messages', filter: `conversation_id=eq.${chat.conversation_id}`
            }, (payload) => {
                console.log(`⚡ [Realtime] Received ${payload.eventType} event:`, payload);
                
                if (payload.eventType === 'INSERT') {
                    setMessages(prev => {
                        if (prev.find(m => m.id === payload.new.id)) return prev;
                        return [...prev, { ...payload.new, status: 'sent' }];
                    });
                    if (payload.new.sender_id !== currentUser.id) markAsRead();
                } else if (payload.eventType === 'UPDATE') {
                    setMessages(prev => prev.map(m => m.id === payload.new.id ? { ...payload.new, status: 'sent' } : m));
                } else if (payload.eventType === 'DELETE') {
                    setMessages(prev => prev.filter(m => m.id !== payload.old.id));
                }
            })
            // Presence: Handle "Typing..." and "Online"
            .on('presence', { event: 'sync' }, () => {
                const state = channel.presenceState();
                const otherUserPresence = state[chat.other_user_id];
                setIsOtherTyping(!!(otherUserPresence && otherUserPresence[0]?.isTyping));
            })
            .subscribe(async (status) => {
                if (status === 'SUBSCRIBED') {
                    await channel.track({ isTyping: false });
                }
            });

        // 2. Listen for Read Receipts (Member Table Updates)
        const memberChannel = supabase.channel(`members_${chat.conversation_id}`)
            .on('postgres_changes', { 
                event: 'UPDATE', schema: 'public', table: 'conversation_members', filter: `conversation_id=eq.${chat.conversation_id}`
            }, (payload) => {
                if (payload.new.user_id !== currentUser.id) {
                    setOtherReadAt(payload.new.last_read_at);
                }
            })
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
            supabase.removeChannel(memberChannel);
        };
    }, [chat.conversation_id]);

    useEffect(() => {
        if (flowRef.current) flowRef.current.scrollTop = flowRef.current.scrollHeight;
    }, [messages]);

    const fetchMessages = async () => {
        const { data } = await supabase
            .from('messages')
            .select('*')
            .eq('conversation_id', chat.conversation_id)
            .order('created_at', { ascending: true });
        if (data) setMessages(data.map(m => ({ ...m, status: 'sent' })));
    };

    const fetchOtherReadReceipt = async () => {
        const { data } = await supabase.from('conversation_members')
            .select('last_read_at')
            .eq('conversation_id', chat.conversation_id)
            .neq('user_id', currentUser.id)
            .single();
        if (data) setOtherReadAt(data.last_read_at);
    };

    const markAsRead = async () => {
        await supabase.from('conversation_members')
            .update({ last_read_at: new Date().toISOString() })
            .eq('conversation_id', chat.conversation_id)
            .eq('user_id', currentUser.id);
    };

    const handleInputChange = (val) => {
        setInput(val);
        if (roomChannelRef.current) roomChannelRef.current.track({ isTyping: true });
        if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = setTimeout(() => {
            if (roomChannelRef.current) roomChannelRef.current.track({ isTyping: false });
        }, 2500);
    };

    const handleSend = async () => {
        if (!input.trim()) return;
        if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
        if (roomChannelRef.current) roomChannelRef.current.track({ isTyping: false });

        const msgText = input;
        setInput('');

        if (editingMessage) {
            console.group(`✏️ [UserChat] Editing Message: ${editingMessage.id}`);
            setMessages(prev => prev.map(m => m.id === editingMessage.id ? { ...m, text: msgText, is_edited: true } : m));
            const response = await supabase.from('messages').update({ text: msgText, is_edited: true }).eq('id', editingMessage.id).select();
            console.log("Edit Response:", response);
            console.groupEnd();
            setEditingMessage(null);
            return;
        }
        
        const tempId = `temp-${Date.now()}`;
        const tempMsg = {
            id: tempId, conversation_id: chat.conversation_id,
            sender_id: currentUser.id, text: msgText,
            reply_to_id: replyingTo?.id || null,
            created_at: new Date().toISOString(), status: 'pending'
        };
        
        setMessages(prev => [...prev, tempMsg]);
        const currentReplyId = replyingTo?.id;
        setReplyingTo(null); // Clear reply state immediately for UX

        console.group(`📤 [UserChat] Sending Message`);
        console.log("Text:", msgText);
        console.log("Replying To:", currentReplyId);

        const { data, error } = await supabase.from('messages').insert({
            conversation_id: chat.conversation_id,
            sender_id: currentUser.id,
            text: msgText,
            reply_to_id: currentReplyId
        }).select().single();
        
        if (!error && data) {
            setMessages(prev => prev.map(m => m.id === tempId ? { ...data, status: 'sent' } : m));
        }
    };

    const deleteMessage = async (msgId) => {
        if (!window.confirm("Delete this message for everyone?")) return;
        console.group(`🗑️ [UserChat] Deleting Message: ${msgId}`);
        setMessages(prev => prev.filter(m => m.id !== msgId));
        setActiveMenuId(null);
        const response = await supabase.from('messages').delete().eq('id', msgId).select();
        console.log("Delete Response:", response);
        console.groupEnd();
    };

    const handleCopy = (text) => {
        navigator.clipboard.writeText(text);
        setActiveMenuId(null);
    };

    const startEditing = (msg) => {
        setEditingMessage(msg);
        setInput(msg.text);
        setActiveMenuId(null);
    };

    const startReply = (msg) => {
        setReplyingTo(msg);
        setActiveMenuId(null);
    };

    const getMessageStatusIcon = (m) => {
        if (m.sender_id !== currentUser.id) return null;
        if (m.status === 'pending') return <i className="fa-solid fa-clock" style={{color: '#888'}}></i>;
        const isRead = otherReadAt && new Date(m.created_at) <= new Date(otherReadAt);
        return isRead ? 
            <i className="fa-solid fa-check-double" style={{color: '#42d7b8'}}></i> : 
            <i className="fa-solid fa-check" style={{color: '#a0a0a0'}}></i>;
    };

    const formatTime = (isoString) => {
        if (!isoString) return '';
        return new Date(isoString).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    };

    return (
        <div className="user-chat-overlay">
            <div className="ambient-prism-light"></div>

            <header className="prism-header">
                <div className="contact-profile">
                    <div className="avatar-ring">
                        <img src={chatAvatar || 'https://via.placeholder.com/150'} alt="Avatar" />
                        {isOnline && <div className="online-dot"></div>}
                    </div>
                    <div className="contact-details">
                        <h2>{chatTitle}</h2>
                        <p style={{ color: (isOnline || isOtherTyping) ? '#42d7b8' : '#888' }}>
                            {isOtherTyping ? (
                                <span>typing<span className="blink-cursor">...</span></span>
                            ) : (
                                isOnline ? 'Online' : formatLastSeen(chat.other_user_last_seen)
                            )}
                        </p>
                    </div>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button className="icon-button" style={{ color: 'white', opacity: 0.6 }} onClick={onClose}>
                        <i className="fas fa-times"></i>
                    </button>
                </div>
            </header>

            <main className="prism-flow" ref={flowRef} onClick={() => setActiveMenuId(null)}>
                {messages.map(m => {
                    const isMine = m.sender_id === currentUser.id;
                    const isMenuOpen = activeMenuId === m.id;
                    const repliedMsg = m.reply_to_id ? messages.find(msg => msg.id === m.reply_to_id) : null;

                    return (
                        <div key={m.id} className={`msg-prism-group ${isMine ? 'sent' : 'received'}`} onClick={(e) => { e.stopPropagation(); setActiveMenuId(isMenuOpen ? null : m.id); }}>
                            <div className="prism-bubble">
                                {repliedMsg && (
                                    <div className="reply-quote" onClick={(e) => { e.stopPropagation(); scrollToQuestion(m.reply_to_id); }}>
                                        <div className="reply-quote-bar"></div>
                                        <div className="reply-quote-content">
                                            <div className="reply-quote-user">{repliedMsg.sender_id === currentUser.id ? 'You' : chatTitle}</div>
                                            <div className="reply-quote-text">{repliedMsg.text}</div>
                                        </div>
                                    </div>
                                )}
                                {m.text}
                            </div>
                            <div className="prism-time">
                                {m.is_edited && <span className="edited-label">edited</span>}
                                {formatTime(m.created_at)}
                                {isMine && <span style={{ marginLeft: '6px' }}>{getMessageStatusIcon(m)}</span>}
                            </div>
                            
                            {isMenuOpen && (
                                <div className="msg-actions-menu">
                                    <button className="msg-action-btn" onClick={() => startReply(m)}>
                                        <i className="fa-solid fa-reply"></i> Reply
                                    </button>
                                    <button className="msg-action-btn" onClick={() => handleCopy(m.text)}>
                                        <i className="fa-solid fa-copy"></i> Copy
                                    </button>
                                    {isMine && (
                                        <button className="msg-action-btn" onClick={() => startEditing(m)}>
                                            <i className="fa-solid fa-pen"></i> Edit
                                        </button>
                                    )}
                                    {isMine && (
                                        <button className="msg-action-btn delete" onClick={() => deleteMessage(m.id)}>
                                            <i className="fa-solid fa-trash"></i> Delete
                                        </button>
                                    )}
                                </div>
                            )}
                        </div>
                    );
                })}
            </main>

            <footer className="prism-input-wrapper">
                {editingMessage && (
                    <div className="input-mode-header">
                        <span><i className="fa-solid fa-pen"></i> Editing message</span>
                        <button className="icon-button" onClick={() => { setEditingMessage(null); setInput(''); }}>
                            <i className="fa-solid fa-times"></i>
                        </button>
                    </div>
                )}
                {replyingTo && (
                    <div className="input-mode-header">
                        <div className="reply-preview-border"></div>
                        <div className="reply-preview-info">
                            <span className="reply-user">Replying to {replyingTo.sender_id === currentUser.id ? 'yourself' : chatTitle}</span>
                            <span className="reply-text">{replyingTo.text}</span>
                        </div>
                        <button className="icon-button" onClick={() => setReplyingTo(null)}>
                            <i className="fa-solid fa-times"></i>
                        </button>
                    </div>
                )}
                <div className="prism-dock">
                    <button className="add-btn"><i className="fa-solid fa-plus"></i></button>
                    <input 
                        type="text" 
                        placeholder="Message..." 
                        value={input}
                        onChange={(e) => handleInputChange(e.target.value)}
                        onKeyPress={(e) => e.key === 'Enter' && handleSend()}
                    />
                    <button className="prism-send-btn" onClick={handleSend}>
                        <i className={`fa-solid ${editingMessage ? 'fa-check' : 'fa-arrow-up'}`}></i>
                    </button>
                </div>
            </footer>
        </div>
    );
};

export default UserChat;