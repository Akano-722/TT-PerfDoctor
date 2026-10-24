/**
 * Read-only performance probes for TT-PerfDoctor.
 *
 * Everything here uses browser-standard APIs only. The one monkey patch
 * (addEventListener counters) is a transparent wrapper and can be disabled
 * by not calling installInstrumentation().
 */

const TICK_MS = 250;
const MAX_SAMPLES = 300;

let listenerAdds = 0;
let listenerRemoves = 0;
let internalDepth = 0;
let instrumentationInstalled = false;

/* ------------------------------------------------------------------ */
/* Source attribution                                                  */
/*                                                                     */
/* One stack walk per listener/timer with a per-second budget. Sources */
/* are cached per callback function so polling loops cost nothing      */
/* after the first call.                                              */
/* ------------------------------------------------------------------ */

const ATTRIBUTION_LIMIT = 300;
const STACK_BUDGET_PER_SEC = 400;

const attribution = {
    listeners: new Map(),
    timeouts: new Map(),
    intervalSchedules: new Map(),
    intervals: new Map(),
    stackDropped: 0,
};

let budgetWindowAt = 0;
let budgetUsed = 0;
const sourceCache = new WeakMap();
const debugStacks = [];
const MAX_DEBUG_STACKS = 3;

/** Own extension files, so stack frames from our wrappers are skipped. */
const SELF_FILES = (() => {
    try {
        const directory = new URL('.', import.meta.url).pathname;
        return new Set(['metrics.js', 'ui.js', 'index.js'].map(name => directory + name));
    } catch {
        return null;
    }
})();

function normalizeSource(url) {
    if (!url) {
        return null;
    }
    let parsed;
    try {
        parsed = new URL(url, globalThis.location?.href ?? 'https://local/');
    } catch {
        return null;
    }
    if (parsed.protocol === 'data:' || parsed.protocol === 'about:' || parsed.protocol === 'javascript:') {
        return null;
    }
    if (parsed.pathname.includes('TT-PerfDoctor') || (SELF_FILES && SELF_FILES.has(parsed.pathname))) {
        return null;
    }
    if (parsed.protocol === 'blob:') {
        const id = parsed.pathname.split('/').filter(Boolean).pop() ?? 'unknown';
        return `blob/${id.slice(0, 8)}`;
    }
    const parts = parsed.pathname.split('/').filter(Boolean);
    return parts.slice(-2).join('/') || parsed.hostname || parsed.protocol;
}

function captureSource() {
    const now = performance.now();
    if (now - budgetWindowAt > 1000) {
        budgetWindowAt = now;
        budgetUsed = 0;
    }
    if (budgetUsed >= STACK_BUDGET_PER_SEC) {
        attribution.stackDropped += 1;
        return null;
    }
    budgetUsed += 1;

    let stack = '';
    try {
        stack = new Error().stack ?? '';
    } catch {
        return null;
    }
    if (!stack) {
        return null;
    }

    for (const line of stack.split('\n')) {
        // Any scheme with an authority (http, https, file, blob, tauri, ...).
        const match = line.match(/([a-z][a-z0-9+.-]*:\/\/[^\s)]+?):(\d+):(\d+)/i);
        if (!match) {
            continue;
        }
        const source = normalizeSource(match[1]);
        if (source) {
            return `${source}:${match[2]}`;
        }
    }

    // Keep a few raw stacks so the report can explain why attribution failed.
    if (debugStacks.length < MAX_DEBUG_STACKS) {
        debugStacks.push(stack.slice(0, 1200));
    }
    return null;
}

function sourceFor(callback) {
    const key = callback && (typeof callback === 'function' || typeof callback === 'object')
        ? callback
        : null;
    if (key && sourceCache.has(key)) {
        return sourceCache.get(key);
    }
    const source = captureSource();
    if (key && source) {
        sourceCache.set(key, source);
    }
    return source;
}

