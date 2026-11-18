import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import 'highlight.js/styles/github-dark.css';
import {
    Page, Container, Card, Typography, Button, ButtonGroup, FloatingActionButton, Badge, Divider, Input, Select, Switch, Icon, Genie,
    ProgressBar, CircularProgress, Data, Flow, TreeView, Image, Video, Audio, PdfViewer, Model3D, Editor
} from '@components/Components';
import { useNotification } from '@contexts/NotificationContext';
import { useAuth } from '@contexts/AuthContext';
import { chatService, deviceService, fileService, modelService, promptService, pickerMemory, describeError, downloadText, useGuide } from '../client/ai.client';
import { appService } from '../client/app.client';

const FIT_COLORS = { gpu: 'secondary', mixed: 'warning', cpu: 'warning', too_large: 'error', cloud: 'primary' };
const FIRST_MESSAGE = 'Explain what you can help me with in three sentences.';
const MAX_ARTICLES = 10;
const READABLE = /\.(txt|md|markdown|csv|tsv|json|jsonl|log|pdf|docx|xml|ya?ml|html?|js|jsx|ts|tsx|py|sql|css)$/i;
const FILE_ICONS = { pdf: 'FiFileText', docx: 'FiFileText', md: 'FiFileText', txt: 'FiFileText', csv: 'FiGrid', tsv: 'FiGrid', json: 'FiSettings', yaml: 'FiSettings', yml: 'FiSettings', png: 'FiImage', jpg: 'FiImage', jpeg: 'FiImage', gif: 'FiImage', mp4: 'FiFilm', mp3: 'FiMusic', js: 'FiCode', py: 'FiCode', html: 'FiCode' };

const formatSize = (bytes) => {
    if (!bytes) return '—';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};
const formatDate = (value) => (value ? new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—');

const textOf = (node) => {
    if (typeof node === 'string') return node;
    if (Array.isArray(node)) return node.map(textOf).join('');
    return node?.props?.children ? textOf(node.props.children) : '';
};

const Row = ({ icon, iconColor = 'primary', label, title, size = 'xs', color = 'default', selected = false, disabled = false, onClick, children }) => (
    <Container
        layout="flex"
        wrap={false}
        align="center"
        gap="xs"
        padding="xs"
        width="100%"
        hoverable={!disabled}
        backgroundColor={selected ? 'primary' : 'transparent'}
        role="button"
        tabIndex={disabled ? -1 : 0}
        title={title || label}
        onClick={disabled ? undefined : onClick}
        onKeyDown={(event) => event.key === 'Enter' && !disabled && onClick?.()}
    >
        {icon && <Icon name={icon} size="xs" color={selected ? 'contrast' : disabled ? 'text' : iconColor} />}
        <Container padding="none" flexFill minWidth="0">
            <Typography size={size} truncate color={selected ? 'contrast' : disabled ? 'muted' : color} weight={selected ? 'semibold' : 'normal'}>
                {label}
            </Typography>
        </Container>
        {children}
    </Container>
);

const Pop = ({ label, icon, open, onOpen, onClose, width = '320px', tall = false, fab = false, iconOnly = false, iconEnd = false, children, ...button }) => {
    const trigger = useRef(null);
    const closedAt = useRef(0);
    const close = useCallback(() => {
        closedAt.current = Date.now();
        onClose();
    }, [onClose]);

    const toggle = () => {
        if (open) close();
        else if (Date.now() - closedAt.current > 250) onOpen();
    };

    return (
        <>
            {fab ? (
                <FloatingActionButton ref={trigger} icon={icon} position="bottom-right" onClick={toggle} {...button} />
            ) : (
                <Button ref={trigger} size="sm" variant="ghost" selected={open} onClick={toggle} title={iconOnly ? label : undefined} aria-label={iconOnly ? label : undefined} {...button}>
                    {icon && !iconEnd && <Icon name={icon} size="xs" />}
                    {!iconOnly && label}
                    {icon && iconEnd && <Icon name={icon} size="xs" />}
                </Button>
            )}
            {createPortal(
                <Genie key={width} visible={open} onClose={close} triggerRef={trigger} variant="popover" width={width} maxWidth="94vw" maxHeight={tall ? '88vh' : '72vh'} padding="xs">
                    {open && (
                        <Container layout="flex-column" wrap={false} gap="xs" padding="xs" width="100%" minHeight={tall ? 'min(520px, 70vh)' : undefined} maxHeight={tall ? '82vh' : '66vh'} overflow="auto">
                            {children}
                        </Container>
                    )}
                </Genie>,
                document.body
            )}
        </>
    );
};

export const CopyButton = ({ text, label = 'Copy' }) => {
    const [copied, setCopied] = useState(false);
    const copy = async () => {
        try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch {
            setCopied(false);
        }
    };
    return (
        <Button size="xxs" variant="ghost" title={copied ? 'Copied' : label} aria-label={label} onClick={copy}>
            <Icon name={copied ? 'FiCheck' : 'FiCopy'} />
        </Button>
    );
};

const CODE_EXTENSIONS = {
    python: 'py', py: 'py', javascript: 'js', js: 'js', jsx: 'jsx', typescript: 'ts', ts: 'ts', tsx: 'tsx', json: 'json', html: 'html', css: 'css',
    bash: 'sh', shell: 'sh', sh: 'sh', powershell: 'ps1', sql: 'sql', java: 'java', c: 'c', cpp: 'cpp', csharp: 'cs', cs: 'cs', go: 'go', rust: 'rs',
    ruby: 'rb', php: 'php', yaml: 'yaml', yml: 'yaml', xml: 'xml', markdown: 'md', md: 'md', swift: 'swift', kotlin: 'kt'
};

const CodeView = ({ code, language }) => {
    const text = String(code ?? '').replace(/\n$/, '');
    const kind = String(language || '').toLowerCase();
    const lines = Math.min(Math.max(text.split('\n').length, 2), 24);
    const height = `${lines * 20 + 24}px`;
    return (
        <Card backgroundColor="surface" bordered={false} shadow={false} hover={false} layout="flex-column" gap="xs" padding="xs" width="100%" marginBottom="sm">
            <Container layout="flex" align="center" justify="between" padding="none" width="100%">
                <Typography size="xxs" color="muted">{kind || 'code'}</Typography>
                <CopyButton text={text} />
            </Container>
            <Editor mode="code" readOnly showToolbar={false} minimap={false} content={text} filePath={`snippet.${CODE_EXTENSIONS[kind] || 'txt'}`} width="100%" height={height} minHeight={height} />
        </Card>
    );
};

const CodeBlock = ({ children }) => {
    const language = String(children?.props?.className || '').match(/language-([\w+-]+)/)?.[1];
    return <CodeView code={textOf(children)} language={language} />;
};

const BlockContext = React.createContext({ send: null, live: false });

const BLOCK_COMPONENTS = {
    Container, Card, Typography, Button, ButtonGroup, FloatingActionButton, Badge, Divider, Icon, ProgressBar, CircularProgress,
    Data, Flow, TreeView, Image, Video, Audio, PdfViewer, Model3D, Editor, Input, Select, Switch
};
const MEDIA = { Image: 'image', Video: 'video', Audio: 'audio', PdfViewer: 'PDF', Model3D: '3D model' };
const isRemote = (value) => /^https?:\/\//i.test(String(value || ''));
const safeLink = (value) => (/^(https?:|mailto:)/i.test(String(value || '')) ? value : null);
const safeSource = (value) => (/^(https?:\/\/|data:(image|audio|video|model|application\/pdf))/i.test(String(value || '')) ? value : null);

const BOX_PROPS = [
    'layout', 'columns', 'gap', 'padding', 'justify', 'align', 'wrap', 'flexFill', 'width', 'height', 'minWidth', 'minHeight', 'maxWidth',
    'backgroundColor', 'background', 'backgroundTone', 'backgroundIntensity', 'backgroundSize', 'backgroundMotion', 'backgroundFade'
];
const BLOCK_SPEC = {
    Container: { children: 'nodes', props: [...BOX_PROPS, 'hoverable'] },
    Card: { children: 'nodes', props: [...BOX_PROPS, 'bordered', 'borderColor', 'borderStrength', 'radius', 'shadow', 'hover'] },
    Divider: { props: ['label', 'color', 'variant', 'size'] },
    Typography: { children: 'text', props: ['size', 'weight', 'color', 'font', 'as', 'href', 'truncate'] },
    Badge: { children: 'text', props: ['color', 'size'] },
    Icon: { props: ['name', 'color', 'size'], required: ['name'] },
    Button: { children: 'text', props: ['color', 'variant', 'size', 'icon', 'send', 'disabled', 'width', 'align', 'flat'] },
    ButtonGroup: { children: 'nodes', props: [] },
    FloatingActionButton: { props: ['icon', 'color', 'size', 'position', 'badge', 'badgeColor', 'draggable', 'send'], required: ['icon'] },
    ProgressBar: { props: ['value', 'max', 'label', 'showPercentage', 'color', 'size', 'striped', 'animated'], required: ['value'] },
    CircularProgress: { props: ['size', 'color'] },
    Data: { props: ['data', 'src', 'variant', 'fields'] },
    Flow: { props: ['nodes', 'edges', 'height'], required: ['nodes'] },
    TreeView: { props: ['items'], required: ['items'] },
    Image: { props: ['src', 'content', 'alt', 'width', 'height'] },
    Video: { props: ['src', 'title'], required: ['src'] },
    Audio: { props: ['src', 'title'], required: ['src'] },
    PdfViewer: { props: ['src'], required: ['src'] },
    Model3D: { props: ['content', 'src', 'format', 'fileName', 'autoRotate', 'height'] },
    Editor: { props: ['content', 'src', 'mode', 'language'] },
    Input: { props: ['label', 'placeholder', 'multiline', 'rows'] },
    Select: { props: ['label', 'placeholder', 'options'] },
    Switch: { props: ['label', 'defaultChecked'] }
};
const NODE_KEYS = ['component', 'props', 'children'];
const FLOW_SHAPES = ['rectangle', 'circle', 'diamond', 'cylinder'];
const FIELD_COMPONENTS = { Badge, Typography, ProgressBar };
const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isText = (value) => typeof value === 'string' || typeof value === 'number';

const checkNode = (node, parent = null) => {

    const name = node.component;
    const spec = BLOCK_SPEC[name];
    if (!spec) return `"${name}" is not a component.`;
    const extra = Object.keys(node).find((key) => !NODE_KEYS.includes(key));
    if (extra) return `${name} has the key "${extra}". Only component, props and children are allowed; everything else belongs inside props.`;
    if (node.props !== undefined && !isObject(node.props)) return `${name}: "props" must be an object.`;
    const props = node.props || {};

    const missing = (spec.required || []).find((prop) => props[prop] === undefined || props[prop] === null || props[prop] === '');
    if (missing && !(name === 'Image' || name === 'Model3D' || name === 'Editor')) return `${name} needs the attribute "${missing}".`;
    const blank = !isText(node.children) || String(node.children).trim() === '';
    if (spec.children === 'text' && blank && !(name === 'Button' && isText(props.icon))) return `${name} has no text. Write it between the tags: <${name}>text</${name}>.`;
    const empty = node.children === undefined || node.children === null || node.children === '' || (Array.isArray(node.children) && node.children.length === 0);
    if (!spec.children && !empty) return `${name} cannot hold other tags.`;

    if (name === 'ProgressBar' && !Number.isFinite(Number(props.value))) return 'ProgressBar: "value" must be a number.';
    if (name === 'FloatingActionButton' && parent !== 'Card') return 'FloatingActionButton must be placed directly inside a Card.';
    if (name === 'Image' && !props.src && !props.content) return 'Image needs "src" or "content".';
    const webSource = isText(props.src) && String(props.src).trim() !== '';
    if (webSource && ['Model3D', 'Editor', 'Data', 'PdfViewer', 'Video', 'Audio'].includes(name) && !isRemote(props.src)) return `${name}: src must be an https address.`;
    const hasContent = typeof props.content === 'string' && props.content.trim() !== '';
    if (name === 'Model3D' && !webSource && !hasContent) return 'Model3D needs src, or the text of an OBJ or STL file between its tags.';
    if (name === 'Model3D' && webSource && !MODEL_FORMATS.includes(String(props.format || extensionOf(props.src)).toLowerCase())) return `Model3D can show these file types: ${MODEL_FORMATS.join(', ')}.`;
    if (name === 'Editor' && !webSource && !hasContent) return 'Editor needs src, or its text between its tags.';
    if (name === 'Data' && !webSource) {
        if (!Array.isArray(props.data) || props.data.length === 0 || !props.data.every(isObject)) return 'Data needs src, or at least one <Row /> inside it.';
        if (props.fields !== undefined && !isObject(props.fields)) return 'Data: "fields" must be an object keyed by column.';
    }
    if (name === 'TreeView') {
        const bad = (items) => !Array.isArray(items) || items.some((item) => !isObject(item) || !isText(item.label) || (item.children !== undefined && bad(item.children)));
        if (bad(props.items)) return 'TreeView needs <Item label="..." /> tags inside it, each with a label.';
    }
    if (name === 'Flow') {
        if (!Array.isArray(props.nodes) || props.nodes.length === 0) return 'Flow needs at least one <Node /> inside it.';
        if (props.nodes.some((item) => !isObject(item) || !isText(item.id) || !isText(item.label))) return 'Flow: every <Node /> needs an id and a label.';
        const ids = new Set(props.nodes.map((item) => String(item.id)));
        if (props.edges !== undefined && !Array.isArray(props.edges)) return 'Flow: "edges" must be a list.';
        const broken = (props.edges || []).find((edge) => !isObject(edge) || !ids.has(String(edge.source)) || !ids.has(String(edge.target)));
        if (broken) return 'Flow: every <Edge /> needs source and target set to the id of a Node.';
    }
    if (name === 'Select' && props.options !== undefined && (!Array.isArray(props.options) || props.options.some((option) => !isObject(option) || !isText(option.label)))) {
        return 'Select: "options" must be a list of {"value", "label"} objects.';
    }
    return null;
};

const layoutFlow = (nodes, edges = []) => {
    const links = edges.map((edge, index) => ({
        id: `edge-${index}`,
        source: String(edge.source),
        target: String(edge.target),
        label: isText(edge.label) ? String(edge.label) : undefined,
        type: 'smoothstep'
    }));
    const level = new Map(nodes.map((node) => [String(node.id), 0]));
    for (let pass = 0; pass < nodes.length; pass++) {
        for (const edge of links) {
            if (level.get(edge.target) <= level.get(edge.source) && level.get(edge.source) < nodes.length) {
                level.set(edge.target, level.get(edge.source) + 1);
            }
        }
    }
    const rows = new Map();
    return {
        nodes: nodes.map((node) => {
            const id = String(node.id);
            const column = level.get(id);
            const row = rows.get(column) || 0;
            rows.set(column, row + 1);
            return {
                id,
                type: 'editable',
                position: { x: column * 240, y: row * 110 },
                data: { label: String(node.label), color: node.color, shape: FLOW_SHAPES.includes(node.shape) ? node.shape : 'rectangle' }
            };
        }),
        edges: links
    };
};

const treeData = (items = []) => {
    const out = {};
    items.forEach((item, index) => {
        const label = String(item.label);
        out[out[label] ? `${label} (${index + 1})` : label] = { label, children: treeData(item.children) };
    });
    return out;
};

const dataFields = (fields = {}) => {
    const out = {};
    for (const [field, config] of Object.entries(fields)) {
        if (!isObject(config)) continue;
        const Component = FIELD_COMPONENTS[config.component];
        const colors = isObject(config.colors) ? config.colors : null;
        out[field] = { label: isText(config.label) ? String(config.label) : undefined };
        if (!Component) continue;
        out[field].component = Component;
        out[field].props = {};
        out[field].transform = (value) => (config.component === 'ProgressBar'
            ? { value: Number(value) || 0, max: 100, showPercentage: true, width: '100%' }
            : { children: String(value), color: colors?.[String(value)] });
    }
    return out;
};

const LocalField = ({ Component, ...props }) => {
    const [value, setValue] = useState('');
    return <Component {...props} value={value} onChange={(next) => setValue(next?.target ? next.target.value : next)} />;
};

const MODEL_FORMATS = ['glb', 'gltf', 'obj', 'stl', 'fbx', 'ply', 'dae', '3mf', 'vox', '3ds'];
const extensionOf = (address) => {
    try {
        return new URL(address).pathname.split('.').pop().toLowerCase();
    } catch {
        return '';
    }
};

const webFiles = new Map();
const loadWebFile = (address) => {
    if (!webFiles.has(address)) {
        const request = fileService.remote(address);
        webFiles.set(address, request);
        request.catch(() => webFiles.delete(address));
    }
    return webFiles.get(address);
};

const useWebFile = (address, kind) => {
    const [state, setState] = useState({ loading: true });
    useEffect(() => {
        let current = true;
        if (kind === 'direct') {
            setState({ value: address });
            return undefined;
        }
        setState({ loading: true });
        loadWebFile(address)
            .then(async (blob) => {
                const start = (await blob.slice(0, 400).text()).trimStart().toLowerCase();
                if (kind !== 'text' && (start.startsWith('<!doctype html') || start.startsWith('<html'))) {
                    if (current) setState({ problem: 'This address is a web page, not a file, so it cannot be shown here. Open it in a new tab.' });
                    return;
                }
                const value = kind === 'blob' ? blob : await blob.text();
                if (current) setState({ value });
            })
            .catch(async (error) => {
                let problem = 'The file could not be loaded from its address.';
                try {
                    const data = error?.response?.data;
                    const parsed = data instanceof Blob ? JSON.parse(await data.text()) : data;
                    if (parsed?.message) problem = `${parsed.message} ${parsed.action || ''}`.trim();
                } catch {
                    problem = 'The file could not be loaded from its address.';
                }
                if (current) setState({ problem });
            });
        return () => {
            current = false;
        };
    }, [address, kind]);
    return state;
};

const EDITOR_LANGUAGES = ['js', 'jsx', 'ts', 'tsx', 'html', 'css', 'json', 'md', 'txt', 'bash', 'sh', 'python', 'py', 'sql', 'yml', 'yaml', 'ruby', 'go', 'rust', 'c', 'cpp', 'java', 'math'];
const LANGUAGE_NAMES = { javascript: 'js', typescript: 'ts', shell: 'sh', console: 'sh', zsh: 'sh', powershell: 'sh', markdown: 'md', text: 'txt', xml: 'html', svg: 'html', rb: 'ruby', rs: 'rust', golang: 'go', 'c++': 'cpp' };
const HTML_LINE = /^\s*<(?:[A-Za-z][\w-]*(?:[\s>/]|$)|\/[A-Za-z]|!--)/;
const HTML_TAG = /<!--[\s\S]*?-->|<\/?[A-Za-z][^<>]*>/;
const PASS_THROUGH = new Set(['p', 'div', 'center', 'section', 'article', 'header', 'footer', 'main', 'span', 'font', 'sub', 'sup', 'small', 'u', 'mark', 'abbr', 'picture', 'figure', 'figcaption', 'nobr', 'body']);
const BLOCK_TAGS = new Set(['p', 'div', 'center', 'section', 'article', 'header', 'footer', 'main', 'figure', 'figcaption']);

const escapeText = (text) => text.replace(/[<{}]/g, (mark) => `\\${mark}`);
const resolveAddress = (value, base) => {
    try {
        return new URL(value, base || undefined).href;
    } catch {
        return /^(https?:|data:|#|mailto:)/i.test(value) ? value : null;
    }
};

const htmlToMarkdown = (html, base) => {
    const state = { unsupported: false };
    const walk = (node) => {
        if (node.nodeType === 3) return escapeText(node.textContent.replace(/\s+/g, ' '));
        if (node.nodeType !== 1) return '';
        const tag = node.tagName.toLowerCase();
        const inner = () => [...node.childNodes].map(walk).join('');
        if (tag === 'img') {
            const address = resolveAddress(node.getAttribute('src') || '', base);
            return address ? `![${(node.getAttribute('alt') || '').replace(/[[\]]/g, '')}](${address})` : '';
        }
        if (tag === 'source') return '';
        if (tag === 'br') return '  \n';
        if (tag === 'hr') return '\n\n---\n\n';
        if (tag === 'a') {
            const address = resolveAddress(node.getAttribute('href') || '', base);
            const label = inner().trim();
            return address && label ? `[${label}](${address})` : label;
        }
        if (/^h[1-6]$/.test(tag)) return `\n\n${'#'.repeat(Number(tag[1]))} ${inner().trim()}\n\n`;
        if (tag === 'strong' || tag === 'b') return inner().trim() ? `**${inner().trim()}**` : '';
        if (tag === 'em' || tag === 'i') return inner().trim() ? `*${inner().trim()}*` : '';
        if (tag === 'del' || tag === 's' || tag === 'strike') return inner().trim() ? `~~${inner().trim()}~~` : '';
        if (tag === 'code' || tag === 'kbd' || tag === 'samp' || tag === 'tt') return `\`${node.textContent.replace(/`/g, '')}\``;
        if (tag === 'li') return `\n- ${inner().trim()}`;
        if (tag === 'ul' || tag === 'ol') return `\n${inner()}\n\n`;
        if (tag === 'summary') return `\n\n**${inner().trim()}**\n\n`;
        if (tag === 'details' || tag === 'blockquote') return `\n\n${inner().trim()}\n\n`;
        if (PASS_THROUGH.has(tag)) return BLOCK_TAGS.has(tag) ? `\n\n${inner().trim()}\n\n` : inner();
        state.unsupported = true;
        return '';
    };
    const body = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html').body;
    const markdown = walk(body).replace(/[ \t]+\n/g, (space) => (space.startsWith('  ') ? '  \n' : '\n')).replace(/\n{3,}/g, '\n\n').trim();
    return state.unsupported ? null : markdown;
};

