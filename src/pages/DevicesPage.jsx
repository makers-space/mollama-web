import React, { useCallback, useEffect, useState } from 'react';
import { Page, Container, Card, Typography, Button, ButtonGroup, Badge, Icon, Input } from '@components/Components';
import { useNotification } from '@contexts/NotificationContext';
import { deviceService, desktopService, describeError, formatGb, useGuide } from '../client/ai.client';

const ADD_STEPS = [
    'Download the Mollama desktop app on the computer you want to add.',
    'Install it, open it and sign in with this account.',
    'The computer appears on this page by itself, and its models can be used from any of your Mollama apps.'
];

const Tile = ({ icon, label, value, note }) => (
    <Card layout="flex" align="center" gap="sm" padding="sm" hover={false} shadow={false} wrap={false} width="100%" minWidth="0">
        <Icon name={icon} size="sm" color="primary" />
        <Container layout="flex-column" gap="none" padding="none" minWidth="0">
            <Typography size="xxs" color="muted">{label}</Typography>
            <Typography size="sm" weight="semibold" truncate title={String(value)}>{value}</Typography>
            {note && <Typography size="xxs" color="muted">{note}</Typography>}
        </Container>
    </Card>
);

const Heading = ({ icon, title, children }) => (
    <Container layout="flex" justify="between" align="center" gap="sm" padding="none" width="100%" wrap={false}>
        <Container layout="flex" align="center" gap="xs" padding="none" wrap={false} minWidth="0">
            <Icon name={icon} size="xs" color="primary" />
            <Typography as="h2" size="sm" weight="semibold" truncate>{title}</Typography>
        </Container>
        {children}
    </Container>
);

const toGbText = (megabytes) => (megabytes ? String(Math.round(megabytes / 1024)) : '');
export const DesktopDownloads = () => {
    const [published, setPublished] = useState(null);
    const channels = desktopService.channels();

    useEffect(() => {
        let live = true;
        desktopService.published().then((release) => { if (live) setPublished(release); });
        return () => { live = false; };
    }, []);

    const ready = (file) => published === null || published.files.includes(file);

    return (
        <Container layout="flex-column" gap="sm" padding="none" width="100%">
            {channels.map((channel) => (
                <Container key={channel.id} layout="flex-column" gap="xs" padding="none" width="100%">
                    {channels.length > 1 && (
                        <Container layout="flex" align="center" gap="xs" padding="none">
                            <Typography size="xs" weight="semibold" margin="none">{channel.title}</Typography>
                            <Badge size="xs" color={channel.id === 'staging' ? 'warning' : 'success'}>{channel.opens}</Badge>
                        </Container>
                    )}
                    <ButtonGroup size="sm" justify="start" selectable={false}>
                        {desktopService.systems.map((system) => {
                            const file = `${channel.name}${system.ending}`;
                            return (
                                <Button key={system.id} size="sm" color={channel.id === 'staging' ? 'secondary' : 'primary'} height="auto" disabled={!ready(file)} onClick={() => window.open(desktopService.address(file), '_blank', 'noopener')}>
                                    <Container layout="flex-column" align="center" gap="none" padding="none">
                                        <Container layout="flex" align="center" gap="xs" padding="none" wrap={false}>
                                            <Icon name={system.icon} size="xs" />
                                            <Typography size="xs" weight="semibold" color="inherit" margin="none">{system.label}</Typography>
                                        </Container>
                                        <Typography size="xxs" color="inherit" margin="none">
                                            {!ready(file) ? 'Not available yet' : published?.version ? `Version ${published.version}` : 'Download'}
                                        </Typography>
                                    </Container>
                                </Button>
                            );
                        })}
                    </ButtonGroup>
                </Container>
            ))}
        </Container>
    );
};

const toMb = (gbText) => (gbText === '' ? null : Math.round(Number(gbText) * 1024));