function bump(map, source) {
    if (!source) {
        return;
    }
    const key = map.has(source) || map.size < ATTRIBUTION_LIMIT ? source : '(其他)';
    map.set(key, (map.get(key) ?? 0) + 1);
}

function installTimerAttribution() {
    if (globalThis.__TTPD_TIMERS_PATCHED__) {
        return;
    }
    const nativeSetTimeout = globalThis.setTimeout;
    const nativeSetInterval = globalThis.setInterval;
    const nativeClearInterval = globalThis.clearInterval;
    if (typeof nativeSetTimeout !== 'function' || typeof nativeSetInterval !== 'function') {
        return;
    }

    globalThis.setTimeout = function patchedSetTimeout(handler, delay, ...args) {
        if (internalDepth === 0 && typeof handler === 'function') {
            bump(attribution.timeouts, sourceFor(handler));
        }
        return Reflect.apply(nativeSetTimeout, this, [handler, delay, ...args]);
    };

    globalThis.setInterval = function patchedSetInterval(handler, delay, ...args) {
        let source = null;
        if (internalDepth === 0 && typeof handler === 'function') {
            source = sourceFor(handler);
            bump(attribution.intervalSchedules, source);
        }
        const handle = Reflect.apply(nativeSetInterval, this, [handler, delay, ...args]);
        if (source) {
            attribution.intervals.set(handle, { source, since: Date.now() });
        }
        return handle;
    };

    globalThis.clearInterval = function patchedClearInterval(handle) {
        attribution.intervals.delete(handle);
        return Reflect.apply(nativeClearInterval, this, [handle]);
    };

    globalThis.__TTPD_TIMERS_PATCHED__ = true;
}

function topEntries(map, limit) {
    return [...map.entries()]
        .sort((left, right) => right[1] - left[1])
        .slice(0, limit)
        .map(([source, count]) => ({ source, count }));
}

export function getAttribution(limit = 6) {
    const active = new Map();
    const now = Date.now();
    for (const meta of attribution.intervals.values()) {
        const entry = active.get(meta.source) ?? { count: 0, oldestMs: 0 };
        entry.count += 1;
        entry.oldestMs = Math.max(entry.oldestMs, now - meta.since);
        active.set(meta.source, entry);
    }

    return {
        listeners: topEntries(attribution.listeners, limit),
        timeouts: topEntries(attribution.timeouts, limit),
        intervalSchedules: topEntries(attribution.intervalSchedules, limit),
        intervalsActive: [...active.entries()]
            .sort((left, right) => right[1].count - left[1].count)
            .slice(0, limit)
            .map(([source, meta]) => ({ source, count: meta.count, oldestMs: meta.oldestMs })),
        stackSamplesDropped: attribution.stackDropped,
        debugStacks: debugStacks.slice(),
    };
}

export function resetAttribution() {
    attribution.listeners.clear();
    attribution.timeouts.clear();
    attribution.intervalSchedules.clear();
    attribution.stackDropped = 0;
    debugStacks.length = 0;
    budgetWindowAt = performance.now();
    budgetUsed = 0;
}

/** Run a function without counting listeners it registers as extension leakage. */
export function withInternal(fn) {
    internalDepth += 1;
    try {
        return fn();
    } finally {
        internalDepth -= 1;
    }
}

export function installInstrumentation() {
    if (instrumentationInstalled) {
        return { installed: false, reason: 'already-installed' };
    }
    instrumentationInstalled = true;

    installTimerAttribution();

    const proto = globalThis.EventTarget?.prototype;
    if (!proto || typeof proto.addEventListener !== 'function') {
        return { installed: true, listeners: false, reason: 'no-event-target' };
    }

    const add = proto.addEventListener;
    const remove = proto.removeEventListener;

    proto.addEventListener = function patchedAddEventListener() {
        if (internalDepth === 0) {
            listenerAdds += 1;
            bump(attribution.listeners, sourceFor(arguments[1]));
        }
        return Reflect.apply(add, this, arguments);
    };
    proto.removeEventListener = function patchedRemoveEventListener() {
        if (internalDepth === 0) {
            listenerRemoves += 1;
        }
        return Reflect.apply(remove, this, arguments);
    };

    return { installed: true, listeners: true };
}

