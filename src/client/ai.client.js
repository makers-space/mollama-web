import { createContext, createElement, useCallback, useContext, useEffect, useState } from 'react';
import { useAuth } from '@contexts/AuthContext';
import { useNotification } from '@contexts/NotificationContext';
import { Button, Container, Icon, Typography } from '@components/Components';
import { sharedAPI as api, API_BASE_URL, refreshCsrfToken, appService } from './app.client.js';

export const guideService = {
    get: () => api.get('/guide'),
    set: (on) => api.put('/guide', { on }),
    seen: (key) => api.post('/guide/seen', { key })
};

export const GUIDE_TEXT = {
    'nav.chat': ['Chat', 'Talk to a model that runs on this computer. Your chats are saved, and only you can open them.'],
    'nav.models': ['Models', 'Find models that fit this device, download them, and make your own versions.'],
    'nav.devices': ['Devices', 'What Mollama reads from this computer: graphics card, memory and free disk.'],
    'nav.settings': ['Settings', 'Your account, sign-in security, themes, and how Mollama reaches Ollama.'],
    'chat.send': ['Sending a message', 'The reply is written on this computer and keeps going if you leave the page. You can send another message while it is being written; it waits its turn.'],
    'chat.new': ['New chat', 'Starts an empty conversation. The earlier ones stay in the list on the left.'],
    'models.installed': ['Installed', 'The models already on this device, with their size on disk.'],
    'models.running': ['Running', 'Models loaded in memory right now. They unload by themselves after a few minutes.'],
    'models.mine': ['My models', 'An installed model with your own instructions built in, saved under its own name.'],
    'models.refresh': ['Refresh', 'Reads the model lists and the free disk space again, for example after a download finished elsewhere.'],
    'models.download': ['Download', 'The download runs on the server, so it carries on if you close this page. Its progress shows at the top.'],
    'devices.read': ['Read this computer again', 'Reads the hardware again, for example after a graphics card was changed.'],
    'devices.correct': ['Correct these details', 'Use this only when what Mollama reads is wrong. It changes which models are said to fit.']
};

const NO_ACTIVITY = { replies: [], downloads: [], finished: [], canManage: false };
const ActivityContext = createContext({ ...NO_ACTIVITY, refresh: async () => {}, stopReply: async () => {}, cancelDownload: async () => {} });
export const useActivity = () => useContext(ActivityContext);

export const ActivityProvider = ({ children }) => {
    const { user } = useAuth();
    const userId = user?.id || user?._id || null;
    const [activity, setActivity] = useState(NO_ACTIVITY);

    const refresh = useCallback(async () => {
        try {
            const result = await api.get('/activity');
            setActivity({
                replies: result.replies,
                downloads: result.downloads.filter((job) => job.status === 'queued' || job.status === 'downloading'),
                finished: result.downloads.filter((job) => job.status === 'completed' || job.status === 'failed'),
                canManage: Boolean(result.permissions?.manage)
            });
        } catch {
            return;
        }
    }, []);

    useEffect(() => {
        if (!userId) {
            setActivity(NO_ACTIVITY);
            return undefined;
        }
        refresh();
        const stopListening = appService.onNotification('activity:changed', refresh);
        const stopDownloads = appService.onNotification('download:finished', () => window.dispatchEvent(new CustomEvent('ollama-availability-changed')));
        const stopDevices = appService.onNotification('device:changed', () => {
            window.dispatchEvent(new CustomEvent('ollama-status-changed'));
            window.dispatchEvent(new CustomEvent('ollama-availability-changed'));
        });
        const timer = setInterval(() => {
            if (!document.hidden) refresh();
        }, 60000);
        return () => {
            stopListening();
            stopDownloads();
            stopDevices();
            clearInterval(timer);
        };
    }, [userId, refresh]);

    // While something is running its progress is read every few seconds; otherwise once a minute is enough.
    const busy = activity.replies.length + activity.downloads.length > 0;
    useEffect(() => {
        if (!userId || !busy) return undefined;
        const timer = setInterval(() => {
            if (!document.hidden) refresh();
        }, 3000);
        return () => clearInterval(timer);
    }, [userId, busy, refresh]);

    const stopReply = useCallback(async (chatId) => {
        await api.post(`/chats/${chatId}/stop`, {}).catch(() => {});
        refresh();
    }, [refresh]);
    const cancelDownload = useCallback(async (id) => {
        await api.post('/models/downloads/cancel', { id, action: 'cancel' }).catch(() => {});
        refresh();
    }, [refresh]);

    return createElement(ActivityContext.Provider, { value: { ...activity, refresh, stopReply, cancelDownload } }, children);
};

