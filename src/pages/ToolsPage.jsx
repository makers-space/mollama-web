import React, { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Page, Container, Card, Typography, Button, ButtonGroup, Badge, Icon, Input } from '@components/Components';
import { useNotification } from '@contexts/NotificationContext';
import { toolService, deviceService, describeError } from '../client/ai.client';

const STALE_MS = 60 * 1000;
// Each listed app's own logo, where the icon sets have one. The few without one get a plain icon for what they do.
const APP_ICONS = {
    Notion: 'SiNotion', Atlassian: 'SiAtlassian', Airtable: 'SiAirtable', Coda: 'SiCoda', Linear: 'SiLinear', ClickUp: 'SiClickup', Trello: 'SiTrello', Todoist: 'SiTodoist',
    'monday.com': 'TbBrandMonday', GitHub: 'SiGithub', GitLab: 'SiGitlab', Sentry: 'SiSentry', Netlify: 'SiNetlify', Cloudflare: 'SiCloudflare', 'Cloudflare Docs': 'SiCloudflare',
    Supabase: 'SiSupabase', Neon: 'SiNeon', PostHog: 'SiPosthog', Context7: 'SiUpstash', Miro: 'SiMiro', Webflow: 'SiWebflow', Wix: 'SiWix', 'WordPress.com': 'SiWordpress',
    Calendly: 'SiCalendly', Stripe: 'SiStripe', 'Hugging Face': 'SiHuggingface', Zapier: 'SiZapier', Make: 'SiMake',
    DeepWiki: 'FiBookOpen', Exa: 'FiSearch', Firecrawl: 'FiSearch', Tavily: 'FiSearch',
    Blender: 'SiBlender', 'Chrome DevTools': 'SiGooglechrome', Playwright: 'FiMousePointer', Docker: 'SiDocker', Xcode: 'SiXcode', Godot: 'SiGodotengine', FreeCAD: 'SiFreecad',
    'Ableton Live': 'FiMusic', 'Files on this computer': 'FiFolder', 'Excel files': 'FiGrid', Git: 'SiGit', 'Fetch a web page': 'FiDownloadCloud', Memory: 'FiDatabase',
    'Date and time': 'FiClock', 'Step-by-step thinking': 'FiList'
};
const MADE_BY = { maker: 'Made by the app\'s own maker', standard: 'Made by the group behind the tool-server standard', community: 'Made by the community' };
const HEALTH_COLORS = { healthy: 'success', unchecked: 'default', signin: 'warning', empty: 'warning', busy: 'warning', offline: 'default' };

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

const Section = ({ title, note, children }) => (
    <Container layout="flex" justify="between" align="center" gap="sm" padding="none" width="100%" wrap={false}>
        <Container layout="flex-column" gap="none" padding="none" minWidth="0">
            <Typography as="h2" size="sm" weight="semibold">{title}</Typography>
            {note && <Typography size="xxs" color="muted">{note}</Typography>}
        </Container>
        {children}
    </Container>
);

