import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../config/supabaseClient.js';
import './Notes.css';

const Notes = ({ currentUser, onClose }) => {
    const [conversationId, setConversationId] = useState(null);
    const [messages, setMessages] = useState([]);
    const [input, setInput] = useState('');
    const [isUploading, setIsUploading] = useState(false);
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
            // 1. Upload to Supabase Storage
            const fileExt = file.name.split('.').pop();
            const filePath = `${currentUser.id}/${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;
            
            const { error: uploadError } = await supabase.storage
                .from('user_notes')
                .upload(filePath, file);

            if (uploadError) throw uploadError;

            // 2. Get Public URL
            const { data: { publicUrl } } = supabase.storage
                .from('user_notes')
                .getPublicUrl(filePath);

            // 3. Insert Message with Attachment Metadata
            const attachment = {
                name: file.name,
                url: publicUrl,
                type: file.type,
                size: file.size
            };

            await supabase.from('messages').insert({
                conversation_id: conversationId,
                sender_id: currentUser.id,
                text: '', // Empty text if it's just a file upload
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
        setMessages(prev => prev.filter(m => m.id !== id));
        await supabase.from('messages').delete().eq('id', id);
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

            <main className="notes-flow" ref={flowRef}>
                {messages.length === 0 && !isUploading && (
                    <div style={{textAlign: 'center', color: '#666', marginTop: '2rem'}}>
                        <i className="fas fa-cloud-arrow-up" style={{fontSize: '3rem', marginBottom: '1rem', opacity: 0.5}}></i>
                        <p>Your secure space for links, files, and thoughts.</p>
                    </div>
                )}
                
                {messages.map(m => (
                    <div key={m.id} className="note-card">
                        <button 
                            style={{position: 'absolute', top: '10px', right: '10px', background: 'transparent', border: 'none', color: '#666', cursor: 'pointer'}} 
                            onClick={() => deleteNote(m.id)}
                            title="Delete note"
                        >
                            <i className="fas fa-trash"></i>
                        </button>

                        {m.text && <div className="note-text">{m.text}</div>}
                        
                        {m.attachments?.map((att, i) => (
                            <div key={i} className="note-attachment">
                                {att.type.startsWith('image/') ? (
                                    <img src={att.url} alt="Note Attachment" className="note-image" />
                                ) : (
                                    <a href={att.url} target="_blank" rel="noopener noreferrer" className="note-file-box">
                                        <div className="note-file-icon"><i className="fas fa-file"></i></div>
                                        <div className="note-file-info">
                                            <span className="note-file-name">{att.name}</span>
                                            <span className="note-file-size">{(att.size / 1024 / 1024).toFixed(2)} MB</span>
                                        </div>
                                    </a>
                                )}
                            </div>
                        ))}
                        <span className="note-time">{formatTime(m.created_at)}</span>
                    </div>
                ))}
                
                {isUploading && (
                    <div className="note-card" style={{opacity: 0.7}}>
                        <div className="note-file-box" style={{background: 'transparent', border: 'none'}}>
                            <i className="fas fa-circle-notch fa-spin note-file-icon"></i>
                            <div className="note-file-info"><span className="note-file-name">Uploading file...</span></div>
                        </div>
                    </div>
                )}
            </main>

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