const DeviceCard = ({ device, canManage, onChanged, onRemove, here, onSetUp }) => {
    const { success, error: notifyError } = useNotification();
    const [editing, setEditing] = useState(false);
    const [busy, setBusy] = useState(false);
    const [form, setForm] = useState({ name: '', memoryGb: '', gpuName: '', gpuMemoryGb: '' });

    const { hardware, ollama } = device;
    const guide = useGuide();

    const startEditing = () => {
        setForm({
            name: device.name,
            memoryGb: toGbText(hardware.memoryMb),
            gpuName: hardware.gpuName || '',
            gpuMemoryGb: hardware.hasGpu ? toGbText(hardware.gpuMemoryMb) : '0'
        });
        setEditing(true);
    };

    const run = async (action, doneMessage) => {
        setBusy(true);
        try {
            const result = await action();
            onChanged(result.device);
            success(doneMessage);
            setEditing(false);
        } catch (error) {
            notifyError(describeError(error));
        } finally {
            setBusy(false);
        }
    };

    const save = () => {
        const numbers = [form.memoryGb, form.gpuMemoryGb];
        if (numbers.some((value) => value !== '' && (!Number.isFinite(Number(value)) || Number(value) < 0))) {
            notifyError('Memory must be a number of gigabytes, for example 32.');
            return;
        }
        run(() => deviceService.updateDevice(device.id, {
            name: form.name.trim() || device.name,
            overrides: {
                memoryMb: toMb(form.memoryGb),
                gpuName: form.gpuName.trim(),
                gpuMemoryMb: toMb(form.gpuMemoryGb)
            }
        }), 'Device details saved.');
    };

    const useDetected = () => run(() => deviceService.updateDevice(device.id, {
        overrides: { memoryMb: null, gpuName: '', gpuMemoryMb: null }
    }), 'Back to the details read from this computer.');

    const readAgain = () => run(() => deviceService.detectDevice(device.id), 'This computer was read again.');

    const change = (field) => (event) => setForm((current) => ({ ...current, [field]: event.target.value }));

    return (
        <Card layout="flex-column" gap="sm" padding="md" width="100%" hover={false} span="full">
            <Heading icon="FiMonitor" title={device.name}>
                <Container layout="flex" gap="xs" padding="none" align="center" justify="end">
                    <Badge size="xs" color={device.online ? 'success' : 'default'}>{device.online ? 'Online' : 'Offline'}</Badge>
                    {device.online && (
                        <Badge size="xs" color={ollama.available ? 'success' : 'error'}>
                            {ollama.available ? `Ollama ${ollama.version}` : 'Ollama is not running'}
                        </Badge>
                    )}
                    {here && device.online && !ollama.available && <Button size="xs" color="secondary" onClick={onSetUp}>Set up Ollama</Button>}
                    {device.kind !== 'local' && !device.online && <Button size="xs" color="error" onClick={() => onRemove(device)}>Remove</Button>}
                    {device.edited && <Badge size="xs" color="warning">Corrected by hand</Badge>}
                </Container>
            </Heading>
            <Typography size="xxs" color="muted">
                {device.kind === 'local' ? 'The computer Mollama is running on.' : 'Linked through the Mollama desktop app.'}
                {!device.online && ' Open the Mollama desktop app on it to bring it online, or remove it if that computer is no longer yours to use.'}
                {device.online && !ollama.available && (here ? ' Ollama is not running here. Set up Ollama installs it if needed and starts it.' : ' Start Ollama on that computer, or open Mollama on it and choose Set up Ollama.')}
            </Typography>

            {!editing && (
                <Container layout="grid" columns="auto-sm" gap="sm" padding="none" width="100%">
                    <Tile
                        icon="FiZap"
                        label={hardware.gpuShared ? 'Graphics' : 'Graphics card'}
                        value={!hardware.hasGpu ? 'None found' : hardware.gpuShared ? 'Built in' : (hardware.gpuName || 'Graphics card')}
                        note={!hardware.hasGpu
                            ? 'Models run on the processor, which is slower'
                            : hardware.gpuShared
                                ? `Shares the ${formatGb(hardware.memoryMb)} of system memory. About ${formatGb(hardware.gpuMemoryMb)} of it can hold a model (an estimate).`
                                : `${formatGb(hardware.gpuMemoryMb)} of graphics memory`}
                    />
                    <Tile icon="FiLayers" label="System memory" value={formatGb(hardware.memoryMb)} />
                    <Tile
                        icon="FiHardDrive"
                        label="Free disk for models"
                        value={hardware.diskFreeMb === null ? 'Unknown' : `${formatGb(hardware.diskFreeMb)} free`}
                        note={hardware.diskTotalMb ? `of ${formatGb(hardware.diskTotalMb)}` : null}
                    />
                    <Tile
                        icon="FiCpu"
                        label="Processor"
                        value={hardware.cpu || 'Unknown'}
                        note={hardware.cpuThreads ? `${hardware.cpuThreads} threads` : null}
                    />
                    <Tile
                        icon="FiBox"
                        label="Models installed"
                        value={ollama.available ? String(ollama.modelCount) : 'Unknown'}
                        note={ollama.available && ollama.modelCount === 0 ? 'None yet' : null}
                    />
                </Container>
            )}

            {editing && (
                <Container layout="flex-column" gap="sm" padding="none" width="100%">
                    <Typography size="xs" color="muted">
                        Change these only if what Mollama reads is wrong. Leave a box empty to use what it reads.
                    </Typography>
                    <Container layout="grid" columns="auto-sm" gap="sm" padding="none" width="100%">
                        <Input size="sm" label="Device name" value={form.name} onChange={change('name')} width="100%" />
                        <Input size="sm" label="System memory (GB)" value={form.memoryGb} onChange={change('memoryGb')} width="100%" />
                        <Input size="sm" label="Graphics card name" value={form.gpuName} onChange={change('gpuName')} width="100%" />
                        <Input size="sm" label="Graphics memory (GB)" value={form.gpuMemoryGb} onChange={change('gpuMemoryGb')} width="100%" />
                    </Container>
                    <Container layout="flex" gap="xs" padding="none">
                        <Button size="sm" onClick={save} disabled={busy}>Save</Button>
                        <Button size="sm" color="secondary" onClick={() => setEditing(false)} disabled={busy}>Cancel</Button>
                        {device.edited && (
                            <Button size="sm" color="secondary" onClick={useDetected} disabled={busy}>Use what Mollama reads</Button>
                        )}
                    </Container>
                </Container>
            )}

            {canManage && !editing && (
                <Container layout="flex" gap="xs" padding="none">
                    <Button size="xs" onClick={readAgain} disabled={busy} {...guide.tip('devices.read')}>
                        <Icon name="FiRefreshCw" size="xs" />{busy ? 'Reading…' : 'Read this computer again'}
                    </Button>
                    <Button size="xs" color="secondary" onClick={startEditing} disabled={busy} {...guide.tip('devices.correct')}>
                        <Icon name="FiEdit2" size="xs" />Correct these details
                    </Button>
                </Container>
            )}
        </Card>
    );
};

