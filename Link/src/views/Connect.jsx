import React, { useState, useEffect } from 'react';
import { supabase } from '../config/supabaseClient.js';
import UserChat from './UserChat.jsx';
import Notes from './Notes.jsx';

const Connect = ({ onOpenActivity, userProfile, currentUser }) => {
    const [activeView, setActiveView] = useState('messages');
    const [activeChat, setActiveChat] = useState(null);
    const [isNotesOpen, setIsNotesOpen] = useState(false);
    const [conversations, setConversations] = useState([]);
    const [isHeaderCollapsed, setIsHeaderCollapsed] = useState(false);
    const [showDirectory, setShowDirectory] = useState(false);
    const [allUsers, setAllUsers] = useState([]);
    const [onlineUsers, setOnlineUsers] = useState(new Set());

    useEffect(() => {
        if (!currentUser) return;
        
        fetchConversations();
        
        // 1. Subscribe to Realtime Messages and Read Receipt updates
        const msgChannel = supabase.channel('chat_list_updates')
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, () => {
                fetchConversations();
            })
            .on('postgres_changes', { 
                event: 'UPDATE', 
                schema: 'public', 
                table: 'conversation_members',
                filter: `user_id=eq.${currentUser.id}` 
            }, () => {
                // Refresh list when I mark a chat as read to clear badges instantly
                fetchConversations();
            })
            .subscribe();

        // 2. Global Presence (Who is Online?)
        const presenceChannel = supabase.channel('global_presence', {
            config: { presence: { key: currentUser.id } }
        });
        
        presenceChannel.on('presence', { event: 'sync' }, () => {
            const state = presenceChannel.presenceState();
            setOnlineUsers(new Set(Object.keys(state)));
        }).subscribe(async (status) => {
            if (status === 'SUBSCRIBED') {
                await presenceChannel.track({ online_at: new Date().toISOString() });
            }
        });

        return () => {
            supabase.removeChannel(msgChannel);
            supabase.removeChannel(presenceChannel);
        };
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
        // 1. Check if DM already exists locally
        const existing = conversations.find(c => c.type === 'dm' && c.other_user_name === targetUser.full_name);
        if (existing) {
            setShowDirectory(false);
            setActiveChat(existing);
            return;
        }

        // 2. Call the secure RPC to create the DM atomically
        const { data: newConvId, error } = await supabase.rpc('create_direct_message', { 
            target_user_id: targetUser.id 
        });

        if (error) {
            console.error("Failed to create DM:", error);
            return;
        }

        setShowDirectory(false);
        fetchConversations();
        
        // Construct temporary object to open chat immediately
        setActiveChat({
            conversation_id: newConvId,
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

                        {/* My Notes Entry */}
                        <div className="messages-list-item" style={{ background: 'rgba(66, 215, 184, 0.05)', border: '1px solid rgba(66, 215, 184, 0.2)' }} onClick={() => setIsNotesOpen(true)}>
                            <div style={{ width: '50px', height: '50px', borderRadius: '50%', background: '#42d7b8', color: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.2rem', flexShrink: 0 }}>
                                <i className="fas fa-bookmark"></i>
                            </div>
                            <div className="message-info">
                                <div className="name" style={{ color: '#42d7b8' }}>My Notes</div>
                                <div className="last-message">
                                    {conversations.find(c => c.type === 'notes')?.last_message_text || 'Personal cloud & quick clips'}
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
                            conversations.filter(c => c.type !== 'notes').map(chat => {
                                const title = chat.type === 'dm' ? chat.other_user_name : chat.title;
                                const avatar = chat.type === 'dm' ? chat.other_user_avatar : chat.avatar_url;
                                return (
                                    <div className="messages-list-item" key={chat.conversation_id} onClick={() => setActiveChat(chat)}>
                                        <div style={{ position: 'relative' }}>
                                            <img src={avatar || 'https://via.placeholder.com/150'} alt="Avatar" />
                                            {onlineUsers.has(chat.other_user_id) && (
                                                <div style={{ position: 'absolute', bottom: '0', right: '0', width: '12px', height: '12px', background: '#42d7b8', borderRadius: '50%', border: '2px solid #1e1e1e' }}></div>
                                            )}
                                        </div>
                                        <div className="message-info">
                                            <div className="name">{title}</div>
                                            <div className="last-message">{chat.last_message_text || 'No messages yet'}</div>
                                        </div>
                                        <div className="message-meta">
                                            <span>{formatTime(chat.last_message_at)}</span>
                                            {chat.unread_count > 0 && <div className="unread-badge">{chat.unread_count}</div>}
                                        </div>
                                    </div>
                                )
                            })
                        )}
                    </div>
                </div>
            </div>
            
            {activeChat && <UserChat chat={activeChat} currentUser={currentUser} isOnline={onlineUsers.has(activeChat.other_user_id)} onClose={() => { setActiveChat(null); fetchConversations(); }} />}
            {isNotesOpen && <Notes currentUser={currentUser} onClose={() => setIsNotesOpen(false)} />}
        </div>
    );
};

export default Connect;