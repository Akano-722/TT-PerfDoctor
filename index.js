/**
 * TT-PerfDoctor — iOS-first performance diagnostics for TauriTavern.
 *
 * Design rules:
 *  - Read-only by default; the only mutations are opt-in toggles the user presses.
 *  - Sampling runs only while the panel is open or a recording is in progress.
 *  - Never touch chat data. Never send anything off-device.
 */

import {
    installInstrumentation,
    getHostConfig,
    getDomSnapshot,
    getChatSnapshot,
    getListenerCounters,
    getAttribution,
    resetAttribution,
    createSampler,
    summarizeSamples,
    measureFps,
    measureIframeFps,
    scanVisualSuspects,
    readTtPerfSnapshot,
} from './metrics.js';
import { mountUI } from './ui.js';

const SETTINGS_NAMESPACE = 'tt-perfdoctor';
const SETTINGS_KEY = 'settings';
const RECORD_SECONDS = 30;

const state = {
    live: null,
    config: null,
    samples: [],
    recording: false,
    recordEndsAt: 0,
    summary: null,
    baseline: null,
    baselineAt: null,
    diff: null,
    scan: null,
    attr: null,
    probe: null,
    visual: null,
    ttPerf: null,
    ttPerfAutoEnabled: false,
    perfCss: false,
    pendingReload: false,
    advice: '',
    experiments: {
        noAnim: false,
        pauseAnimations: false,
        effectsOff: false,
        removeBg: false,
        hideMedia: false,
        hideChatIframes: false,
        hideOtherIframes: false,
        removeIframes: false,
    },
};

const EXPERIMENT_CLASSES = {
    noAnim: 'ttpd-no-anim',
    pauseAnimations: 'ttpd-pause-anim',
    effectsOff: 'ttpd-no-effects',
    removeBg: 'ttpd-no-bg',
    hideMedia: 'ttpd-hide-media',
    hideChatIframes: 'ttpd-hide-chat-iframes',
    hideOtherIframes: 'ttpd-hide-other-iframes',
};

const EXPERIMENT_LABELS = {
    noAnim: '禁用动画/过渡',
    pauseAnimations: '暂停运行中的动画',
    effectsOff: '关闭滤镜/模糊/阴影',
    removeBg: '移除整页背景图',
    hideMedia: '隐藏 canvas / video',
    hideChatIframes: '隐藏聊天内 iframe',
    hideOtherIframes: '隐藏聊天外 iframe',
    removeIframes: '移除全部 iframe',
};

/** Animations paused by the A/B switch, so turning it off can resume them. */
let pausedAnimations = new Set();
let probeRunning = false;

let settings = { perfCss: false };
let sampler = null;
let ui = null;
let recordTimer = 0;
let countdownTimer = 0;
let lazyObserver = null;
let renderQueued = false;

function getSTContext() {
    try {
        return globalThis.SillyTavern?.getContext?.() ?? null;
    } catch {
        return null;
    }
}

async function waitForHost() {
    const ready = globalThis.__TAURITAVERN__?.ready ?? globalThis.__TAURITAVERN_MAIN_READY__;
    if (!ready || typeof ready.then !== 'function') {
        return;
    }
    await Promise.race([
        Promise.resolve(ready).catch(() => {}),
        new Promise(resolve => setTimeout(resolve, 3000)),
    ]);
}

export async function activate() {
    try {
        await waitForHost();
        installInstrumentation();

        settings = await loadSettings();
        state.perfCss = Boolean(settings.perfCss);

        ui = mountUI({
            onOpen,
            onClose,
            onRecordToggle: toggleRecording,
            onBaseline: captureBaseline,
            onCompare: compareBaseline,
            onScan: scanChat,
            onTogglePerfCss: applyPerfCss,
            onApplyDepth: applyJsrDepth,
            onDisableStreaming: disableStreaming,
            onToggleExperiment: setExperiment,
            onProbeBlank: runBlankProbe,
            onProbeIframe: runIframeProbe,
            onScanVisual: runVisualScan,
            onToggleTtPerf: toggleTtPerf,
            onCopy: copyReport,
            onClear: clearData,
        });

        sampler = createSampler({ intervalMs: 1000, onSample });
        refreshConfig();

        if (state.perfCss) {
            applyPerfCss(true, { silent: true, persist: false });
        }

        ui.render(paintState());

        globalThis.__TT_PERFDOCTOR__ = {
            getReport: buildReport,
            getState: () => ({ ...state, samples: state.samples.slice() }),
            scanChat,
        };
    } catch (error) {
        showFatal(error);
    }
}

