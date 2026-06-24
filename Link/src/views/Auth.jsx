import React, { useState } from 'react';
import { supabase } from '../config/supabaseClient.js';
import './Auth.css';

const Auth = () => {
    const [isSignUp, setIsSignUp] = useState(false);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [fullName, setFullName] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    const handleGoogleAuth = async () => {
        try {
            setError(null);
            
            // Dynamically construct the redirect URL to target the App Preview, not the IDE editor
            let targetRedirect = window.location.origin;
            try {
                if (window.IS_CONDUIT_PREVIEW && window.parent) {
                    const parentUrl = new URL(window.parent.location.href);
                    parentUrl.searchParams.set('conduit_preview', 'true');
                    targetRedirect = parentUrl.toString();
                }
            } catch (e) {
                targetRedirect = window.location.origin + '/?conduit_preview=true';
            }

            const { data, error } = await supabase.auth.signInWithOAuth({
                provider: 'google',
                options: {
                    redirectTo: targetRedirect,
                    skipBrowserRedirect: true // Bypass iframe restrictions
                }
            });
            if (error) throw error;
            
            // Open Google OAuth in a new tab. Once authorized, it redirects back to the target URL.
            if (data?.url) {
                window.open(data.url, '_blank');
            }
        } catch (err) {
            setError(err.message);
        }
    };

    const handleEmailAuth = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError(null);

        try {
            if (isSignUp) {
                // Pass full_name to raw_user_meta_data so our PostgreSQL trigger picks it up!
                const { error } = await supabase.auth.signUp({
                    email,
                    password,
                    options: { data: { full_name: fullName } }
                });
                if (error) throw error;
                // Auto login might happen or require verification depending on Supabase settings
                alert('Success! If email confirmations are enabled, check your inbox.');
            } else {
                const { error } = await supabase.auth.signInWithPassword({
                    email,
                    password,
                });
                if (error) throw error;
            }
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="auth-root">
            <div className="ambient-elegant-bg"></div>
            
            <div className="auth-card">
                <header className="auth-header">
                    <h1 className="auth-title">LinkUp</h1>
                    <p className="auth-subtitle">
                        {isSignUp ? 'Create an account to get started' : 'Welcome back, please sign in'}
                    </p>
                </header>

                {error && <div className="auth-error">{error}</div>}

                <form onSubmit={handleEmailAuth}>
                    <div className={`input-group dynamic-field ${isSignUp ? 'is-visible' : ''}`}>
                        <input 
                            type="text" 
                            className="auth-input" 
                            placeholder="Full Name" 
                            value={fullName}
                            onChange={(e) => setFullName(e.target.value)}
                            required={isSignUp}
                        />
                        <i className="fas fa-user input-icon"></i>
                    </div>

                    <div className="input-group">
                        <input 
                            type="email" 
                            className="auth-input" 
                            placeholder="Email address" 
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            required
                        />
                        <i className="fas fa-envelope input-icon"></i>
                    </div>

                    <div className="input-group">
                        <input 
                            type="password" 
                            className="auth-input" 
                            placeholder="Password" 
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            required
                        />
                        <i className="fas fa-lock input-icon"></i>
                    </div>

                    <button type="submit" className="auth-submit-btn" disabled={loading}>
                        {loading ? <i className="fas fa-circle-notch fa-spin"></i> : (isSignUp ? 'Sign Up' : 'Sign In')}
                    </button>
                </form>

                <div className="auth-divider">
                    <span>Or continue with</span>
                </div>

                <button className="google-btn" onClick={handleGoogleAuth} type="button">
                    <svg className="google-icon" viewBox="0 0 24 24">
                        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                        <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                    </svg>
                    Google
                </button>

                <div className="auth-footer">
                    {isSignUp ? 'Already have an account?' : "Don't have an account?"}
                    <button type="button" onClick={() => setIsSignUp(!isSignUp)}>
                        {isSignUp ? 'Sign In' : 'Sign Up'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default Auth;