export function getListenerCounters() {
    return {
        adds: listenerAdds,
        removes: listenerRemoves,
        net: listenerAdds - listenerRemoves,
    };
}

export function getDomSnapshot() {
    const chat = document.querySelector('#chat');
    return {
        nodes: document.getElementsByTagName('*').length,
        chatNodes: chat ? chat.getElementsByTagName('*').length : 0,
        mes: document.querySelectorAll('#chat > .mes').length,
        iframes: document.querySelectorAll('iframe').length,
        thRender: document.querySelectorAll('.TH-render').length,
        xiaobaixIframes: document.querySelectorAll('iframe.xiaobaix-iframe').length,
    };
}

function getSTContext() {
    try {
        return globalThis.SillyTavern?.getContext?.() ?? null;
    } catch {
        return null;
    }
}

function safeRead(fn, fallback = null) {
    try {
        return fn();
    } catch {
        return fallback;
    }
}

export function getHostConfig() {
    const abi = globalThis.__TAURITAVERN__;
    const host = globalThis.__TAURITAVERN_HOST__;
    const ctx = getSTContext();
    const extSettings = ctx?.extensionSettings ?? {};
    const disabled = Array.isArray(extSettings.disabledExtensions) ? extSettings.disabledExtensions : [];
    const isEnabled = name => !disabled.includes(`third-party/${name}`) && !disabled.includes(name);

    const surface = abi?.api?.chatSurface;
    const managed = surface
        ? safeRead(() => surface.isManagedOwnershipRequired(), null)
        : null;

    const jsr = extSettings.tavern_helper;
    const lwb = extSettings.LittleWhiteBox;

    return {
        host: {
            abiVersion: abi?.abiVersion ?? null,
            platform: host?.platform ?? null,
            kind: host?.kind ?? null,
            userAgent: navigator.userAgent,
            hardwareConcurrency: navigator.hardwareConcurrency ?? null,
            devicePixelRatio: globalThis.devicePixelRatio ?? null,
            viewport: { width: globalThis.innerWidth, height: globalThis.innerHeight },
        },
        chatSurface: {
            available: Boolean(surface),
            protocolVersion: surface?.protocolVersion ?? null,
            managedOwnershipRequired: managed,
        },
        jsSlashRunner: jsr
            ? {
                enabled: isEnabled('JS-Slash-Runner'),
                renderEnabled: jsr.render?.enabled ?? null,
                renderDepth: jsr.render?.depth ?? null,
                allowStreaming: jsr.render?.allow_streaming ?? null,
            }
            : null,
        littleWhiteBox: lwb
            ? {
                enabled: isEnabled('LittleWhiteBox'),
                renderEnabled: lwb.renderEnabled ?? null,
            }
            : null,
        extensions: {
            total: Array.isArray(ctx?.extensionNames) ? ctx.extensionNames.length : null,
            disabled: disabled.length,
        },
    };
}

/**
 * Scan the chat array once. Capped so a huge chat cannot freeze the page.
 * @param {Array<any>} chat
 * @param {number} scanLimit
 */