function emit(phase, detail) {
    try {
        console.info(`[TT-PerfDoctor] ${phase}`, detail ?? '');
    } catch {
        // Console is optional on iOS.
    }
}

function showFatal(error) {
    const message = error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error);
    emit('fatal', message);

    let box = document.getElementById('ttpd-fatal');
    if (!box) {
        box = document.createElement('div');
        box.id = 'ttpd-fatal';
        document.body.appendChild(box);
    }
    box.textContent = `Perf Doctor 启动失败：${message}`;
}

/* ------------------------------------------------------------------ */
/* State plumbing                                                      */
/* ------------------------------------------------------------------ */

function paintState() {
    return {
        live: state.live,
        config: state.config,
        recording: state.recording,
        recordRemainingMs: state.recordEndsAt ? state.recordEndsAt - Date.now() : 0,
        summary: state.summary,
        baselineAt: state.baselineAt,
        diff: state.diff,
        scan: state.scan,
        attr: state.attr,
        probe: state.probe,
        visual: state.visual,
        ttPerf: state.ttPerf,
        experiments: state.experiments,
        perfCss: state.perfCss,
        pendingReload: state.pendingReload,
        advice: state.advice,
    };
}

function scheduleRender() {
    if (renderQueued || !ui?.isOpen()) {
        return;
    }
    renderQueued = true;
    requestAnimationFrame(() => {
        renderQueued = false;
        if (ui?.isOpen()) {
            ui.render(paintState());
        }
    });
}

function onSample(sample) {
    state.live = sample;
    state.attr = getAttribution(6);
    if (state.recording) {
        state.samples.push(sample);
        if (state.samples.length > 300) {
            state.samples.shift();
        }
    }
    scheduleRender();
}

function refreshConfig() {
    state.config = getHostConfig();
    state.advice = buildAdvice();
}

function onOpen() {
    refreshConfig();
    state.live = null;
    state.attr = getAttribution(6);
    state.ttPerf = readTtPerfSnapshot();
    sampler?.start();
    clearInterval(countdownTimer);
    countdownTimer = setInterval(scheduleRender, 500);
    scheduleRender();
}

function onClose() {
    clearInterval(countdownTimer);
    if (!state.recording) {
        sampler?.stop();
    }
}

/* ------------------------------------------------------------------ */
/* Recording                                                           */
/* ------------------------------------------------------------------ */

function toggleRecording() {
    if (state.recording) {
        stopRecording();
    } else {
        startRecording();
    }
}

function startRecording() {
    state.recording = true;
    state.samples = [];
    state.summary = null;
    state.recordEndsAt = Date.now() + RECORD_SECONDS * 1000;
    resetAttribution();
    state.attr = getAttribution(6);
    enableTtPerfForRecording();
    sampler?.start();
    clearTimeout(recordTimer);
    recordTimer = setTimeout(stopRecording, RECORD_SECONDS * 1000);
    refreshConfig();
    ui?.toast(`开始录制 ${RECORD_SECONDS} 秒，请复现卡顿`);
    scheduleRender();
}

function stopRecording() {
    if (!state.recording) {
        return;
    }
    state.recording = false;
    state.recordEndsAt = 0;
    clearTimeout(recordTimer);
    finishTtPerfRecording();
    state.summary = summarizeSamples(state.samples);
    if (!ui?.isOpen()) {
        sampler?.stop();
    }
    ui?.toast('录制结束');
    scheduleRender();
}

/* ------------------------------------------------------------------ */
/* Leak comparison                                                     */
/* ------------------------------------------------------------------ */

function captureBaseline() {
    state.baseline = {
        at: Date.now(),
        dom: getDomSnapshot(),
        listeners: getListenerCounters(),
    };
    state.baselineAt = state.baseline.at;
    state.diff = null;
    ui?.toast('基线已记录，去滚动或切换聊天');
    scheduleRender();
}