const safeLine = (line, base) => line.split(/(`[^`\n]*`)/).map((piece, index) => {
    if (index % 2 === 1) return piece;
    const linked = piece.replace(/<(https?:\/\/[^>\s]+)>/g, '[$1]($1)');
    if (!HTML_TAG.test(linked)) return escapeText(linked);
    const converted = htmlToMarkdown(linked, base);
    if (converted !== null) return `${/^\s/.test(linked) ? ' ' : ''}${converted}${/\s$/.test(linked) ? ' ' : ''}`;
    return linked.split(/(<!--.*?-->|<\/?[A-Za-z][^<>\n]*>)/).map((part, position) => (position % 2 === 1 ? `\`${part}\`` : escapeText(part))).join('');
}).join('');

const LINK_DEFINITION = /^[ \t]{0,3}\[([^\]\n]+)\]:[ \t]*<?([^\s>]+)>?(?:[ \t]+(?:"[^"\n]*"|'[^'\n]*'|\([^)\n]*\)))?[ \t]*$/gm;
const FULL_REFERENCE = /(!?)\[((?:[^\[\]\n]|!?\[[^\[\]\n]*\](?:\([^()\n]*\)|\[[^\[\]\n]*\])?)*)\]\[([^\]\n]*)\]/g;
const inlineLinks = (part, links) => {
    let text = part.replace(LINK_DEFINITION, "").replace(/\[\^([^\]\n]+)\]:?/g, "($1)");
    for (let pass = 0; pass < 3; pass++) {
        text = text.replace(FULL_REFERENCE, (whole, bang, label, reference) => {
            const target = links.get((reference || label).toLowerCase());
            return target ? `${bang}[${label}](${target})` : whole;
        });
    }
    return text.replace(/(!?)\[([^\[\]\n]+)\](?![[(:])/g, (whole, bang, label) => {
        const target = links.get(label.toLowerCase());
        return target ? `${bang}[${label}](${target})` : whole;
    });
};

const editorMarkdown = (source, base = null) => {
    const links = new Map([...String(source).matchAll(LINK_DEFINITION)].map((match) => [match[1].toLowerCase(), match[2]]));
    return editorParts(source, links, base);
};

const editorParts = (source, links, base) => String(source).split(/(^(?:```|~~~)[^\n]*\n[\s\S]*?(?:^(?:```|~~~)[ \t]*$|(?![\s\S])))/m).map((part, index) => {
    if (index % 2 === 1) {
        return part.replace(/^(```|~~~)[ \t]*([^\s`]*)[^\n]*/, (_, fence, name) => {
            const wanted = name.toLowerCase();
            const language = EDITOR_LANGUAGES.includes(wanted) ? wanted : LANGUAGE_NAMES[wanted] || '';
            return `\`\`\`${language}`;
        }).replace(/~~~[ \t]*$/, '```');
    }
    const out = [];
    let block = null;
    const close = () => {
        if (out.length > 0 && out[out.length - 1].trim() !== '') out.push('');
        const converted = htmlToMarkdown(block.join('\n'), base);
        if (converted === null) out.push('```html', ...block, '```', '');
        else if (converted) out.push(converted, '');
        block = null;
    };
    for (const line of inlineLinks(part, links).split('\n')) {
        if (block) {
            if (line.trim() === '') close();
            else block.push(line);
        } else if (HTML_LINE.test(line)) block = [line];
        else out.push(safeLine(line, base));
    }
    if (block) close();
    return out.join('\n');
}).join('');

const DocumentPanel = ({ mode, text, address = null }) => (mode === 'document'
    ? <Editor mode="document" minHeight="120px" readOnly showToolbar={false} content={text} />
    : (
        <Container layout="block" padding="none" width="100%" maxHeight="70vh" overflow="auto">
            <Editor mode="markdown" minHeight="120px" readOnly showToolbar={false} content={editorMarkdown(text, address)} />
        </Container>
    ));

const SourceLine = ({ address }) => (
    <Typography size="xxs" color="muted" href={address} target="_blank" rel="noreferrer noopener" truncate>Source: {address}</Typography>
);

const UnverifiedAddresses = createContext(() => false);

const WebFile = ({ address, kind, children }) => {
    const file = useWebFile(address, kind);
    const unverified = useContext(UnverifiedAddresses)(address);
    return (
        <Container layout="flex-column" gap="xs" padding="none" width="100%">
            {file.loading && <Typography size="xs" color="muted">Loading the file from the web…</Typography>}
            {file.problem && <Typography size="xs" color="warning">{file.problem}{unverified ? ' The model wrote this address itself; it did not come from the web search.' : ''}</Typography>}
            {file.value !== undefined && children(file.value)}
            <SourceLine address={address} />
        </Container>
    );
};

const BlobAddress = ({ blob, children }) => {
    const [url, setUrl] = useState(null);
    useEffect(() => {
        const next = URL.createObjectURL(blob);
        setUrl(next);
        return () => URL.revokeObjectURL(next);
    }, [blob]);
    return url ? children(url) : null;
};

const parseCsv = (text) => {
    const rows = [];
    let row = [];
    let cell = '';
    let quoted = false;
    for (let index = 0; index < text.length; index++) {
        const char = text[index];
        if (quoted) {
            if (char === '"' && text[index + 1] === '"') {
                cell += '"';
                index += 1;
            } else if (char === '"') quoted = false;
            else cell += char;
        } else if (char === '"') quoted = true;
        else if (char === ',') {
            row.push(cell);
            cell = '';
        } else if (char === '\n') {
            row.push(cell);
            rows.push(row);
            row = [];
            cell = '';
        } else if (char !== '\r') cell += char;
    }
    if (cell !== '' || row.length > 0) {
        row.push(cell);
        rows.push(row);
    }
    const [header = [], ...lines] = rows.filter((line) => line.some((value) => value !== ''));
    return lines.map((line) => Object.fromEntries(header.map((name, index) => [name || `column ${index + 1}`, line[index] ?? ''])));
};