export function getChatSnapshot(chat, scanLimit = 8000) {
    if (!Array.isArray(chat)) {
        return null;
    }

    const scanned = Math.min(chat.length, scanLimit);
    let chars = 0;
    let withIframe = 0;
    let withScript = 0;
    let withHtml = 0;
    let swipes = 0;
    const heavy = [];

    for (let index = 0; index < scanned; index += 1) {
        const message = chat[index];
        if (!message) {
            continue;
        }

        const text = typeof message.mes === 'string' ? message.mes : '';
        chars += text.length;

        const lowered = text.toLowerCase();
        const hasIframe = lowered.includes('<iframe');
        if (hasIframe) {
            withIframe += 1;
        }
        if (lowered.includes('<script')) {
            withScript += 1;
        }
        if (/<(?:div|span|p|img|style|table|details|svg)\b/.test(lowered)) {
            withHtml += 1;
        }
        if (Array.isArray(message.swipes)) {
            swipes += Math.max(0, message.swipes.length - 1);
        }
        if (text.length >= 1500) {
            heavy.push({
                index,
                role: message.is_user ? 'user' : message.is_system ? 'system' : 'assistant',
                length: text.length,
                iframe: hasIframe,
                script: lowered.includes('<script'),
            });
        }
    }

    heavy.sort((left, right) => right.length - left.length);

    return {
        total: chat.length,
        scanned,
        truncated: scanned < chat.length,
        chars,
        avgChars: scanned ? Math.round(chars / scanned) : 0,
        swipes,
        withIframe,
        withScript,
        withHtml,
        heavy: heavy.slice(0, 10),
    };
}

function round1(value) {
    return Math.round(value * 10) / 10;
}

function p95(values) {
    if (!values.length) {
        return 0;
    }
    const sorted = [...values].sort((left, right) => left - right);
    const index = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
    return sorted[index];
}

export function summarizeSamples(samples) {
    if (!Array.isArray(samples) || !samples.length) {
        return null;
    }

    const average = key => round1(samples.reduce((sum, sample) => sum + (sample[key] || 0), 0) / samples.length);
    const peak = key => round1(Math.max(...samples.map(sample => sample[key] || 0)));

    return {
        durationMs: samples[samples.length - 1].at - samples[0].at + 1000,
        sampleCount: samples.length,
        avgFps: average('fps'),
        avgBusyPct: average('busyPct'),
        peakBusyMs: peak('busyPeakMs'),
        worstFrameMs: peak('worstFrameMs'),
        totalDroppedFrames: samples.reduce((sum, sample) => sum + (sample.droppedFrames || 0), 0),
        maxInputP95Ms: peak('inputP95Ms'),
        maxInputMs: peak('inputMaxMs'),
        scrollEvents: samples.reduce((sum, sample) => sum + (sample.scrollEvents || 0), 0),
        scrollJank: samples.reduce((sum, sample) => sum + (sample.scrollJank || 0), 0),
    };
}

/* ------------------------------------------------------------------ */
/* Isolation probes                                                    */
/*                                                                     */
/* These answer "is the frame rate capped by the page at all?" rather  */
/* than describing the page. Safe one-shot helpers; no callbacks kept. */
/* ------------------------------------------------------------------ */

/**
 * Measure requestAnimationFrame rate for a fixed window.
 * Resolves even when the document is hidden (rAF stops in that case).
 * @param {number} durationMs
 */
export function measureFps(durationMs = 2000) {
    return new Promise(resolve => {
        const startedAt = performance.now();
        let frames = 0;
        let firstAt = 0;
        let lastAt = 0;
        let rafId = 0;
        let failsafe = 0;
        let finished = false;

        const finish = aborted => {
            if (finished) {
                return;
            }
            finished = true;
            if (rafId) {
                cancelAnimationFrame(rafId);
            }
            if (failsafe) {
                withInternal(() => clearTimeout(failsafe));
            }
            const elapsed = lastAt - firstAt;
            resolve({
                durationMs: Math.round(elapsed),
                frames,
                fps: elapsed > 0 ? Math.round(((frames - 1) / elapsed) * 1000 * 10) / 10 : 0,
                aborted,
            });
        };

        const step = stamp => {
            if (!firstAt) {
                firstAt = stamp;
            }
            lastAt = stamp;
            frames += 1;
            if (performance.now() - startedAt < durationMs) {
                rafId = requestAnimationFrame(step);
            } else {
                finish(false);
            }
        };

        failsafe = withInternal(() => setTimeout(() => finish(true), durationMs + 1500));
        rafId = requestAnimationFrame(step);
    });
}

