import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../config/supabaseClient.js';
import './UserChat.css';

const UserChat = ({ chat, currentUser, isOnline, onClose }) => {
    const [messages, setMessages] = useState([]);
    
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
    const [otherReadAt, setOtherReadAt] = useState(null);
    const [input, setInput] = useState('');
    const flowRef = useRef(null);

    const chatTitle = chat.type === 'dm' ? chat.other_user_name : chat.title;
    const chatAvatar = chat.type === 'dm' ? chat.other_user_avatar : chat.avatar_url;

    useEffect(() => {
        fetchMessages();
        fetchOtherReadReceipt();
        markAsRead();

        // 1. Listen for new messages
        const msgChannel = supabase.channel(`room_${chat.conversation_id}`)
            .on('postgres_changes', { 
                event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${chat.conversation_id}`
            }, (payload) => {
                setMessages(prev => {
                    // Ignore if optimistic UI already added it
                    if (prev.find(m => m.id === payload.new.id)) return prev;
                    return [...prev, { ...payload.new, status: 'sent' }];
                });
                if (payload.new.sender_id !== currentUser.id) markAsRead();
            })
            .subscribe();

        // 2. Listen for the other user opening the chat (Read Receipts)
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
            supabase.removeChannel(msgChannel);
            supabase.removeChannel(memberChannel);
        };
    }, [chat.conversation_id]);

    useEffect(() => {
        if (flowRef.current) flowRef.current.scrollTop = flowRef.current.scrollHeight;
    }, [messages]);

    const fetchMessages = async () => {
        const { data, error } = await supabase
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

    const handleSend = async () => {
        if (!input.trim()) return;
        const msgText = input;
        setInput('');
        
        // 1. Optimistic UI insert (instant clock state)
        const tempId = `temp-${Date.now()}`;
        const tempMsg = {
            id: tempId,
            conversation_id: chat.conversation_id,
            sender_id: currentUser.id,
            text: msgText,
            created_at: new Date().toISOString(),
            status: 'pending' // Shows clock
        };
        setMessages(prev => [...prev, tempMsg]);

        // 2. Real Database insert
        const { data, error } = await supabase.from('messages').insert({
            conversation_id: chat.conversation_id,
            sender_id: currentUser.id,
            text: msgText
        }).select().single();
        
        if (!error && data) {
            // 3. Update the temporary message with the real DB record (single tick)
            setMessages(prev => prev.map(m => m.id === tempId ? { ...data, status: 'sent' } : m));
        }
    };

    const getMessageStatusIcon = (m) => {
        if (m.sender_id !== currentUser.id) return null;
        if (m.status === 'pending') return <i className="fa-solid fa-clock" style={{color: '#888'}}></i>;
        
        // Check if receiver's read timestamp is newer than this message
        const isRead = otherReadAt && new Date(m.created_at) <= new Date(otherReadAt);
        if (isRead) {
            return <i className="fa-solid fa-check-double" style={{color: '#42d7b8'}}></i>;
        } else {
            return <i className="fa-solid fa-check" style={{color: '#a0a0a0'}}></i>;
        }
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
                        <p style={{ color: isOnline ? '#42d7b8' : '#888' }}>
                            {isOnline ? 'Online' : formatLastSeen(chat.other_user_last_seen)}
                        </p>
                    </div>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button className="icon-button" style={{ color: 'white', opacity: 0.6 }} onClick={onClose}>
                        <i className="fas fa-times"></i>
                    </button>
                </div>
            </header>

            <main className="prism-flow" ref={flowRef}>
                {messages.map(m => {
                    const isMine = m.sender_id === currentUser.id;
                    return (
                        <div key={m.id} className={`msg-prism-group ${isMine ? 'sent' : 'received'}`}>
                            <div className="prism-bubble">{m.text}</div>
                            <div className="prism-time">
                                {formatTime(m.created_at)}
                                {isMine && (
                                    <span style={{ marginLeft: '6px' }}>{getMessageStatusIcon(m)}</span>
                                )}
                            </div>
                        </div>
                    );
                })}
            </main>

            <footer className="prism-input-wrapper">
                <div className="prism-dock">
                    <button className="add-btn"><i className="fa-solid fa-plus"></i></button>
                    <input 
                        type="text" 
                        placeholder="Message..." 
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyPress={(e) => e.key === 'Enter' && handleSend()}
                    />
                    <button className="prism-send-btn" onClick={handleSend}>
                        <i className="fa-solid fa-arrow-up"></i>
                    </button>
                </div>
            </footer>
        </div>
    );
};

export default UserChat;