const tableRows = (text, address) => {
    if (extensionOf(address) === 'json' || /^\s*[[{]/.test(text)) {
        const parsed = JSON.parse(text);
        const list = Array.isArray(parsed) ? parsed : Object.values(parsed).find(Array.isArray) || [];
        return list.filter(isObject);
    }
    return parseCsv(text);
};

const WebTable = ({ text, address, variant, fields }) => {
    const rows = useMemo(() => {
        try {
            return tableRows(text, address).slice(0, 500);
        } catch {
            return [];
        }
    }, [text, address]);
    if (rows.length === 0) return <Typography size="xs" color="warning">This file does not hold a table that can be shown. Use a CSV file or a JSON list.</Typography>;
    return <Data size="xs" width="100%" variant={variant} data={rows} fieldConfig={dataFields(fields)} />;
};

const InlineModel = ({ content, format = 'obj', fileName, ...props }) => {
    const { success, error: notifyError } = useNotification();
    const [saving, setSaving] = useState(false);
    const kind = ['obj', 'stl'].includes(String(format).toLowerCase()) ? String(format).toLowerCase() : 'obj';
    const name = /\.(obj|stl)$/i.test(String(fileName || '')) ? fileName : `${String(fileName || 'model').replace(/[\\/]/g, '-')}.${kind}`;
    const [url, setUrl] = useState(null);
    useEffect(() => {
        const next = URL.createObjectURL(new Blob([content], { type: 'text/plain' }));
        setUrl(next);
        return () => URL.revokeObjectURL(next);
    }, [content]);

    const save = async (folder) => {
        setSaving(false);
        try {
            const saved = await fileService.save(folder, name, content);
            success(`Saved to ${saved.path}`);
        } catch (error) {
            notifyError(describeError(error, 'The model could not be saved.'));
        }
    };

    return (
        <Container layout="flex-column" gap="xs" padding="none" width="100%">
            {url && <Model3D src={url} format={kind} height="360px" {...props} />}
            <Container layout="flex" align="center" gap="xs" padding="none">
                <Typography size="xxs" color="muted">{name}</Typography>
                <Button size="xs" variant="ghost" title="Download" aria-label="Download" onClick={() => downloadText(name, content)}><Icon name="FiDownload" size="xs" /></Button>
                <Pop label="Save to my files" icon="FiHardDrive" size="xs" open={saving} onOpen={() => setSaving(true)} onClose={() => setSaving(false)} width="440px">
                    <FileBrowser mode="save" onPick={save} onBack={() => setSaving(false)} />
                </Pop>
            </Container>
        </Container>
    );
};

const renderBlock = (node, context, key, parent = null) => {
    if (node === null || node === undefined) return null;
    if (isText(node)) return node;
    if (Array.isArray(node)) return node.map((child, index) => renderBlock(child, context, index, parent));

    const name = node.component;
    const problem = checkNode(node, parent);
    if (problem) return <Typography key={key} size="xxs" color="warning">[Not drawn: {problem}]</Typography>;
    const spec = BLOCK_SPEC[name];
    const props = Object.fromEntries(Object.entries(node.props || {}).filter(([prop]) => spec.props.includes(prop)));
    const children = spec.children ? renderBlock(node.children, context, 'children', name) : undefined;

    if (name === 'Container') return <Container key={key} padding="none" gap="sm" {...props}>{children}</Container>;
    if (name === 'Card') return <Card key={key} hover={false} shadow={false} padding="md" gap="sm" {...props}>{children}</Card>;
    if (name === 'Divider') return <Divider key={key} margin="sm" {...props} />;
    if (name === 'Typography') {
        const href = 'href' in props ? safeLink(props.href) : null;
        delete props.href;
        const link = href ? { href, target: '_blank', rel: 'noreferrer noopener' } : {};
        return <Typography key={key} size="xs" {...props} {...link}>{children}</Typography>;
    }
    if (name === 'Badge') return <Badge key={key} size="sm" {...props}>{children}</Badge>;
    if (name === 'Icon') return <Icon key={key} size="sm" {...props} />;
    if (name === 'Button') {
        const { send, icon, ...rest } = props;
        const label = isText(node.children) ? String(node.children).trim() : '';
        const message = isText(send) && String(send).trim() ? String(send) : label;
        const onClick = message && context.send && !context.live ? () => context.send(message) : undefined;
        return (
            <Button key={key} size="sm" {...rest} onClick={onClick}>
                {isText(icon) && <Icon name={String(icon)} size="xs" />}
                {label}
            </Button>
        );
    }
    if (name === 'ButtonGroup') return <ButtonGroup key={key} spaced selectable={false} justify="start">{children}</ButtonGroup>;
    if (name === 'FloatingActionButton') {
        const { send, color, ...rest } = props;
        const onClick = isText(send) && String(send).trim() && context.send && !context.live ? () => context.send(String(send)) : undefined;
        return <FloatingActionButton key={key} parentType="card" variant={color || 'primary'} {...rest} onClick={onClick} />;
    }
    if (name === 'ProgressBar') return <ProgressBar key={key} width="100%" showLabel={Boolean(props.label)} {...props} value={Number(props.value)} />;
    if (name === 'CircularProgress') return <CircularProgress key={key} {...props} />;
    if (name === 'Data' && props.src) {
        return <WebFile key={key} address={props.src} kind="table">{(text) => <WebTable text={text} address={props.src} variant={props.variant} fields={props.fields} />}</WebFile>;
    }
    if (name === 'Data') return <Data key={key} size="xs" width="100%" variant={props.variant} data={props.data} fieldConfig={dataFields(props.fields)} />;
    if (name === 'Flow') {
        const graph = layoutFlow(props.nodes, props.edges);
        return <Flow key={key} height={props.height || '380px'} toolbar="view" connectable={false} deletable={false} enableNodeCreation={false} nodes={graph.nodes} edges={graph.edges} />;
    }
    if (name === 'TreeView') return <TreeView key={key} size="sm" data={treeData(props.items)} />;
    if (name === 'Editor' && props.src) {
        const extension = extensionOf(props.src);
        const asText = props.mode === 'markdown' || props.mode === 'document' || (!props.mode && ['md', 'markdown'].includes(extension));
        return (
            <WebFile key={key} address={props.src} kind="text">
                {(text) => (asText
                    ? <DocumentPanel mode={props.mode} text={text.slice(0, 200000)} address={props.src} />
                    : <CodeView code={text.slice(0, 200000)} language={props.language || extension} />)}
            </WebFile>
        );
    }
    if (name === 'Editor') {
        if (props.mode === 'code') return <CodeView key={key} code={String(props.content)} language={props.language} />;
        return <DocumentPanel key={key} mode={props.mode} text={String(props.content)} />;
    }
    if (name === 'Input') return <LocalField key={key} Component={Input} size="sm" {...props} />;
    if (name === 'Select') return <LocalField key={key} Component={Select} size="sm" {...props} options={props.options || []} />;
    if (name === 'Switch') return <Switch key={key} {...props} />;
    if (name === 'Model3D' && props.src) {
        const { src, content: _content, format, fileName: _fileName, ...rest } = props;
        const kind = String(format || extensionOf(src)).toLowerCase();
        return <WebFile key={key} address={src} kind="blob">{(blob) => <BlobAddress blob={blob}>{(url) => <Model3D src={url} format={kind} height="360px" {...rest} />}</BlobAddress>}</WebFile>;
    }
    if (name === 'Model3D') return <InlineModel key={key} {...props} />;
    if (name === 'PdfViewer') {
        return <WebFile key={key} address={props.src} kind="blob">{(blob) => <PdfViewer blob={blob} readOnly compact height="70vh" />}</WebFile>;
    }

    const { content, src, ...rest } = props;
    const source = name === 'Image' && typeof content === 'string' && /<svg[\s>]/i.test(content)
        ? `data:image/svg+xml;utf8,${encodeURIComponent(content)}`
        : safeSource(src);
    if (!source) return <Typography key={key} size="xxs" color="warning">[Not drawn: this {MEDIA[name]} has no https address.]</Typography>;
    if (name === 'Image' && isRemote(source)) {
        return (
            <WebFile key={key} address={source} kind="blob">
                {(blob) => <BlobAddress blob={blob}>{(url) => <Image src={url} maxWidth="100%" allowDownload={false} {...rest} />}</BlobAddress>}
            </WebFile>
        );
    }
    const Media = BLOCK_COMPONENTS[name];
    if (isRemote(source)) {
        return <WebFile key={key} address={source} kind="direct">{() => <Media src={source} {...rest} />}</WebFile>;
    }
    return (
        <Container key={key} layout="flex-column" gap="xs" padding="none" width="100%">
            {name === 'Image' ? <Image src={source} maxWidth="100%" allowDownload={false} {...rest} /> : <Media src={source} {...rest} />}
        </Container>
    );
};

class BlockBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { failed: false };
    }

    static getDerivedStateFromError() {
        return { failed: true };
    }

    componentDidUpdate(previous) {
        if (previous.source !== this.props.source && this.state.failed) this.setState({ failed: false });
    }

    render() {
        return this.state.failed ? this.props.fallback : this.props.children;
    }
}

