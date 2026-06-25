import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../config/supabaseClient.js';
import './UserChat.css';

const UserChat = ({ chat, currentUser, onClose }) => {
    const [messages, setMessages] = useState([]);
    const [input, setInput] = useState('');
    const flowRef = useRef(null);

    const chatTitle = chat.type === 'dm' ? chat.other_user_name : chat.title;
    const chatAvatar = chat.type === 'dm' ? chat.other_user_avatar : chat.avatar_url;

    useEffect(() => {
        fetchMessages();
        markAsRead();

        // High-Performance Realtime Subscription
        const channel = supabase.channel(`room_${chat.conversation_id}`)
            .on('postgres_changes', { 
                event: 'INSERT', 
                schema: 'public', 
                table: 'messages',
                filter: `conversation_id=eq.${chat.conversation_id}`
            }, (payload) => {
                setMessages(prev => [...prev, payload.new]);
                markAsRead();
            })
            .subscribe();

        return () => supabase.removeChannel(channel);
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
        
        if (data) setMessages(data);
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
        setInput(''); // Optimistic UI clear
        
        // Optimistic UI insert (instant feel)
        const tempMsg = {
            id: Date.now().toString(),
            conversation_id: chat.conversation_id,
            sender_id: currentUser.id,
            text: msgText,
            created_at: new Date().toISOString(),
            isTemp: true
        };
        setMessages(prev => [...prev, tempMsg]);

        // Real Database insert
        const { error } = await supabase.from('messages').insert({
            conversation_id: chat.conversation_id,
            sender_id: currentUser.id,
            text: msgText
        });
        
        if (error) console.error("Send failed:", error);
        // We do not need to push the successful message to state manually, 
        // the Realtime socket listener will catch the INSERT and update it.
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
                        <div className="online-dot"></div>
                    </div>
                    <div className="contact-details">
                        <h2>{chatTitle}</h2>
                        <p>Active</p>
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
                        <div key={m.id} className={`msg-prism-group ${isMine ? 'sent' : 'received'}`} style={{ opacity: m.isTemp ? 0.7 : 1 }}>
                            <div className="prism-bubble">{m.text}</div>
                            <div className="prism-time">
                                {formatTime(m.created_at)}
                                {isMine && (
                                    <i className={`fa-solid ${m.isTemp ? 'fa-clock' : 'fa-check-double'}`} 
                                       style={{ marginLeft: '4px', color: m.isTemp ? '#888' : '#42d7b8' }}></i>
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