export const API_ENDPOINT = 'https://ryaxynjczfwqyqvpmorl.supabase.co/functions/v1/book-reader';

/**
 * Standardized fetch wrapper for the Supabase Edge Function
 * @param {Object} payload - The JSON payload containing the action and parameters.
 * @param {AbortSignal} [signal] - Optional abort signal for canceling requests.
 * @returns {Promise<any>} - The parsed JSON response.
 */
import { supabase } from './supabaseClient.js';

export const invokeBookReader = async (payload, signal = null) => {
    const { data: { session } } = await supabase.auth.getSession();
    
    const options = {
        method: 'POST',
        headers: { 
            'Content-Type': 'application/json',
            ...(session ? { 'Authorization': `Bearer ${session.access_token}` } : {})
        },
        body: JSON.stringify(payload)
    };
    
    if (signal) {
        options.signal = signal;
    }

    const response = await fetch(API_ENDPOINT, options);
    
    if (!response.ok) {
        throw new Error(`API Error: ${response.status} ${response.statusText}`);
    }
    
    return response.json();
};

export const MIRON_ENDPOINT = 'https://ryaxynjczfwqyqvpmorl.supabase.co/functions/v1/miron-athena';

export const invokeMiron = async (payload) => {
    const { data: { session } } = await supabase.auth.getSession();
    
    const response = await fetch(MIRON_ENDPOINT, {
        method: 'POST',
        headers: { 
            'Content-Type': 'application/json',
            ...(session ? { 'Authorization': `Bearer ${session.access_token}` } : {})
        },
        body: JSON.stringify(payload)
    });
    
    if (!response.ok) {
        throw new Error(`Miron Error: ${response.status} ${response.statusText}`);
    }
    
    return response.json();
};