function compareBaseline() {
    if (!state.baseline) {
        ui?.toast('请先记录基线');
        return;
    }
    const dom = getDomSnapshot();
    const listeners = getListenerCounters();
    const base = state.baseline;
    const diff = {
        elapsedMs: Date.now() - base.at,
        mes: dom.mes - base.dom.mes,
        iframes: dom.iframes - base.dom.iframes,
        nodes: dom.nodes - base.dom.nodes,
        listeners: listeners.net - base.listeners.net,
        listenerAdds: listeners.adds - base.listeners.adds,
        listenerRemoves: listeners.removes - base.listeners.removes,
        suspected: false,
    };
    diff.suspected = diff.iframes >= 5 || diff.listeners >= 100;
    state.diff = diff;
    scheduleRender();
}

/* ------------------------------------------------------------------ */
/* Chat scan                                                           */
/* ------------------------------------------------------------------ */

function scanChat() {
    const chat = getSTContext()?.chat;
    if (!Array.isArray(chat)) {
        state.scan = { error: '读取不到 chat[]（可能不在聊天页面）。' };
    } else {
        state.scan = getChatSnapshot(chat, 8000);
    }
    scheduleRender();
}

/* ------------------------------------------------------------------ */
/* Opt-in optimizations                                                */
/* ------------------------------------------------------------------ */

async function applyPerfCss(enabled, options = {}) {
    const { silent = false, persist = true } = options;
    state.perfCss = Boolean(enabled);
    settings.perfCss = state.perfCss;
    document.body.classList.toggle('ttpd-perf', state.perfCss);
    updateLazyImages(state.perfCss);

    if (persist) {
        void persistSettings();
    }

    state.advice = buildAdvice();
    if (!silent) {
        ui?.toast(state.perfCss ? 'CSS 性能模式已开启' : 'CSS 性能模式已关闭');
    }
    scheduleRender();
}

function updateLazyImages(enabled) {
    if (!enabled) {
        lazyObserver?.disconnect();
        lazyObserver = null;
        for (const img of document.querySelectorAll('img[data-ttpd-lazy="1"]')) {
            img.removeAttribute('loading');
            img.removeAttribute('decoding');
            delete img.dataset.ttpdLazy;
        }
        return;
    }

    const mark = img => {
        if (img.dataset.ttpdLazy === '1') {
            return;
        }
        img.dataset.ttpdLazy = '1';
        if (!img.hasAttribute('loading')) {
            img.setAttribute('loading', 'lazy');
        }
        if (!img.hasAttribute('decoding')) {
            img.setAttribute('decoding', 'async');
        }
    };

    for (const img of document.querySelectorAll('img')) {
        mark(img);
    }

    lazyObserver = new MutationObserver(records => {
        for (const record of records) {
            for (const node of record.addedNodes) {
                if (node.nodeType !== 1) {
                    continue;
                }
                if (node.tagName === 'IMG') {
                    mark(node);
                } else if (node.querySelector?.('img')) {
                    node.querySelectorAll('img').forEach(mark);
                }
            }
        }
    });
    lazyObserver.observe(document.body, { childList: true, subtree: true });
}

function getJsrRender() {
    return getSTContext()?.extensionSettings?.tavern_helper?.render ?? null;
}

function saveSTSettings() {
    const ctx = getSTContext();
    const save = ctx?.saveSettingsDebounced ?? globalThis.saveSettingsDebounced;
    if (typeof save !== 'function') {
        return false;
    }
    try {
        save();
        return true;
    } catch {
        return false;
    }
}