const GUIDE_OFF = { on: false, seen: [], steps: [] };
const GuideContext = createContext({ ...GUIDE_OFF, setOn: async () => {}, tip: () => ({}) });
export const useGuide = () => useContext(GuideContext);

export const GuideProvider = ({ children }) => {
    const { user } = useAuth();
    const userId = user?.id || user?._id || null;
    const [guide, setGuide] = useState(GUIDE_OFF);
    const [showing, setShowing] = useState([]);

    useEffect(() => {
        if (!userId) {
            setGuide(GUIDE_OFF);
            return;
        }
        guideService.get().then((result) => setGuide(result.guide)).catch(() => setGuide(GUIDE_OFF));
    }, [userId]);

    const setOn = useCallback(async (on) => {
        setGuide((await guideService.set(on)).guide);
    }, []);

    const begin = (key) => {
        setShowing((now) => (now.includes(key) ? now : [...now, key]));
        if (guide.seen.includes(key)) return;
        setGuide((now) => ({ ...now, seen: [...now.seen, key] }));
        guideService.seen(key).then((result) => setGuide(result.guide)).catch(() => {});
    };
    const end = (key) => setShowing((now) => now.filter((item) => item !== key));

    const tip = (key, action = null) => {
        const known = GUIDE_TEXT[key];
        const due = guide.on && guide.steps.includes(key) && !guide.seen.includes(key);
        if (!known || (!due && !showing.includes(key))) return {};
        return {
            genie: {
                trigger: 'click',
                padding: 'none',
                backgroundColor: 'background',
                borderColor: 'tertiary',
                borderStyle: 'dotted',
                shadow: false,
                width: '250px',
                content: createElement(Container, { layout: 'flex-column', gap: 'xs', padding: 'sm', width: '100%' },
                    createElement(Typography, { size: 'xs', weight: 'semibold' }, known[0]),
                    createElement(Typography, { size: 'xs', color: 'muted' }, known[1]),
                    createElement(Container, { layout: 'flex', align: 'center', justify: 'between', gap: 'sm', padding: 'none', width: '100%', wrap: false },
                        createElement(Container, { layout: 'flex', align: 'center', gap: 'xs', padding: 'none', wrap: false },
                            createElement(Icon, { name: 'MdSupportAgent', size: 'xs', color: 'tertiary' }),
                            createElement(Typography, { size: 'xxs', color: 'tertiary' }, 'Helper')),
                        action ? createElement(Button, { size: 'xs', color: 'tertiary', onClick: action.run }, action.label) : null))
            },
            genieTrigger: 'click',
            onGenieShow: () => begin(key),
            onGenieHide: () => end(key)
        };
    };

    return createElement(GuideContext.Provider, { value: { ...guide, setOn, tip } }, children);
};

// The device the person chose to work on travels with every request; with none chosen the server picks.
const DEVICE_KEY = 'mollama-device';
const chosenDevice = () => {
    try {
        return localStorage.getItem(DEVICE_KEY) || '';
    } catch {
        return '';
    }
};
const deviceHeader = () => (chosenDevice() ? { 'X-Mollama-Device': chosenDevice() } : {});
api.interceptors.request.use((config) => {
    if (!config.headers['X-Mollama-Device']) Object.assign(config.headers, deviceHeader());
    return config;
});

