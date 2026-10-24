/**
 * Panel UI for TT-PerfDoctor. Plain DOM, no framework, no external assets.
 */

const TEMPLATE = `
<div id="ttpd-fab" role="button" tabindex="0" aria-label="打开性能诊断">性能</div>
<div id="ttpd-overlay" class="ttpd-hidden"></div>
<aside id="ttpd-panel" class="ttpd-hidden" role="dialog" aria-modal="true" aria-label="性能诊断">
    <header class="ttpd-head">
        <div class="ttpd-title">Perf Doctor <span class="ttpd-sub">iOS 优先</span></div>
        <div class="ttpd-head-actions">
            <button id="ttpd-rec" class="ttpd-btn ttpd-btn-rec" type="button">录制</button>

            <button id="ttpd-close" class="ttpd-btn" type="button">关闭</button>
        </div>
    </header>

    <div class="ttpd-body">
        <section class="ttpd-section">
            <h3>实时</h3>
            <div class="ttpd-grid">
                <div class="ttpd-cell"><span>帧率</span><b id="ttpd-live-fps">—</b></div>
                <div class="ttpd-cell"><span>主线程占用</span><b id="ttpd-live-busy">—</b></div>
                <div class="ttpd-cell"><span>点击→下一帧</span><b id="ttpd-live-input">—</b></div>
                <div class="ttpd-cell"><span>被阻塞峰值</span><b id="ttpd-live-peak">—</b></div>
                <div class="ttpd-cell"><span>消息 DOM</span><b id="ttpd-live-mes">—</b></div>
                <div class="ttpd-cell"><span>iframe</span><b id="ttpd-live-iframes">—</b></div>
                <div class="ttpd-cell"><span>DOM 节点</span><b id="ttpd-live-nodes">—</b></div>
                <div class="ttpd-cell"><span>监听器净增</span><b id="ttpd-live-listeners">—</b></div>
            </div>
            <div id="ttpd-verdict" class="ttpd-note"></div>
        </section>

        <section class="ttpd-section">
            <h3>环境</h3>
            <div id="ttpd-config" class="ttpd-lines"></div>
        </section>

        <section class="ttpd-section">
            <h3>录制</h3>
            <div class="ttpd-row">
                <button id="ttpd-rec2" class="ttpd-btn" type="button">开始录制 30 秒</button>
                <span id="ttpd-rec-status" class="ttpd-muted"></span>
            </div>
            <div id="ttpd-rec-summary" class="ttpd-lines"></div>
        </section>

        <section class="ttpd-section">
            <h3>归因</h3>
            <p class="ttpd-hint">录制时统计：谁在加监听、谁在定时。来源取调用栈里的脚本文件，录制结束保留结果。</p>
            <div id="ttpd-attr" class="ttpd-lines"></div>
        </section>

        <section class="ttpd-section">
            <h3>定位探针</h3>
            <p class="ttpd-hint">先测「空白遮罩」：整个页面隐藏后仍然低帧率，说明不是聊天/主题内容；恢复到高帧率，则是页面绘制或合成的问题。</p>
            <div class="ttpd-row ttpd-wrap">
                <button id="ttpd-probe-blank" class="ttpd-btn" type="button">空白遮罩 2.5s</button>
                <button id="ttpd-probe-iframe" class="ttpd-btn" type="button">iframe 内 2s</button>
                <button id="ttpd-scan-visual" class="ttpd-btn" type="button">扫描视觉嫌疑</button>
                <button id="ttpd-tthud" class="ttpd-btn" type="button">TT HUD 开关</button>
            </div>
            <div id="ttpd-probe-out" class="ttpd-lines"></div>
            <div id="ttpd-visual-out" class="ttpd-lines"></div>
        </section>

        <section class="ttpd-section">
            <h3>泄漏对比</h3>
            <p class="ttpd-hint">记录基线 → 去滚动 / 发消息 / 切换聊天 → 对比。iframe、监听器只增不减就是泄漏信号。</p>
            <div class="ttpd-row">
                <button id="ttpd-base" class="ttpd-btn" type="button">记录基线</button>
                <button id="ttpd-diff" class="ttpd-btn" type="button">与基线对比</button>
            </div>
            <div id="ttpd-diff-out" class="ttpd-lines"></div>
        </section>

        <section class="ttpd-section">
            <h3>重消息</h3>
            <div class="ttpd-row">
                <button id="ttpd-scan" class="ttpd-btn" type="button">扫描聊天</button>
                <span class="ttpd-muted">只读，最多扫描 8000 楼</span>
            </div>
            <div id="ttpd-scan-out" class="ttpd-lines"></div>
        </section>

        <section class="ttpd-section">
            <h3>优化</h3>
            <label class="ttpd-check">
                <input type="checkbox" id="ttpd-perfcss">
                <span>CSS 性能模式（content-visibility + 图片懒加载）</span>
            </label>
            <div class="ttpd-row ttpd-wrap">
                <span class="ttpd-muted">JSR 渲染深度</span>
                <button class="ttpd-btn" type="button" data-depth="1">1</button>
                <button class="ttpd-btn" type="button" data-depth="3">3</button>
                <button class="ttpd-btn" type="button" data-depth="5">5</button>
                <button class="ttpd-btn" type="button" data-depth="10">10</button>
                <button class="ttpd-btn" type="button" data-depth="20">20</button>
                <button id="ttpd-nostream" class="ttpd-btn" type="button">关闭流式渲染</button>
            </div>
            <div id="ttpd-advice" class="ttpd-advice"></div>
            <div class="ttpd-row">
                <button id="ttpd-reload" class="ttpd-btn ttpd-btn-primary ttpd-hidden" type="button">重载页面使设置生效</button>
            </div>
        </section>

        <section class="ttpd-section">
            <h3>实验 A/B</h3>
            <p class="ttpd-hint">开关后等 2–3 秒再看上方「帧率」。除「移除 iframe」外，取消勾选或刷新页面即恢复，不留设置。</p>
            <label class="ttpd-check">
                <input type="checkbox" data-exp="noAnim">
                <span>禁用动画 / 过渡（CSS 主题动效）</span>
            </label>
            <label class="ttpd-check">
                <input type="checkbox" data-exp="pauseAnimations">
                <span>暂停运行中的动画（Web Animations，含 JS 创建的）</span>
            </label>
            <label class="ttpd-check">
                <input type="checkbox" data-exp="effectsOff">
                <span>关闭滤镜 / 模糊 / 阴影（backdrop-filter 通常是发热大头）</span>
            </label>
            <label class="ttpd-check">
                <input type="checkbox" data-exp="removeBg">
                <span>移除整页背景图（含头像等所有背景图）</span>
            </label>
            <label class="ttpd-check">
                <input type="checkbox" data-exp="hideMedia">
                <span>隐藏 canvas / video（只是不显示，不停止播放）</span>
            </label>
            <label class="ttpd-check">
                <input type="checkbox" data-exp="pauseMedia">
                <span>暂停所有视频 / 音频（含画中画背景视频，真正停解码）</span>
            </label>
            <label class="ttpd-check">
                <input type="checkbox" data-exp="hideChatIframes">
                <span>隐藏聊天内 iframe（MVU / HTML 状态栏）</span>
            </label>
            <label class="ttpd-check">
                <input type="checkbox" data-exp="hideOtherIframes">
                <span>隐藏聊天外 iframe（常驻组件 / 主题）</span>
            </label>
            <label class="ttpd-check">
                <input type="checkbox" data-exp="removeIframes">
                <span>彻底移除全部 iframe（停掉其脚本；刷新才能恢复）</span>
            </label>
            <p class="ttpd-hint">「隐藏」只是不绘制：iframe 里的 JS 仍在跑，视频/画中画也仍在解码。要停 CSS 开销，样式开关已改用内联 !important，能覆盖主题的 #id 规则。</p>
        </section>

        <section class="ttpd-section">
            <h3>报告</h3>
            <div class="ttpd-row">
                <button id="ttpd-copy" class="ttpd-btn ttpd-btn-primary" type="button">复制 JSON 报告</button>
                <button id="ttpd-clear" class="ttpd-btn" type="button">清空数据</button>
            </div>
            <textarea id="ttpd-report" readonly placeholder="点「复制 JSON 报告」后，内容也会显示在这里，可长按手动复制"></textarea>
        </section>

        <footer class="ttpd-foot">数据只在本机内存中，不会上传。关闭面板即停止采样。</footer>
    </div>
</aside>
<div id="ttpd-toast" class="ttpd-toast ttpd-hidden"></div>
`;