function applyJsrDepth(depth) {
    const render = getJsrRender();
    if (!render) {
        ui?.toast('未检测到 JS-Slash-Runner 的渲染设置');
        return;
    }
    const current = Number(render.depth) || 0;
    if (current === depth) {
        ui?.toast(`渲染深度已经是 ${depth}`);
        return;
    }
    const confirmed = globalThis.confirm?.(
        `将 JS-Slash-Runner 渲染深度：${current} → ${depth}\n\n`
        + `只渲染最近 ${depth} 楼的 HTML / MVU 前端，更旧的楼层不创建 iframe。`
        + `聊天记录本身不受影响，往上翻到旧楼层时仍可看到文本，但前端不会重建。\n\n继续？`,
    );
    if (!confirmed) {
        return;
    }
    const previousDepth = render.depth;
    try {
        render.depth = depth;
        if (render.depth !== depth || !saveSTSettings()) {
            render.depth = previousDepth;
            ui?.toast('写入失败：设置对象不可写或无法保存');
            return;
        }
    } catch (error) {
        ui?.toast(`写入失败：${error?.message ?? error}`);
        return;
    }
    state.pendingReload = true;
    refreshConfig();
    ui?.toast(`已写入 depth=${depth}，重载后生效`);
    scheduleRender();
}

function disableStreaming() {
    const render = getJsrRender();
    if (!render) {
        ui?.toast('未检测到 JS-Slash-Runner 的渲染设置');
        return;
    }
    if (render.allow_streaming === false) {
        ui?.toast('流式渲染已经是关闭状态');
        return;
    }
    const confirmed = globalThis.confirm?.(
        '关闭流式渲染？\n\n'
        + '生成过程中不再随文字逐步重绘前端，等回复完成后再渲染一次。'
        + '开启聊天虚拟化时本来也不支持流式渲染。\n\n继续？',
    );
    if (!confirmed) {
        return;
    }
    const previousStreaming = render.allow_streaming;
    try {
        render.allow_streaming = false;
        if (render.allow_streaming !== false || !saveSTSettings()) {
            render.allow_streaming = previousStreaming;
            ui?.toast('写入失败：设置对象不可写或无法保存');
            return;
        }
    } catch (error) {
        ui?.toast(`写入失败：${error?.message ?? error}`);
        return;
    }
    state.pendingReload = true;
    refreshConfig();
    ui?.toast('已关闭流式渲染，重载后生效');
    scheduleRender();
}

function setExperiment(name, enabled) {
    const on = Boolean(enabled);
    if (!(name in state.experiments)) {
        return;
    }
    state.experiments[name] = on;

    const className = EXPERIMENT_CLASSES[name];
    if (className) {
        document.body.classList.toggle(className, on);
    }

    if (name === 'pauseAnimations') {
        setWebAnimationsPaused(on);
    } else if (name === 'removeIframes' && on) {
        const frames = document.querySelectorAll('iframe');
        const count = frames.length;
        frames.forEach(frame => frame.remove());
        ui?.toast(`已移除 ${count} 个 iframe（刷新页面恢复）`);
    }

    if (name !== 'removeIframes') {
        ui?.toast(`${on ? '已开启' : '已关闭'}：${EXPERIMENT_LABELS[name]}（刷新即恢复）`);
    }
    scheduleRender();
}

function setWebAnimationsPaused(paused) {
    if (!paused) {
        for (const animation of pausedAnimations) {
            try {
                animation.play();
            } catch {
                // Animation may have been cancelled.
            }
        }
        pausedAnimations = new Set();
        return;
    }
    try {
        for (const animation of document.getAnimations?.() ?? []) {
            if (animation.playState !== 'running') {
                continue;
            }
            try {
                animation.pause();
                pausedAnimations.add(animation);
            } catch {
                // Ignore individual failures.
            }
        }
    } catch {
        // Optional API.
    }
}

/* ------------------------------------------------------------------ */
/* Isolation probes                                                    */
/* ------------------------------------------------------------------ */

async function runBlankProbe() {
    if (probeRunning) {
        return;
    }
    probeRunning = true;
    const wasOpen = ui?.isOpen();
    ui?.close();
    document.body.classList.add('ttpd-blank');
    ui?.toast('空白遮罩测量中（2.5 秒）…');

    try {
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const result = await measureFps(2500);
        state.probe = { ...(state.probe ?? {}), blank: result, blankAt: Date.now() };
        ui?.toast(result.aborted
            ? '测量被中断（页面切到后台？）'
            : `空白遮罩：${result.fps} fps`);
    } finally {
        document.body.classList.remove('ttpd-blank');
        if (wasOpen) {
            ui?.open();
        }
        probeRunning = false;
        scheduleRender();
    }
}

