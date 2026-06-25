import React, { useState, useEffect } from 'react';
import { supabase } from './config/supabaseClient.js';
import Auth from './views/Auth.jsx';

// Placeholder imports for views we will create in the next session
import Home from './views/Home.jsx';
import Discover from './views/Discover.jsx';
import Study from './views/Study.jsx';
import Connect from './views/Connect.jsx';
import Profile from './views/Profile.jsx';

import ActivityHub from './views/ActivityHub.jsx';
import MironChat from './views/MironChat.jsx';

const App = () => {
  console.log("App Component Rendering...");
  const [session, setSession] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const [activeTab, setActiveTab] = useState('home');

  useEffect(() => {
    // 0. Conduit OAuth Popup Interceptor
    const handleMessage = (e) => {
      if (e.data?.type === 'CONDUIT_OAUTH_TOKEN' && e.data.hash) {
        const hashParams = new URLSearchParams(e.data.hash.substring(1));
        const accessToken = hashParams.get('access_token');
        const refreshToken = hashParams.get('refresh_token');
        if (accessToken && refreshToken) {
          supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken
          });
        }
      }
    };
    window.addEventListener('message', handleMessage);

    // Legacy fallback for parent window hash (just in case)
    try {
      if (window.IS_CONDUIT_PREVIEW && window.parent && window.parent.location.hash.includes('access_token')) {
        const hashParams = new URLSearchParams(window.parent.location.hash.substring(1));
        const accessToken = hashParams.get('access_token');
        const refreshToken = hashParams.get('refresh_token');
        if (accessToken && refreshToken) {
          supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
          window.parent.history.replaceState(null, '', window.parent.location.pathname + window.parent.location.search);
        }
      }
    } catch (e) {}

    const fetchProfile = async (userId) => {
      const { data } = await supabase.from('profiles').select('*').eq('id', userId).single();
      if (data) setUserProfile(data);
    };

    const updateLastSeen = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        await supabase.from('profiles').update({ last_seen_at: new Date().toISOString() }).eq('id', session.user.id);
      }
    };

    // 1. Check active session on load
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) {
        fetchProfile(session.user.id);
        updateLastSeen();
      }
      setIsCheckingAuth(false);
    });

    // Sync last seen every 2 minutes while active
    const presenceInterval = setInterval(() => {
      updateLastSeen();
    }, 120000);

    // 2. Listen for login/logout events in realtime
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session) {
        fetchProfile(session.user.id);
      } else {
        setUserProfile(null);
      }
    });

    return () => {
      subscription.unsubscribe();
      window.removeEventListener('message', handleMessage);
      clearInterval(presenceInterval);
    };
  }, []);
  const [isActivityOpen, setIsActivityOpen] = useState(false);
  const [mironContext, setMironContext] = useState(null); // null means closed, object holds selection context

  useEffect(() => {
    const handleGlobalMironRequest = (e) => {
      const text = e.detail?.text || null;
      setMironContext({ text });
    };
    window.addEventListener('open-full-miron-chat', handleGlobalMironRequest);
    return () => window.removeEventListener('open-full-miron-chat', handleGlobalMironRequest);
  }, []);
  
  // Maps tab IDs to their index for the mobile indicator animation
  const tabIndex = {
    'home': 0,
    'discover': 1,
    'study': 2,
    'connect': 3,
    'profile': 4
  };

  const renderContent = () => {
    switch(activeTab) {
      case 'home': return <Home onOpenActivity={() => setIsActivityOpen(true)} userProfile={userProfile} />;
      case 'discover': return <Discover onOpenActivity={() => setIsActivityOpen(true)} userProfile={userProfile} />;
      case 'study': return <Study onOpenActivity={() => setIsActivityOpen(true)} userProfile={userProfile} />;
      case 'connect': return <Connect onOpenActivity={() => setIsActivityOpen(true)} userProfile={userProfile} currentUser={session?.user} />;
      case 'profile': return <Profile onOpenActivity={() => setIsActivityOpen(true)} userProfile={userProfile} />;
      default: return <Home onOpenActivity={() => setIsActivityOpen(true)} userProfile={userProfile} />;
    }
  };

  // The Minimalist Auth Gate Loader
  if (isCheckingAuth) {
    return (
      <div style={{ height: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0c0c0c', color: '#42d7b8', flexDirection: 'column', gap: '1rem' }}>
        <i className="fas fa-circle-notch fa-spin" style={{ fontSize: '2rem' }}></i>
        <div style={{ fontFamily: 'Roboto Mono, monospace', fontSize: '0.9rem', letterSpacing: '2px' }}>INITIALIZING LINKUP</div>
      </div>
    );
  }

  // The Auth Gateway Interceptor
  if (!session) {
    return <Auth />;
  }

  return (
    <div className="app-container">
      <main className="main-content">
        {renderContent()}
      </main>
      {isActivityOpen && <ActivityHub onClose={() => setIsActivityOpen(false)} />}
      {mironContext && (
        <MironChat 
          initialContext={mironContext.text} 
          onClose={() => setMironContext(null)} 
        />
      )}

      <footer className="navigation-magic">
        <nav>
          {/* Mobile Indicator - Moves based on active index (20% width per item) */}
          <div 
            className="indicator" 
            style={{ 
              transform: `translateX(${tabIndex[activeTab] * 100}%)`, 
              left: '0' 
            }}
          ></div>

          <li 
            className={`list ${activeTab === 'home' ? 'active' : ''}`} 
            onClick={() => setActiveTab('home')}
          >
            <a>
              <span className="icon"><i className="fas fa-home"></i></span>
              <span className="text">Home</span>
            </a>
          </li>
          
          <li 
            className={`list ${activeTab === 'discover' ? 'active' : ''}`} 
            onClick={() => setActiveTab('discover')}
          >
            <a>
              <span className="icon"><i className="fas fa-compass"></i></span>
              <span className="text">Discover</span>
            </a>
          </li>

          <li 
            className={`list ${activeTab === 'study' ? 'active' : ''}`} 
            onClick={() => setActiveTab('study')}
          >
            <a>
              <span className="icon"><i className="fas fa-book-open"></i></span>
              <span className="text">Study</span>
            </a>
          </li>

          <li 
            className={`list ${activeTab === 'connect' ? 'active' : ''}`} 
            onClick={() => setActiveTab('connect')}
          >
            <a>
              <span className="icon"><i className="fas fa-users"></i></span>
              <span className="text">Connect</span>
            </a>
          </li>

          <li 
            className={`list ${activeTab === 'profile' ? 'active' : ''}`} 
            onClick={() => setActiveTab('profile')}
          >
            <a>
              <span className="icon"><i className="fas fa-user"></i></span>
              <span className="text">Profile</span>
            </a>
          </li>
        </nav>
      </footer>
    </div>
  );
};

export default App;