/**
 * Measure rAF inside a fresh same-origin iframe. A frame rate that stays
 * low here too points at the host/compositor rather than the current page.
 */
export function measureIframeFps(durationMs = 2000) {
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;border:0;'
        + 'opacity:0.01;pointer-events:none;z-index:0;';
    document.body.appendChild(frame);

    const win = frame.contentWindow;
    if (!win || typeof win.requestAnimationFrame !== 'function') {
        frame.remove();
        return Promise.resolve({ error: 'iframe-raf-unavailable' });
    }

    const raf = win.requestAnimationFrame.bind(win);
    const caf = win.cancelAnimationFrame.bind(win);

    return new Promise(resolve => {
        const startedAt = performance.now();
        let frames = 0;
        let firstAt = 0;
        let lastAt = 0;
        let rafId = 0;
        let failsafe = 0;
        let finished = false;

        const finish = aborted => {
            if (finished) {
                return;
            }
            finished = true;
            if (rafId) {
                caf(rafId);
            }
            if (failsafe) {
                withInternal(() => clearTimeout(failsafe));
            }
            const elapsed = lastAt - firstAt;
            resolve({
                durationMs: Math.round(elapsed),
                frames,
                fps: elapsed > 0 ? Math.round(((frames - 1) / elapsed) * 1000 * 10) / 10 : 0,
                aborted,
            });
        };

        const step = stamp => {
            if (!firstAt) {
                firstAt = stamp;
            }
            lastAt = stamp;
            frames += 1;
            if (performance.now() - startedAt < durationMs) {
                rafId = raf(step);
            } else {
                finish(false);
            }
        };

        failsafe = withInternal(() => setTimeout(() => finish(true), durationMs + 1500));
        rafId = raf(step);
    }).finally(() => {
        try {
            frame.remove();
        } catch {
            // Ignore.
        }
    });
}

const VISUAL_HINT_SELECTOR = [
    'canvas',
    'video',
    'iframe',
    '[style*="filter"]',
    '[style*="backdrop"]',
    '[style*="animation"]',
    '[style*="background-image"]',
    '[class*="bg" i]',
    '[id*="bg" i]',
    '[class*="background" i]',
    '[id*="background" i]',
    '[class*="effect" i]',
    '[class*="particle" i]',
    '[class*="blur" i]',
    '[class*="glow" i]',
    '[class*="live2d" i]',
    '[class*="wallpaper" i]',
].join(',');

function describeElement(element) {
    const tag = element.tagName.toLowerCase();
    const id = element.id ? `#${element.id}` : '';
    const className = typeof element.className === 'string' ? element.className.trim() : '';
    const cls = className ? `.${className.split(/\s+/).slice(0, 3).join('.')}` : '';
    return `${tag}${id}${cls}`.slice(0, 90);
}

/**
 * Find painted elements that are plausible GPU/CPU sinks: fullscreen fixed
 * layers, filters, backdrop filters, background images, animated nodes,
 * canvases, videos and iframes. On-demand only; it walks computed styles.
 */
