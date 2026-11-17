import React, { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Page, Container, Card, Typography, Button, Badge, Icon, Input } from '@components/Components';
import { useNotification } from '@contexts/NotificationContext';
import { toolService, deviceService, describeError } from '../client/ai.client';

const STALE_MS = 60 * 1000;
const SIGN_IN_LABELS = { account: 'Sign in with your account', key: 'Needs a key from the app', none: 'No sign-in needed' };
// A sign-in page opens in a tab of its own. The tab is opened at the click, before anything is asked of the server,
// because browsers block a tab opened later. Inside the desktop app the link is handed to the person's browser instead.
const openTab = () => {
    if (window.desktop) return null;
    const tab = window.open('', '_blank');
    if (tab) tab.opener = null;
    return tab;
};
const sendTo = (tab, url) => {
    if (tab && !tab.closed) tab.location.replace(url);
    else window.location.assign(url);
};
const HEALTH_COLORS = { healthy: 'success', unchecked: 'default', signin: 'warning', empty: 'warning', offline: 'default' };

const Heading = ({ icon, title, children }) => (
    <Container layout="flex" justify="between" align="center" gap="sm" padding="none" width="100%" wrap={false}>
        <Container layout="flex" align="center" gap="xs" padding="none" wrap={false} minWidth="0">
            <Icon name={icon} size="xs" color="primary" />
            <Typography as="h2" size="sm" weight="semibold" truncate>{title}</Typography>
        </Container>
        {children}
    </Container>
);

const ServerCard = ({ server, computer, busy, onCheck, onSignIn, onRemove }) => {
    const [showTools, setShowTools] = useState(false);
    const { health } = server;
    const ready = health.state === 'healthy';
    const canSignIn = server.kind === 'remote' && ['signin', 'refused'].includes(health.state);

    return (
        <Card layout="flex-column" gap="sm" padding="md" width="100%" hover={false}>
            <Heading icon={server.kind === 'remote' ? 'FiGlobe' : 'FiMonitor'} title={server.name}>
                <Container layout="flex" gap="xs" padding="none" align="center" justify="end">
                    <Badge size="xs" color={HEALTH_COLORS[health.state] || 'error'}>{health.label}</Badge>
                    {canSignIn && <Button size="xs" color="primary" disabled={busy} onClick={() => onSignIn(server)} title="Opens the app's sign-in page in a new tab"><Icon name="FiLogIn" size="xs" />Sign in</Button>}
                    <Button size="xs" color="secondary" disabled={busy} onClick={() => onCheck(server)}><Icon name="FiRefreshCw" size="xs" />{busy ? 'Checking…' : 'Check now'}</Button>
                    <Button size="xs" color="error" disabled={busy} onClick={() => onRemove(server)}><Icon name="FiTrash2" size="xs" />Remove</Button>
                </Container>
            </Heading>
            <Typography size="xxs" color="muted" truncate title={server.address || computer}>
                {server.kind === 'remote' ? server.address : `On ${computer || 'a computer that is no longer linked'}`}
            </Typography>

            {!ready && (
                <Container layout="flex-column" gap="xs" padding="none" width="100%">
                    <Typography size="xs" weight="semibold">To make this usable</Typography>
                    {health.needs.map((need) => (
                        <Container key={need} layout="flex" align="center" gap="xs" padding="none" wrap={false}>
                            <Icon name="FiAlertCircle" size="xs" color="warning" />
                            <Typography size="xs">{need}</Typography>
                        </Container>
                    ))}
                    {health.detail && <Typography size="xxs" color="muted">What that computer reported: {health.detail}</Typography>}
                </Container>
            )}

            {server.tools.length > 0 && (
                <Container layout="flex-column" gap="xs" padding="none" width="100%">
                    <Container layout="flex" align="center" gap="xs" padding="none">
                        <Button size="xxs" color="secondary" onClick={() => setShowTools((shown) => !shown)}>
                            <Icon name={showTools ? 'FiChevronDown' : 'FiChevronRight'} size="xs" />
                            {server.tools.length === 1 ? '1 tool' : `${server.tools.length} tools`}
                        </Button>
                        {!ready && <Typography size="xxs" color="muted">As last seen. They cannot be used until this is ready.</Typography>}
                    </Container>
                    {showTools && server.tools.map((tool) => (
                        <Container key={tool.name} layout="flex" align="start" justify="between" gap="sm" padding="none" width="100%" wrap={false}>
                            <Container layout="flex-column" gap="none" padding="none" minWidth="0">
                                <Typography size="xs" weight="medium">{tool.title || tool.name}</Typography>
                                {tool.description && <Typography size="xxs" color="muted">{tool.description}</Typography>}
                            </Container>
                            <Badge size="xs" color={tool.readOnly ? 'secondary' : 'warning'}>{tool.readOnly ? 'Only reads' : 'Can change things'}</Badge>
                        </Container>
                    ))}
                </Container>
            )}
        </Card>
    );
};