function setText(root, id, text) {
    const el = root.querySelector(`#${id}`);
    if (el && el.textContent !== text) {
        el.textContent = text;
    }
}

function flag(root, id, bad) {
    const el = root.querySelector(`#${id}`);
    if (el) {
        el.classList.toggle('is-bad', Boolean(bad));
    }
}

function fmtMs(value) {
    return value > 0 ? `${Math.round(value)} ms` : '0 ms';
}

function verdictFor(live) {
    if (!live) {
        return '等待采样…';
    }
    const problems = [];
    if (live.busyPct >= 30) problems.push('主线程长期被占用');
    if (live.fps && live.fps < 45) problems.push('帧率偏低');
    if (live.inputP95Ms >= 100) problems.push('点击延迟明显');
    if (live.iframes >= 30) problems.push('消息 iframe 偏多');
    if (!problems.length) return '当前窗口未见明显异常。';
    return `异常：${problems.join(' · ')}`;
}

export function mountUI(handlers) {
    const host = document.createElement('div');
    host.id = 'ttpd-root';
    host.innerHTML = TEMPLATE;
    document.body.appendChild(host);

    const $ = selector => host.querySelector(selector);
    let toastTimer = 0;

    const open = () => {
        $('#ttpd-panel').classList.remove('ttpd-hidden');
        $('#ttpd-overlay').classList.remove('ttpd-hidden');
        handlers.onOpen?.();
    };

    const close = () => {
        $('#ttpd-panel').classList.add('ttpd-hidden');
        $('#ttpd-overlay').classList.add('ttpd-hidden');
        handlers.onClose?.();
    };

    const isOpen = () => !$('#ttpd-panel').classList.contains('ttpd-hidden');

    $('#ttpd-fab').addEventListener('click', open);
    $('#ttpd-fab').addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            open();
        }
    });
    $('#ttpd-close').addEventListener('click', close);
    $('#ttpd-overlay').addEventListener('click', close);

    $('#ttpd-rec').addEventListener('click', () => handlers.onRecordToggle?.());
    $('#ttpd-rec2').addEventListener('click', () => handlers.onRecordToggle?.());
    $('#ttpd-base').addEventListener('click', () => handlers.onBaseline?.());
    $('#ttpd-diff').addEventListener('click', () => handlers.onCompare?.());
    $('#ttpd-scan').addEventListener('click', () => handlers.onScan?.());
    $('#ttpd-copy').addEventListener('click', () => handlers.onCopy?.());
    $('#ttpd-clear').addEventListener('click', () => handlers.onClear?.());
    $('#ttpd-nostream').addEventListener('click', () => handlers.onDisableStreaming?.());
    $('#ttpd-probe-blank').addEventListener('click', () => handlers.onProbeBlank?.());
    $('#ttpd-probe-iframe').addEventListener('click', () => handlers.onProbeIframe?.());
    $('#ttpd-scan-visual').addEventListener('click', () => handlers.onScanVisual?.());
    $('#ttpd-tthud').addEventListener('click', () => handlers.onToggleTtPerf?.());
    $('#ttpd-reload').addEventListener('click', () => location.reload());
    $('#ttpd-perfcss').addEventListener('change', event => {
        handlers.onTogglePerfCss?.(Boolean(event.target.checked));
    });
    host.querySelectorAll('[data-depth]').forEach(button => {
        button.addEventListener('click', () => {
            handlers.onApplyDepth?.(Number(button.dataset.depth));
        });
    });
    host.querySelectorAll('[data-exp]').forEach(input => {
        input.addEventListener('change', event => {
            handlers.onToggleExperiment?.(input.dataset.exp, Boolean(event.target.checked));
        });
    });

    function toast(message) {
        const el = $('#ttpd-toast');
        el.textContent = message;
        el.classList.remove('ttpd-hidden');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => el.classList.add('ttpd-hidden'), 2600);
    }

    function showReport(text) {
        $('#ttpd-report').value = text;
    }

    function render(state = {}) {
        const live = state.live;

        setText(host, 'ttpd-live-fps', live ? `${live.fps} fps` : '—');
        setText(host, 'ttpd-live-busy', live ? `${live.busyPct}%` : '—');
        setText(host, 'ttpd-live-input', live ? fmtMs(live.inputP95Ms) : '—');
        setText(host, 'ttpd-live-peak', live ? fmtMs(live.busyPeakMs) : '—');
        setText(host, 'ttpd-live-mes', live ? `${live.mes}` : '—');
        setText(host, 'ttpd-live-iframes', live ? `${live.iframes}` : '—');
        setText(host, 'ttpd-live-nodes', live ? live.nodes.toLocaleString() : '—');
        setText(host, 'ttpd-live-listeners', live ? `${live.listeners}` : '—');

        flag(host, 'ttpd-live-fps', live && live.fps > 0 && live.fps < 45);
        flag(host, 'ttpd-live-busy', live && live.busyPct >= 30);
        flag(host, 'ttpd-live-input', live && live.inputP95Ms >= 100);
        flag(host, 'ttpd-live-iframes', live && live.iframes >= 30);

        setText(host, 'ttpd-verdict', verdictFor(live));

        const config = state.config;
        const configLines = [];
        if (config) {
            const { host: hostInfo, chatSurface, jsSlashRunner, littleWhiteBox } = config;
            configLines.push(`平台：${hostInfo.platform ?? '?'} / ${hostInfo.kind ?? '?'} · ABI ${hostInfo.abiVersion ?? '?'} · ${hostInfo.hardwareConcurrency ?? '?'} 核`);
            if (chatSurface) {
                const managed = chatSurface.managedOwnershipRequired;
                const managedText = managed === true ? '托管中（虚拟化生效）' : managed === false ? '未托管（虚拟化可能关闭）' : '未知';
                configLines.push(`ChatSurface：${chatSurface.available ? `v${chatSurface.protocolVersion}` : '不可用'} · ${managedText}`);
            } else {
                configLines.push('ChatSurface：不可用');
            }
            if (jsSlashRunner) {
                configLines.push(`JS-Slash-Runner：${jsSlashRunner.enabled ? '启用' : '禁用'} · 前端渲染 ${jsSlashRunner.renderEnabled ? '开' : '关'} · 深度 ${jsSlashRunner.renderDepth ?? '?'} · 流式 ${jsSlashRunner.allowStreaming ? '开' : '关'}`);
            } else {
                configLines.push('JS-Slash-Runner：未检测到');
            }
            if (littleWhiteBox) {
                configLines.push(`LittleWhiteBox：${littleWhiteBox.enabled ? '启用' : '禁用'} · 渲染 ${littleWhiteBox.renderEnabled ? '开' : '关'}`);
            }
        } else {
            configLines.push('尚未读取环境。');
        }
        const configEl = $('#ttpd-config');
        if (configEl.dataset.sig !== configLines.join('|')) {
            configEl.dataset.sig = configLines.join('|');
            configEl.textContent = '';
            for (const line of configLines) {
                const div = document.createElement('div');
                div.textContent = line;
                configEl.appendChild(div);
            }
        }

        const recording = Boolean(state.recording);
        setText(host, 'ttpd-rec', recording ? '停止' : '录制');
        setText(host, 'ttpd-rec2', recording ? '停止录制' : '开始录制 30 秒');
        setText(host, 'ttpd-rec-status', recording
            ? `录制中 · 剩余 ${Math.max(0, Math.ceil((state.recordRemainingMs || 0) / 1000))}s`
            : (state.summary ? '已录制' : ''));

        const summary = state.summary;
        const summaryLines = [];
        if (summary) {
            summaryLines.push(`时长 ${(summary.durationMs / 1000).toFixed(1)}s · ${summary.sampleCount} 个采样`);
            summaryLines.push(`平均 ${summary.avgFps} fps · 最差单帧 ${summary.worstFrameMs} ms · 掉帧 ${summary.totalDroppedFrames}`);
            summaryLines.push(`主线程平均占用 ${summary.avgBusyPct}% · 单次最长阻塞 ${summary.peakBusyMs} ms`);
            summaryLines.push(`点击延迟 p95 峰值 ${summary.maxInputP95Ms} ms · 最大 ${summary.maxInputMs} ms`);
            summaryLines.push(`滚动事件 ${summary.scrollEvents} · 滚动掉帧 ${summary.scrollJank}`);
        }
        const summaryEl = $('#ttpd-rec-summary');
        const summaryText = summaryLines.join('\n');
        if (summaryEl.textContent !== summaryText) {
            summaryEl.textContent = summaryText;
        }

        const diff = state.diff;
        const diffEl = $('#ttpd-diff-out');
        const diffText = !diff
            ? (state.baselineAt
                ? `基线已记录于 ${new Date(state.baselineAt).toLocaleTimeString()}，操作后再点「与基线对比」。`
                : '')
            : buildDiffText(diff);
        if (diffEl.textContent !== diffText) {
            diffEl.textContent = diffText;
        }
        diffEl.classList.toggle('is-warn', Boolean(diff?.suspected));

        const scanEl = $('#ttpd-scan-out');
        const scan = state.scan;
        if (scanEl.__scan !== scan) {
            scanEl.__scan = scan;
            renderScan(scanEl, scan);
        }

        const attrEl = $('#ttpd-attr');
        const attrText = buildAttrText(state.attr);
        if (attrEl.textContent !== attrText) {
            attrEl.textContent = attrText;
        }

        const probeEl = $('#ttpd-probe-out');
        const probeText = buildProbeText(state.probe, state.ttPerf);
        if (probeEl.textContent !== probeText) {
            probeEl.textContent = probeText;
        }

        const visualEl = $('#ttpd-visual-out');
        const visualText = buildVisualText(state.visual);
        if (visualEl.textContent !== visualText) {
            visualEl.textContent = visualText;
        }

        setText(host, 'ttpd-tthud', state.ttPerf?.enabled ? '关闭 TT HUD' : '开启 TT HUD');

        for (const input of host.querySelectorAll('[data-exp]')) {
            const on = Boolean(state.experiments?.[input.dataset.exp]);
            if (input.checked !== on) {
                input.checked = on;
            }
        }

        const checkbox = $('#ttpd-perfcss');
        if (checkbox.checked !== Boolean(state.perfCss)) {
            checkbox.checked = Boolean(state.perfCss);
        }

        setText(host, 'ttpd-advice', state.advice || '');
        $('#ttpd-reload').classList.toggle('ttpd-hidden', !state.pendingReload);

        const fab = $('#ttpd-fab');
        fab.classList.toggle('is-recording', recording);
        fab.textContent = recording ? 'REC' : '性能';
    }

    function buildDiffText(diff) {
        const icon = value => (value > 0 ? `+${value}` : `${value}`);
        const lines = [
            `经过 ${(diff.elapsedMs / 1000).toFixed(1)}s`,
            `消息 DOM ${icon(diff.mes)} · iframe ${icon(diff.iframes)} · DOM 节点 ${icon(diff.nodes)}`,
            `监听器净增 ${icon(diff.listeners)}（新增 ${diff.listenerAdds} / 移除 ${diff.listenerRemoves}）`,
        ];
        if (diff.suspected) {
            lines.push('⚠️ 疑似泄漏：资源增长与操作量不成比例。');
        } else {
            lines.push('未发现明显泄漏。');
        }
        return lines.join('\n');
    }

    function buildProbeText(probe, ttPerf) {
        const lines = [];
        const data = probe ?? {};
        if (data.blank) {
            lines.push(`空白遮罩：${data.blank.fps} fps（${data.blank.frames} 帧 / ${data.blank.durationMs} ms${data.blank.aborted ? ' · 中断' : ''}）`);
        }
        if (data.iframe) {
            lines.push(data.iframe.error
                ? `iframe 内：${data.iframe.error}`
                : `iframe 内：${data.iframe.fps} fps（${data.iframe.frames} 帧）`);
        }
        if (ttPerf) {
            if (!ttPerf.available) {
                lines.push('TT HUD：当前版本未安装');
            } else if (ttPerf.error) {
                lines.push(`TT HUD：读取失败 ${ttPerf.error}`);
            } else {
                const snap = ttPerf.snapshot ?? {};
                const fps = Number(snap.fps);
                const lag = snap.eventLoopLag?.p95Ms;
                const invokes = snap.invokes?.count10s;
                lines.push(`TT HUD：${ttPerf.enabled ? '开启中' : '已关闭'}`
                    + `${Number.isFinite(fps) ? ` · FPS ${fps.toFixed(1)}` : ''}`
                    + `${lag != null ? ` · 事件循环 p95 ${Math.round(lag)} ms` : ''}`
                    + `${invokes != null ? ` · invoke ${invokes}/10s` : ''}`);
            }
        }
        return lines.length
            ? lines.join('\n')
            : '点上方按钮开始定位；「空白遮罩」最能一锤定音。';
    }

    function buildVisualText(visual) {
        if (!visual) {
            return '';
        }
        if (visual.error) {
            return `扫描失败：${visual.error}`;
        }
        const lines = [
            `canvas ${visual.canvas} · video ${visual.video}（播放 ${visual.playingVideo}） · iframe ${visual.iframes}`,
            `Web 动画 ${visual.webAnimations}（运行 ${visual.runningAnimations}）`,
        ];
        if (visual.suspects?.length) {
            lines.push('面积最大的嫌疑：');
            for (const item of visual.suspects.slice(0, 6)) {
                lines.push(`  ${item.viewportPct}% 屏 · ${item.selector} · ${item.reasons.join('/')}`);
            }
        } else {
            lines.push('没有发现滤镜 / 背景图 / 动画 / canvas 类嫌疑。');
        }
        return lines.join('\n');
    }

    function buildAttrText(attr) {
        if (!attr) {
            return '开始录制后统计。';
        }
        const lines = [];
        const top = (title, items) => {
            if (!items?.length) {
                return;
            }
            lines.push(title);
            for (const item of items.slice(0, 3)) {
                lines.push(`  ${item.count}× ${item.source}`);
            }
        };

        top('监听器新增', attr.listeners);
        top('setTimeout 调度', attr.timeouts);
        top('setInterval 创建', attr.intervalSchedules);

        if (attr.intervalsActive?.length) {
            const total = attr.intervalsActive.reduce((sum, item) => sum + item.count, 0);
            lines.push(`常驻 interval（${total}）`);
            for (const item of attr.intervalsActive.slice(0, 3)) {
                lines.push(`  ${item.count}× ${item.source} · 最久 ${Math.round(item.oldestMs / 1000)}s`);
            }
        }

        if (!lines.length) {
            lines.push('这段时间没有记录到新的监听器 / 定时器。');
        }
        if (attr.stackSamplesDropped) {
            lines.push(`（调用栈采样限流，丢弃 ${attr.stackSamplesDropped} 次）`);
        }
        return lines.join('\n');
    }

    function renderScan(scanEl, scan) {
        if (!scan) {
            scanEl.textContent = '';
        } else if (scan.error) {
            scanEl.textContent = scan.error;
        } else {
            scanEl.textContent = '';
            const head = document.createElement('div');
            head.textContent = `共 ${scan.total} 楼（扫描 ${scan.scanned}${scan.truncated ? '，已截断' : ''}）· 字符 ${scan.chars.toLocaleString()} · 平均 ${scan.avgChars} · swipe ${scan.swipes}`;
            scanEl.appendChild(head);
            const second = document.createElement('div');
            second.textContent = `含 iframe ${scan.withIframe} · 含 script ${scan.withScript} · 含 HTML 标签 ${scan.withHtml}`;
            scanEl.appendChild(second);
            if (scan.heavy.length) {
                const title = document.createElement('div');
                title.className = 'ttpd-muted';
                title.textContent = '最重的楼层：';
                scanEl.appendChild(title);
                for (const item of scan.heavy) {
                    const row = document.createElement('div');
                    row.textContent = `#${item.index} ${item.role} · ${item.length} 字符${item.iframe ? ' · iframe' : ''}${item.script ? ' · script' : ''}`;
                    scanEl.appendChild(row);
                }
            }
        }
    }

    return {
        render,
        toast,
        showReport,
        open,
        close,
        isOpen,
    };
}