const ServerCard = ({ server, icon, where, busy, onCheck, onSignIn, onRemove }) => {
    const [showTools, setShowTools] = useState(false);
    const { health } = server;
    const ready = health.state === 'healthy';
    const canSignIn = server.kind === 'remote' && ['signin', 'refused'].includes(health.state);

    return (
        <Card layout="flex-column" gap="xs" padding="sm" width="100%" minWidth="0" hover={false}>
            <Container layout="flex" align="center" justify="between" gap="xs" padding="none" width="100%" wrap={false}>
                <Container layout="flex" align="center" gap="xs" padding="none" wrap={false} minWidth="0">
                    <Icon name={icon} size="sm" color="primary" />
                    <Typography size="sm" weight="semibold" truncate>{server.name}</Typography>
                </Container>
                <Badge size="xs" color={HEALTH_COLORS[health.state] || 'error'}>{health.label}</Badge>
            </Container>
            <Typography size="xxs" color="muted" truncate title={where}>{where}</Typography>

            {!ready && health.needs.map((need) => <Typography key={need} size="xxs">{need}</Typography>)}
            {!ready && health.detail && <Typography size="xxs" color="muted">Reported: {health.detail}</Typography>}

            <Container layout="flex" align="center" justify="between" gap="xs" padding="none" width="100%" wrap={false}>
                {server.tools.length > 0 ? (
                    <Button size="xxs" color="secondary" flat onClick={() => setShowTools((shown) => !shown)}>
                        <Icon name={showTools ? 'FiChevronDown' : 'FiChevronRight'} size="xs" />
                        {server.tools.length === 1 ? '1 tool' : `${server.tools.length} tools`}
                    </Button>
                ) : <Icon name="MdLinkOff" size="xs" color="error" title="No tools yet" aria-label="No tools yet" />}
                <Container layout="flex" align="center" gap="xs" padding="none" wrap={false}>
                    {canSignIn && <Button size="xxs" color="primary" disabled={busy} title="Opens the app's sign-in page in a new tab" onClick={() => onSignIn(server)}><Icon name="FiLogIn" size="xs" />Sign in</Button>}
                    <Button size="xxs" color="secondary" disabled={busy} onClick={() => onCheck(server)}><Icon name="FiRefreshCw" size="xs" />{busy ? 'Checking…' : 'Check'}</Button>
                    <Button size="xxs" color="error" disabled={busy} onClick={() => onRemove(server)}><Icon name="FiTrash2" size="xs" />Remove</Button>
                </Container>
            </Container>

            {showTools && server.tools.map((tool) => (
                <Container key={tool.name} layout="flex" align="center" justify="between" gap="xs" padding="none" width="100%" wrap={false}>
                    <Typography size="xxs" truncate title={tool.description || tool.name}>{tool.title || tool.name}</Typography>
                    <Icon name={tool.readOnly ? 'FiEye' : 'FiEdit3'} size="xs" color={tool.readOnly ? 'muted' : 'warning'} title={tool.readOnly ? 'Only reads' : 'Can change things'} aria-label={tool.readOnly ? 'Only reads' : 'Can change things'} />
                </Container>
            ))}
        </Card>
    );
};

