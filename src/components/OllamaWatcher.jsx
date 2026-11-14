import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@contexts/AuthContext';
import { useNotification } from '@contexts/NotificationContext';
import { deviceService, useDeviceLink } from '../client/ai.client';

const RECHECK_MS = 30000;
const RECHECK_PROBLEM_MS = 5000;

export const OllamaWatcher = () => {
    const { user } = useAuth();
    const { warning, success } = useNotification();
    const [problem, setProblem] = useState(null);
    useDeviceLink();

    const lastState = useRef(null);

    const check = useCallback(async () => {
        let found = null;
        try {
            const status = await deviceService.getSetupStatus();
            found = status.ollama?.available ? null : status.ollama;
        } catch (error) {
            const data = error?.response?.data;
            if (data?.code === 'DATABASE_DOWN') {
                found = { message: data.message, action: data.action };
            } else if (!error?.response) {
                found = {
                    message: 'Mollama is not answering.',
                    action: 'Check that its server is running and that this device is online.'
                };
            }
        } finally {
            setProblem(found);
            const state = found ? found.message || 'down' : 'up';
            if (lastState.current !== state) {
                if (found) {
                    warning(`${found.message || 'No device is available to run models right now.'} ${found.action || 'Start Ollama, then try again.'}`, { duration: 10000 });
                } else if (lastState.current !== null) {
                    success('Models are available again.');
                }
                if (lastState.current !== null) window.dispatchEvent(new CustomEvent('ollama-availability-changed'));
            }
            lastState.current = state;
        }
    }, [warning, success]);

    useEffect(() => {
        if (!user) {
            setProblem(null);
            lastState.current = null;
            return undefined;
        }
        check();
        window.addEventListener('ollama-status-changed', check);
        window.addEventListener('online', check);
        window.addEventListener('offline', check);
        return () => {
            window.removeEventListener('ollama-status-changed', check);
            window.removeEventListener('online', check);
            window.removeEventListener('offline', check);
        };
    }, [user, check]);

    const showing = Boolean(problem);
    useEffect(() => {
        if (!user) return undefined;
        const timer = setInterval(check, showing ? RECHECK_PROBLEM_MS : RECHECK_MS);
        return () => clearInterval(timer);
    }, [user, check, showing]);

    return null;
};

export default OllamaWatcher;