// The Models page works on one computer at a time; its requests name that computer themselves.
let viewedDevice = null;
let chatDevice = null;
const onDevice = (id) => (id ? { headers: { 'X-Mollama-Device': id } } : {});
const onViewed = () => onDevice(viewedDevice);

export const deviceService = {
    listDevices: () => api.get('/devices'),
    linkDevice: (details) => api.post('/devices/link', details),
    removeDevice: (id) => api.delete(`/devices/${id}`),
    chosen: chosenDevice,
    choose(id) {
        try {
            if (id) localStorage.setItem(DEVICE_KEY, id);
            else localStorage.removeItem(DEVICE_KEY);
        } catch { /* storage unavailable: the server picks */ }
        window.dispatchEvent(new CustomEvent('ollama-status-changed'));
        window.dispatchEvent(new CustomEvent('ollama-availability-changed'));
    },
    updateDevice: (id, changes) => api.put(`/devices/${id}`, changes),
    detectDevice: (id) => api.post(`/devices/${id}/detect`, {}),

    getSettings: () => api.get('/settings'),
    updateSettings: (changes) => api.put('/settings', changes),
    testConnection: (ollamaBaseUrl) => api.post('/settings/test-connection', { ollamaBaseUrl }),

    getSetupStatus: () => api.get('/setup/status')
};

// The desktop app's installers are published as releases of a public repository; this reads which ones exist.
const INSTALLERS = 'makers-space/mollama-installers';
export const desktopService = {
    systems: [
        { id: 'windows', label: 'Windows', icon: 'FaWindows', ending: '-Setup.exe' },
        { id: 'mac', label: 'macOS', icon: 'FaApple', ending: '.dmg' },
        { id: 'linux', label: 'Linux', icon: 'FaLinux', ending: '.AppImage' }
    ],
    // Only the released app is offered for download; the staging build is still published for testers who ask for it.
    channels() {
        return [{ id: 'production', name: 'Mollama', title: 'Mollama', opens: 'Opens www.mollama.one' }];
    },
    address: (file) => `https://github.com/${INSTALLERS}/releases/latest/download/${file}`,
    async published() {
        try {
            const reply = await fetch(`https://api.github.com/repos/${INSTALLERS}/releases/latest`);
            if (!reply.ok) return { version: null, files: ['Mollama-Setup.exe', 'Mollama-Staging-Setup.exe'] };
            const release = await reply.json();
            return { version: String(release.tag_name || '').replace(/^v/, '') || null, files: (release.assets || []).map((asset) => asset.name) };
        } catch {
            return { version: null, files: ['Mollama-Setup.exe', 'Mollama-Staging-Setup.exe'] };
        }
    }
};

// Inside the desktop app, signing in links this computer to the account and signing out unlinks it.
export const useDeviceLink = () => {
    const { user, isLoading, logout } = useAuth();
    const { warning } = useNotification();
    const userId = user?.id || user?._id || null;

    useEffect(() => {
        const desktop = window.desktop;
        if (!desktop?.link || isLoading) return undefined;
        let cancelled = false;
        let busy = false;
        const sync = async () => {
            if (busy || cancelled) return;
            busy = true;
            try {
                const state = await desktop.deviceState();
                if (!userId) {
                    if (state?.deviceId && state.user && sessionStorage.getItem('mollama-signed-in')) await desktop.unlink();
                    sessionStorage.removeItem('mollama-signed-in');
                    return;
                }
                sessionStorage.setItem('mollama-signed-in', '1');
                const { devices } = await api.get('/devices');
                const mine = Boolean(state?.deviceId) && state.user === String(userId);
                if (mine && devices.some((device) => device.id === state.deviceId)) return;
                // This computer was linked for this person and is no longer on their account: it was removed from another
                // device, so it signs out here instead of quietly adding itself back.
                if (mine) {
                    await desktop.unlink();
                    sessionStorage.removeItem('mollama-signed-in');
                    warning('This computer was removed from your account, so it has been signed out. Sign in again to add it back.', { duration: 10000 });
                    await logout();
                    return;
                }
                const hardware = await desktop.hardware();
                const linked = await api.post('/devices/link', { hostname: hardware.hostname, hardware });
                if (cancelled) return;
                const socketUrl = `${import.meta.env.VITE_WS_BASE_URL || API_BASE_URL.replace(/^http/, 'ws').replace(/[/]api[/]v1[/]?$/, '')}/devices`;
                await desktop.link({ deviceId: linked.device.id, key: linked.key, user: String(userId), socketUrl });
            } catch {
                return;
            } finally {
                busy = false;
            }
        };
        sync();
        // A removal made on another device is noticed here without waiting for the app to be reopened.
        const timer = userId ? setInterval(sync, 30000) : null;
        window.addEventListener('focus', sync);
        return () => {
            cancelled = true;
            if (timer) clearInterval(timer);
            window.removeEventListener('focus', sync);
        };
    }, [userId, isLoading]);
};