const ToolsPage = () => {
    const { success, error: showError, confirm } = useNotification();
    const [params, setParams] = useSearchParams();
    const [servers, setServers] = useState(null);
    const [devices, setDevices] = useState([]);
    const [failed, setFailed] = useState(false);
    const [busy, setBusy] = useState({});
    const [here, setHere] = useState(null);
    const [remote, setRemote] = useState({ name: '', address: '', key: '' });
    const [local, setLocal] = useState({ name: '', command: '', args: '' });
    const [adding, setAdding] = useState(null);
    const [apps, setApps] = useState([]);
    const [find, setFind] = useState('');
    const localBridge = window.desktop?.tools || null;

    const replace = (server) => setServers((current) => (current || []).map((one) => (one.id === server.id ? server : one)));
    const check = useCallback(async (server) => {
        setBusy((current) => ({ ...current, [server.id]: true }));
        try {
            replace((await toolService.check(server.id)).server);
        } catch (error) {
            showError(describeError(error, 'This tool server could not be checked.'));
        } finally {
            setBusy((current) => ({ ...current, [server.id]: false }));
        }
    }, [showError]);

    const load = useCallback(async () => {
        setFailed(false);
        try {
            const [listed, computers, catalogue] = await Promise.all([toolService.list(), deviceService.listDevices().catch(() => ({ devices: [] })), toolService.catalogue().catch(() => ({ apps: [] }))]);
            setServers(listed.servers);
            setApps(catalogue.apps || []);
            setDevices(computers.devices || []);
            listed.servers
                .filter((server) => !server.health.checkedAt || Date.now() - new Date(server.health.checkedAt).getTime() > STALE_MS)
                .forEach(check);
        } catch {
            setFailed(true);
        }
    }, [check]);

    useEffect(() => {
        load();
        window.desktop?.deviceState?.().then((state) => setHere(state?.deviceId || null));
        window.addEventListener('focus', load);
        return () => window.removeEventListener('focus', load);
    }, [load]);

    const tellResult = useCallback((result) => {
        if (result === 'done') success('Signed in. The tools are ready to use.');
        else showError('The sign-in did not finish. Choose Sign in to try again.');
    }, [success, showError]);

    // The sign-in tab ends up back on this page. It passes the result to the tab the person started from and closes;
    // if no other tab is listening, it stays open as the Tools page.
    useEffect(() => {
        const channel = new BroadcastChannel('mollama-tools');
        const result = params.get('signin');
        let timer = null;
        channel.onmessage = (event) => {
            if (event.data?.heard) return;
            if (event.data?.signin) {
                channel.postMessage({ heard: true });
                tellResult(event.data.signin);
                load();
            }
        };
        if (result) {
            setParams({}, { replace: true });
            const waiting = new BroadcastChannel('mollama-tools');
            waiting.onmessage = (event) => {
                if (!event.data?.heard) return;
                clearTimeout(timer);
                timer = null;
                window.close();
            };
            waiting.postMessage({ signin: result });
            timer = setTimeout(() => { tellResult(result); waiting.close(); }, 600);
        }
        return () => channel.close();
    }, []);

    const signIn = async (server, tab = openTab()) => {
        setBusy((current) => ({ ...current, [server.id]: true }));
        try {
            const started = await toolService.signIn(server.id);
            if (started.url) sendTo(tab, started.url);
            else {
                tab?.close();
                replace(started.server);
            }
        } catch (error) {
            tab?.close();
            showError(describeError(error, 'The sign-in could not be started.'));
        }
        setBusy((current) => ({ ...current, [server.id]: false }));
    };

    const remove = async (server) => {
        if (!await confirm(`Remove ${server.name}? Its tools will no longer be available in any chat.`, { confirmLabel: 'Remove', color: 'error' })) return;
        try {
            await toolService.remove(server.id);
            if (server.kind === 'local' && server.device === here) await localBridge?.remove?.(server.localId);
            setServers((current) => current.filter((one) => one.id !== server.id));
        } catch (error) {
            showError(describeError(error, 'This tool server could not be removed.'));
        }
    };

    const addRemote = async () => {
        setAdding('remote');
        try {
            const { server } = await toolService.add({ kind: 'remote', name: remote.name.trim(), address: remote.address.trim(), ...(remote.key.trim() ? { key: remote.key.trim() } : {}) });
            setServers((current) => [...(current || []), server]);
            setRemote({ name: '', address: '', key: '' });
        } catch (error) {
            showError(describeError(error, 'This app could not be added. Check that the address starts with https.'));
        }
        setAdding(null);
    };

    // One step for a listed app: add it, then go straight to its sign-in page when it asks for an account.
    const addApp = async (entry) => {
        if (entry.signIn === 'key') return setRemote({ name: entry.name, address: entry.address, key: '' });
        setAdding(entry.address);
        const tab = entry.signIn === 'account' ? openTab() : null;
        try {
            const { server } = await toolService.add({ kind: 'remote', name: entry.name, address: entry.address });
            setServers((current) => [...(current || []), server]);
            if (server.health.state === 'signin') await signIn(server, tab);
            else tab?.close();
        } catch (error) {
            tab?.close();
            showError(describeError(error, 'This app could not be added.'));
        }
        return setAdding(null);
    };

    const addLocal = async () => {
        setAdding('local');
        try {
            const made = await localBridge.add({ name: local.name.trim(), command: local.command.trim(), args: local.args.trim() });
            if (!made?.localId) throw new Error('not saved');
            const { server } = await toolService.add({ kind: 'local', name: local.name.trim(), device: here, localId: made.localId });
            setServers((current) => [...(current || []), server]);
            setLocal({ name: '', command: '', args: '' });
        } catch (error) {
            showError(describeError(error, 'This tool server could not be added on this computer.'));
        }
        setAdding(null);
    };

    const computerName = (id) => devices.find((device) => device.id === id)?.name || null;
    const remotes = (servers || []).filter((server) => server.kind === 'remote');
    const locals = (servers || []).filter((server) => server.kind === 'local');
    const cardProps = { onCheck: check, onSignIn: signIn, onRemove: remove };
    const added = new Set(remotes.map((server) => server.address));
    const words = find.trim().toLowerCase();
    const shownApps = apps.filter((entry) => !words || `${entry.name} ${entry.group} ${entry.does}`.toLowerCase().includes(words));

    return (
        <Page layout="flex-column" padding="none" gap="none" background="dots" backgroundFade="bottom">
            <Container layout="flex-column" align="center" gap="none" padding="none" width="100%" height="100vh" wrap={false} overflow="hidden">
                <Container layout="flex-column" gap="none" padding="lg" width="100%" maxWidth="1360px" wrap={false}>
                    <Typography as="h1" size="2xl" weight="bold" animation="blur" animationDuration={600}>Tools</Typography>
                    <Typography size="xs" color="muted">Apps your models can use while they answer. Each one is checked, and shows what it needs when it is not ready.</Typography>
                </Container>
                <Container layout="flex" justify="center" padding="none" width="100%" flexFill minHeight="0" overflow="auto">
                    <Container layout="flex-column" gap="md" padding="lg" width="100%" maxWidth="1360px" wrap={false}>
                        {servers === null && !failed && <Typography size="xs" color="muted">Loading your tools…</Typography>}
                        {failed && (
                            <Card padding="md" width="100%" hover={false}>
                                <Container layout="flex" align="center" justify="between" gap="sm" padding="none" width="100%" wrap={false}>
                                    <Typography size="sm" weight="semibold">Your tools could not be loaded.</Typography>
                                    <Button size="sm" onClick={load}>Try again</Button>
                                </Container>
                            </Card>
                        )}

                        {servers && (
                            <Container layout="grid" columns={2} gap="md" padding="none" width="100%">
                                <Container layout="flex-column" gap="sm" padding="none" width="100%" minWidth="0">
                                    <Heading icon="FiGlobe" title="Remote tools" />
                                    <Typography size="xxs" color="muted">Apps that live online. Mollama connects to them from its own server, so they work from any of your devices at any time. Add the app, then sign in to it.</Typography>
                                    {remotes.map((server) => <ServerCard key={server.id} server={server} busy={Boolean(busy[server.id])} {...cardProps} />)}
                                    {apps.length > 0 && (
                                        <Card layout="flex-column" gap="sm" padding="md" width="100%" hover={false}>
                                            <Container layout="flex" align="center" justify="between" gap="sm" padding="none" width="100%" wrap={false}>
                                                <Typography size="sm" weight="semibold">Apps ready to add</Typography>
                                                <Input size="xs" value={find} onChange={(e) => setFind(e.target.value)} placeholder="Find an app" width="180px" />
                                            </Container>
                                            <Container layout="flex-column" gap="xs" padding="none" width="100%" maxHeight="340px" overflow="auto" wrap={false}>
                                                {shownApps.length === 0 && <Typography size="xs" color="muted">No listed app matches. It can still be added by its address below.</Typography>}
                                                {shownApps.map((entry) => (
                                                    <Container key={entry.address} layout="flex" align="center" justify="between" gap="sm" padding="none" width="100%" wrap={false}>
                                                        <Container layout="flex-column" gap="none" padding="none" minWidth="0">
                                                            <Container layout="flex" align="center" gap="xs" padding="none" wrap={false}>
                                                                <Typography size="xs" weight="semibold">{entry.name}</Typography>
                                                                <Typography size="xxs" color="muted">{entry.group}</Typography>
                                                            </Container>
                                                            <Typography size="xxs" color="muted">{entry.does}. {SIGN_IN_LABELS[entry.signIn]}.</Typography>
                                                        </Container>
                                                        <Button size="xs" color={added.has(entry.address) ? 'secondary' : 'primary'} disabled={added.has(entry.address) || adding === entry.address} onClick={() => addApp(entry)}>
                                                            {added.has(entry.address) ? 'Added' : adding === entry.address ? 'Adding…' : entry.signIn === 'key' ? 'Add with a key' : 'Add'}
                                                        </Button>
                                                    </Container>
                                                ))}
                                            </Container>
                                        </Card>
                                    )}
                                    <Card layout="flex-column" gap="sm" padding="md" width="100%" hover={false}>
                                        <Typography size="sm" weight="semibold">Add another app by its address</Typography>
                                        <Input size="sm" label="Name" value={remote.name} onChange={(e) => setRemote((form) => ({ ...form, name: e.target.value }))} placeholder="Notion" width="100%" />
                                        <Input size="sm" label="Tool server address" value={remote.address} onChange={(e) => setRemote((form) => ({ ...form, address: e.target.value }))} placeholder="https://…" width="100%" />
                                        <Input size="sm" label="Key (only if the app gave you one)" type="password" value={remote.key} onChange={(e) => setRemote((form) => ({ ...form, key: e.target.value }))} width="100%" />
                                        <Typography size="xxs" color="muted">The address is the MCP address from the app&apos;s own help pages. Leave the key empty to sign in with your account after adding.</Typography>
                                        <Container layout="flex" justify="end" padding="none" width="100%">
                                            <Button size="sm" color="primary" disabled={adding === 'remote' || !remote.name.trim() || !/^https:\/\/\S+$/.test(remote.address.trim())} onClick={addRemote}>
                                                <Icon name="FiPlus" size="xs" />{adding === 'remote' ? 'Adding…' : 'Add'}
                                            </Button>
                                        </Container>
                                    </Card>
                                </Container>

                                <Container layout="flex-column" gap="sm" padding="none" width="100%" minWidth="0">
                                    <Heading icon="FiMonitor" title="Local tools" />
                                    <Typography size="xxs" color="muted">Apps on your own computer. Mollama reaches them through the Mollama desktop app on that computer, so it has to be on, with the desktop app open.</Typography>
                                    {locals.map((server) => <ServerCard key={server.id} server={server} computer={computerName(server.device)} busy={Boolean(busy[server.id])} {...cardProps} />)}
                                    <Card layout="flex-column" gap="sm" padding="md" width="100%" hover={false}>
                                        <Typography size="sm" weight="semibold">Add an app on this computer</Typography>
                                        {localBridge && here ? (
                                            <>
                                                <Input size="sm" label="Name" value={local.name} onChange={(e) => setLocal((form) => ({ ...form, name: e.target.value }))} placeholder="Blender" width="100%" />
                                                <Input size="sm" label="Program that starts its tool server" value={local.command} onChange={(e) => setLocal((form) => ({ ...form, command: e.target.value }))} placeholder="uvx" width="100%" />
                                                <Input size="sm" label="What to pass to it" value={local.args} onChange={(e) => setLocal((form) => ({ ...form, args: e.target.value }))} placeholder="blender-mcp" width="100%" />
                                                <Typography size="xxs" color="muted">Both come from the app&apos;s MCP setup instructions. They are kept on this computer only and run nowhere else.</Typography>
                                                <Container layout="flex" justify="end" padding="none" width="100%">
                                                    <Button size="sm" color="primary" disabled={adding === 'local' || !local.name.trim() || !local.command.trim()} onClick={addLocal}>
                                                        <Icon name="FiPlus" size="xs" />{adding === 'local' ? 'Adding…' : 'Add'}
                                                    </Button>
                                                </Container>
                                            </>
                                        ) : (
                                            <Typography size="xs" color="muted">
                                                {window.desktop
                                                    ? (localBridge ? 'Sign in on this computer first, so it is linked to your account.' : 'This version of the Mollama desktop app cannot run local tools yet. Update it, then open this page again.')
                                                    : 'A local app is added from the Mollama desktop app on the computer it is installed on. Open this page there.'}
                                            </Typography>
                                        )}
                                    </Card>
                                </Container>
                            </Container>
                        )}
                    </Container>
                </Container>
            </Container>
        </Page>
    );
};

export default ToolsPage;