export function scanVisualSuspects() {
    const viewport = Math.max(1, (globalThis.innerWidth ?? 1) * (globalThis.innerHeight ?? 1));
    const suspects = [];

    const canvas = document.querySelectorAll('canvas').length;
    const iframes = document.querySelectorAll('iframe').length;
    let video = 0;
    let playingVideo = 0;
    for (const element of document.querySelectorAll('video')) {
        video += 1;
        if (!element.paused) {
            playingVideo += 1;
        }
    }

    let webAnimations = 0;
    let runningAnimations = 0;
    try {
        const animations = document.getAnimations?.() ?? [];
        webAnimations = animations.length;
        runningAnimations = animations.filter(animation => animation.playState === 'running').length;
    } catch {
        // Optional API.
    }

    const candidates = new Set();
    try {
        for (const element of document.querySelectorAll(VISUAL_HINT_SELECTOR)) {
            candidates.add(element);
        }
    } catch {
        // Ignore selector support issues.
    }
    const addChildren = root => {
        for (const element of root?.children ?? []) {
            candidates.add(element);
        }
    };
    addChildren(document.body);
    addChildren(document.documentElement);
    addChildren(document.querySelector('#sheld'));
    if (document.body) {
        candidates.add(document.body);
    }

    for (const element of candidates) {
        if (!element || element.nodeType !== 1 || element.closest('#ttpd-root')) {
            continue;
        }
        let style;
        try {
            style = getComputedStyle(element);
        } catch {
            continue;
        }
        const rect = element.getBoundingClientRect();
        const area = Math.max(0, rect.width * rect.height);
        const reasons = [];
        if (style.filter && style.filter !== 'none') {
            reasons.push('filter');
        }
        if (style.backdropFilter && style.backdropFilter !== 'none') {
            reasons.push('backdrop');
        }
        if (style.backgroundImage && style.backgroundImage !== 'none') {
            reasons.push('bg-image');
        }
        if (style.animationName && style.animationName !== 'none') {
            reasons.push('css-anim');
        }
        if (style.position === 'fixed' && area >= viewport * 0.5) {
            reasons.push('fullscreen-fixed');
        }
        if (element.tagName === 'CANVAS') {
            reasons.push('canvas');
        }
        if (element.tagName === 'VIDEO') {
            reasons.push(element.paused ? 'video' : 'video-playing');
        }
        if (element.tagName === 'IFRAME') {
            reasons.push('iframe');
        }
        if (!reasons.length) {
            continue;
        }
        suspects.push({
            selector: describeElement(element),
            area: Math.round(area),
            viewportPct: Math.round((area / viewport) * 100),
            reasons,
        });
    }

    suspects.sort((left, right) => right.area - left.area);

    return {
        canvas,
        video,
        playingVideo,
        iframes,
        webAnimations,
        runningAnimations,
        suspects: suspects.slice(0, 10),
    };
}

/** Read TT's built-in perf controller snapshot, if it is installed. */
export function readTtPerfSnapshot() {
    const controller = globalThis.__TAURITAVERN_PERF__;
    if (!controller || typeof controller.snapshot !== 'function') {
        return { available: false };
    }
    try {
        return {
            available: true,
            enabled: Boolean(controller.enabled),
            snapshot: controller.snapshot(),
        };
    } catch (error) {
        return { available: true, error: String(error?.message ?? error) };
    }
}

/**
 * Samples main-thread health once per interval.
 * Call start() only while the panel is open or a recording is running.
 */