export const describeError = (error, fallback = 'Something went wrong. Please try again.') => {
    const data = error?.response?.data;
    if (data?.action) return `${data.message} ${data.action}`;
    return data?.message || fallback;
};

export const modelService = {
    view(deviceId) {
        viewedDevice = deviceId || null;
    },
    installedOn: (deviceId) => api.get('/models', onDevice(deviceId)),

    listInstalled: () => api.get('/models', onViewed()),
    listRunning: () => api.get('/models/running', onViewed()),
    deleteModel: (name) => api.post('/models/delete', { name }, onViewed()),
    unloadModel: (name) => api.post('/models/unload', { name }, onViewed()),
    loadModel: (name) => api.post('/models/load', name ? { name } : {}, onDevice(chatDevice)),
    createModel: (request) => api.post('/models/create', request, onViewed()),
    updateModel: (request) => api.post('/models/update', request, onViewed()),

    getDeviceCatalogue: (deviceId, query = {}) => api.get(`/devices/${deviceId}/catalogue`, { params: query }),
    // A server that is one version behind does not know "sample" yet; it is then asked the older way and the page trims the list itself.
    getPublicCatalogue: (memoryMb, gpuMemoryMb, shared = false) => api.get('/catalogue', { params: { memoryMb, gpuMemoryMb, sample: true, ...(shared ? { shared: true } : {}) } })
        .catch((error) => (error?.response?.status === 400 ? api.get('/catalogue', { params: { memoryMb, gpuMemoryMb } }) : Promise.reject(error))),

    startDownload: (name) => api.post('/models/pull', { name }, onViewed()),
    listDownloads: () => api.get('/models/downloads', onViewed()),
    pauseDownload: (id) => api.post('/models/downloads/cancel', { id, action: 'pause' }, onViewed()),
    cancelDownload: (id) => api.post('/models/downloads/cancel', { id, action: 'cancel' }, onViewed()),

    watchDownloads({ onSnapshot, onProgress, onError }) {
        const watched = viewedDevice || chosenDevice();
        const source = new EventSource(`${API_BASE_URL}/models/downloads/stream${watched ? `?device=${watched}` : ''}`, { withCredentials: true });
        source.addEventListener('snapshot', (event) => onSnapshot(JSON.parse(event.data)));
        source.addEventListener('progress', (event) => onProgress(JSON.parse(event.data)));
        source.onerror = () => onError?.();
        return () => source.close();
    }
};

