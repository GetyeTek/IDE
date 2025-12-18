import React, { useState } from 'react';

export default function App() {
    const [count, setCount] = useState(0);

    return (
        <div className="card">
            <h1>⚛️ React Bundler</h1>
            <p style={{ color: '#aaa' }}>If you can see this, JSX is working!</p>
            
            <div className="count" style={{ color: count > 0 ? '#4ade80' : '#fff' }}>
                {count}
            </div>

            <div style={{ display: 'flex', justifyContent: 'center', gap: '10px' }}>
                <button onClick={() => setCount(count - 1)}>-</button>
                <button onClick={() => setCount(count + 1)}>+</button>
            </div>
            
            <div style={{ marginTop: '20px' }}>
                <button className="reset" onClick={() => setCount(0)}>Reset</button>
            </div>
        </div>
    );
}