async function runIframeProbe() {
    if (probeRunning) {
        return;
    }
    probeRunning = true;
    ui?.toast('iframe 内测量中（2 秒）…');
    try {
        const result = await measureIframeFps(2000);
        state.probe = { ...(state.probe ?? {}), iframe: result, iframeAt: Date.now() };
        ui?.toast(result.error ? `iframe 探针不可用：${result.error}` : `iframe 内：${result.fps} fps`);
    } finally {
        probeRunning = false;
        scheduleRender();
    }
}

function captureVisual() {
    try {
        return scanVisualSuspects();
    } catch (error) {
        return { error: String(error?.message ?? error) };
    }
}

function runVisualScan() {
    ui?.toast('扫描视觉嫌疑元素…');
    state.visual = captureVisual();
    scheduleRender();
}

function toggleTtPerf() {
    const controller = globalThis.__TAURITAVERN_PERF__;
    if (!controller || typeof controller.toggle !== 'function') {
        ui?.toast('当前 TT 版本没有内置 Perf HUD');
        return;
    }
    try {
        controller.toggle();
        state.ttPerf = readTtPerfSnapshot();
        ui?.toast(`TT HUD ${state.ttPerf.enabled ? '已开启（左上角）' : '已关闭'}`);
    } catch (error) {
        ui?.toast(`TT HUD 操作失败：${error?.message ?? error}`);
    }
    scheduleRender();
}

function enableTtPerfForRecording() {
    state.ttPerfAutoEnabled = false;
    const controller = globalThis.__TAURITAVERN_PERF__;
    if (!controller || typeof controller.enable !== 'function') {
        return;
    }
    try {
        if (!controller.enabled) {
            controller.enable();
            state.ttPerfAutoEnabled = true;
        }
    } catch {
        // Never block recording on the host HUD.
    }
}

function finishTtPerfRecording() {
    // Snapshot while it is still enabled, then restore the previous state.
    const snapshot = readTtPerfSnapshot();
    const controller = globalThis.__TAURITAVERN_PERF__;
    if (state.ttPerfAutoEnabled && controller && typeof controller.disable === 'function') {
        try {
            controller.disable();
        } catch {
            // Ignore.
        }
        state.ttPerf = snapshot.available ? { ...snapshot, enabled: false } : snapshot;
    } else {
        state.ttPerf = snapshot;
    }
    state.ttPerfAutoEnabled = false;
}

/* ------------------------------------------------------------------ */
/* Advice                                                              */
/* ------------------------------------------------------------------ */

function buildAdvice() {
    const config = state.config ?? getHostConfig();
    const lines = [];
    const managed = config.chatSurface?.managedOwnershipRequired;

    if (managed === false) {
        const mounted = state.live?.mes;
        if (Number.isFinite(mounted) && mounted > 0 && mounted <= 20) {
            lines.push(`① 未托管，但 DOM 只挂了 ${mounted} 楼，虚拟化收益有限；先看「归因」和「实验 A/B」。`);
        } else {
            lines.push('① 未托管：到 TauriTavern 设置 → 性能 → 打开「聊天 DOM 虚拟化」，然后重载。这是收益最大的一步。');
        }
    } else if (managed === true) {
        lines.push('① 虚拟化已托管，继续保持。');
    }

    const jsr = config.jsSlashRunner;
    if (jsr) {
        if (!jsr.renderEnabled) {
            lines.push('② JS-Slash-Runner 前端渲染已关闭；若你依赖 MVU 状态栏，请先确认。');
        } else if (!jsr.renderDepth) {
            lines.push('② 渲染深度为 0（全部渲染）：建议设为 5–10，尤其是长聊天。');
        } else {
            lines.push(`② 渲染深度 ${jsr.renderDepth}，已限制前端数量。`);
        }
        if (jsr.allowStreaming) {
            lines.push('③ 流式渲染开启：生成时会反复重绘；虚拟化模式下不支持，建议关闭。');
        }
    }

    if (!state.perfCss) {
        lines.push('④ 可开启 CSS 性能模式：只影响显示，不改数据，随时可关。');
    } else if (managed === true) {
        lines.push('④ 虚拟化已托管时通常不需要 CSS 性能模式；若滚动位置跳动，请关掉。');
    }

    const blank = state.probe?.blank;
    if (blank && Number.isFinite(blank.fps)) {
        if (blank.fps < 30) {
            lines.push(`◆ 空白遮罩（页面几乎全隐藏）仍只有 ${blank.fps} fps：瓶颈不在聊天内容或主题，先看 TT HUD 的长任务 / invoke 与设备发热。`);
        } else {
            lines.push(`◆ 空白遮罩恢复到 ${blank.fps} fps：瓶颈在页面绘制/合成，优先试「关闭滤镜/模糊」和「移除整页背景图」。`);
        }
    }

    if (!lines.length) {
        lines.push('设置看起来已经比较克制。若仍然卡，先录制 30 秒并导出报告。');
    }
    return lines.join('\n');
}

