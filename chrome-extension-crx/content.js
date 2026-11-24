(() => {
    'use strict';

    const MAX_SELECTION = 8000;
    const EDITABLE = 'input, textarea, select, [contenteditable], [role="textbox"], [role="searchbox"], [role="combobox"], [aria-multiline="true"]';
    const GAP = 8;
    const LABELS = { translate: '翻译', explain: '解释' };
    const FAILURE = '未能完成请求。请检查扩展里的服务配置和网络后重试。';
    const css = `
        :host { all: initial; direction: ltr; color-scheme: light dark; }
        *, *::before, *::after { box-sizing: border-box; }
        [hidden] { display: none !important; }
        .surface {
            --ink: #152638; --muted: #475b71; --border: #ccd9e5;
            --paper: #fff; --quiet: #edf3f8; --accent: #07596b;
            --on-accent: #fff; --danger: #9b3037;
            color: var(--ink); background: var(--paper);
            border: 1px solid var(--border); border-radius: 14px;
            box-shadow: 0 10px 32px rgb(11 35 54 / 24%), 0 2px 6px rgb(11 35 54 / 10%);
            font: 400 14px/1.5 system-ui, sans-serif;
            text-align: start; letter-spacing: normal;
        }
        @media (prefers-color-scheme: dark) {
            .surface { --ink: #edf5fa; --muted: #afc1d0; --border: #445868;
                --paper: #1b2937; --quiet: #2c3e50; --accent: #9ee8ef;
                --on-accent: #122a31; --danger: #ffb4b8; }
        }
        .tools { display: flex; align-items: center; flex-wrap: wrap; gap: 5px; padding: 5px; }
        .tools strong { font-size: 11px; padding: 0 6px; color: var(--muted); }
        button {
            appearance: none; margin: 0; cursor: pointer; border: 0; border-radius: 8px;
            min-height: 36px; padding: 6px 10px; color: var(--ink); background: var(--quiet);
            font: 650 13px/1.25 system-ui, sans-serif; white-space: nowrap;
        }
        button:hover:not(:disabled) { filter: brightness(.9); }
        button:active:not(:disabled) { transform: translateY(1px); }
        button:focus-visible, .result:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
        button:disabled { cursor: default; opacity: .55; }
        button.primary { color: var(--on-accent); background: var(--accent); }
        .card { width: min(410px, var(--ais-width)); max-height: var(--ais-height); overflow: auto; overscroll-behavior: contain; }
        .header { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap;
            gap: 8px; padding: 10px 12px; border-bottom: 1px solid var(--border); }
        .title { font: 700 14px/1.4 system-ui, sans-serif; margin: 0; }
        .buttons { display: flex; gap: 5px; }
        .close { font-size: 18px; line-height: 1; }
        .body { padding: 13px 14px 15px; }
        .status { margin: 0; color: var(--muted); }
        .status.failure { color: var(--danger); }
        .sr-only { position: absolute; clip-path: inset(50%); width: 1px; height: 1px; overflow: hidden; }
        .result { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; user-select: text; }
        .note { color: var(--muted); font-size: 12px; margin: 10px 0 0; }
        .clipboard { position: fixed; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
    `;

    function element(name, className, text) {
        const node = document.createElement(name);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    function button(className, text, label) {
        const node = element('button', className, text);
        node.type = 'button';
        if (label) node.setAttribute('aria-label', label);
        return node;
    }

    function parentElement(node) {
        return node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
    }

    function isEditable(node) {
        const target = parentElement(node);
        return Boolean(document.designMode === 'on' || target?.isContentEditable || target?.closest(EDITABLE));
    }

    function isSafeRange(range, host) {
        const { startContainer, endContainer, commonAncestorContainer } = range;
        if (range.collapsed || !startContainer.isConnected || !endContainer.isConnected ||
            startContainer.getRootNode() !== document || endContainer.getRootNode() !== document ||
            isEditable(startContainer) || isEditable(endContainer) || host.contains(commonAncestorContainer)) return false;

        // A range with ordinary endpoints may still cross an editable control.
        const common = parentElement(commonAncestorContainer);
        return Boolean(common && !Array.from(common.querySelectorAll(EDITABLE)).some(node => range.intersectsNode(node)));
    }

    function viewport() {
        const vv = window.visualViewport;
        return vv ? { left: vv.offsetLeft, top: vv.offsetTop, width: vv.width, height: vv.height }
            : { left: 0, top: 0, width: document.documentElement.clientWidth, height: document.documentElement.clientHeight };
    }

    function rangeRect(range, preferStart) {
        const rects = Array.from(range.getClientRects()).filter(rect => rect.width > 0 && rect.height > 0);
        return (preferStart ? rects[0] : rects.at(-1)) ?? null;
    }

    const host = element('ais-selection-ui');
    host.lang = 'zh-CN';
    host.hidden = true;
    for (const [property, value] of Object.entries({
        position: 'fixed', margin: '0', padding: '0', border: '0',
        width: 'max-content', height: 'max-content', bottom: 'auto', right: 'auto',
        'max-width': 'var(--ais-width)', 'z-index': '2147483647', 'pointer-events': 'auto',
        direction: 'ltr', opacity: '1', transform: 'none',
    })) host.style.setProperty(property, value, 'important');
    const shadow = host.attachShadow({ mode: 'closed' });
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    shadow.adoptedStyleSheets = [sheet];

    const tools = element('div', 'surface tools');
    tools.setAttribute('role', 'group');
    tools.setAttribute('aria-label', 'AI-Sliding 选中文本操作（Alt+Shift+S）');
    const translate = button('primary', LABELS.translate);
    translate.title = 'Alt+Shift+S 聚焦操作，Esc 关闭';
    translate.setAttribute('aria-keyshortcuts', 'Alt+Shift+S');
    const explain = button('', LABELS.explain);
    tools.append(element('strong', '', 'AI-Sliding'), translate, explain);

    const card = element('section', 'surface card');
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-labelledby', 'result-title');
    const header = element('div', 'header');
    const title = element('h2', 'title');
    title.id = 'result-title';
    const controls = element('div', 'buttons');
    const copy = button('primary', '复制');
    const close = button('close', '×', '关闭结果');
    controls.append(copy, close);
    header.append(title, controls);
    const body = element('div', 'body');
    const status = element('p', 'status');
    status.setAttribute('role', 'status');
    const result = element('p', 'result');
    result.dir = 'auto';
    result.tabIndex = 0;
    const copyNote = element('p', 'note');
    copyNote.setAttribute('role', 'status');
    body.append(status, result, copyNote);
    card.append(header, body);
    shadow.append(tools, card);

    let selection = null;
    let phase = null;
    let generation = 0;
    let scheduled = 0;
    let positionFrame = 0;
    let returnFocus = null;
    let pointerStart = null;
    const pendingSelectionKeys = new Set();

    function fromUI(event) {
        return event.composedPath().includes(host);
    }

    function updateVisibility() {
        host.hidden = phase === null;
        host.style.setProperty('display', phase === null ? 'none' : 'block', 'important');
        tools.hidden = phase !== 'tools';
        card.hidden = phase !== 'card';
    }

    function dismiss(restoreFocus = false) {
        const focus = returnFocus;
        const hadFocus = Boolean(shadow.activeElement);
        generation++;
        if (scheduled) cancelAnimationFrame(scheduled);
        scheduled = 0;
        phase = null;
        selection = null;
        returnFocus = null;
        status.textContent = '';
        result.textContent = '';
        copyNote.textContent = '';
        updateVisibility();
        if (restoreFocus && hadFocus && focus?.isConnected && focus !== host) {
            focus.focus?.({ preventScroll: true });
        }
    }

    function position() {
        if (!phase || !selection) return;
        const v = viewport();
        const currentRect = selection.range.startContainer.isConnected ? rangeRect(selection.range, selection.preferStart) : null;
        if (currentRect) selection.rect = currentRect;
        const rect = selection.rect;
        if (phase === 'tools' && (!currentRect || rect.bottom < v.top || rect.top > v.top + v.height ||
            rect.right < v.left || rect.left > v.left + v.width)) {
            dismiss();
            return;
        }
        host.style.setProperty('--ais-width', `${Math.max(0, v.width - 2 * GAP)}px`, 'important');
        host.style.setProperty('--ais-height', `${Math.max(0, v.height - 2 * GAP)}px`, 'important');
        const { width, height } = host.getBoundingClientRect();
        const x = Math.max(v.left + GAP, Math.min(rect.left, v.left + v.width - width - GAP));
        const below = rect.bottom + GAP;
        const above = rect.top - height - GAP;
        const y = Math.max(v.top + GAP, Math.min(
            below + height <= v.top + v.height - GAP || above < v.top + GAP ? below : above,
            v.top + v.height - height - GAP,
        ));
        host.style.setProperty('left', `${x}px`, 'important');
        host.style.setProperty('top', `${y}px`, 'important');
    }

    function schedulePosition(event) {
        if (event && fromUI(event)) return;
        if (!phase || positionFrame) return;
        positionFrame = requestAnimationFrame(() => {
            positionFrame = 0;
            position();
        });
    }

    function captureSelection() {
        scheduled = 0;
        const current = window.getSelection();
        if (!current || current.rangeCount !== 1 || current.isCollapsed || isEditable(document.activeElement)) {
            if (phase === 'tools') dismiss();
            return;
        }
        const range = current.getRangeAt(0).cloneRange();
        if (!isSafeRange(range, host)) {
            if (phase === 'tools') dismiss();
            return;
        }
        const text = range.toString().trim();
        const preferStart = current.focusNode === range.startContainer && current.focusOffset === range.startOffset;
        const rect = rangeRect(range, preferStart);
        if (!text || !rect || text !== current.toString().trim()) {
            if (phase === 'tools') dismiss();
            return;
        }
        if (phase === 'card') dismiss();
        selection = { text: text.length > MAX_SELECTION ? null : text, range, rect, preferStart };
        returnFocus = document.activeElement;
        generation++;
        phase = 'tools';
        if (!host.isConnected) document.documentElement.append(host);
        updateVisibility();
        position();
    }

    function scheduleSelection() {
        if (scheduled) cancelAnimationFrame(scheduled);
        scheduled = requestAnimationFrame(captureSelection);
    }

    function showFailure(message) {
        status.className = 'status failure';
        status.hidden = false;
        status.textContent = message;
        position();
    }

    async function requestAction(event, action) {
        if (!event.isTrusted || phase !== 'tools' || !selection) return;
        event.stopPropagation();
        const snapshot = selection;
        // The live page may change between the selection gesture and the button click.
        const safe = isSafeRange(snapshot.range, host) &&
            (snapshot.text === null || snapshot.range.toString().trim() === snapshot.text);
        if (!safe) {
            dismiss(true);
            return;
        }
        const id = ++generation;
        phase = 'card';
        title.textContent = `${LABELS[action]}结果`;
        status.className = 'status';
        status.textContent = '处理中…';
        status.hidden = false;
        result.textContent = '';
        result.hidden = true;
        copyNote.textContent = '';
        copy.hidden = true;
        updateVisibility();
        position();
        close.focus({ preventScroll: true });

        if (snapshot.text === null) {
            showFailure(`选中的文本超过 ${MAX_SELECTION} 个字符，请缩小范围后重试。`);
            return;
        }
        try {
            const response = await chrome.runtime.sendMessage({ type: 'ais:process', action, text: snapshot.text });
            if (id !== generation || phase !== 'card') return;
            if (response?.ok !== true || typeof response.result !== 'string' || !response.result.trim()) {
                showFailure(FAILURE);
                return;
            }
            status.textContent = '结果已就绪。';
            status.className = 'status sr-only';
            // Keep the completion announcement available, but show only the answer visually.
            result.textContent = response.result;
            result.hidden = false;
            copy.hidden = false;
            position();
        } catch {
            if (id === generation && phase === 'card') showFailure(FAILURE);
        }
    }

    translate.addEventListener('click', event => requestAction(event, 'translate'));
    explain.addEventListener('click', event => requestAction(event, 'explain'));
    close.addEventListener('click', event => {
        if (!event.isTrusted) return;
        event.stopPropagation();
        dismiss(true);
    });

    function copyFallback(text) {
        const field = element('textarea', 'clipboard');
        field.value = text;
        field.readOnly = true;
        field.tabIndex = -1;
        const focus = shadow.activeElement;
        shadow.append(field);
        try {
            field.focus({ preventScroll: true });
            field.select();
            return document.execCommand('copy') === true;
        } catch {
            return false;
        } finally {
            field.remove();
            focus?.focus({ preventScroll: true });
        }
    }

    copy.addEventListener('click', async event => {
        if (!event.isTrusted || phase !== 'card' || result.hidden) return;
        event.stopPropagation();
        const id = generation;
        const text = result.textContent;
        let copied = false;
        try {
            await navigator.clipboard.writeText(text);
            copied = true;
        } catch {
            if (id === generation && phase === 'card') copied = copyFallback(text);
        }
        if (id !== generation || phase !== 'card') return;
        copyNote.textContent = copied ? '已复制。' : '无法自动复制，请手动选中结果并复制。';
        position();
    });
    // Do not collapse the source selection while a mouse user presses an action.
    tools.addEventListener('mousedown', event => {
        if (event.isTrusted && event.button === 0) event.preventDefault();
    });

    document.addEventListener('pointerdown', event => {
        if (!event.isTrusted || fromUI(event)) return;
        pointerStart = !event.isPrimary || event.button !== 0 || event.composedPath().some(isEditable)
            ? null : event.pointerId;
        if (phase || scheduled) dismiss();
    }, true);
    document.addEventListener('pointerup', event => {
        if (!event.isTrusted || event.pointerId !== pointerStart) return;
        pointerStart = null;
        if (!fromUI(event) && !event.composedPath().some(isEditable)) scheduleSelection();
    }, true);
    document.addEventListener('pointercancel', event => {
        if (event.isTrusted && event.pointerId === pointerStart) pointerStart = null;
    }, true);

    function selectionKey(event) {
        return (event.shiftKey && /^(Arrow(?:Left|Right|Up|Down)|Home|End|PageUp|PageDown)$/.test(event.key)) ||
            ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'a');
    }

    document.addEventListener('keydown', event => {
        if (!event.isTrusted) return;
        if (event.key === 'Escape' && (phase || scheduled)) {
            if (fromUI(event)) {
                event.preventDefault();
                event.stopPropagation();
            }
            dismiss(true);
            return;
        }
        if (phase === 'tools' && event.altKey && event.shiftKey && !event.ctrlKey && !event.metaKey &&
            event.code === 'KeyS' && !event.composedPath().some(isEditable)) {
            event.preventDefault();
            event.stopPropagation();
            translate.focus({ preventScroll: true });
            return;
        }
        if (!fromUI(event) && !event.composedPath().some(isEditable) && selectionKey(event)) {
            pendingSelectionKeys.add(event.code || event.key);
        }
    }, true);
    document.addEventListener('keyup', event => {
        if (!event.isTrusted || !pendingSelectionKeys.delete(event.code || event.key)) return;
        if (!fromUI(event) && !event.composedPath().some(isEditable)) scheduleSelection();
    }, true);
    window.addEventListener('blur', () => {
        pointerStart = null;
        pendingSelectionKeys.clear();
        if (phase === 'tools') dismiss();
    });
    window.addEventListener('scroll', schedulePosition, { capture: true, passive: true });
    window.addEventListener('resize', schedulePosition, { passive: true });
    window.visualViewport?.addEventListener('scroll', schedulePosition, { passive: true });
    window.visualViewport?.addEventListener('resize', schedulePosition, { passive: true });
    updateVisibility();
})();