const DevicesPage = () => {
    const { error: notifyError, success, confirm } = useNotification();
    const [devices, setDevices] = useState(null);
    const [here, setHere] = useState(null);
    const [canManage, setCanManage] = useState(false);
    const [failed, setFailed] = useState(false);

    const load = useCallback(async () => {
        try {
            const result = await deviceService.listDevices();
            setDevices(result.devices);
            setCanManage(Boolean(result.permissions?.manage));
            setFailed(false);
        } catch (error) {
            setFailed(true);
            notifyError(describeError(error, 'Your devices could not be loaded.'));
        }
    }, [notifyError]);

    useEffect(() => {
        load();
        window.addEventListener('ollama-availability-changed', load);
        return () => window.removeEventListener('ollama-availability-changed', load);
    }, [load]);

    const removeDevice = async (device) => {
        if (!(await confirm(`Remove ${device.name} from your account? It comes back if someone signs in to Mollama on it again.`))) return;
        try {
            await deviceService.removeDevice(device.id);
            if (deviceService.chosen() === device.id) deviceService.choose('');
            success(`${device.name} was removed.`);
            load();
        } catch (error) {
            notifyError(describeError(error, 'The device could not be removed.'));
        }
    };

    useEffect(() => {
        window.desktop?.deviceState?.().then((state) => setHere(state?.deviceId || null));
    }, [devices]);

    const setUpOllama = async () => {
        success('Setting up Ollama on this computer. Answer the question Mollama asks, then wait for it to finish.');
        const result = await window.desktop.setUpOllama();
        if (result === 'running') success('Ollama is running on this computer.');
        else if (result === 'failed') notifyError('Ollama could not be set up. Install it from ollama.com, then try again.');
        load();
    };

    const replaceDevice = (updated) => {
        setDevices((current) => current.map((device) => (device.id === updated.id ? updated : device)));
        window.dispatchEvent(new CustomEvent('ollama-status-changed'));
    };

    return (
        <Page layout="flex-column" padding="none" gap="none" background="dots" backgroundFade="bottom">
            <Container layout="flex-column" align="center" gap="none" padding="none" width="100%" height="100vh" wrap={false} overflow="hidden">
            <Container layout="flex-column" gap="md" padding="lg" width="100%" maxWidth="1360px" wrap={false}>
                <Container layout="flex-column" gap="none" padding="none">
                    <Typography as="h1" size="2xl" weight="bold" animation="blur" animationDuration={600}>Devices</Typography>
                    <Typography size="xs" color="muted">
                        The computers that run your AI models. Mollama reads each one so it can tell you which models fit.
                        {devices && !canManage && " Only an admin or owner can correct a device's details."}
                    </Typography>
                </Container>

            </Container>
            <Container layout="flex" justify="center" padding="none" width="100%" flexFill minHeight="0" overflow="auto">
            <Container layout="flex-column" gap="md" padding="lg" width="100%" maxWidth="1360px" wrap={false}>
                {devices === null && !failed && <Typography size="xs" color="muted">Reading this computer…</Typography>}

                {failed && (
                    <Card padding="md" width="100%" hover={false}>
                        <Container layout="flex" align="center" justify="between" gap="sm" padding="none" width="100%" wrap={false}>
                            <Typography size="sm" weight="semibold">Your devices could not be loaded.</Typography>
                            <Button size="sm" onClick={load}>Try again</Button>
                        </Container>
                    </Card>
                )}

                {devices?.length === 0 && (
                    <Card layout="flex-column" gap="xs" padding="md" width="100%" hover={false}>
                        <Typography size="sm" weight="semibold">No device is connected to your account yet.</Typography>
                        <Typography size="xs" color="muted">
                            Install the Mollama desktop app on a computer and sign in. That computer appears here by itself, and its models can then be used from any of your Mollama apps.
                        </Typography>
                    </Card>
                )}

                <Container layout="grid" columns={2} gap="sm" padding="none" width="100%">
                    {devices?.map((device) => (
                        <DeviceCard key={device.id} device={device} canManage={canManage} onChanged={replaceDevice} onRemove={removeDevice} here={device.id === here} onSetUp={setUpOllama} />
                    ))}


                    <Card layout="flex-column" gap="sm" padding="md" width="100%" minWidth="0" hover={false} background="hex" backgroundFade="left">
                        <Heading icon="FiPlusCircle" title={devices?.length ? 'Add another device' : 'Add a device'} />
                        <Container layout="flex-column" gap="xs" padding="none" width="100%">
                            {ADD_STEPS.map((step, index) => (
                                <Container key={step} layout="flex" align="start" gap="xs" padding="none" wrap={false}>
                                    <Badge size="xs" color="primary">{index + 1}</Badge>
                                    <Typography size="xs" color="muted">{step}</Typography>
                                </Container>
                            ))}
                        </Container>
                        <DesktopDownloads />
                    </Card>
                </Container>
            </Container>
            </Container>
            </Container>
        </Page>
    );
};

export default DevicesPage;