export function createSampler({ intervalMs = 1000, onSample } = {}) {
    let running = false;
    let rafId = 0;
    let tickTimer = 0;
    let emitTimer = 0;
    let lastFrameAt = 0;
    let lastTickAt = 0;
    let windowStartedAt = 0;

    const counters = {
        frames: 0,
        dropped: 0,
        worstFrame: 0,
        frameSum: 0,
        busyMs: 0,
        busyPeak: 0,
        inputs: [],
        scrolls: 0,
        scrollJank: 0,
        scrollUntil: 0,
    };

    const history = [];

    function resetCounters() {
        counters.frames = 0;
        counters.dropped = 0;
        counters.worstFrame = 0;
        counters.frameSum = 0;
        counters.busyMs = 0;
        counters.busyPeak = 0;
        counters.inputs = [];
        counters.scrolls = 0;
        counters.scrollJank = 0;
    }

    function onFrame(now) {
        if (!running) {
            return;
        }
        const delta = lastFrameAt ? now - lastFrameAt : 16;
        lastFrameAt = now;
        counters.frames += 1;
        counters.frameSum += delta;
        if (delta > counters.worstFrame) {
            counters.worstFrame = delta;
        }
        if (delta > 50) {
            counters.dropped += 1;
            if (now < counters.scrollUntil) {
                counters.scrollJank += 1;
            }
        }
        rafId = requestAnimationFrame(onFrame);
    }

    function tick() {
        if (!running) {
            return;
        }
        const now = performance.now();
        const drift = Math.max(0, now - lastTickAt - TICK_MS);
        lastTickAt = now;
        if (drift > 0) {
            counters.busyMs += drift;
            if (drift > counters.busyPeak) {
                counters.busyPeak = drift;
            }
        }
        withInternal(() => {
            tickTimer = setTimeout(tick, TICK_MS);
        });
    }

    function onPointerDown() {
        if (!running) {
            return;
        }
        const pressedAt = performance.now();
        requestAnimationFrame(() => {
            if (!running) {
                return;
            }
            counters.inputs.push(performance.now() - pressedAt);
            if (counters.inputs.length > 200) {
                counters.inputs.shift();
            }
        });
    }

    function onScroll() {
        if (!running) {
            return;
        }
        counters.scrolls += 1;
        counters.scrollUntil = performance.now() + 400;
    }

    function emit() {
        if (!running) {
            return;
        }

        const now = performance.now();
        if (document.hidden) {
            resetCounters();
            windowStartedAt = now;
            lastTickAt = now;
            return;
        }

        const elapsed = Math.max(1, now - windowStartedAt);
        const avgFrame = counters.frames ? counters.frameSum / counters.frames : 0;
        const sample = {
            at: Date.now(),
            fps: avgFrame > 0 ? Math.round(1000 / avgFrame) : 0,
            frameMs: round1(avgFrame),
            worstFrameMs: round1(counters.worstFrame),
            droppedFrames: counters.dropped,
            busyPct: Math.round(Math.min(100, (counters.busyMs / elapsed) * 100)),
            busyPeakMs: round1(counters.busyPeak),
            inputP95Ms: round1(p95(counters.inputs)),
            inputMaxMs: round1(counters.inputs.length ? Math.max(...counters.inputs) : 0),
            scrollEvents: counters.scrolls,
            scrollJank: counters.scrollJank,
            ...getDomSnapshot(),
            listeners: getListenerCounters().net,
        };

        history.push(sample);
        if (history.length > MAX_SAMPLES) {
            history.shift();
        }

        try {
            onSample?.(sample);
        } catch {
            // A rendering error must never stop the sampler.
        }

        resetCounters();
        windowStartedAt = now;
    }

    function start() {
        if (running) {
            return false;
        }
        running = true;
        windowStartedAt = performance.now();
        lastTickAt = windowStartedAt;
        lastFrameAt = 0;
        resetCounters();

        rafId = requestAnimationFrame(onFrame);
        withInternal(() => {
            tickTimer = setTimeout(tick, TICK_MS);
            emitTimer = setInterval(emit, intervalMs);
        });

        withInternal(() => {
            document.addEventListener('pointerdown', onPointerDown, { capture: true, passive: true });
            document.addEventListener('scroll', onScroll, { capture: true, passive: true });
        });

        return true;
    }

    function stop() {
        if (!running) {
            return false;
        }
        running = false;
        cancelAnimationFrame(rafId);
        clearTimeout(tickTimer);
        clearInterval(emitTimer);
        withInternal(() => {
            document.removeEventListener('pointerdown', onPointerDown, { capture: true });
            document.removeEventListener('scroll', onScroll, { capture: true });
        });
        return true;
    }

    return {
        start,
        stop,
        isRunning: () => running,
        getHistory: () => history.slice(),
        clearHistory: () => { history.length = 0; },
    };
}
