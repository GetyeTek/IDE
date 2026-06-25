import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../config/supabaseClient.js';
import './Notes.css';

const Notes = ({ currentUser, onClose }) => {
    const [conversationId, setConversationId] = useState(null);
    const [messages, setMessages] = useState([]);
    const [input, setInput] = useState('');
    const [isUploading, setIsUploading] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [activeMenu, setActiveMenu] = useState(null);
    
    const fileInputRef = useRef(null);
    const flowRef = useRef(null);

    useEffect(() => {
        const initNotes = async () => {
            // 1. Call RPC to get or create the Notes conversation
            const { data, error } = await supabase.rpc('get_or_create_notes', { req_user_id: currentUser.id });
            if (error) {
                console.error("Failed to init Notes:", error);
                return;
            }
            setConversationId(data);

            // 2. Fetch existing notes
            const { data: msgs } = await supabase
                .from('messages')
                .select('*')
                .eq('conversation_id', data)
                .order('created_at', { ascending: true });
            
            if (msgs) setMessages(msgs);
            setIsLoading(false);

            // 3. Realtime Subscription
            const channel = supabase.channel(`room_${data}`)
                .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${data}` }, (payload) => {
                    setMessages(prev => {
                        if (prev.find(m => m.id === payload.new.id)) return prev;
                        return [...prev, payload.new];
                    });
                })
                .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'messages', filter: `conversation_id=eq.${data}` }, (payload) => {
                    setMessages(prev => prev.filter(m => m.id !== payload.old.id));
                })
                .subscribe();

            return () => supabase.removeChannel(channel);
        };

        initNotes();
    }, [currentUser.id]);

    useEffect(() => {
        if (flowRef.current) flowRef.current.scrollTop = flowRef.current.scrollHeight;
    }, [messages, isUploading]);

    const handleSend = async () => {
        if (!input.trim() || !conversationId) return;

        const msgText = input;
        setInput('');

        // Optimistic UI
        const tempId = `temp-${Date.now()}`;
        setMessages(prev => [...prev, {
            id: tempId, conversation_id: conversationId,
            sender_id: currentUser.id, text: msgText,
            attachments: [], created_at: new Date().toISOString()
        }]);

        const { data, error } = await supabase.from('messages').insert({
            conversation_id: conversationId,
            sender_id: currentUser.id,
            text: msgText
        }).select().single();

        if (data) {
            setMessages(prev => prev.map(m => m.id === tempId ? data : m));
        }
    };

    const handleFileUpload = async (e) => {
        const file = e.target.files[0];
        if (!file || !conversationId) return;

        setIsUploading(true);
        try {
            // 1. Convert File to ArrayBuffer to prevent 'postMessage' cloning errors
            const arrayBuffer = await file.arrayBuffer();

            // 2. Upload to Supabase Storage
            const safeName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
            const filePath = `${currentUser.id}/${Date.now()}_${safeName}`;
            
            const { error: uploadError } = await supabase.storage
                .from('user_notes')
                .upload(filePath, arrayBuffer, {
                    contentType: file.type,
                    upsert: true
                });

            if (uploadError) throw uploadError;

            // 2. Get Public URL
            const { data: { publicUrl } } = supabase.storage
                .from('user_notes')
                .getPublicUrl(filePath);

            // 3. Insert Message with Attachment Metadata
            const attachment = {
                name: file.name,
                url: publicUrl,
                path: filePath, // Store the path so we can delete it later
                type: file.type,
                size: file.size
            };

            await supabase.from('messages').insert({
                conversation_id: conversationId,
                sender_id: currentUser.id,
                text: '', // No text needed in the bubble
                attachments: [attachment]
            });

        } catch (err) {
            console.error("Upload failed:", err);
            alert("Failed to upload file. Check console.");
        } finally {
            setIsUploading(false);
            e.target.value = null; // reset input
        }
    };

    const formatTime = (isoString) => {
        if (!isoString) return '';
        return new Date(isoString).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    };

    const deleteNote = async (id) => {
        if(!window.confirm("Delete this note?")) return;

        // 1. Find the message locally to check for attachments
        const noteToDelete = messages.find(m => m.id === id);
        
        // 2. Optimistic UI update
        setMessages(prev => prev.filter(m => m.id !== id));
        setActiveMenu(null);

        try {
            // 3. Cleanup Storage if files exist
            if (noteToDelete?.attachments && noteToDelete.attachments.length > 0) {
                const paths = noteToDelete.attachments
                    .map(att => att.path)
                    .filter(Boolean); // Only get valid paths

                if (paths.length > 0) {
                    console.log("🧹 [Notes] Cleaning up storage files:", paths);
                    await supabase.storage.from('user_notes').remove(paths);
                }
            }

            // 4. Delete the database record
            await supabase.from('messages').delete().eq('id', id);
            console.log("✅ [Notes] Message and associated files deleted.");
        } catch (err) {
            console.error("❌ [Notes] Deletion cleanup failed:", err);
        }
    };

    const handleCopy = (text) => {
        navigator.clipboard.writeText(text);
        setActiveMenu(null);
    };

    const handleDownload = (url, filename) => {
        setActiveMenu(null);
        const downloadUrl = `${url}${url.includes('?') ? '&' : '?'}download=${encodeURIComponent(filename)}`;
        
        const link = document.createElement('a');
        link.href = downloadUrl;
        link.setAttribute('download', filename);
        link.target = '_blank'; 
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    return (
        <div className="notes-overlay">
            <header className="notes-header">
                <div className="notes-title-box">
                    <div className="notes-icon"><i className="fas fa-bookmark"></i></div>
                    <div>
                        <h2>My Notes</h2>
                        <p>Personal cloud & quick clips</p>
                    </div>
                </div>
                <button className="icon-button" style={{color: 'white'}} onClick={onClose}>
                    <i className="fas fa-times"></i>
                </button>
            </header>

            <main className="notes-flow" ref={flowRef} onClick={() => setActiveMenu(null)} onScroll={() => setActiveMenu(null)}>
                {isLoading ? (
                    <div className="notes-loader-container">
                        <i className="fas fa-circle-notch fa-spin"></i>
                        <p>Opening your notes...</p>
                    </div>
                ) : messages.length === 0 && !isUploading ? (
                    <div className="notes-empty-state">
                        <i className="fas fa-cloud-arrow-up"></i>
                        <p>Your secure space for links, files, and thoughts.</p>
                    </div>
                ) : (
                    messages.map(m => {
                        const isMenuOpen = activeMenu?.msg?.id === m.id;
                        return (
                            <div 
                                key={m.id} 
                                className="note-card"
                                style={{ zIndex: isMenuOpen ? 100 : 1 }}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    if (isMenuOpen) {
                                        setActiveMenu(null);
                                        return;
                                    }
                                    
                                    let x = e.clientX || (e.touches && e.touches[0].clientX);
                                    let y = e.clientY || (e.touches && e.touches[0].clientY);
                                    
                                    if (!x || !y) {
                                        const rect = e.currentTarget.getBoundingClientRect();
                                        x = rect.left + rect.width / 2;
                                        y = rect.top + rect.height / 2;
                                    }
                                    
                                    const menuW = 140;
                                    const menuH = 100;
                                    
                                    if (x + menuW > window.innerWidth - 20) x = window.innerWidth - menuW - 20;
                                    if (y + menuH > window.innerHeight - 80) y = window.innerHeight - menuH - 80;
                                    if (y < 80) y = 80;
                                    
                                    setActiveMenu({ msg: m, x, y });
                                }}
                            >
                                {m.text && <div className="note-text">{m.text}</div>}
                        
                        {m.attachments?.map((att, i) => (
                            <div key={i} className="note-attachment">
                                {att.type.startsWith('image/') ? (
                                    <img src={att.url} alt="Note Attachment" className="note-image" />
                                ) : (
                                    <div className="note-file-box" onClick={(e) => { e.stopPropagation(); handleDownload(att.url, att.name); }}>
                                        <div className="note-file-icon"><i className="fas fa-file"></i></div>
                                        <div className="note-file-info">
                                            <span className="note-file-name">{att.name}</span>
                                            <span className="note-file-size">{(att.size / 1024 / 1024).toFixed(2)} MB</span>
                                        </div>
                                    </div>
                                )}
                            </div>
                        ))}
                            <span className="note-time">{formatTime(m.created_at)}</span>
                        </div>
                        );
                    })
                )}
                
                {isUploading && (
                    <div className="note-card" style={{opacity: 0.7}}>
                        <div className="note-file-box" style={{background: 'transparent', border: 'none'}}>
                            <i className="fas fa-circle-notch fa-spin note-file-icon"></i>
                            <div className="note-file-info"><span className="note-file-name">Uploading file...</span></div>
                        </div>
                    </div>
                )}
            </main>

            {activeMenu && (
                <div className="notes-ctx-menu" style={{ left: activeMenu.x, top: activeMenu.y }}>
                    {activeMenu.msg.text && (
                        <button className="notes-ctx-btn" onClick={() => handleCopy(activeMenu.msg.text)}>
                            <i className="fa-solid fa-copy"></i> Copy Text
                        </button>
                    )}
                    {activeMenu.msg.attachments?.[0] && (
                        <button className="notes-ctx-btn" onClick={() => handleDownload(activeMenu.msg.attachments[0].url, activeMenu.msg.attachments[0].name)}>
                            <i className="fa-solid fa-download"></i> Download File
                        </button>
                    )}
                    <button className="notes-ctx-btn delete" onClick={() => deleteNote(activeMenu.msg.id)}>
                        <i className="fa-solid fa-trash"></i> Delete Note
                    </button>
                </div>
            )}

            <footer className="notes-dock-wrap">
                <div className="notes-dock">
                    <input 
                        type="file" 
                        ref={fileInputRef} 
                        style={{display: 'none'}} 
                        onChange={handleFileUpload} 
                    />
                    <button className="dock-btn attach" onClick={() => fileInputRef.current.click()} disabled={isUploading}>
                        <i className="fas fa-paperclip"></i>
                    </button>
                    <textarea 
                        className="notes-input" 
                        placeholder="Save a note or link..." 
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                handleSend();
                            }
                        }}
                        rows="1"
                    />
                    <button className="dock-btn send" onClick={handleSend} disabled={!input.trim() && !isUploading}>
                        <i className="fas fa-arrow-up"></i>
                    </button>
                </div>
            </footer>
        </div>
    );
};

export default Notes;