/* ------------------------------------------------------------------ */
/* Report / settings                                                   */
/* ------------------------------------------------------------------ */

function buildReport() {
    return {
        tool: { name: 'TT-PerfDoctor', version: '0.3.0' },
        generatedAt: new Date().toISOString(),
        config: state.config ?? getHostConfig(),
        dom: getDomSnapshot(),
        listeners: getListenerCounters(),
        attribution: getAttribution(15),
        probe: state.probe,
        visual: state.visual ?? captureVisual(),
        ttPerf: state.ttPerf ?? readTtPerfSnapshot(),
        experiments: { ...state.experiments },
        live: state.live,
        recording: summarizeSamples(state.samples),
        samples: state.samples.slice(-120),
        baseline: state.baseline
            ? {
                at: new Date(state.baseline.at).toISOString(),
                dom: state.baseline.dom,
                listeners: state.baseline.listeners,
            }
            : null,
        diff: state.diff,
        chat: state.scan,
        perfCss: state.perfCss,
    };
}

async function copyReport() {
    const text = JSON.stringify(buildReport(), null, 2);
    ui?.showReport(text);
    try {
        await navigator.clipboard.writeText(text);
        ui?.toast('报告已复制');
    } catch {
        ui?.toast('已显示在报告框，请长按复制');
    }
}

function clearData() {
    state.samples = [];
    state.summary = null;
    state.baseline = null;
    state.baselineAt = null;
    state.diff = null;
    state.scan = null;
    state.attr = null;
    state.probe = null;
    state.visual = null;
    state.ttPerf = null;
    state.pendingReload = false;
    resetAttribution();
    sampler?.clearHistory();
    ui?.showReport('');
    ui?.toast('已清空');
    scheduleRender();
}

async function loadSettings() {
    const store = globalThis.__TAURITAVERN__?.api?.extension?.store;
    if (store?.tryGetJson) {
        try {
            const result = await Promise.race([
                store.tryGetJson({ namespace: SETTINGS_NAMESPACE, key: SETTINGS_KEY }),
                new Promise(resolve => setTimeout(() => resolve(null), 1500)),
            ]);
            if (result?.found && result.value && typeof result.value === 'object') {
                return { perfCss: Boolean(result.value.perfCss) };
            }
        } catch {
            // Fall through to localStorage.
        }
    }
    try {
        const raw = globalThis.localStorage?.getItem(`${SETTINGS_NAMESPACE}:settings`);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object') {
                return { perfCss: Boolean(parsed.perfCss) };
            }
        }
    } catch {
        // Defaults below.
    }
    return { perfCss: false };
}

async function persistSettings() {
    const value = { perfCss: state.perfCss };
    try {
        globalThis.localStorage?.setItem(`${SETTINGS_NAMESPACE}:settings`, JSON.stringify(value));
    } catch {
        // localStorage may be unavailable; extension.store is the primary path.
    }
    const store = globalThis.__TAURITAVERN__?.api?.extension?.store;
    if (store?.setJson) {
        try {
            await store.setJson({ namespace: SETTINGS_NAMESPACE, key: SETTINGS_KEY, value });
        } catch {
            // Non-fatal.
        }
    }
}
