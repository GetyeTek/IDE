import React, { useState, useEffect } from 'react';
import { supabase } from '../config/supabaseClient.js';
import UserChat from './UserChat.jsx';

const Connect = ({ onOpenActivity, userProfile, currentUser }) => {
    const [activeView, setActiveView] = useState('messages');
    const [activeChat, setActiveChat] = useState(null);
    const [conversations, setConversations] = useState([]);
    const [isHeaderCollapsed, setIsHeaderCollapsed] = useState(false);
    const [showDirectory, setShowDirectory] = useState(false);
    const [allUsers, setAllUsers] = useState([]);

    useEffect(() => {
        if (!currentUser) return;
        
        fetchConversations();
        
        // Subscribe to real-time message inserts to update the chat list dynamically
        const channel = supabase.channel('chat_list_updates')
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, () => {
                fetchConversations();
            })
            .subscribe();

        return () => supabase.removeChannel(channel);
    }, [currentUser]);

    const fetchConversations = async () => {
        const { data, error } = await supabase.rpc('get_user_conversations', { req_user_id: currentUser.id });
        if (data) setConversations(data);
        if (error) console.error("Error fetching chats:", error);
    };

    const fetchAllUsers = async () => {
        setShowDirectory(true);
        const { data } = await supabase.from('profiles').select('*').neq('id', currentUser.id).limit(20);
        if (data) setAllUsers(data);
    };

    const startDirectMessage = async (targetUser) => {
        // 1. Check if DM already exists
        const existing = conversations.find(c => c.type === 'dm' && c.other_user_name === targetUser.full_name);
        if (existing) {
            setShowDirectory(false);
            setActiveChat(existing);
            return;
        }

        // 2. Create new conversation
        const { data: conv, error: convErr } = await supabase.from('conversations').insert({ type: 'dm' }).select().single();
        if (convErr) return console.error(convErr);

        // 3. Add both members
        await supabase.from('conversation_members').insert([
            { conversation_id: conv.id, user_id: currentUser.id },
            { conversation_id: conv.id, user_id: targetUser.id }
        ]);

        setShowDirectory(false);
        fetchConversations();
        // Construct temporary object to open chat immediately
        setActiveChat({
            conversation_id: conv.id,
            type: 'dm',
            other_user_name: targetUser.full_name,
            other_user_avatar: targetUser.avatar_url
        });
    };

    const handleScroll = (e) => {
        setIsHeaderCollapsed(e.currentTarget.scrollTop > 30);
    };

    const formatTime = (isoString) => {
        if (!isoString) return '';
        const date = new Date(isoString);
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    };

    return (
        <div className={`tab-content active ${isHeaderCollapsed ? 'header-collapsed' : ''}`} id="connect-content">
            <header className="interactive-header">
                <div className="large-title-row">
                    <h2 className="large-title">Social Hub</h2>
                    <div className="header-actions">
                        <button className="icon-button notification-btn" onClick={onOpenActivity}>
                            <i className="fas fa-bell"></i>
                            <span className="notification-badge">3</span>
                        </button>
                        <img src={userProfile?.avatar_url || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=80'} alt="Profile" className="profile-avatar" />
                    </div>
                </div>
                <div className="main-nav-row">
                    <div className="orbiter-container">
                        <div className="icon-orbiter">
                            <div className={`option ${activeView === 'for-you' ? 'active' : ''}`} onClick={() => setActiveView('for-you')}>
                                <div className="icon-wrapper"><div className="orbiter-indicator"></div><i className="fa-solid fa-star"></i></div>
                                <span className="text-label">For You</span>
                            </div>
                            <div className={`option ${activeView === 'messages' ? 'active' : ''}`} onClick={() => setActiveView('messages')}>
                                <div className="icon-wrapper"><div className="orbiter-indicator"></div><i className="fa-solid fa-paper-plane"></i></div>
                                <span className="text-label">Messages</span>
                            </div>
                        </div>
                    </div>
                    {activeView === 'messages' && (
                        <button className="icon-button" style={{color: 'var(--accent-teal)'}} onClick={fetchAllUsers}>
                            <i className="fas fa-plus"></i>
                        </button>
                    )}
                </div>
            </header>

            <div className="content-panel">
                <div id="messages-view" className={`hub-view ${activeView === 'messages' ? 'active' : ''}`} onScroll={handleScroll} style={{ overflowY: 'auto', height: '100%' }}>
                    <div className="messages-list">
                        
                        {/* Static Miron Entry (Bot) */}
                        <div className="messages-list-item miron-chat-card" onClick={() => window.dispatchEvent(new CustomEvent('open-full-miron-chat'))}>
                            <div className="miron-avatar-orb">
                                <span className="material-symbols-outlined">auto_awesome</span>
                            </div>
                            <div className="message-info">
                                <div className="name">Miron</div>
                                <div className="typewriter-wrapper">
                                    <span className="typewriter-text">Ask me anything about your courses...</span>
                                    <span className="blinking-cursor"></span>
                                </div>
                            </div>
                        </div>

                        {showDirectory ? (
                            <div style={{ padding: '1rem', background: 'rgba(255,255,255,0.05)', borderRadius: '12px' }}>
                                <h3 style={{ fontSize: '0.8rem', color: '#888', marginBottom: '10px', textTransform: 'uppercase' }}>Network Directory</h3>
                                {allUsers.map(u => (
                                    <div key={u.id} className="messages-list-item" onClick={() => startDirectMessage(u)}>
                                        <img src={u.avatar_url} alt="Avatar" />
                                        <div className="message-info">
                                            <div className="name">{u.full_name}</div>
                                            <div className="last-message" style={{color: 'var(--accent-teal)'}}>Tap to start chatting</div>
                                        </div>
                                    </div>
                                ))}
                                <button style={{ width: '100%', padding: '10px', marginTop: '10px', background: 'transparent', border: '1px solid #444', color: '#fff', borderRadius: '8px' }} onClick={() => setShowDirectory(false)}>Cancel</button>
                            </div>
                        ) : (
                            conversations.map(chat => {
                                const title = chat.type === 'dm' ? chat.other_user_name : chat.title;
                                const avatar = chat.type === 'dm' ? chat.other_user_avatar : chat.avatar_url;
                                return (
                                    <div className="messages-list-item" key={chat.conversation_id} onClick={() => setActiveChat(chat)}>
                                        <img src={avatar || 'https://via.placeholder.com/150'} alt="Avatar" />
                                        <div className="message-info">
                                            <div className="name">{title}</div>
                                            <div className="last-message">{chat.last_message_text || 'No messages yet'}</div>
                                        </div>
                                        <div className="message-meta">
                                            <span>{formatTime(chat.last_message_at)}</span>
                                            {chat.unread_count > 0 && <div className="unread-dot"></div>}
                                        </div>
                                    </div>
                                )
                            })
                        )}
                    </div>
                </div>
            </div>
            
            {activeChat && <UserChat chat={activeChat} currentUser={currentUser} onClose={() => { setActiveChat(null); fetchConversations(); }} />}
        </div>
    );
};

export default Connect;