const ToolsPage = () => {
    const { success, error: showError, confirm } = useNotification();
    const [params, setParams] = useSearchParams();
    const [view, setView] = useState(params.get('view') === 'local' ? 'local' : 'remote');
    const [servers, setServers] = useState(null);
    const [devices, setDevices] = useState([]);
    const [apps, setApps] = useState([]);
    const [failed, setFailed] = useState(false);
    const [busy, setBusy] = useState({});
    const [here, setHere] = useState(null);
    const [remote, setRemote] = useState({ name: '', address: '', key: '' });
    const [local, setLocal] = useState({ name: '', command: '', args: '' });
    const [adding, setAdding] = useState(null);
    const [find, setFind] = useState('');
    const [keyHelp, setKeyHelp] = useState(null);
    const [localApps, setLocalApps] = useState([]);
    const [localHelp, setLocalHelp] = useState(null);
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
            const listed = await toolService.list();
            setServers(listed.servers);
            listed.servers
                .filter((server) => !server.health.checkedAt || Date.now() - new Date(server.health.checkedAt).getTime() > STALE_MS)
                .forEach(check);
        } catch {
            setFailed(true);
        }
    }, [check]);

    useEffect(() => {
        load();
        toolService.catalogue().then((catalogue) => { setApps(catalogue.apps || []); setLocalApps(catalogue.localApps || []); }).catch(() => undefined);
        deviceService.listDevices().then((computers) => setDevices(computers.devices || [])).catch(() => undefined);
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
            setKeyHelp(null);
        } catch (error) {
            showError(describeError(error, 'This app could not be added. Check that the address starts with https.'));
        }
        setAdding(null);
    };

    // One step for a listed app: add it, then go straight to its sign-in page when it asks for an account.
    const addApp = async (entry) => {
        if (entry.keyNeeded) {
            setKeyHelp(entry);
            return setRemote({ name: entry.name, address: entry.address, key: '' });
        }
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
            setLocalHelp(null);
        } catch (error) {
            showError(describeError(error, 'This tool server could not be added on this computer.'));
        }
        setAdding(null);
    };

    const pick = (next) => {
        setView(next);
        setParams(next === 'local' ? { view: 'local' } : {}, { replace: true });
    };
    const computerName = (id) => devices.find((device) => device.id === id)?.name || 'a computer that is no longer linked';
    const remotes = (servers || []).filter((server) => server.kind === 'remote');
    const locals = (servers || []).filter((server) => server.kind === 'local');
    const cardProps = { onCheck: check, onSignIn: signIn, onRemove: remove };
    const listed = new Map(apps.map((entry) => [entry.address, entry]));
    const added = new Set(remotes.map((server) => server.address));
    const words = find.trim().toLowerCase();
    const shownApps = apps.filter((entry) => !added.has(entry.address) && (!words || `${entry.name} ${entry.group} ${entry.does}`.toLowerCase().includes(words)));
    const showKeyHelp = keyHelp?.key && keyHelp.address === remote.address.trim();

    return (
        <Page layout="flex-column" padding="none" gap="none" background="dots" backgroundFade="bottom">
            <Container layout="flex-column" align="center" gap="none" padding="none" width="100%" height="100vh" wrap={false} overflow="hidden">
                <Container layout="flex" justify="between" align="center" gap="md" padding="lg" width="100%" maxWidth="1360px" wrap={false}>
                    <Container layout="flex-column" gap="none" padding="none" minWidth="0">
                        <Typography as="h1" size="2xl" weight="bold" animation="blur" animationDuration={600}>Tools</Typography>
                        <Typography size="xs" color="muted">
                            {view === 'remote'
                                ? 'Apps that live online. Mollama connects to them from its own server, so they work from any of your devices at any time.'
                                : 'Apps on your own computer. Mollama reaches them through the Mollama desktop app there, so that computer has to be on with the desktop app open.'}
                        </Typography>
                    </Container>
                    <ButtonGroup size="sm" selectable={false} wrap={false} justify="end">
                        <Button size="sm" color={view === 'remote' ? 'primary' : 'secondary'} selected={view === 'remote'} onClick={() => pick('remote')}><Icon name="FiGlobe" size="xs" />Remote{remotes.length > 0 ? ` (${remotes.length})` : ''}</Button>
                        <Button size="sm" color={view === 'local' ? 'primary' : 'secondary'} selected={view === 'local'} onClick={() => pick('local')}><Icon name="FiMonitor" size="xs" />Local{locals.length > 0 ? ` (${locals.length})` : ''}</Button>
                    </ButtonGroup>
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

                        {servers && view === 'remote' && (
                            <Container layout="flex-column" gap="md" padding="none" width="100%">
                            <Container layout="flex" align="start" gap="lg" padding="none" width="100%" wrap={false}>
                                <Container layout="flex-column" gap="md" padding="none" flexFill minWidth="0">
                                {apps.length > 0 && (
                                    <>
                                        <Section title="Apps ready to add" note="Each one is the maker's own tool server. Add it, then sign in to it.">
                                            <Container padding="none" width="220px">
                                                <Input size="xs" value={find} onChange={(e) => setFind(e.target.value)} placeholder="Find an app" width="100%" />
                                            </Container>
                                        </Section>
                                        {shownApps.length === 0 && <Typography size="xs" color="muted">{words ? 'No listed app matches. It can still be added by its address below.' : 'Every listed app is added.'}</Typography>}
                                        <Container layout="grid" columns={3} gap="sm" padding="none" width="100%">
                                            {shownApps.map((entry) => (
                                                <Card key={entry.address} layout="flex-column" gap="xs" padding="md" width="100%" minWidth="0" hover={false} shadow={false}>
                                                    <Container layout="flex" align="center" justify="between" gap="sm" padding="none" width="100%" wrap={false}>
                                                        <Container layout="flex" align="center" gap="sm" padding="none" wrap={false} minWidth="0">
                                                            <Icon name={APP_ICONS[entry.name] || 'FiGlobe'} size="md" color="primary" />
                                                            <Typography size="sm" weight="semibold" truncate>{entry.name}</Typography>
                                                        </Container>
                                                        <Button size="xs" color="primary" disabled={adding === entry.address} onClick={() => addApp(entry)}>
                                                            <Icon name={entry.keyNeeded ? 'FiKey' : 'FiPlus'} size="xs" />{adding === entry.address ? 'Adding…' : entry.keyNeeded ? 'Add with a key' : 'Add'}
                                                        </Button>
                                                    </Container>
                                                    <Typography size="xs">{entry.does}.</Typography>
                                                </Card>
                                            ))}
                                        </Container>
                                    </>
                                )}

                                </Container>
                                <Divider orientation="vertical" />
                                <Container layout="flex-column" gap="sm" padding="none" width="340px" minWidth="340px">
                                    <Section title="Connected" note="What your models can use. Anything not ready says what it needs." />
                                    {remotes.length === 0 && <Typography size="xs" color="muted">Nothing connected yet.</Typography>}
                                    {remotes.map((server) => <ServerCard key={server.id} server={server} icon={APP_ICONS[listed.get(server.address)?.name] || 'FiGlobe'} where={server.address} busy={Boolean(busy[server.id])} {...cardProps} />)}
                                </Container>
                            </Container>
                            <Section title="Add another app by its address" note="The MCP address from the app's own help pages. Leave the key empty to sign in with your account after adding." />
                            <Card layout="flex-column" gap="sm" padding="sm" width="100%" hover={false}>
                                <Container layout="grid" columns={3} gap="sm" padding="none" width="100%">
                                    <Input size="sm" label="Name" value={remote.name} onChange={(e) => setRemote((form) => ({ ...form, name: e.target.value }))} placeholder="Notion" width="100%" />
                                    <Input size="sm" label="Tool server address" value={remote.address} onChange={(e) => setRemote((form) => ({ ...form, address: e.target.value }))} placeholder="https://…" width="100%" />
                                    <Input size="sm" label="Key (only if the app gave you one)" type="password" value={remote.key} onChange={(e) => setRemote((form) => ({ ...form, key: e.target.value }))} width="100%" />
                                </Container>
                                {showKeyHelp && (
                                    <Container layout="flex-column" gap="xs" padding="none" width="100%">
                                        <Container layout="flex" align="center" gap="sm" padding="none" wrap={false}>
                                            <Typography size="xs" weight="semibold">Getting a key for {keyHelp.name}</Typography>
                                            <Typography size="xxs" color="muted">{keyHelp.key.cost}</Typography>
                                            <Button size="xxs" color="secondary" title="Opens in a new tab" onClick={() => window.open(keyHelp.key.page, '_blank', 'noopener')}>
                                                <Icon name="FiExternalLink" size="xs" />Open the key page
                                            </Button>
                                        </Container>
                                        {keyHelp.key.steps.map((step, index) => <Typography key={step} size="xs">{index + 1}. {step}</Typography>)}
                                        <Typography size="xxs" color="muted">The key is stored sealed on Mollama&apos;s server and is never shown again or sent to a model.</Typography>
                                    </Container>
                                )}
                                <Container layout="flex" justify="end" padding="none" width="100%">
                                    <Button size="sm" color="primary" disabled={adding === 'remote' || !remote.name.trim() || !/^https:\/\/\S+$/.test(remote.address.trim())} onClick={addRemote}>
                                        <Icon name="FiPlus" size="xs" />{adding === 'remote' ? 'Adding…' : 'Add'}
                                    </Button>
                                </Container>
                            </Card>
                            </Container>
                        )}

                        {servers && view === 'local' && (
                            <Container layout="flex-column" gap="md" padding="none" width="100%">
                            <Container layout="flex" align="start" gap="lg" padding="none" width="100%" wrap={false}>
                                <Container layout="flex-column" gap="md" padding="none" flexFill minWidth="0">
                                {localApps.length > 0 && (
                                    <>
                                        <Section title="Apps you can set up" note="Tool servers that run on your own computer. Choosing one shows what it needs and fills in the form below; nothing runs until you add it." />
                                        <Container layout="grid" columns={3} gap="sm" padding="none" width="100%">
                                            {localApps.map((entry) => (
                                                <Card key={entry.name} layout="flex-column" gap="xs" padding="md" width="100%" minWidth="0" hover={false} shadow={false}>
                                                    <Container layout="flex" align="center" justify="between" gap="sm" padding="none" width="100%" wrap={false}>
                                                        <Container layout="flex" align="center" gap="sm" padding="none" wrap={false} minWidth="0">
                                                            <Icon name={APP_ICONS[entry.name] || 'FiMonitor'} size="md" color="primary" />
                                                            <Typography size="sm" weight="semibold" truncate>{entry.name}</Typography>
                                                        </Container>
                                                        <Button size="xs" color={localHelp?.name === entry.name ? 'secondary' : 'primary'} onClick={() => { setLocalHelp(entry); setLocal({ name: entry.name, command: entry.command, args: entry.args }); }}>
                                                            <Icon name="FiArrowDown" size="xs" />Set up
                                                        </Button>
                                                    </Container>
                                                    <Typography size="xs">{entry.does}.</Typography>
                                                    {entry.only && <Typography size="xxs" color="muted">{entry.only} only</Typography>}
                                                </Card>
                                            ))}
                                        </Container>
                                    </>
                                )}

                                </Container>
                                <Divider orientation="vertical" />
                                <Container layout="flex-column" gap="sm" padding="none" width="340px" minWidth="340px">
                                    <Section title="Connected" note="Tool servers on your computers. Anything not ready says what it needs." />
                                    {locals.length === 0 && <Typography size="xs" color="muted">Nothing connected yet.</Typography>}
                                    {locals.map((server) => <ServerCard key={server.id} server={server} icon="FiMonitor" where={`On ${computerName(server.device)}`} busy={Boolean(busy[server.id])} {...cardProps} />)}
                                </Container>
                            </Container>
                            <Section title="Add an app on this computer" note="The program and what to pass to it come from the app's MCP setup instructions. They are kept on this computer only." />
                            {localHelp && (
                                <Card layout="flex-column" gap="xs" padding="sm" width="100%" hover={false}>
                                    <Container layout="flex" align="center" gap="sm" padding="none" wrap={false}>
                                        <Icon name={APP_ICONS[localHelp.name] || 'FiMonitor'} size="sm" color="primary" />
                                        <Typography size="sm" weight="semibold">Before adding {localHelp.name}</Typography>
                                        <Typography size="xxs" color="muted">{MADE_BY[localHelp.by]}</Typography>
                                    </Container>
                                    {localHelp.needs.map((need, index) => <Typography key={need} size="xs">{index + 1}. {need}</Typography>)}
                                    <Typography size="xs">It will run this on your computer: <Typography as="span" size="xs" font="monospace">{localHelp.command} {localHelp.args}</Typography></Typography>
                                    {localHelp.caution && (
                                        <Container layout="flex" align="center" gap="xs" padding="none" wrap={false}>
                                            <Icon name="FiAlertTriangle" size="xs" color="warning" />
                                            <Typography size="xs">{localHelp.caution}</Typography>
                                        </Container>
                                    )}
                                </Card>
                            )}
                            <Card layout="flex-column" gap="sm" padding="sm" width="100%" hover={false}>
                                {localBridge && here ? (
                                    <>
                                        <Container layout="grid" columns={3} gap="sm" padding="none" width="100%">
                                            <Input size="sm" label="Name" value={local.name} onChange={(e) => setLocal((form) => ({ ...form, name: e.target.value }))} placeholder="Blender" width="100%" />
                                            <Input size="sm" label="Program that starts its tool server" value={local.command} onChange={(e) => setLocal((form) => ({ ...form, command: e.target.value }))} placeholder="uvx" width="100%" />
                                            <Input size="sm" label="What to pass to it" value={local.args} onChange={(e) => setLocal((form) => ({ ...form, args: e.target.value }))} placeholder="blender-mcp" width="100%" />
                                        </Container>
                                        <Container layout="flex" justify="end" padding="none" width="100%">
                                            <Button size="sm" color="primary" disabled={adding === 'local' || !local.name.trim() || !local.command.trim() || /<[^>]*>/.test(local.args)} onClick={addLocal}>
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
                        )}
                    </Container>
                </Container>
            </Container>
        </Page>
    );
};

export default ToolsPage;
