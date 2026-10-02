const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

function load(file, overrides = {}, cache = new Map()) {
    const resolved = path.resolve(file);
    if (cache.has(resolved)) return cache.get(resolved).exports;
    const module = { exports: {} }; cache.set(resolved, module);
    const code = ts.transpileModule(fs.readFileSync(resolved, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    const local = name => {
        if (Object.hasOwn(overrides, name)) return overrides[name];
        if (!name.startsWith('.') && !name.startsWith('@/')) return require(name);
        const base = name.startsWith('@/') ? path.resolve('src', name.slice(2)) : path.resolve(path.dirname(resolved), name);
        return load(base + (fs.existsSync(base + '.ts') ? '.ts' : '.tsx'), overrides, cache);
    };
    new Function('require', 'module', 'exports', code)(local, module, module.exports);
    return module.exports;
}
function nodes(element) {
    if (!element || typeof element !== 'object') return [];
    return [element, ...[element.props?.children].flat(Infinity).flatMap(nodes)];
}
function text(element) {
    if (element == null || typeof element === 'boolean') return '';
    if (typeof element !== 'object') return String(element);
    return [element.props?.children].flat(Infinity).map(text).join(' ');
}
const controls = {
    'next/link': 'a', 'next/image': 'img',
    './ui/card': { Card: 'article', CardHeader: 'header', CardTitle: 'h2', CardContent: 'div' },
    './ui/button': { Button: 'button' }, './ui/label': { Label: 'label' }, './ui/textarea': { Textarea: 'textarea' },
    './TicketBadges': { TicketBadges: 'badges' },
    './RequestState': { LoadingState: 'loading', ErrorState: 'error' },
};

test('tenant location states explain missing occupancy and structured/legacy ticket context remains visible', () => {
    const overrides = { './RequestState': controls['./RequestState'], '@/hooks/use-resource': { useResource: () => ({ data: { unit: null }, loading: false, error: null }) } };
    const location = load('src/components/TenantLocation.tsx', overrides).TenantLocation;
    assert.match(text(location()), /manager must assign.*Existing tickets/);
    const view = load('src/components/TicketLocation.tsx').TicketLocation;
    assert.match(text(view({ ticket: { property: null, unit: null } })), /Legacy.*preserved/);
    assert.match(text(view({ ticket: { property: { name: 'Rose Court', address: '10 Rose Street' }, unit: { identifier: '4B' } } })), /Rose Court.*4B.*10 Rose/);
});

test('new-ticket form disables submission until occupancy loads and never submits a client location ID', async () => {
    let occupancy = { data: { unit: null }, loading: false, error: null, reload() {} }, calls = 0, sent;
    const page = load('src/app/tickets/new/page.tsx', {
        react: { ...require('react'), useState: initial => [initial, () => {}] }, 'next/navigation': { useRouter: () => ({ push() {} }) },
        '@/hooks/use-resource': { useResource: () => occupancy }, '@/hooks/use-toast': { useToast: () => ({ toast() {} }) },
        '@/hooks/use-mutation': { useMutation: () => ({ pending: false, run: action => action() }) },
        '@/lib/client-request': { requestData: async (url, options) => { calls++; sent = JSON.parse(options.body); } },
    }).default;
    for (const state of [{ data: null, loading: true }, { data: { unit: null }, loading: false }, { data: { unit: { id: 'unit' } }, loading: false, error: Error('Offline') }]) {
        occupancy = { ...occupancy, ...state };
        const tree = page(); assert.equal(nodes(tree).find(node => node.type === 'fieldset').props.disabled, true);
        await nodes(tree).find(node => node.type === 'form').props.onSubmit({ preventDefault() {} });
    }
    assert.equal(calls, 0);
    occupancy = { data: { unit: { id: 'unit', identifier: '4B', property: { name: 'Home' } } }, loading: false, error: null };
    const tree = page(); assert.equal(nodes(tree).find(node => node.type === 'fieldset').props.disabled, false);
    await nodes(tree).find(node => node.type === 'form').props.onSubmit({ preventDefault() {} });
    assert.equal(calls, 1); assert.equal('propertyId' in sent, false); assert.equal('unitId' in sent, false);
});

test('resource failures exit loading, preserve confirmed data, retry, and ignore stale/unmounted responses', async () => {
    let state, ref, effect, cleanup, resolveOld, calls = 0;
    const react = {
        useState: initial => { state ??= initial; return [state, update => { state = typeof update === 'function' ? update(state) : update; }]; },
        useRef: initial => { ref ??= { current: initial }; return ref; }, useCallback: callback => callback,
        useEffect: callback => { effect = callback; },
    };
    const { useResource } = load('src/hooks/use-resource.ts', { react, '@/lib/client-request': { requestData: async () => {
        calls++; if (calls === 1) throw new Error('Offline'); if (calls === 2) return ['Confirmed'];
        return new Promise(resolve => { resolveOld = resolve; });
    } } });
    let resource = useResource('/api/tickets'); cleanup = effect();
    await new Promise(resolve => setImmediate(resolve)); assert.equal(state.loading, false); assert.equal(state.data, null); assert.ok(state.error);
    resource = useResource('/api/tickets'); await resource.reload(); assert.deepEqual(state.data, ['Confirmed']); assert.equal(state.error, null);
    const pending = resource.reload(); cleanup(); resolveOld(['Stale']); await pending; assert.deepEqual(state.data, ['Confirmed']);
});

test('homepage redirects each authenticated role and presents public entry links', async () => {
    let session = null;
    const home = load('src/app/page.tsx', { 'next/link': 'a', '@/components/ui/button': { Button: 'button' }, '@/lib/auth': { getSession: async () => session }, 'next/navigation': { redirect: target => { throw new Error(target); } } }).default;
    const entry = await home(); assert.match(text(entry), /maintenance|repairs/); assert.deepEqual(nodes(entry).filter(n => n.type === 'a').map(n => n.props.href), ['/login', '/register']);
    for (const [role, target] of [['TENANT', '/dashboard'], ['MANAGER', '/manager/dashboard'], ['TECHNICIAN', '/tech/dashboard']]) { session = { role }; await assert.rejects(home(), error => error.message === target); }
});

test('dashboard loading/errors never masquerade as zero metrics or an empty ticket list', () => {
    let resource = { data: null, loading: true, error: null, reload() {} };
    const dashboard = load('src/components/Dashboard.tsx', { ...controls, '@/hooks/use-resource': { useResource: () => resource } }).Dashboard;
    for (const role of ['TENANT', 'MANAGER', 'TECHNICIAN']) {
        const loading = dashboard({ role }); assert.equal(nodes(loading).filter(n => n.type === 'loading').length, 2); assert.doesNotMatch(text(loading), /no assigned|reported any/);
        resource = { ...resource, loading: false, error: new Error('Offline') }; assert.equal(nodes(dashboard({ role })).filter(n => n.type === 'error').length, 2);
        resource = { ...resource, loading: true, error: null };
    }
    const metrics = { totalSubmitted: 0, pending: 0 };
    const emptyDashboard = load('src/components/Dashboard.tsx', { ...controls, '@/hooks/use-resource': { useResource: url => ({ data: url === '/api/metrics' ? metrics : [], loading: false, error: null }) } }).Dashboard;
    assert.match(text(emptyDashboard({ role: 'TENANT' })), /Total submitted.*0.*Pending.*0.*haven’t reported/);
});

test('detail errors have retry states and no note controls for inaccessible tickets', () => {
    const view = load('src/components/TicketDetailView.tsx', { ...controls, react: { useState: () => ['', () => {}] }, 'next/navigation': { useParams: () => ({ id: 'id' }) }, '@/hooks/use-resource': { useResource: () => ({ data: null, loading: false, error: new Error('Denied'), reload() {} }) }, '@/hooks/use-mutation': { useMutation: () => ({ pending: false, run() {} }) }, '@/hooks/use-toast': { useToast: () => ({ toast() {} }) } }).TicketDetailView;
    for (const role of ['TENANT', 'MANAGER', 'TECHNICIAN']) { const tree = view({ role }); assert.equal(nodes(tree).filter(n => n.type === 'error').length, 1); assert.equal(nodes(tree).filter(n => n.type === 'textarea').length, 0); assert.equal(nodes(tree).filter(n => n.type === 'loading').length, 0); }
});

test('authorized roles can submit notes; successful save clears input and refreshes; completed tickets cannot submit', async () => {
    const ticket = { title: 'Issue', description: 'Description', status: 'ASSIGNED', priority: 'HIGH', createdAt: new Date().toISOString(), tenant: { name: 'Tenant' }, assignedTo: { name: 'Tech' }, images: [], activityLogs: [] };
    let note = 'An update', refreshed = 0, fail = false, failures = 0;
    const sent = [];
    const view = load('src/components/TicketDetailView.tsx', { ...controls, react: { useState: () => [note, value => { note = value; }] }, 'next/navigation': { useParams: () => ({ id: 'ticket' }) }, '@/hooks/use-resource': { useResource: url => ({ data: url?.includes('/users') ? [] : ticket, loading: false, error: null, reload: async () => { refreshed++; } }) }, '@/hooks/use-mutation': { useMutation: () => ({ pending: false, run: async action => { try { await action(); } catch { failures++; } } }) }, '@/hooks/use-toast': { useToast: () => ({ toast() {} }) }, '@/lib/client-request': { requestData: async (url, options) => { if (fail) throw Error('Offline'); sent.push({ url, body: JSON.parse(options.body) }); } } }).TicketDetailView;
    for (const role of ['TENANT', 'MANAGER', 'TECHNICIAN']) {
        note = 'An update'; let tree = view({ role }); const form = nodes(tree).find(n => n.type === 'form' && nodes(n).some(c => c.type === 'textarea'));
        assert.ok(form); await form.props.onSubmit({ preventDefault() {} }); await new Promise(resolve => setImmediate(resolve)); assert.equal(note, '');
    }
    assert.equal(sent.length, 3); assert.equal(refreshed, 3); assert.ok(sent.every(s => s.url === '/api/tickets/ticket/notes' && s.body.note === 'An update'));
    note = 'Keep on failure'; fail = true; const form = nodes(view({ role: 'TENANT' })).find(n => n.type === 'form'); await form.props.onSubmit({ preventDefault() {} }); await new Promise(resolve => setImmediate(resolve)); assert.equal(note, 'Keep on failure'); assert.equal(failures, 1);
    ticket.status = 'DONE'; for (const role of ['TENANT', 'MANAGER', 'TECHNICIAN']) { const tree = view({ role }); assert.equal(nodes(tree).filter(n => n.type === 'textarea').length, 0); assert.match(text(tree), /Notes are closed/); }
});

test('error states distinguish missing tickets, forbidden access and expired sessions without leaking internals', () => {
    const { RequestError } = load('src/lib/client-request.ts');
    const { ErrorState } = load('src/components/RequestState.tsx', { './ui/button': { Button: 'button' }, '@/lib/client-request': { RequestError } });
    for (const [status, message] of [[404, /could not be found/], [403, /do not have access/], [401, /session has expired/], [500, /try again/]]) { const tree = ErrorState({ error: new RequestError('sensitive internal failure', false, status), retry() {} }); assert.match(text(tree), message); assert.doesNotMatch(text(tree), /sensitive/); }
});
