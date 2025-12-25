import React, { useState, useEffect } from 'react';

// Placeholder imports for views we will create in the next session
import Home from './views/Home';
import Discover from './views/Discover';
import Study from './views/Study';
import Connect from './views/Connect';
import Profile from './views/Profile';

const App = () => {
  console.log("App Component Rendering...");
  const [activeTab, setActiveTab] = useState('home');
  
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
      case 'home': return <Home />;
      case 'discover': return <Discover />;
      case 'study': return <Study />;
      case 'connect': return <Connect />;
      case 'profile': return <Profile />;
      default: return <Home />;
    }
  };

  return (
    <div className="app-container">
      <main className="main-content">
        {renderContent()}
      </main>

      <footer className="navigation-magic">
        <nav>
          {/* Mobile Indicator - Moves based on active index (20% width per item) */}
          <div 
            className="indicator" 
            style={{ 
              transform: `translateX(${tabIndex[activeTab] * 100}%)`, 
              left: '2.5%' /* Adjustment for centering within the 20% slice if needed, or rely on CSS centering */
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