const RAW_TAGS = ['Model3D', 'Editor', 'Image'];
const TEXT_TAGS = ['Typography', 'Badge', 'Button'];
const NUMBER_PROPS = ['value', 'max', 'columns', 'rows'];
const TAG_NAMES = [
    'Container', 'Card', 'Divider', 'Typography', 'Badge', 'Icon', 'Button', 'ButtonGroup', 'FloatingActionButton', 'ProgressBar', 'CircularProgress',
    'Data', 'Flow', 'TreeView', 'Image', 'Video', 'Audio', 'PdfViewer', 'Model3D', 'Editor', 'Input', 'Select', 'Switch',
    'Row', 'Column', 'Node', 'Edge', 'Item', 'Option'
];
const EXACT_TAG = new Map(TAG_NAMES.map((name) => [name.toLowerCase(), name]));
const ATTRIBUTE = /([A-Za-z_][\w-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|\{([^}]*)\}|([^\s"'>/]+)))?/g;

const readValue = (name, raw) => {
    if (raw === undefined) return true;
    const text = String(raw).trim();
    if (text === 'true') return true;
    if (text === 'false') return false;
    if (NUMBER_PROPS.includes(name) && text !== '' && Number.isFinite(Number(text))) return Number(text);
    return text.replace(/^["']|["']$/g, '');
};

const readAttributes = (source) => {
    const props = {};
    for (const match of source.matchAll(ATTRIBUTE)) {
        props[match[1]] = readValue(match[1], match[2] ?? match[3] ?? match[4] ?? match[5]);
    }
    return props;
};

const readMarkup = (source) => {
    const root = { tag: null, props: {}, children: [] };
    const stack = [root];
    const top = () => stack[stack.length - 1];
    let index = 0;

    while (index < source.length) {
        const open = source.indexOf('<', index);
        if (open === -1) {
            top().children.push(source.slice(index));
            break;
        }
        if (open > index) top().children.push(source.slice(index, open));

        const closing = source.slice(open).match(/^<\/\s*([A-Za-z][\w]*)\s*>/);
        if (closing) {
            const name = EXACT_TAG.get(closing[1].toLowerCase()) || closing[1];
            const at = stack.map((entry) => entry.tag).lastIndexOf(name);
            if (at > 0) stack.length = at;
            index = open + closing[0].length;
            continue;
        }

        const opening = source.slice(open).match(/^<\s*([A-Za-z][\w]*)((?:"[^"]*"|'[^']*'|\{[^}]*\}|[^>"'{])*)>/);
        if (!opening) {
            top().children.push('<');
            index = open + 1;
            continue;
        }
        const name = EXACT_TAG.get(opening[1].toLowerCase()) || opening[1];
        const selfClosed = /\/\s*$/.test(opening[2]);
        const node = { tag: name, props: readAttributes(opening[2].replace(/\/\s*$/, '')), children: [] };
        top().children.push(node);
        index = open + opening[0].length;
        if (selfClosed) continue;

        if (RAW_TAGS.includes(name)) {
            const rest = source.slice(index);
            const end = rest.search(new RegExp(`</\\s*${name}\\s*>`, 'i'));
            node.children.push(end === -1 ? rest : rest.slice(0, end));
            index = end === -1 ? source.length : index + end + rest.slice(end).match(/^<\/[^>]*>/)[0].length;
            continue;
        }
        stack.push(node);
    }
    return root.children;
};

const textOfMarkup = (children) => children.filter((child) => typeof child === 'string').join('').replace(/\s+/g, ' ').trim();
const rawText = (children) => children.filter((child) => typeof child === 'string').join('').replace(/^\s*\n/, '').replace(/\s+$/, '');
const elements = (children, tag) => children.filter((child) => typeof child === 'object' && (!tag || child.tag === tag));
const cellValue = (value) => (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value.replace(/,/g, ''))) && !/^0\d/.test(value) ? Number(value.replace(/,/g, '')) : value);

const treeItems = (children) => elements(children, 'Item').map((item) => {
    const nested = treeItems(item.children);
    const label = item.props.label ?? textOfMarkup(item.children);
    return nested.length > 0 ? { label, children: nested } : { label };
});

const toNode = (element) => {
    const { tag, props, children } = element;
    if (tag === 'Data') {
        const fields = {};
        for (const column of elements(children, 'Column')) {
            const key = column.props.key ?? column.props.name;
            if (key === undefined || key === true) continue;
            const entry = {};
            if (typeof column.props.label === 'string') entry.label = column.props.label;
            if (typeof column.props.as === 'string') entry.component = column.props.as;
            if (typeof column.props.colors === 'string') {
                entry.colors = Object.fromEntries(column.props.colors.split(',').map((pair) => pair.split(':').map((part) => part.trim())).filter((pair) => pair.length === 2 && pair[0]));
            }
            fields[String(key)] = entry;
        }
        const data = elements(children, 'Row').map((row) => Object.fromEntries(Object.entries(row.props).map(([key, value]) => [key, cellValue(value)])));
        const out = { ...props, data };
        if (Object.keys(fields).length > 0) out.fields = fields;
        return { component: 'Data', props: out };
    }
    if (tag === 'Flow') {
        return {
            component: 'Flow',
            props: {
                ...props,
                nodes: elements(children, 'Node').map((node) => ({ ...node.props, label: node.props.label ?? textOfMarkup(node.children) })),
                edges: elements(children, 'Edge').map((edge) => edge.props)
            }
        };
    }
    if (tag === 'TreeView') return { component: 'TreeView', props: { ...props, items: treeItems(children) } };
    if (tag === 'Select') {
        const options = elements(children, 'Option').map((option) => ({ value: option.props.value ?? option.props.label, label: option.props.label ?? textOfMarkup(option.children) }));
        return { component: 'Select', props: { ...props, options } };
    }
    if (tag === 'Model3D' || tag === 'Editor') return { component: tag, props: { ...props, content: props.content ?? rawText(children) } };
    if (tag === 'Image') {
        const inner = rawText(children);
        return { component: 'Image', props: inner ? { ...props, content: inner } : props };
    }
    if (TEXT_TAGS.includes(tag)) return { component: tag, props, children: textOfMarkup(children) };
    const nested = children.filter((child) => typeof child === 'object').map(toNode);
    const stray = textOfMarkup(children);
    if (tag === 'Container' || tag === 'Card' || tag === 'ButtonGroup') {
        const list = stray && nested.length === 0 ? [{ component: 'Typography', props: {}, children: stray }] : nested;
        return { component: tag, props, children: list };
    }
    return { component: tag, props };
};

const readComponents = (source) => readMarkup(source)
    .map((entry) => (typeof entry === 'string' ? { text: entry.replace(/^[\s`,]+|[\s`,]+$/g, '') } : { node: toNode(entry) }))
    .filter((entry) => entry.node || entry.text);


const fenceBareBlocks = (text) => {
    const start = /^[ \t]*<(Card|Container|Data|Flow|TreeView|Model3D|ButtonGroup|Button|ProgressBar|Typography|Badge|Image|Editor)[\s>]/m;
    if (!start.test(text)) return text;
    return String(text).split(/(```[\s\S]*?(?:```|$))/).map((part, position) => {
        if (position % 2 === 1) return part;
        const at = part.search(start);
        if (at === -1) return part;
        const last = part.lastIndexOf('>');
        return `${part.slice(0, at)}\n\n\`\`\`component\n${part.slice(at, last + 1).trim()}\n\`\`\`\n\n${part.slice(last + 1)}`;
    }).join('');
};

const ComponentBlock = ({ source }) => {
    const context = React.useContext(BlockContext);
    const items = useMemo(() => {
        if (/^\s*[{[]/.test(source)) return [{ reason: 'It is written as JSON. Components are written as tags, such as <Card>...</Card>.' }];
        return readComponents(source).map((item) => {
            if (item.text) return item;
            return { tree: item.node };
        });
    }, [source]);

    const shown = context.live ? items.filter((item, index) => !(index === items.length - 1 && (item.reason || item.text))) : items;
    const failed = shown.some((item) => item.reason);
    const pending = context.live && shown.length < items.length;

    return (
        <Container layout="flex-column" gap="sm" padding="none" width="100%" marginBottom="sm">
            {shown.map((item, index) => {
                if (item.text) return <Typography key={index} as="p" size="xs">{item.text}</Typography>;
                if (item.reason) return <Typography key={index} size="xxs" color="warning">The model wrote a component that could not be drawn. {item.reason}</Typography>;
                return (
                    <BlockBoundary
                        key={index}
                        source={source}
                        fallback={<Typography size="xxs" color="warning">The model wrote a component that failed while being drawn.</Typography>}
                    >
                        {renderBlock(item.tree, context, 'root')}
                    </BlockBoundary>
                );
            })}
            {(pending || (context.live && items.length === 0)) && <Typography size="xs" color="muted">Building a component…</Typography>}
            {failed && <CodeView code={source} language="xml" />}
            {!context.live && items.length === 0 && <CodeView code={source} language="xml" />}
        </Container>
    );
};

const PreBlock = ({ children }) => {
    const language = String(children?.props?.className || '');
    if (!/language-component\b/.test(language)) return <CodeBlock>{children}</CodeBlock>;
    return <ComponentBlock source={textOf(children).replace(/`+\s*$/, '')} />;
};

const heading = (as, size) => ({ children }) => <Typography as={as} size={size} weight="bold" marginBottom="sm">{children}</Typography>;

const MARKDOWN_PARTS = {
    pre: PreBlock,
    p: ({ children }) => <Typography as="p" size="xs" marginBottom="sm">{children}</Typography>,
    a: ({ children, href }) => <Typography size="inherit" color="tertiary" href={href} target="_blank" rel="noreferrer noopener">{children}</Typography>,
    h1: heading('h2', 'md'),
    h2: heading('h3', 'sm'),
    h3: heading('h4', 'xs'),
    h4: heading('h5', 'xs'),
    li: ({ children }) => <Typography as="li" size="xs">{children}</Typography>,
    table: ({ children }) => <Container padding="none" width="100%" overflow="auto" marginBottom="sm"><Typography as="table" size="xs">{children}</Typography></Container>,
    th: ({ children }) => <Typography as="th" size="xs" weight="bold" padding="xs">{children}</Typography>,
    td: ({ children }) => <Typography as="td" size="xs" padding="xs">{children}</Typography>
};

const Markdown = React.memo(({ text }) => (
    <Container layout="block" padding="none" width="100%">
        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]} components={MARKDOWN_PARTS}>
            {fenceBareBlocks(text)}
        </ReactMarkdown>
    </Container>
));

const hostOf = (address) => {
    try {
        return new URL(address).host;
    } catch {
        return address;
    }
};
const STEP_FAILURES = {
    refused: 'the search service refused the request. Check its key or settings on the server.',
    blocked: 'only public https addresses can be read.',
    limited: 'the search service is limiting requests right now. Wait a few minutes, or check the monthly allowance of the search key.',
    unreachable: 'the web could not be reached.'
};
const TOOL_FAILURES = {
    failed: 'it reported a problem.',
    refused: 'you did not allow it.',
    offline: 'that computer is not connected.',
    limited: 'the hourly limit on tool use was reached.',
    blocked: 'only public https addresses can be reached.',
    unreachable: 'it could not be reached.'
};
const isSearchStep = (step) => step.tool === 'web_search' || step.tool === 'web_fetch';
// A step still under way reads as something happening now; a finished one as something done.
const stepText = (step, active = false) => {
    if (!isSearchStep(step)) {
        if (step.failed) return `Could not use ${step.tool}: ${TOOL_FAILURES[step.failed] || TOOL_FAILURES.unreachable}`;
        return active ? `Using ${step.tool}…` : `Used ${step.tool}`;
    }
    const what = step.tool === 'web_fetch' ? `read ${hostOf(step.input)}` : `search the web for “${step.input}”`;
    if (step.failed) return `Could not ${what}: ${STEP_FAILURES[step.failed] || STEP_FAILURES.unreachable}`;
    if (active) return step.tool === 'web_fetch' ? `Reading ${hostOf(step.input)}…` : `Searching the web for “${step.input}”…`;
    return step.tool === 'web_fetch' ? `Read ${hostOf(step.input)}` : `Searched the web for “${step.input}”`;
};

const Steps = ({ steps, live = false }) => (
    <Container layout="flex-column" gap="none" padding="none" marginBottom="xs">
        {steps.map((step, index) => (
            <Container key={index} layout="flex" wrap={false} align="center" gap="xs" padding="none">
                <Icon name={step.failed ? 'FiAlertTriangle' : !isSearchStep(step) ? 'FiTool' : step.tool === 'web_fetch' ? 'FiFileText' : 'FiSearch'} size="xs" color={step.failed ? 'error' : 'secondary'} />
                {!isSearchStep(step)
                    ? <Typography size="xxs" color={step.failed ? 'error' : 'muted'} truncate title={`What was sent: ${step.input}`}>{stepText(step, live && index === steps.length - 1)}</Typography>
                    : step.failed
                    ? <Typography size="xxs" color="error">{stepText(step, live && index === steps.length - 1)}</Typography>
                    : step.tool === 'web_fetch'
                    ? <Typography size="xxs" color="muted" href={/^https?:/i.test(step.input) ? step.input : undefined} target="_blank" rel="noreferrer noopener" truncate>{stepText(step, live && index === steps.length - 1)}</Typography>
                    : <Typography size="xxs" color="muted" truncate>{stepText(step, live && index === steps.length - 1)}</Typography>}
            </Container>
        ))}
    </Container>
);

const PlainText = ({ text }) => (
    <Container layout="flex-column" gap="none" padding="none">
        {text.split('\n').map((line, index) => <Typography key={index} as="p" size="xs">{line || ' '}</Typography>)}
    </Container>
);

const Thinking = ({ text, startOpen = false }) => {
    const [open, setOpen] = useState(startOpen);
    return (
        <Container layout="flex-column" gap="xs" padding="none" marginBottom="xs">
            <Container layout="flex" padding="none">
                <Button size="xs" variant="ghost" onClick={() => setOpen((shown) => !shown)}>
                    <Icon name={open ? 'FiChevronDown' : 'FiChevronRight'} size="xs" />Thinking
                </Button>
            </Container>
            {open && <Typography size="xxs" color="muted">{text}</Typography>}
        </Container>
    );
};

const FileBrowser = ({ mode, onPick, onBack }) => {
    const [path, setPath] = useState('/');
    const [listing, setListing] = useState(null);
    const [problem, setProblem] = useState(null);

    useEffect(() => {
        let current = true;
        setListing(null);
        setProblem(null);
        fileService.browse(path)
            .then((result) => current && setListing(result))
            .catch((error) => current && setProblem(describeError(error, 'Your files could not be loaded.')));
        return () => {
            current = false;
        };
    }, [path]);

    const crumbs = useMemo(() => {
        const parts = path.split('/').filter(Boolean);
        return [{ name: 'My files', path: '/' }, ...parts.map((name, index) => ({ name, path: `/${parts.slice(0, index + 1).join('/')}` }))];
    }, [path]);

    return (
        <>
            <Container layout="flex" align="center" gap="xs" padding="none" width="100%">
                <Button size="xs" variant="ghost" onClick={onBack} title="Back"><Icon name="FiArrowLeft" size="xs" /></Button>
                {crumbs.map((crumb, index) => (
                    <React.Fragment key={crumb.path}>
                        {index > 0 && <Icon name="FiChevronRight" size="xs" color="text" />}
                        <Button size="xs" variant={index === crumbs.length - 1 ? null : 'ghost'} onClick={() => setPath(crumb.path)} title={crumb.path}>
                            {index === 0 && <Icon name="FiHardDrive" size="xs" />}
                            {crumb.name}
                        </Button>
                    </React.Fragment>
                ))}
            </Container>

            {problem && <Typography size="sm" color="error">{problem}</Typography>}
            {!problem && !listing && <Typography size="sm" color="muted">Loading your files…</Typography>}
            {listing && listing.entries.length === 0 && <Typography size="sm" color="muted">This folder is empty.</Typography>}
            {listing && listing.entries.length > 0 && (
                <Container layout="flex-column" gap="none" padding="none" width="100%">
                    {listing.entries.map((entry) => {
                        const isFolder = entry.type === 'folder';
                        const usable = isFolder || (mode !== 'save' && READABLE.test(entry.name));
                        const extension = entry.name.split('.').pop()?.toLowerCase();
                        return (
                            <Row
                                key={entry.path}
                                icon={isFolder ? 'FiFolder' : FILE_ICONS[extension] || 'FiFile'}
                                iconColor={isFolder ? 'primary' : 'secondary'}
                                label={entry.name}
                                title={usable ? entry.path : mode === 'save' ? 'Open a folder to save in' : 'This kind of file cannot be read as text'}
                                disabled={!usable}
                                onClick={() => (isFolder ? setPath(entry.path) : onPick(entry.path, entry.name))}
                            >
                                <Typography size="xs" color="muted" width="96px">{formatDate(entry.updatedAt)}</Typography>
                                <Typography size="xs" color="muted" width="64px">{isFolder ? '—' : formatSize(entry.size)}</Typography>
                            </Row>
                        );
                    })}
                </Container>
            )}
            {mode === 'save' && listing && (
                <Button size="sm" color="primary" disabled={path === '/'} onClick={() => onPick(path)}>
                    {path === '/' ? 'Open a folder to save in' : `Save in ${crumbs[crumbs.length - 1].name}`}
                </Button>
            )}
        </>
    );
};

const SavedInstructions = ({ onAdd, onBack, full }) => {
    const { error: notifyError } = useNotification();
    const [prompts, setPrompts] = useState(null);

    const load = useCallback(() => {
        promptService.list()
            .then((result) => setPrompts(result.prompts))
            .catch((error) => {
                setPrompts([]);
                notifyError(describeError(error, 'Your saved instructions could not be loaded.'));
            });
    }, [notifyError]);

    useEffect(load, [load]);

    return (
        <>
            <Container layout="flex" align="center" gap="xs" padding="none" width="100%">
                <Button size="xs" variant="ghost" onClick={onBack} title="Back"><Icon name="FiArrowLeft" size="xs" /></Button>
                <Typography size="sm" weight="semibold">Saved instructions</Typography>
            </Container>
            {!prompts && <Typography size="sm" color="muted">Loading…</Typography>}
            {prompts?.length === 0 && (
                <Typography size="sm" color="muted">Nothing is saved yet. Press Save beside an instruction to keep it for other chats.</Typography>
            )}
            {full && <Typography size="sm" color="warning">This chat already has {MAX_ARTICLES} instructions. Remove one to add another.</Typography>}
            <Container layout="flex-column" gap="none" padding="none" width="100%">
                {prompts?.map((prompt) => (
                    <Row
                        key={prompt.id}
                        icon={prompt.source === 'fs-one' ? 'FiHardDrive' : 'FiBookmark'}
                        label={prompt.name}
                        title={prompt.text.slice(0, 300)}
                        disabled={full}
                        onClick={() => onAdd({ name: prompt.name, text: prompt.text, source: prompt.source, path: prompt.path })}
                    >
                        <Button
                            size="xs"
                            variant="ghost"
                            title="Delete this saved instruction"
                            onClick={async (event) => {
                                event.stopPropagation();
                                try {
                                    await promptService.remove(prompt.id);
                                    load();
                                } catch (error) {
                                    notifyError(describeError(error, 'It could not be deleted.'));
                                }
                            }}
                        >
                            <Icon name="FiTrash2" size="xs" color="error" />
                        </Button>
                    </Row>
                ))}
            </Container>
        </>
    );
};

const Message = ({ message, isLast, busy, onRegenerate, onEdit }) => {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(message.content);
    const mine = message.role === 'user';

    const body = (
        <>
            {message.attachments?.length > 0 && (
                <Container layout="flex" gap="xs" padding="none">
                    {message.attachments.map((file) => <Badge key={file.id} size="sm" color="tertiary">{file.name}</Badge>)}
                </Container>
            )}
            {message.steps?.length > 0 && <Steps steps={message.steps} />}
            {message.thinking && <Thinking text={message.thinking} />}
            {editing ? (
                <Container layout="flex-column" gap="xs" padding="none" width="100%" minWidth="min(480px, 68vw)">
                    <Input multiline rows={3} value={draft} onChange={(event) => setDraft(event.target.value)} width="100%" />
                    <Container layout="flex" justify="end" gap="xs" padding="none" width="100%">
                        <Button size="xs" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
                        <Button
                            size="xs"
                            color="primary"
                            disabled={!draft.trim()}
                            onClick={() => {
                                setEditing(false);
                                onEdit(message.index, draft.trim());
                            }}
                        >
                            Send again
                        </Button>
                    </Container>
                </Container>
            ) : mine ? <PlainText text={message.content} /> : message.content && <UnverifiedAddresses.Provider value={(address) => (message.unverified || []).includes(address)}><Markdown text={message.content} /></UnverifiedAddresses.Provider>}
            {message.error && <Typography size="sm" color="error">{message.error.message} {message.error.action}</Typography>}
            {message.stopped && <Typography size="sm" color="muted">Stopped before it finished.</Typography>}
        </>
    );

    return (
        <Container layout="flex-column" gap="xs" padding="none" width="100%" align={mine ? 'end' : 'stretch'}>
            {mine
                ? <Card backgroundColor="background" borderColor="secondary" borderStrength="soft" shadow={false} hover={false} layout="flex-column" gap="xs" padding="sm" maxWidth="85%">{body}</Card>
                : <Container layout="flex-column" gap="xs" padding="none" width="100%">{body}</Container>}
            {!editing && (
                <Container layout="flex" align="center" gap="xs" padding="none">
                    {message.content && <CopyButton text={message.content} />}
                    {mine && !busy && (
                        <Button size="xxs" variant="ghost" title="Edit" aria-label="Edit" onClick={() => { setDraft(message.content); setEditing(true); }}>
                            <Icon name="FiEdit2" />
                        </Button>
                    )}
                    {!mine && isLast && !busy && (
                        <Button size="xxs" variant="ghost" title="Regenerate" aria-label="Regenerate" onClick={onRegenerate}><Icon name="FiRefreshCw" /></Button>
                    )}
                    {!mine && message.stats?.tokensPerSecond && (
                        <Typography size="xs" color="muted">{message.model} · {message.stats.tokensPerSecond} tokens per second</Typography>
                    )}
                </Container>
            )}
        </Container>
    );
};

const liveStatus = (live) => {
    if (live.ahead > 0) return `Waiting for the model — ${live.ahead} ahead of you`;
    if (!live.started) return 'Sending…';
    if (live.note) return live.note;
    if (live.sharing > 0) return 'Waiting for another reply that is being written at the same time…';
    if (!live.loaded) return 'Loading the model into memory. The first reply takes longest.';
    return 'Thinking…';
};

const LIVE_BLOCKS = { send: null, live: true };
const Centered = ({ gap = 'sm', children }) => (
    <Container layout="flex" justify="center" padding="sm" width="100%">
        <Container layout="flex-column" wrap={false} gap={gap} padding="none" width="100%" maxWidth="820px">{children}</Container>
    </Container>
);

const MODEL_SETTINGS = [
    { key: 'temperature', label: 'Creativity (temperature, 0 to 2)', help: "Lower is more exact, higher is more varied. Empty uses the model's own setting.", min: 0, max: 2, whole: false },
    { key: 'num_ctx', label: 'Context size (tokens)', help: 'How much the model reads at once. Empty lets Mollama choose. Larger sizes use more memory.', min: 512, max: 262144, whole: true },
    { key: 'num_predict', label: 'Longest reply (tokens)', help: 'Stops a reply at this length. Empty or -1 means no limit.', min: -1, max: 100000, whole: true },
    { key: 'top_p', label: 'Word choice breadth (top p, 0 to 1)', help: 'Lower keeps to the most likely words. Empty uses the model setting.', min: 0, max: 1, whole: false },
    { key: 'top_k', label: 'Words considered (top k)', help: 'How many likely next words the model picks from. Empty uses the model setting.', min: 0, max: 500, whole: true },
    { key: 'repeat_penalty', label: 'Repetition penalty', help: 'Higher discourages repeating the same words. Around 1.1 is usual.', min: 0, max: 5, whole: false },
    { key: 'seed', label: 'Seed', help: 'The same number gives the same reply to the same message. Empty gives a different reply each time.', min: null, max: null, whole: true }
];
const emptySetup = { instructions: [], skills: null, tools: [], ...Object.fromEntries(MODEL_SETTINGS.map((setting) => [setting.key, ''])) };

const ChatPage = () => {
    const { id: routeId } = useParams();
    const navigate = useNavigate();
    const { success, error: notifyError, confirm } = useNotification();

    const [chats, setChats] = useState([]);
    const [search, setSearch] = useState('');
    const [chat, setChat] = useState(null);
    const { user: signedIn } = useAuth();
    pickerMemory.as(signedIn?.id || signedIn?._id);
    // The pickers open with what they showed last, so a name is there at once; the fresh answer then corrects it.
    const preferDevice = (list, current) => {
        const ready = list.filter((device) => deviceService.ready(device) || (device.online && !device.paused && device.ollama?.available));
        const usable = list.filter((device) => device.online && !device.paused);
        return (ready.find((device) => device.id === deviceService.chosen())
            || ready.find((device) => device.id === current)
            || ready[0]
            || usable.find((device) => device.id === deviceService.chosen())
            || usable.find((device) => device.id === current)
            || usable[0])?.id || null;
    };
    const [devices, setDevices] = useState(() => pickerMemory.devices().devices);
    const [draftDevice, setDraftDevice] = useState(() => {
        const kept = pickerMemory.devices();
        return preferDevice(kept.devices, kept.current);
    });
    // The list of models is kept together with the computer it belongs to, so the two can never be out of step.
    const keptModels = (deviceId) => (pickerMemory.models(deviceId) || []).filter((model) => model.canChat !== false);
    const [modelState, setModelState] = useState(() => ({ device: draftDevice, list: keptModels(draftDevice), loaded: Boolean(pickerMemory.models(draftDevice)) }));
    const modelsAsk = useRef(0);
    const [webSearch, setWebSearch] = useState(false);
    const [draftSearch, setDraftSearch] = useState(true);
    const [skills, setSkills] = useState([]);
    const [tools, setTools] = useState([]);
    const [text, setText] = useState(() => {
        try {
            return sessionStorage.getItem('mollama-first-prompt') || '';
        } catch {
            return '';
        }
    });
    useEffect(() => {
        try {
            sessionStorage.removeItem('mollama-first-prompt');
        } catch {
            return;
        }
    }, []);
    const [live, setLive] = useState(null);
    const [pop, setPop] = useState(null);
    const [view, setView] = useState('main');
    const [advancedOpen, setAdvancedOpen] = useState(false);
    const [working, setWorking] = useState(null);
    const [draftSetup, setDraftSetup] = useState(emptySetup);
    const rememberedModel = (deviceId) => {
        const name = pickerMemory.choice(deviceId);
        return name && (pickerMemory.models(deviceId) || []).some((model) => model.name === name) ? name : null;
    };
    const [draftModel, setDraftModel] = useState(() => rememberedModel(draftDevice));
    const [draftTitle, setDraftTitle] = useState('');
    const [exportFile, setExportFile] = useState(null);
    const [wide, setWide] = useState(() => window.innerWidth > 900);

    const abortRef = useRef(null);
    const turnRef = useRef(null);
    const bottomRef = useRef(null);
    const followRef = useRef(true);
    const idleLive = () => ({ chatId: null, target: null, joined: false, seq: 0, syncing: false, buffer: [], lastAt: 0 });
    const liveRef = useRef(idleLive());
    const streamingRef = useRef(null);
    const chatRef = useRef(null);
    const pieceRef = useRef(null);
    const syncRef = useRef(null);
    chatRef.current = chat;
    const fileInputRef = useRef(null);
    const busy = Boolean(live);

    const openPop = (name) => {
        setView('main');
        setPop(name);
    };
    const closePop = useCallback(() => setPop(null), []);
    const guide = useGuide();

    useEffect(() => {
        const onResize = () => setWide(window.innerWidth > 900);
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, []);

    const loadChats = useCallback(async (term = '') => {
        try {
            setChats((await chatService.list(term)).chats);
        } catch (error) {
            notifyError(describeError(error, 'Your chats could not be loaded.'));
        }
    }, [notifyError]);

    // The computer this chat runs on. With none chosen the server picks one.
    const currentDevice = chat?.device || draftDevice || null;
    // While the list for the computer in use is on its way, what was last seen on that same computer is shown.
    const models = useMemo(() => (modelState.device === currentDevice ? modelState.list : keptModels(currentDevice)), [modelState, currentDevice]);
    const modelsLoaded = modelState.device === currentDevice ? modelState.loaded : Boolean(pickerMemory.models(currentDevice));

    const loadDevices = useCallback(() => {
        deviceService.listPickable()
            .then((result) => {
                setDevices(result.devices);
                pickerMemory.keepDevices(result.devices, result.current);
                const preferred = preferDevice(result.devices, result.current);
                // A remembered choice is kept while that computer can still be used; otherwise the best one takes its place.
                setDraftDevice((now) => (now && result.devices.some((device) => device.id === now && device.online && !device.paused) ? now : preferred));
                // The other computers' models are fetched quietly, so switching to one shows its models at once.
                result.devices
                    .filter((device) => deviceService.ready(device))
                    .forEach((device) => modelService.installedOn(device.id).then((answer) => pickerMemory.keepModels(device.id, answer.models)).catch(() => {}));
            })
            .catch(() => {});
    }, []);

    useEffect(() => {
        loadDevices();
    }, [loadDevices]);

    useEffect(() => {
        chatService.on(currentDevice);
        return () => chatService.on(null);
    }, [currentDevice]);

    // The list always belongs to the computer in use: what was last seen on it is shown at once, never another
    // computer's models, and an answer that arrives after the person has moved on is dropped.
    const loadModels = useCallback(async () => {
        const ask = ++modelsAsk.current;
        const kept = pickerMemory.models(currentDevice);
        setModelState({ device: currentDevice, list: keptModels(currentDevice), loaded: Boolean(kept) });
        try {
            const result = await modelService.installedOn(currentDevice);
            pickerMemory.keepModels(currentDevice, result.models);
            if (ask !== modelsAsk.current) return;
            setModelState({ device: currentDevice, list: result.models.filter((model) => model.canChat !== false), loaded: true });
            if ('webSearch' in result) setWebSearch(Boolean(result.webSearch));
        } catch {
            if (ask !== modelsAsk.current) return;
            setModelState({ device: currentDevice, list: keptModels(currentDevice), loaded: true });
        }
    }, [currentDevice]);

    useEffect(() => {
        loadModels();
    }, [loadModels]);

    useEffect(() => {
        const timer = setTimeout(() => loadChats(search), search ? 250 : 0);
        return () => clearTimeout(timer);
    }, [search, loadChats]);

    useEffect(() => {
        if (!routeId) {
            setChat(null);
            setDraftSetup(emptySetup);
            return;
        }
        if (chat?.id === routeId) return;
        chatService.get(routeId)
            .then((result) => {
                setChat(result.chat);
                if (result.chat.replying) joinReply(result.chat);
            })
            .catch((error) => {
                notifyError(describeError(error, 'This chat could not be opened.'));
                navigate('/chat', { replace: true });
            });
    }, [routeId]);

    useEffect(() => {
        if (!chat) return;
        setDraftSetup({
            instructions: chat.instructions || [],
            skills: chat.skills || null,
            tools: chat.tools || [],
            ...Object.fromEntries(MODEL_SETTINGS.map((setting) => [setting.key, chat.options?.[setting.key] ?? ''])),
            num_ctx: chat.options?.num_ctx ?? ''
        });
    }, [chat?.id, chat?.updatedAt]);

    const currentModel = chat?.model || draftModel;

    // A new chat names a model as soon as the computer's models are known: one already in memory if there is one.
    // It is only a first guess, so the server's own choice replaces it when that arrives.
    const guessRef = useRef(null);
    useEffect(() => {
        if (chat || currentModel || models.length === 0) return;
        const guess = (models.find((model) => model.ready) || models[0]).name;
        guessRef.current = guess;
        setDraftModel(guess);
    }, [chat?.id, currentModel, models]);

    // After moving to another computer, a model that is not on it is swapped for one that is.
    useEffect(() => {
        if (!modelsLoaded || models.length === 0 || !currentModel || models.some((model) => model.name === currentModel)) return;
        if (!chat) setDraftModel(models[0].name);
        else chatService.update(chat.id, { model: models[0].name }).then((result) => setChat(result.chat)).catch(() => {});
    }, [modelsLoaded, models, currentModel, chat?.id]);

    const changeDevice = async (id) => {
        closePop();
        deviceService.choose(id);
        if (!chat) {
            setDraftDevice(id);
            setDraftModel(rememberedModel(id));
            return;
        }
        // The picker changes at once; the server is told behind it, and the old choice comes back if it refuses.
        const before = chat.device;
        setChat((now) => now && { ...now, device: id });
        try {
            const saved = (await chatService.update(chat.id, { device: id })).chat;
            setChat((now) => (now && now.id === saved.id && now.device === id ? saved : now));
        } catch (error) {
            setChat((now) => (now && now.device === id ? { ...now, device: before } : now));
            notifyError(describeError(error, 'The computer could not be changed.'));
        }
    };

    useEffect(() => {
        if (!modelsLoaded || models.length === 0) return;
        const guessed = !chat && Boolean(currentModel) && guessRef.current === currentModel;
        modelService.loadModel(guessed ? null : currentModel || null)
            .then((result) => {
                if (result.model) pickerMemory.keepChoice(currentDevice, result.model);
                if ((!currentModel || guessed) && result.model && guessRef.current === (guessed ? currentModel : guessRef.current)) {
                    guessRef.current = null;
                    setDraftModel(result.model);
                }
            })
            .catch(() => {});
    }, [modelsLoaded, models.length, currentModel]);

    useEffect(() => {
        if (followRef.current) bottomRef.current?.scrollIntoView({ block: 'end' });
    }, [chat?.messages?.length, live?.content, live?.thinking, live?.steps?.length]);

    useEffect(() => {
        followRef.current = true;
    }, [chat?.id]);

    useEffect(() => () => abortRef.current?.abort(), []);

    useEffect(() => {
        // Whether the server can search does not depend on any computer, so it is read here and not with the model list.
        chatService.skills().then((result) => {
            setSkills(result.skills || []);
            setTools(result.tools || []);
            setWebSearch(Boolean(result.webSearch));
        }).catch(() => setSkills([]));
    }, []);

    const setupBody = (setup = draftSetup) => {
        const options = {};
        for (const setting of MODEL_SETTINGS) {
            const raw = String(setup[setting.key] ?? '').trim();
            const value = Number(raw);
            if (raw === '' || Number.isNaN(value)) continue;
            const clean = setting.whole ? Math.round(value) : value;
            options[setting.key] = setting.min === null ? clean : Math.min(setting.max, Math.max(setting.min, clean));
        }
        const instructions = setup.instructions
            .filter((item) => item.text.trim())
            .map((item, index) => ({ name: item.name.trim() || `Instruction ${index + 1}`, text: item.text, source: item.source || 'ai-base', path: item.path || null }));
        return { instructions, options, skills: setup.skills, tools: setup.tools || [] };
    };

    // With nothing chosen, a chat uses the skills that are on by default.
    const activeSkills = draftSetup.skills || skills.filter((skill) => skill.default).map((skill) => skill.id);
    const activeTools = draftSetup.tools || [];
    const toggleTool = (id) => setDraftSetup((now) => ({ ...now, tools: activeTools.includes(id) ? activeTools.filter((other) => other !== id) : [...activeTools, id] }));
    // Only a model marked as able to use tools is offered them; one whose abilities are not known yet is given the benefit of the doubt.
    const modelAbilities = models.find((model) => model.name === currentModel)?.capabilities;
    const modelUsesTools = !modelAbilities || modelAbilities.includes('tools');
    const toggleSkill = (id) => setDraftSetup((now) => ({
        ...now,
        skills: activeSkills.includes(id) ? activeSkills.filter((other) => other !== id) : [...activeSkills, id]
    }));

    const searchOn = webSearch && (chat ? chat.webSearch !== false : draftSearch);
    const toggleSearch = async () => {
        if (!chat) {
            setDraftSearch((on) => !on);
            return;
        }
        try {
            setChat((await chatService.update(chat.id, { webSearch: !searchOn })).chat);
        } catch (error) {
            notifyError(describeError(error, 'Web search could not be changed for this chat.'));
        }
    };

    const ensureChat = async () => {
        if (chat) return chat;
        const body = setupBody();
        if (draftModel) body.model = draftModel;
        if (draftDevice) body.device = draftDevice;
        body.webSearch = draftSearch;
        const created = (await chatService.create(body)).chat;
        setChat(created);
        navigate(`/chat/${created.id}`, { replace: true });
        return created;
    };

    const applyEvent = (event) => {
        if (event.type === 'queued') setLive((now) => now && { ...now, ahead: event.ahead });
        if (event.type === 'start') setLive((now) => now && { ...now, started: true, ahead: null, sharing: event.sharing || 0, loaded: event.loaded !== false });
        if (event.type === 'note') setLive((now) => now && { ...now, note: event.text });
        if (event.type === 'thinking') setLive((now) => now && { ...now, thinking: now.thinking + event.text });
        if (event.type === 'token') setLive((now) => now && { ...now, content: now.content + event.text });
        if (event.type === 'replace') setLive((now) => now && { ...now, content: event.text });
        if (event.type === 'tool') setLive((now) => now && { ...now, steps: [...(now.steps || []), { tool: event.tool, input: event.input }] });
        if (event.type === 'permission') setLive((now) => now && { ...now, permission: { id: event.id, tool: event.tool, input: event.input } });
        if (event.type === 'toolFailed' || event.type === 'token') setLive((now) => (now?.permission ? { ...now, permission: null } : now));
        if (event.type === 'toolFailed') setLive((now) => now && { ...now, steps: (now.steps || []).map((step, index, all) => (index === all.length - 1 ? { ...step, failed: event.failed } : step)) });
    };

    // Replies travel on the live connection, each piece numbered, so every app this person has open follows the same
    // reply. A missed piece, or joining part-way, is caught up from the server's copy of what has been sent so far.
    const stopFollowing = () => {
        liveRef.current = idleLive();
    };
    const followLive = (target, state) => {
        abortRef.current?.abort();
        abortRef.current = null;
        followRef.current = true;
        turnRef.current = target.id;
        liveRef.current = { ...idleLive(), chatId: target.id, target, joined: Boolean(state.joined), lastAt: Date.now() };
        setLive(state);
    };
    const applyPiece = (follow, event) => {
        if (event.type === 'end') {
            stopFollowing();
            settle(follow.target);
            return;
        }
        if (event.type === 'accepted' && follow.joined) {
            chatService.get(follow.chatId).then((result) => turnRef.current === follow.chatId && setChat(result.chat)).catch(() => {});
        }
        applyEvent(event);
    };
    const syncLive = async () => {
        const follow = liveRef.current;
        if (!follow.chatId || follow.syncing) return;
        follow.syncing = true;
        let snapshot = null;
        try {
            snapshot = await chatService.live(follow.chatId);
        } catch {
            snapshot = null;
        }
        if (liveRef.current !== follow) return;
        follow.syncing = false;
        follow.lastAt = Date.now();
        if (!snapshot) return;
        if (!snapshot.replying) {
            stopFollowing();
            settle(follow.target);
            return;
        }
        setLive((now) => now && { ...now, content: '', thinking: '', steps: [], note: undefined, started: false, ahead: null });
        snapshot.events.forEach((event) => applyPiece(follow, event));
        follow.seq = snapshot.seq;
        const waiting = follow.buffer.filter((piece) => piece.seq > follow.seq).sort((a, b) => a.seq - b.seq);
        follow.buffer = [];
        waiting.forEach((piece) => pieceRef.current?.(piece));
    };
    syncRef.current = syncLive;
    pieceRef.current = (piece) => {
        if (!piece?.chatId || streamingRef.current === piece.chatId) return;
        const follow = liveRef.current;
        if (follow.chatId !== piece.chatId) {
            // Another of this person's apps started a reply in the chat that is open here.
            const open = chatRef.current;
            if (open?.id === piece.chatId && piece.event.type !== 'end') {
                followLive(open, { joined: true, content: '', thinking: '', ahead: null, started: false });
                syncLive();
            }
            return;
        }
        follow.lastAt = Date.now();
        if (follow.syncing) {
            follow.buffer.push(piece);
            return;
        }
        if (piece.seq <= follow.seq) return;
        if (piece.seq !== follow.seq + 1) {
            follow.buffer.push(piece);
            syncLive();
            return;
        }
        follow.seq = piece.seq;
        applyPiece(follow, piece.event);
    };

    useEffect(() => appService.onNotification('chat:reply', (piece) => pieceRef.current?.(piece)), []);

    // A computer or model changed somewhere: the pickers here follow.
    const availabilityRef = useRef(null);
    availabilityRef.current = () => {
        loadDevices();
        loadModels();
    };
    // A chat changed in another of this person's open apps: the list follows, and so does the open chat unless a
    // reply is being written into it here.
    const chatChangedRef = useRef(null);
    chatChangedRef.current = async (detail = {}) => {
        loadChats(search);
        const open = chatRef.current;
        if (!open || detail.id !== open.id) return;
        if (detail.removed) {
            leave();
            navigate('/chat', { replace: true });
            return;
        }
        if (live) return;
        try {
            const next = (await chatService.get(open.id)).chat;
            if (chatRef.current?.id !== next.id) return;
            setChat(next);
            if (next.replying) joinReply(next);
        } catch {
            return;
        }
    };
    useEffect(() => {
        const onAvailability = () => availabilityRef.current?.();
        const onChat = (event) => chatChangedRef.current?.(event.detail);
        window.addEventListener('ollama-availability-changed', onAvailability);
        window.addEventListener('mollama-chat-changed', onChat);
        return () => {
            window.removeEventListener('ollama-availability-changed', onAvailability);
            window.removeEventListener('mollama-chat-changed', onChat);
        };
    }, []);

    // If the live connection goes quiet in the middle of a reply, the server is asked where the reply has got to.
    useEffect(() => {
        const timer = setInterval(() => {
            const follow = liveRef.current;
            if (follow.chatId && !follow.syncing && Date.now() - follow.lastAt > 6000) syncRef.current?.();
        }, 3000);
        return () => clearInterval(timer);
    }, []);

    const runTurn = async (target, body, shownText) => {
        const state = { userText: shownText, editIndex: body.editIndex, regenerate: Boolean(body.regenerate), content: '', thinking: '', ahead: null, started: false };
        if (appService.notificationsConnected()) {
            followLive(target, state);
            try {
                const result = await chatService.send(target.id, { ...body, live: true }, { onEvent: applyEvent });
                if (result?.started) return;
                stopFollowing();
                settle(target);
                return;
            } catch (error) {
                stopFollowing();
                const refusedLive = error.response?.status === 400 && /live/i.test(error.response.data?.message || '');
                if (!refusedLive && error.response) {
                    notifyError(describeError(error, 'The message could not be sent.'));
                    if (shownText && !body.regenerate && body.editIndex === undefined) setText(shownText);
                    settle(target);
                    return;
                }
                if (!refusedLive) {
                    joinReply(target);
                    return;
                }
            }
        }
        followRef.current = true;
        const controller = new AbortController();
        abortRef.current = controller;
        turnRef.current = target.id;
        streamingRef.current = target.id;
        setLive(state);
        let failure = null;
        try {
            await chatService.send(target.id, body, {
                signal: controller.signal,
                onEvent: applyEvent
            });
        } catch (error) {
            if (error.name !== 'AbortError') failure = error;
        }
        streamingRef.current = null;
        abortRef.current = null;

        if (failure?.response) {
            notifyError(describeError(failure, 'The message could not be sent.'));
            if (shownText && !body.regenerate && body.editIndex === undefined) setText(shownText);
        } else if (failure) {
            joinReply(target);
            return;
        }
        if (controller.signal.aborted) return;
        settle(target);
    };

    const settle = async (target) => {
        let next = target;
        try {
            next = (await chatService.get(target.id)).chat;
        } catch {
            next = target;
        }
        if (turnRef.current !== target.id) return;
        setChat(next);
        if (next.replying) {
            joinReply(next);
            return;
        }
        setLive(null);
        loadChats(search);
        loadModels();
    };

    const joinReply = async (target) => {
        if (appService.notificationsConnected()) {
            followLive(target, { joined: true, content: '', thinking: '', ahead: null, started: false });
            syncLive();
            return;
        }
        abortRef.current?.abort();
        followRef.current = true;
        const controller = new AbortController();
        abortRef.current = controller;
        turnRef.current = target.id;
        setLive({ joined: true, content: '', thinking: '', ahead: null, started: false });
        const onEvent = (event) => {
            if (event.type === 'accepted') chatService.get(target.id).then((result) => turnRef.current === target.id && setChat(result.chat)).catch(() => {});
            applyEvent(event);
        };
        const joined = await chatService.rejoin(target.id, { signal: controller.signal, onEvent }).catch(() => false);
        if (controller.signal.aborted) return;
        abortRef.current = null;
        if (joined) {
            settle(target);
            return;
        }
        try {
            setChat((await chatService.get(target.id)).chat);
        } catch {
            setChat(target);
        }
        setLive(null);
        loadChats(search);
        loadModels();
    };

    const sendText = async (content) => {
        const trimmed = content.trim();
        if (!trimmed) return;
        if (busy) {
            if (!chat) return;
            setText('');
            try {
                const result = await chatService.send(chat.id, { content: trimmed }, { onEvent: applyEvent });
                if (result?.queued) setChat((now) => now && { ...now, queued: result.queued });
            } catch (error) {
                setText(trimmed);
                notifyError(describeError(error, 'The message could not be sent.'));
            }
            return;
        }
        setText('');
        try {
            const target = await ensureChat();
            await runTurn(target, { content: trimmed }, trimmed);
        } catch (error) {
            setText(trimmed);
            notifyError(describeError(error, 'The chat could not be started.'));
        }
    };

    const leave = () => {
        abortRef.current?.abort();
        abortRef.current = null;
        streamingRef.current = null;
        stopFollowing();
        turnRef.current = null;
        setLive(null);
        loadChats(search);
    };

    const newChat = () => {
        closePop();
        leave();
        setChat(null);
        setDraftModel(null);
        setDraftSetup(emptySetup);
        navigate('/chat');
    };

    const openChat = (id) => {
        closePop();
        if (id !== chat?.id) leave();
        navigate(`/chat/${id}`);
    };

    const saveSetup = async () => {
        closePop();
        if (!chat) return;
        try {
            setChat((await chatService.update(chat.id, setupBody())).chat);
            success('Instructions saved for this chat.');
        } catch (error) {
            notifyError(describeError(error, 'The instructions could not be saved.'));
        }
    };

    const changeArticle = (index, changes) => setDraftSetup((now) => ({
        ...now,
        instructions: now.instructions.map((item, position) => (position === index ? { ...item, ...changes } : item))
    }));
    const addArticle = (article) => {
        setView('main');
        setDraftSetup((now) => (now.instructions.length >= MAX_ARTICLES ? now : { ...now, instructions: [...now.instructions, article] }));
    };
    const removeArticle = (index) => setDraftSetup((now) => ({ ...now, instructions: now.instructions.filter((_, position) => position !== index) }));

    const articleFromFile = async (path, name) => {
        setView('main');
        setWorking('Reading the file…');
        try {
            const file = await fileService.text(path);
            addArticle({ name: file.name || name, text: file.text, source: 'fs-one', path });
        } catch (error) {
            notifyError(describeError(error, 'The file could not be read.'));
        } finally {
            setWorking(null);
        }
    };

    const keepArticle = async (article, index) => {
        if (!article.text.trim()) return;
        try {
            await promptService.create({
                name: article.name.trim() || `Instruction ${index + 1}`,
                text: article.text,
                source: article.source || 'ai-base',
                path: article.source === 'fs-one' ? article.path : null
            });
            success('Saved. You can add it to any chat from Saved.');
        } catch (error) {
            notifyError(describeError(error, 'The instruction could not be saved.'));
        }
    };

    const changeModel = async (name) => {
        closePop();
        pickerMemory.keepChoice(currentDevice, name);
        guessRef.current = null;
        if (!chat) {
            setDraftModel(name);
            return;
        }
        const before = chat.model;
        setChat((now) => now && { ...now, model: name });
        try {
            const saved = (await chatService.update(chat.id, { model: name })).chat;
            setChat((now) => (now && now.id === saved.id && now.model === name ? saved : now));
        } catch (error) {
            setChat((now) => (now && now.model === name ? { ...now, model: before } : now));
            notifyError(describeError(error, 'The model could not be changed.'));
        }
    };

    const rename = async () => {
        const title = draftTitle.trim();
        if (!title) return;
        closePop();
        try {
            setChat((await chatService.update(chat.id, { title })).chat);
            loadChats(search);
        } catch (error) {
            notifyError(describeError(error, 'The chat could not be renamed.'));
        }
    };

    const removeChat = async () => {
        closePop();
        if (!(await confirm(`Delete "${chat.title}"? Its messages and attached documents are removed for good.`, { confirmLabel: 'Delete', color: 'error' }))) return;
        try {
            await chatService.remove(chat.id);
            setChat(null);
            navigate('/chat', { replace: true });
            loadChats(search);
        } catch (error) {
            notifyError(describeError(error, 'The chat could not be deleted.'));
        }
    };

    const exportAs = async (format, toFiles = false) => {
        try {
            const result = await chatService.exportChat(chat.id, format);
            if (toFiles) {
                setExportFile(result);
                setView('files');
            } else {
                closePop();
                downloadText(result.fileName, result.content);
            }
        } catch (error) {
            notifyError(describeError(error, 'The chat could not be exported.'));
        }
    };

    const saveExport = async (folder) => {
        closePop();
        try {
            const saved = await fileService.save(folder, exportFile.fileName, exportFile.content);
            success(`Saved to ${saved.path}`);
        } catch (error) {
            notifyError(describeError(error, 'The file could not be saved.'));
        }
    };

    const attach = async (work) => {
        closePop();
        setWorking('Reading the document…');
        try {
            const target = await ensureChat();
            setChat((await work(target)).chat);
        } catch (error) {
            notifyError(describeError(error, 'The document could not be attached.'));
        } finally {
            setWorking(null);
        }
    };

    const summarise = async () => {
        setWorking('Writing a summary. This can take a minute…');
        try {
            const next = (await chatService.summarise(chat.id)).chat;
            setChat(next);
            navigate(`/chat/${next.id}`);
            loadChats(search);
            success('A new chat was started from a summary of the old one.');
        } catch (error) {
            notifyError(describeError(error, 'The summary could not be written.'));
        } finally {
            setWorking(null);
        }
    };

    const shown = useMemo(() => {
        const messages = chat?.messages || [];
        if (!live || live.joined) return messages;
        if (live.regenerate) {
            const kept = [...messages];
            while (kept.length > 0 && kept[kept.length - 1].role === 'assistant') kept.pop();
            return kept;
        }
        const base = live.editIndex !== undefined ? messages.slice(0, live.editIndex) : messages;
        const attachments = live.editIndex !== undefined ? messages[live.editIndex]?.attachments : chat?.pendingAttachments;
        return [...base, { id: 'pending', index: base.length, role: 'user', content: live.userText, attachments: attachments || [] }];
    }, [chat, live]);

    const context = chat?.context;
    const pending = live ? [] : chat?.pendingAttachments || [];
    const noModels = modelsLoaded && models.length === 0;
    const modelLabel = models.find((model) => model.name === currentModel)?.displayName || (!modelsLoaded ? 'Loading models…' : currentModel || 'Model');
    const articles = draftSetup.instructions;
    const articlesFull = articles.length >= MAX_ARTICLES;

    const chatList = (
        <>
            {(chats.length > 6 || search) && (
                <Input placeholder="Search by title" value={search} onChange={(event) => setSearch(event.target.value)} width="100%" size="sm" />
            )}
            {chats.length === 0 && <Typography size="sm" color="muted">{search ? 'No chat has that title.' : 'Your chats appear here.'}</Typography>}
            <Container layout="flex-column" gap="none" padding="none" width="100%">
                {chats.map((item) => (
                    <Button
                        key={item.id}
                        size="xs"
                        variant="ghost"
                        color="secondary"
                        align="start"
                        flat
                        width="100%"
                        selected={item.id === chat?.id}
                        title={item.title}
                        onClick={() => openChat(item.id)}
                    >
                        <Typography size="xs" color="secondary" truncate>{item.title}</Typography>
                    </Button>
                ))}
            </Container>
        </>
    );

    return (
        <Page layout="block" padding="none">
            <BlockContext.Provider value={{ send: busy ? null : sendText, live: false }}>
            <Container layout="flex" wrap={false} align="stretch" gap="none" padding="none" width="100%" height="100vh">
                {wide && (
                    <Container padding="lg" height="100%">
                    <Card
                        layout="flex-column"
                        wrap={false}
                        gap="sm"
                        padding="sm"
                        width="clamp(220px, 22vw, 400px)"
                        minWidth="clamp(220px, 22vw, 400px)"
                        height="100%"
                        hover={false}
                        shadow={false}
                        borderColor="primary"
                        borderStrength="soft"
                        backgroundColor="background"
                        background="hex"
                        backgroundIntensity="subtle"
                    >
                        <Container layout="flex" padding="none">
                            <Button size="sm" variant="ghost" onClick={newChat} {...guide.tip('chat.new')}><Icon name="FiPlus" size="xs" />New chat</Button>
                        </Container>
                        <Container layout="flex-column" wrap={false} gap="sm" padding="none" width="100%" flexFill minHeight="0" overflow="auto">
                            {chatList}
                        </Container>
                    </Card>
                    </Container>
                )}

                <Container layout="flex-column" wrap={false} gap="none" padding="none" flexFill minWidth="0" height="100%">
                <Centered>
                    <Container layout="flex" align="center" gap="xs" padding="none" width="100%">
                        <Container padding="none" flexFill minWidth="120px">
                            <Typography as="h1" size="md" weight="semibold" color="secondary" truncate>{chat?.title || 'New chat'}</Typography>
                        </Container>

                        {!wide && (
                            <Pop label="Chats" icon="FiMessageSquare" open={pop === 'chats'} onOpen={() => openPop('chats')} onClose={closePop} width="300px">
                                <Row icon="FiPlus" label="New chat" onClick={newChat} />
                                {chatList}
                            </Pop>
                        )}

                        {chat && (
                            <Pop
                                label=""
                                icon="FiMoreHorizontal"
                                title="More"
                                open={pop === 'more'}
                                onOpen={() => { setDraftTitle(chat.title); openPop('more'); }}
                                onClose={closePop}
                                disabled={busy}
                                width={view === 'files' ? '440px' : '270px'}
                            >
                                {view === 'rename' && (
                                    <>
                                        <Input
                                            label="Chat name"
                                            size="sm"
                                            width="100%"
                                            maxLength={120}
                                            value={draftTitle}
                                            onChange={(event) => setDraftTitle(event.target.value)}
                                            onKeyDown={(event) => event.key === 'Enter' && rename()}
                                        />
                                        <Container layout="flex" justify="end" gap="xs" padding="none" width="100%">
                                            <Button size="sm" variant="ghost" onClick={() => setView('main')}>Back</Button>
                                            <Button size="sm" color="primary" disabled={!draftTitle.trim()} onClick={rename}>Save</Button>
                                        </Container>
                                    </>
                                )}
                                {view === 'files' && <FileBrowser mode="save" onPick={saveExport} onBack={() => setView('main')} />}
                                {view === 'main' && (
                                    <Container layout="flex-column" gap="none" padding="none" width="100%">
                                        <Row icon="FiEdit" label="Rename" onClick={() => setView('rename')} />
                                        {chat.messages.length > 0 && (
                                            <>
                                                <Row icon="FiDownload" label="Download as Markdown" onClick={() => exportAs('markdown')} />
                                                <Row icon="FiDownload" label="Download as JSONL" onClick={() => exportAs('jsonl')} />
                                                <Row icon="FiHardDrive" label="Save Markdown to my files" onClick={() => exportAs('markdown', true)} />
                                                <Row icon="FiHardDrive" label="Save JSONL to my files" onClick={() => exportAs('jsonl', true)} />
                                            </>
                                        )}
                                        <Row icon="FiTrash2" iconColor="error" label="Delete chat" onClick={removeChat} />
                                    </Container>
                                )}
                            </Pop>
                        )}
                        <Container padding="none" width="3.5rem" />
                    </Container>

                </Centered>
                    <Container
                        layout="block"
                        padding="none"
                        width="100%"
                        flexFill
                        minHeight="0"
                        overflow="auto"
                        onScroll={(event) => {
                            const box = event.currentTarget;
                            followRef.current = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
                        }}
                    >
                    <Centered gap="md">
                        {chat?.summary && (
                            <Container layout="flex-column" gap="xs" padding="none" width="100%">
                                <Typography size="sm" color="muted">This chat continues from an earlier one and started with this summary:</Typography>
                                <Markdown text={chat.summary} />
                            </Container>
                        )}
                        {shown.length === 0 && !busy && (
                            <Container layout="flex-column" gap="sm" padding="none" marginTop="xl">
                                <Typography size="lg" weight="semibold">What would you like to work on?</Typography>
                                {noModels ? (
                                    <>
                                        <Typography size="sm" color="muted">No model is installed on this device yet. Download one first.</Typography>
                                        <Button size="sm" color="primary" onClick={() => navigate('/models')}>Open Models</Button>
                                    </>
                                ) : (
                                    <>
                                        <Typography size="sm" color="muted">Nothing needs to be chosen first. You can also attach a document and ask about it.</Typography>
                                        <Button size="sm" variant="ghost" onClick={() => sendText(FIRST_MESSAGE)}>Try: “{FIRST_MESSAGE}”</Button>
                                    </>
                                )}
                            </Container>
                        )}
                        {shown.map((message, index) => (
                            <Message
                                key={message.id}
                                message={message}
                                isLast={index === shown.length - 1}
                                busy={busy}
                                onRegenerate={() => runTurn(chat, { regenerate: true }, null)}
                                onEdit={(messageIndex, content) => runTurn(chat, { content, editIndex: messageIndex }, content)}
                            />
                        ))}
                        {live && (
                            <Container layout="flex-column" gap="xs" padding="none" width="100%">
                                {live.steps?.length > 0 && <Steps steps={live.steps} live />}
                                {live.permission && (
                                    <Card layout="flex-column" gap="xs" padding="sm" width="100%" hover={false} borderColor="primary">
                                        <Container layout="flex" align="center" gap="xs" padding="none" wrap={false}>
                                            <Icon name="FiShield" size="xs" color="warning" />
                                            <Typography size="xs" weight="semibold">{live.permission.tool} can change things. Allow it to run?</Typography>
                                        </Container>
                                        <Typography size="xxs" color="muted" font="monospace">{live.permission.input}</Typography>
                                        <ButtonGroup size="xs" spaced selectable={false} justify="start">
                                            {[['once', 'Allow once', 'primary'], ['always', 'Always in this chat', 'secondary'], ['no', 'Refuse', 'error']].map(([answer, label, color]) => (
                                                <Button key={answer} size="xs" color={color} onClick={() => {
                                                    const question = live.permission.id;
                                                    setLive((now) => now && { ...now, permission: null });
                                                    chatService.answerPermission(chat.id, question, answer).catch(() => {});
                                                }}>{label}</Button>
                                            ))}
                                        </ButtonGroup>
                                    </Card>
                                )}
                                {live.thinking && <Thinking text={live.thinking} startOpen />}
                                {live.content
                                    ? <BlockContext.Provider value={LIVE_BLOCKS}><Markdown text={live.content} /></BlockContext.Provider>
                                    : (
                                        <Typography key={liveStatus(live)} color="secondary" size="xxs" animation="typewriter">{liveStatus(live)}</Typography>
                                    )}
                            </Container>
                        )}
                        {live && (chat?.queued || []).map((item, index) => (
                            <Container key={`${index}-${item}`} layout="flex-column" gap="xs" padding="none" width="100%" align="end">
                                <Card backgroundColor="background" borderColor="secondary" borderStrength="soft" shadow={false} hover={false} layout="flex-column" gap="xs" padding="sm" maxWidth="85%"><PlainText text={item} /></Card>
                                <Typography size="xs" color="muted">Waiting. It is sent when the reply above is finished.</Typography>
                            </Container>
                        ))}
                        <Container ref={bottomRef} padding="none" />
                    </Centered>
                    </Container>
                <Centered>

                    {context?.warn && !busy && chat.messages.length > 0 && (
                        <Container layout="flex" align="center" gap="sm" padding="none" role="status">
                            <Typography size="sm" color="warning">This chat is nearly as long as the model can read ({context.percent}% used). Older messages will soon be forgotten.</Typography>
                            <Button size="xs" color="primary" disabled={Boolean(working)} onClick={summarise}>New chat from summary</Button>
                        </Container>
                    )}

                    <Card backgroundColor="background" borderColor="secondary" borderStrength="soft" shadow={false} hover={false} layout="flex-column" gap="xs" padding="sm" width="100%">
                        {working && pop !== 'setup' && <Typography size="sm" color="muted">{working}</Typography>}
                        {pending.length > 0 && (
                            <Container layout="flex" align="center" gap="xs" padding="none">
                                {pending.map((file) => (
                                    <Button
                                        key={file.id}
                                        size="xs"
                                        variant="ghost"
                                        title={`${file.path || file.name}. Click to remove.`}
                                        onClick={async () => setChat((await chatService.removeAttachment(chat.id, file.id)).chat)}
                                    >
                                        <Icon name="FiFileText" size="xs" />{file.name}<Icon name="FiX" size="xs" />
                                    </Button>
                                ))}
                            </Container>
                        )}
                        <Typography as="div" size="xs" width="100%">
                        <Input
                            multiline
                            rows={2}
                            size="xs"
                            inheritText
                            dictation
                            onDictationError={notifyError}
                            width="100%"
                            variant="underline"
                            backgroundColor="background"
                            placeholder={noModels ? 'Download a model on the Models page first' : 'Write a message. Enter sends, Shift+Enter starts a new line.'}
                            value={text}
                            disabled={noModels}
                            onChange={(event) => setText(event.target.value)}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                                    event.preventDefault();
                                    sendText(text);
                                }
                            }}
                        />
                        </Typography>
                        <Container layout="flex" wrap={false} align="center" justify="between" gap="xs" padding="none" width="100%">
                            <Pop
                                label="Attach"
                                icon="FiPaperclip"
                                iconOnly
                                size="xs"
                                open={pop === 'attach'}
                                onOpen={() => openPop('attach')}
                                onClose={closePop}
                                disabled={busy || Boolean(working) || noModels}
                                width={view === 'files' ? '440px' : '240px'}
                            >
                                {view === 'files' ? (
                                    <FileBrowser mode="read" onPick={(path) => attach((target) => chatService.attachFile(target.id, path))} onBack={() => setView('main')} />
                                ) : (
                                    <Container layout="flex-column" gap="none" padding="none" width="100%">
                                        <Row icon="FiMonitor" label="From this computer" onClick={() => { closePop(); fileInputRef.current?.click(); }} />
                                        <Row icon="FiHardDrive" label="From my files" onClick={() => setView('files')} />
                                    </Container>
                                )}
                            </Pop>
                            <Button
                                size="xs"
                                variant="ghost"
                                color={searchOn ? 'primary' : 'secondary'}
                                selected={searchOn}
                                disabled={!webSearch}
                                title={!webSearch ? 'Web search is not set up on the server' : searchOn ? 'Web search is on for this chat. Click to turn it off.' : 'Web search is off for this chat. Click to turn it on.'}
                                aria-label="Web search"
                                aria-pressed={searchOn}
                                onClick={toggleSearch}
                            >
                                <Icon name={searchOn ? 'FiGlobe' : 'FiSlash'} size="xs" />
                            </Button>
                            <Input
                                ref={fileInputRef}
                                type="file"
                                hidden
                                accept=".txt,.md,.markdown,.csv,.tsv,.json,.log,.pdf,.docx,.xml,.yaml,.yml,.html"
                                onChange={(event) => {
                                    const file = event.target.files?.[0];
                                    event.target.value = '';
                                    if (!file) return;
                                    if (file.size > 20 * 1024 * 1024) {
                                        notifyError('This file is larger than 20 MB. Use a smaller file.');
                                        return;
                                    }
                                    attach((target) => chatService.attachUpload(target.id, file));
                                }}
                            />
                            <Container padding="none" flexFill minWidth="0">
                                {context && (
                                    <Typography
                                        size="xxs"
                                        color={context.warn ? 'warning' : 'muted'}
                                        truncate
                                        title={`${context.usedTokens.toLocaleString()} of ${context.capacityTokens.toLocaleString()} tokens used${pending.length > 0 ? ', including what is attached' : ''}`}
                                    >
                                        {100 - context.percent}% context left
                                    </Typography>
                                )}
                            </Container>
                            {devices.length > 1 && (
                                <Pop label={devices.find((device) => device.id === currentDevice)?.name || 'Computer'} icon="FiMonitor" iconEnd size="xs" open={pop === 'device'} onOpen={() => openPop('device')} onClose={closePop} width="330px">
                                    {devices.map((device) => (
                                        <Row key={device.id} icon="FiMonitor" label={device.name} size="xs" selected={device.id === currentDevice} disabled={!device.online || device.paused} onClick={() => changeDevice(device.id)}>
                                            {deviceService.ready(device)
                                                ? <Icon name="FiCheckCircle" size="xs" color="success" title="Ready to use right now" aria-label="Ready to use right now" />
                                                : <Badge size="xxs" color={device.paused ? 'warning' : device.online ? 'success' : 'default'}>{device.paused ? 'Paused' : device.online ? 'Online' : 'Offline'}</Badge>}
                                        </Row>
                                    ))}
                                </Pop>
                            )}
                            <Pop label={modelLabel} icon="FiCpu" iconEnd size="xs" open={pop === 'model'} onOpen={() => openPop('model')} onClose={closePop} width="330px">
                                {models.length === 0 && <Typography size="xs" color="muted">{modelsLoaded ? 'No model is installed yet.' : 'Loading the models on this computer…'}</Typography>}
                                {models.map((model) => (
                                    <Row key={model.name} label={model.displayName} size="xs" selected={model.name === currentModel} onClick={() => changeModel(model.name)}>
                                        <Badge size="xxs" color={FIT_COLORS[model.fit?.verdict] || 'tertiary'}>{model.fit?.label || 'Fit unknown'}</Badge>
                                        {model.ready && <Icon name="FiCheckCircle" size="xs" color="success" title="Loaded and ready to use right now" aria-label="Loaded and ready to use right now" />}
                                    </Row>
                                ))}
                            </Pop>
                            {busy && <Button size="xs" color="error" title="Stop" aria-label="Stop" onClick={() => turnRef.current && chatService.stop(turnRef.current).catch(() => {})}><Icon name="FiSquare" size="xs" /></Button>}
                            <Button size="xs" color="primary" title={busy ? 'Send when this reply is finished' : 'Send'} aria-label="Send" disabled={!text.trim() || noModels} onClick={() => sendText(text)} {...guide.tip('chat.send')}><Icon name="FiArrowUp" size="xs" /></Button>
                        </Container>
                    </Card>
                    <Container layout="flex" justify="center" padding="none" width="100%">
                        <Typography size="xxs" color="muted">
                            {devices.find((device) => device.id === currentDevice)?.kind === 'cloud'
                                ? 'Replies are written by a model that runs online. What you type and attach in this chat is sent to that service, under your own account with it, and it is billed by them. Dictation is done by your browser, which may send your voice to its maker.'
                                : searchOn
                                ? 'Replies are written by a model running on this device. When the model searches the web, its search words go to the search service set on the server and the pages it opens are loaded by this server. Dictation is done by your browser, which may send your voice to its maker.'
                                : `Replies are written by a model running on this device. Nothing you type or attach is sent to an outside AI service. ${webSearch ? 'Web search is off for this chat, so the model cannot look things up.' : 'Web search is off, so models cannot look things up; it is turned on by setting a search key on the server.'} Dictation is done by your browser, which may send your voice to its maker.`}
                        </Typography>
                    </Container>
                </Centered>
                </Container>
            </Container>
            <Pop
                fab
                title="Instructions for this chat"
                badge={articles.length > 0 ? String(articles.length) : null}
                badgeColor="primary"
                icon="FiSliders"
                open={pop === 'setup'}
                onOpen={() => openPop('setup')}
                onClose={closePop}
                width="480px"
                tall
            >
                {view === 'files' && <FileBrowser mode="read" onPick={articleFromFile} onBack={() => setView('main')} />}
                {view === 'saved' && <SavedInstructions onAdd={addArticle} onBack={() => setView('main')} full={articlesFull} />}
                {view === 'tools' && (
                    <Container layout="flex-column" gap="xs" padding="none" width="100%">
                        <Container layout="flex" wrap={false} align="center" justify="between" gap="xs" padding="none" width="100%">
                            <Button size="xxs" variant="ghost" onClick={() => setView('main')}><Icon name="FiChevronLeft" size="xs" />Tools</Button>
                            <Button size="xxs" variant="ghost" onClick={() => navigate('/tools')}>Manage tools</Button>
                        </Container>
                        {!modelUsesTools && <Typography size="xxs" color="muted">This model cannot use tools. Pick one marked &quot;Can use tools&quot; on the Models page.</Typography>}
                        {tools.map((tool) => (
                        <Container key={tool.id} layout="flex" wrap={false} align="center" justify="between" gap="xs" padding="none" width="100%" title={tool.kind === 'builtin' ? tool.description : tool.ready ? `${tool.count === 1 ? '1 tool' : `${tool.count} tools`} · ${tool.kind === 'local' ? 'on your computer' : 'online'}` : `${tool.state}. Open Manage tools to see what it needs.`}>
                            <Container layout="flex-column" gap="none" padding="none" flexFill minWidth="0">
                                <Typography size="xs" truncate>{tool.name}</Typography>
                                <Typography size="xxs" color="muted" truncate>{tool.kind === 'builtin' ? tool.description : tool.ready ? `${tool.count === 1 ? '1 tool' : `${tool.count} tools`} · ${tool.kind === 'local' ? 'on your computer' : 'online'}` : `${tool.state}. Open Manage tools to see what it needs.`}</Typography>
                            </Container>
                            <Switch size="xs" checked={activeTools.includes(tool.id)} disabled={!modelUsesTools || !tool.ready} onChange={() => toggleTool(tool.id)} aria-label={tool.name} />
                        </Container>
                        ))}
                    </Container>
                )}
                {view === 'skills' && (
                    <Container layout="flex-column" gap="xs" padding="none" width="100%">
                        <Container layout="flex" wrap={false} align="center" justify="between" gap="xs" padding="none" width="100%">
                            <Button size="xxs" variant="ghost" onClick={() => setView('main')}><Icon name="FiChevronLeft" size="xs" />Skills</Button>
                            <Button size="xxs" variant="ghost" disabled={!draftSetup.skills} onClick={() => setDraftSetup((now) => ({ ...now, skills: null }))}>Use defaults</Button>
                        </Container>
                        {skills.map((skill) => (
                        <Container key={skill.id} layout="flex" wrap={false} align="center" justify="between" gap="xs" padding="none" width="100%" title={skill.description}>
                            <Container layout="flex-column" gap="none" padding="none" flexFill minWidth="0">
                                <Typography size="xs" truncate>{skill.name}</Typography>
                                <Typography size="xxs" color="muted" truncate>{skill.description}</Typography>
                            </Container>
                            <Switch size="xs" checked={activeSkills.includes(skill.id)} disabled={false} onChange={() => toggleSkill(skill.id)} aria-label={skill.name} />
                        </Container>
                        ))}
                    </Container>
                )}
                {view === 'main' && (
                    <>
                        <Typography size="xs" color="muted">
                            What the model should know or follow in this chat. Add as many pieces as you need: typed text, files, or ones you saved earlier.
                        </Typography>
                        {working && <Typography size="xs" color="muted">{working}</Typography>}
                        {(tools.length > 0 || skills.length > 0) && (
                            <Container layout="flex-column" gap="none" padding="none" width="100%">
                                {tools.length > 0 && (
                                    <Row icon="FiTool" label="Tools" title="Choose the tools models may use in this chat" onClick={() => setView('tools')}>
                                        <Typography size="xxs" color="muted">{modelUsesTools ? `${activeTools.length} on` : 'Not for this model'}</Typography>
                                        <Icon name="FiChevronRight" size="xs" />
                                    </Row>
                                )}
                                {skills.length > 0 && (
                                    <Row icon="FiZap" label="Skills" title="Choose the skills this chat uses" onClick={() => setView('skills')}>
                                        <Typography size="xxs" color="muted">{`${activeSkills.length} on`}</Typography>
                                        <Icon name="FiChevronRight" size="xs" />
                                    </Row>
                                )}
                                <Divider margin="xs" />
                            </Container>
                        )}
                        {articles.map((article, index) => (
                            <Container key={index} layout="flex-column" gap="xs" padding="none" width="100%">
                                <Container layout="flex" wrap={false} align="center" gap="xs" padding="none" width="100%">
                                    <Icon name={article.source === 'fs-one' ? 'FiHardDrive' : 'FiType'} size="xs" />
                                    <Container padding="none" flexFill minWidth="0">
                                        <Input
                                            size="xs"
                                            width="100%"
                                            placeholder={`Instruction ${index + 1}`}
                                            maxLength={120}
                                            value={article.name}
                                            onChange={(event) => changeArticle(index, { name: event.target.value })}
                                        />
                                    </Container>
                                    <Button size="xxs" variant="ghost" title="Save for other chats" aria-label="Save for other chats" disabled={!article.text.trim()} onClick={() => keepArticle(article, index)}>
                                        <Icon name="FiBookmark" />
                                    </Button>
                                    <Button size="xxs" variant="ghost" title="Remove from this chat" aria-label="Remove from this chat" onClick={() => removeArticle(index)}>
                                        <Icon name="FiX" />
                                    </Button>
                                </Container>
                                <Input
                                    multiline
                                    rows={3}
                                    size="xs"
                                    width="100%"
                                    placeholder="For example: Reply only in formal British English."
                                    value={article.text}
                                    onChange={(event) => changeArticle(index, { text: event.target.value, source: 'ai-base', path: null })}
                                />
                                {article.source === 'fs-one' && (
                                    <Typography size="xxs" color="muted">Copied from {article.path}. Later changes to that file do not change this chat.</Typography>
                                )}
                            </Container>
                        ))}
                        <Container layout="flex" align="center" gap="xs" padding="none" width="100%">
                            <Button size="xs" variant="ghost" disabled={articlesFull} onClick={() => addArticle({ name: '', text: '', source: 'ai-base', path: null })}>
                                <Icon name="FiPlus" size="xs" />Add text
                            </Button>
                            <Button size="xs" variant="ghost" disabled={articlesFull} onClick={() => setView('files')}>
                                <Icon name="FiHardDrive" size="xs" />From my files
                            </Button>
                            <Button size="xs" variant="ghost" onClick={() => setView('saved')}>
                                <Icon name="FiBookmark" size="xs" />Saved
                            </Button>
                        </Container>
                        {advancedOpen && (
                            <>
                                <Container layout="grid" columns={2} gap="xs" padding="none" width="100%">
                                    {MODEL_SETTINGS.map((setting) => (
                                        <Input
                                            key={setting.key}
                                            label={setting.label}
                                            helpText={setting.help}
                                            type="number"
                                            size="xs"
                                            width="100%"
                                            value={draftSetup[setting.key]}
                                            onChange={(event) => setDraftSetup((now) => ({ ...now, [setting.key]: event.target.value }))}
                                        />
                                    ))}
                                </Container>
                            </>
                        )}
                        <Container layout="flex" align="center" justify="between" gap="xs" padding="none" width="100%">
                            <Button size="xs" variant="ghost" onClick={() => setAdvancedOpen((open) => !open)}>{advancedOpen ? 'Hide advanced' : 'Advanced'}</Button>
                            <Button size="xs" color="primary" onClick={saveSetup}>{chat ? 'Save' : 'Use for this chat'}</Button>
                        </Container>
                    </>
                )}
            </Pop>
            </BlockContext.Provider>
        </Page>
    );
};

export default ChatPage;