const cleanGraphicsName = (raw) => {
    if (!raw) return null;
    const angle = String(raw).match(/^ANGLE \([^,]+,\s*(.+?)(?:\s+\(0x[0-9a-f]+\))?(?:\s+Direct3D.*|\s+OpenGL.*|\s+Metal.*|\s+Vulkan.*)?,/i);
    const name = (angle ? angle[1] : String(raw)).replace(/\s+\(0x[0-9a-f]+\)/i, '').trim();
    return /swiftshader|llvmpipe|software/i.test(name) ? null : name;
};

const readGraphicsName = () => {
    try {
        const canvas = document.createElement('canvas');
        const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
        if (!gl) return null;
        const info = gl.getExtension('WEBGL_debug_renderer_info');
        return cleanGraphicsName(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
    } catch {
        return null;
    }
};

export const readBrowserDevice = () => ({
    graphicsName: readGraphicsName(),
    memoryGb: navigator.deviceMemory || null,
    processorThreads: navigator.hardwareConcurrency || null,
    system: navigator.userAgentData?.platform || navigator.platform || null
});

export const formatGb = (megabytes, digits = 0) => {
    if (megabytes === null || megabytes === undefined) return 'Unknown';
    return `${(megabytes / 1024).toFixed(digits)} GB`;
};

const csrfToken = async () => document.cookie.match(/(?:^|; )csrfToken=([^;]+)/)?.[1] || refreshCsrfToken();

const readEvents = async (response, onEvent) => {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) {
            if (line.trim()) onEvent(JSON.parse(line));
        }
    }
};

export const chatService = {
    // The computer the open chat runs on; warming up a model goes to the same one.
    on(deviceId) {
        chatDevice = deviceId || null;
    },
    list: (search) => api.get('/chats', { params: search ? { search } : {} }),
    skills: () => api.get('/skills'),
    create: (body = {}) => api.post('/chats', body),
    get: (id) => api.get(`/chats/${id}`),
    update: (id, changes) => api.patch(`/chats/${id}`, changes),
    remove: (id) => api.delete(`/chats/${id}`),
    summarise: (id) => api.post(`/chats/${id}/summary`, {}, { timeout: 0 }),
    exportChat: (id, format) => api.get(`/chats/${id}/export`, { params: { format } }),

    attachUpload: (id, file) => api.post(`/chats/${id}/attachments`, file, {
        params: { name: file.name },
        headers: { 'Content-Type': 'application/octet-stream' },
        timeout: 120000
    }),
    attachFile: (id, path) => api.post(`/chats/${id}/attachments`, { path }, { timeout: 60000 }),
    removeAttachment: (id, attachmentId) => api.delete(`/chats/${id}/attachments/${attachmentId}`),

    stop: (id) => api.post(`/chats/${id}/stop`, {}),

    async rejoin(id, { onEvent, signal }) {
        const response = await fetch(`${API_BASE_URL}/chats/${id}/reply`, { credentials: 'include', signal, headers: deviceHeader() });
        if (response.status !== 200) return false;
        await readEvents(response, onEvent);
        return true;
    },

    async send(id, body, { onEvent, signal }) {
        const attempt = async () => fetch(`${API_BASE_URL}/chats/${id}/messages`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': await csrfToken(), ...deviceHeader() },
            body: JSON.stringify(body),
            signal
        });

        let response = await attempt();
        if (response.status === 401) {
            await api.get('/chats');
            response = await attempt();
        }
        if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            throw Object.assign(new Error(data.message || 'The message could not be sent.'), { response: { data, status: response.status } });
        }

        if (response.status === 202) return response.json();
        await readEvents(response, onEvent);
        return null;
    }
};

export const promptService = {
    list: () => api.get('/prompts'),
    create: (prompt) => api.post('/prompts', prompt),
    update: (id, changes) => api.patch(`/prompts/${id}`, changes),
    remove: (id) => api.delete(`/prompts/${id}`)
};

export const fileService = {
    browse: (path = '/') => api.get('/files/browse', { params: { path } }),
    text: (path, model) => api.get('/files/text', { params: model ? { path, model } : { path }, timeout: 60000 }),
    save: (folder, name, content) => api.post('/files/save', { folder, name, content }),
    remote: (url) => api.get('/files/remote', { params: { url }, responseType: 'blob', timeout: 120000 })
};

export const downloadText = (fileName, content) => {
    const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
};
