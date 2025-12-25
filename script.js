// ============================================
// データ保存管理 (単一計画/タブ)
// ============================================
const DataManager = {
    dbName: "GanttAppDB",
    storeName: "appData",
    useLocalStorage: false,
    PLAN_KEY: "main",

    async init() {
        try {
            await new Promise((resolve, reject) => {
                const req = indexedDB.open(this.dbName, 1);
                req.onupgradeneeded = (e) => {
                    const db = e.target.result;
                    if (!db.objectStoreNames.contains(this.storeName)) {
                        db.createObjectStore(this.storeName, { keyPath: "id" });
                    }
                };
                req.onsuccess = (e) => { this.db = e.target.result; resolve(); };
                req.onerror = (e) => reject(e);
            });
        } catch (err) {
            console.warn("IndexedDB unavailable, falling back to LocalStorage.");
            this.useLocalStorage = true;
        }
    },

    async load() {
        if (this.useLocalStorage) {
            const json = localStorage.getItem(this.dbName + "_" + this.PLAN_KEY);
            return json ? JSON.parse(json) : null;
        }
        return new Promise((resolve) => {
            const tx = this.db.transaction([this.storeName], "readonly");
            const req = tx.objectStore(this.storeName).get(this.PLAN_KEY);
            req.onsuccess = (e) => resolve(e.target.result ? e.target.result.data : null);
            req.onerror = () => resolve(null);
        });
    },

    async save(data) {
        const ind = document.getElementById("statusIndicator");
        ind.style.opacity = 1;
        setTimeout(() => ind.style.opacity = 0, 1500);

        if (this.useLocalStorage) {
            localStorage.setItem(this.dbName + "_" + this.PLAN_KEY, JSON.stringify(data));
            return;
        }
        return new Promise((resolve) => {
            const tx = this.db.transaction([this.storeName], "readwrite");
            tx.objectStore(this.storeName).put({ id: this.PLAN_KEY, data: data });
            tx.oncomplete = () => resolve();
        });
    }
};

// ============================================
// アプリケーションロジック
// ============================================
const CELL_WIDTH = 28;
const BASE_ROW_HEIGHT = 52;
const SEGMENT_OFFSET_Y = 44;
const now = new Date();
const todayISO = dateToISO(now);
const defaultStart = new Date(now.getFullYear(), now.getMonth(), 1);
const defaultEnd = new Date(now.getFullYear(), now.getMonth() + 3, 0);

// アプリ状態
let appData = {
    projectName: "標準の計画",
    settings: {
        startDate: dateToISO(defaultStart),
        endDate: dateToISO(defaultEnd),
        holidays: []
    },
    tasks: [],
    memo: ""
};

let timelineDays = [];
let taskObjects = [];
let activeTaskId = null;
let selectedSegments = [];
let currentMode = "plan";

let activeProgressSegmentId = null;

// DOM要素
const headerRow = document.getElementById("headerRow");
const rowsContainer = document.getElementById("rowsContainer");
const leftRowsContainer = document.getElementById("leftRows");
const rangeLabel = document.getElementById("rangeLabel");
const ganttRight = document.getElementById("ganttRight");
const freeMemo = document.getElementById("freeMemo");
const showHiddenCheck = document.getElementById("showHiddenCheck");
const projectNameInput = document.getElementById("projectNameInput");
const contextMenu = document.getElementById("contextMenu");
let contextMenuTargetTaskId = null;
const settingsPanel = document.getElementById("settingsPanel");
const totalRow = document.getElementById("totalRow");
const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

function pad2(n) { return String(n).padStart(2, "0"); }
function dateToISO(d) { return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }
function isoToDate(iso) { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d); }
function shiftDateStr(str, delta) {
    const d = isoToDate(str);
    d.setDate(d.getDate() + delta);
    return dateToISO(d);
}
function formatTimestamp(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const h = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${y}${m}${day}${h}${min}`;
}
function dateToIndex(str) { return timelineDays.findIndex((d) => d.iso === str); }
function isSegmentSelected(taskId, segId) { return selectedSegments.some((s) => s.taskId === taskId && s.segId === segId); }
function centerX(index) { return index * CELL_WIDTH + CELL_WIDTH / 2; }

// --- データ同期 & 保存 ---
function syncDataModel() {
    appData.tasks = taskObjects.map(t => ({
        id: t.id,
        label1: t.leftRowEl.children[1].firstElementChild.textContent,
        label2: t.leftRowEl.children[2].firstElementChild.textContent,
        label3: t.leftRowEl.children[3].firstElementChild.textContent,
        segments: t.segments,
        isDone: t.isDone || false,
        isHidden: t.isHidden || false
    }));
    appData.memo = freeMemo.innerHTML;
    appData.projectName = projectNameInput.value;
}

function triggerSave() {
    syncDataModel();
    calculateTotals();
    DataManager.save(appData);
}

projectNameInput.addEventListener("input", () => {
    document.title = projectNameInput.value + " | 工程表";
    triggerSave();
});
freeMemo.addEventListener("input", triggerSave);

// --- 初期化 ---
async function initializeApp() {
    await DataManager.init();
    const savedData = await DataManager.load();
    if (savedData) {
        restoreFromData(savedData);
    } else {
        buildTimeline();
        buildHeader();
        addTaskRow();
        scrollToToday();
        document.title = appData.projectName + " | 工程表";
    }
    setupControlEvents();
}

function restoreFromData(data) {
    appData = data;
    if (!data.settings.startDate) {
        appData.settings.startDate = dateToISO(defaultStart);
        appData.settings.endDate = dateToISO(defaultEnd);
    }

    const restoredName = data.projectName || "標準の計画";
    projectNameInput.value = restoredName;
    document.title = restoredName + " | 工程表";

    if (data.memo) freeMemo.innerHTML = data.memo;

    leftRowsContainer.innerHTML = "";
    rowsContainer.innerHTML = "";
    taskObjects = [];

    buildTimeline();
    buildHeader();

    if (appData.tasks && appData.tasks.length > 0) {
        appData.tasks.forEach(tData => addTaskRow(tData));
    } else {
        addTaskRow();
    }
    setTimeout(scrollToToday, 100);
}

function scrollToToday() {
    const todayIdx = timelineDays.findIndex(d => d.iso === todayISO);
    if (todayIdx !== -1) {
        const x = todayIdx * CELL_WIDTH;
        const containerWidth = ganttRight.clientWidth;
        ganttRight.scrollLeft = x - (containerWidth / 2) + (CELL_WIDTH / 2);
    }
}

function buildTimeline() {
    timelineDays = [];
    const startDt = isoToDate(appData.settings.startDate);
    const endDt = isoToDate(appData.settings.endDate);
    const curr = new Date(startDt);

    while (curr <= endDt) {
        const iso = dateToISO(curr);
        const dow = curr.getDay();
        timelineDays.push({
            index: timelineDays.length,
            date: new Date(curr),
            iso,
            day: curr.getDate(),
            dow,
            month: curr.getMonth() + 1,
            year: curr.getFullYear(),
            isWeekend: dow === 0 || dow === 6,
            isHoliday: appData.settings.holidays.includes(iso),
            isToday: iso === todayISO
        });
        curr.setDate(curr.getDate() + 1);
    }
    updateRangeLabel();
}

function updateRangeLabel() {
    if (!timelineDays.length) { rangeLabel.textContent = ""; return; }
    const f = timelineDays[0].date;
    const l = timelineDays[timelineDays.length - 1].date;
    rangeLabel.textContent = `${dateToISO(f)} 〜 ${dateToISO(l)}`;
}

function buildHeader() {
    headerRow.innerHTML = "";
    const total = timelineDays.length;
    headerRow.style.gridTemplateColumns = `repeat(${total}, ${CELL_WIDTH}px)`;
    timelineDays.forEach((d) => {
        const c = document.createElement("div");
        c.className = "header-day";
        if (d.isWeekend) c.classList.add("weekend");
        if (d.isHoliday) c.classList.add("holiday");
        if (d.isToday) c.classList.add("today");
        c.innerHTML = `<div class="header-day-num">${d.month}/${d.day}</div><div class="header-day-week">${WEEKDAYS[d.dow]}</div>`;
        headerRow.appendChild(c);
    });

    // 合計行の初期化 【修正】色付けロジック追加
    totalRow.innerHTML = "";
    totalRow.style.gridTemplateColumns = `repeat(${total}, ${CELL_WIDTH}px)`;
    timelineDays.forEach((d) => {
        const c = document.createElement("div");
        c.className = "total-cell";
        if (d.isWeekend) c.classList.add("weekend");
        if (d.isHoliday) c.classList.add("holiday");
        if (d.isToday) c.classList.add("today");
        c.dataset.iso = d.iso;
        totalRow.appendChild(c);
    });
}

// --- Drag & Drop ---
let dragSrcEl = null;
function handleDragStart(e) {
    dragSrcEl = this.closest('.left-row');
    dragSrcEl.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    const rows = Array.from(leftRowsContainer.children);
    e.dataTransfer.setData('text/plain', rows.indexOf(dragSrcEl));
}
function handleDragOver(e) { if (e.preventDefault) e.preventDefault(); e.dataTransfer.dropEffect = 'move'; return false; }
function handleDragEnter(e) { this.closest('.left-row').classList.add('over'); }
function handleDragLeave(e) { this.closest('.left-row').classList.remove('over'); }
function handleDrop(e) {
    e.stopPropagation();
    const targetRow = this.closest('.left-row');
    if (dragSrcEl !== targetRow) {
        const rows = Array.from(leftRowsContainer.children);
        const srcIdx = parseInt(e.dataTransfer.getData('text/plain'));
        const targetIdx = rows.indexOf(targetRow);
        const movedItem = taskObjects.splice(srcIdx, 1)[0];
        taskObjects.splice(targetIdx, 0, movedItem);
        refreshRowsDOM();
        triggerSave();
    }
    return false;
}
function handleDragEnd(e) {
    leftRowsContainer.querySelectorAll('.left-row').forEach(r => { r.classList.remove('over'); r.classList.remove('dragging'); });
}
function refreshRowsDOM() {
    taskObjects.forEach(task => { leftRowsContainer.appendChild(task.leftRowEl); rowsContainer.appendChild(task.rowEl); });
}

function addTaskRow(initialData = null) {
    const id = initialData ? initialData.id : "task_" + Date.now() + "_" + Math.random().toString(36).slice(2);
    const total = timelineDays.length;

    const leftRow = document.createElement("div");
    leftRow.className = "left-row";
    if (initialData && initialData.isDone) leftRow.classList.add("task-done");
    if (initialData && initialData.isHidden) leftRow.classList.add("task-hidden");

    const grip = document.createElement("div");
    grip.className = "drag-handle"; grip.innerHTML = "⠿"; grip.draggable = true;
    grip.addEventListener('dragstart', handleDragStart);
    leftRow.appendChild(grip);

    leftRow.addEventListener('dragover', handleDragOver); leftRow.addEventListener('drop', handleDrop);
    leftRow.addEventListener('dragenter', handleDragEnter); leftRow.addEventListener('dragleave', handleDragLeave);
    leftRow.addEventListener('dragend', handleDragEnd);

    const createInput = (ph, text) => {
        const cell = document.createElement("div"); cell.className = "label-cell";
        const ed = document.createElement("div"); ed.className = "editable"; ed.contentEditable = "true"; ed.dataset.placeholder = ph;
        if (text) ed.textContent = text;
        ed.addEventListener('input', triggerSave);
        cell.appendChild(ed);
        return cell;
    };

    const l1 = initialData ? initialData.label1 : "";
    const l2 = initialData ? initialData.label2 : "";
    const l3 = initialData ? initialData.label3 : "";
    leftRow.appendChild(createInput("項目1", l1));
    leftRow.appendChild(createInput("項目2", l2));
    leftRow.appendChild(createInput("時間", l3));

    leftRow.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        showContextMenu(e, id);
    });

    leftRowsContainer.appendChild(leftRow);

    const row = document.createElement("div");
    row.className = "task-row";
    row.dataset.id = id;
    row.style.gridTemplateColumns = `repeat(${total}, ${CELL_WIDTH}px)`;
    if (initialData && initialData.isDone) row.classList.add("task-done");
    if (initialData && initialData.isHidden) row.classList.add("task-hidden");

    const cellRow = document.createElement("div"); cellRow.style.display = "contents";
    for (let i = 0; i < total; i++) {
        const d = timelineDays[i];
        const c = document.createElement("div"); c.className = "cell";
        if (d.isWeekend) c.classList.add("weekend");
        if (d.isHoliday) c.classList.add("holiday");
        if (d.isToday) c.classList.add("today");
        c.dataset.index = i; cellRow.appendChild(c);
    }
    row.appendChild(cellRow);
    const segLayer = document.createElement("div"); segLayer.className = "segments-layer"; row.appendChild(segLayer);
    rowsContainer.appendChild(row);

    const task = {
        id,
        rowEl: row,
        leftRowEl: leftRow,
        cellRowEl: cellRow,
        segLayerEl: segLayer,
        segments: initialData ? initialData.segments : [],
        isDone: initialData ? !!initialData.isDone : false,
        isHidden: initialData ? !!initialData.isHidden : false,
        pendingStartIndex: null,
        pendingStartDate: null
    };
    taskObjects.push(task);
    setupRowInteraction(task);
    activeTaskId = id;
    updateActiveRowHighlight();
    renderAllSegments();
    if (!initialData) triggerSave();
}

// --- コンテキストメニュー処理 ---
function showContextMenu(e, taskId) {
    contextMenuTargetTaskId = taskId;
    const task = taskObjects.find(t => t.id === taskId);

    const hideBtn = document.getElementById("cmHide");
    const unhideBtn = document.getElementById("cmUnhide");

    if (task.isHidden) {
        hideBtn.style.display = "none";
        unhideBtn.style.display = "block";
    } else {
        hideBtn.style.display = "block";
        unhideBtn.style.display = "none";
    }

    contextMenu.style.display = "block";
    contextMenu.style.left = e.pageX + "px";
    contextMenu.style.top = e.pageY + "px";
}

document.addEventListener("click", () => {
    contextMenu.style.display = "none";
});

document.getElementById("cmComplete").addEventListener("click", () => {
    const task = taskObjects.find(t => t.id === contextMenuTargetTaskId);
    if (task) {
        task.isDone = !task.isDone;
        task.leftRowEl.classList.toggle("task-done", task.isDone);
        task.rowEl.classList.toggle("task-done", task.isDone);
        triggerSave();
    }
});
document.getElementById("cmHide").addEventListener("click", () => {
    const task = taskObjects.find(t => t.id === contextMenuTargetTaskId);
    if (task) {
        task.isHidden = true;
        task.leftRowEl.classList.add("task-hidden");
        task.rowEl.classList.add("task-hidden");
        triggerSave();
    }
});
document.getElementById("cmUnhide").addEventListener("click", () => {
    const task = taskObjects.find(t => t.id === contextMenuTargetTaskId);
    if (task) {
        task.isHidden = false;
        task.leftRowEl.classList.remove("task-hidden");
        task.rowEl.classList.remove("task-hidden");
        triggerSave();
    }
});
document.getElementById("cmDelete").addEventListener("click", () => {
    if (confirm("この行を削除しますか？")) {
        deleteTaskRow(contextMenuTargetTaskId);
    }
});

showHiddenCheck.addEventListener("change", (e) => {
    if (e.target.checked) {
        document.body.classList.add("show-hidden-mode");
    } else {
        document.body.classList.remove("show-hidden-mode");
    }
});

function deleteTaskRow(id) {
    const idx = taskObjects.findIndex(t => t.id === id);
    if (idx === -1) return;
    const t = taskObjects[idx];
    t.leftRowEl.remove(); t.rowEl.remove();
    taskObjects.splice(idx, 1);
    triggerSave();
}

function updateActiveRowHighlight() {
    taskObjects.forEach((t) => {
        const active = t.id === activeTaskId;
        t.rowEl.classList.toggle("active", active); t.leftRowEl.classList.toggle("active", active);
    });
}

// --- 【進捗選択状態の管理】 ---
function findSegmentById(segId) {
    for (const task of taskObjects) {
        const seg = task.segments.find(s => s.id === segId);
        if (seg) return { task, seg };
    }
    return null;
}

function selectProgressSegment(taskId, segId) {
    if (activeProgressSegmentId === segId) {
        activeProgressSegmentId = null;
    } else {
        activeProgressSegmentId = segId;
    }
    renderAllSegments();
}


// ============================================
// 【描画ロジック】
// ============================================
function renderAllSegments() {
    if (!timelineDays.length) return;
    const rangeStart = timelineDays[0].date;
    const rangeEnd = timelineDays[timelineDays.length - 1].date;

    taskObjects.forEach((task) => {
        task.segLayerEl.innerHTML = "";

        if (task.segments.length === 0) {
            task.rowEl.style.height = BASE_ROW_HEIGHT + "px";
            task.leftRowEl.style.height = BASE_ROW_HEIGHT + "px";
            if (task.pendingStartIndex != null) drawDraftStart(task);
            return;
        }

        const taskDates = {};
        task.segments.forEach(seg => seg._lane = 0);

        const sortedSegs = [...task.segments].sort((a, b) => {
            if (a.startDate !== b.startDate) {
                return a.startDate < b.startDate ? -1 : 1;
            }
            return a.endDate < b.endDate ? -1 : 1;
        });

        let maxLaneUsed = 0;

        sortedSegs.forEach(seg => {
            let requiredLane = 0;
            let sIdx = dateToIndex(seg.startDate);
            let eIdx = dateToIndex(seg.endDate);
            if (sIdx === -1 || eIdx === -1) return;

            while (true) {
                let overlap = false;
                for (let i = Math.min(sIdx, eIdx); i <= Math.max(sIdx, eIdx); i++) {
                    const iso = timelineDays[i].iso;
                    if (taskDates[iso] && taskDates[iso].includes(requiredLane)) {
                        overlap = true;
                        break;
                    }
                }
                if (!overlap) break;
                requiredLane++;
            }

            seg._lane = requiredLane;
            maxLaneUsed = Math.max(maxLaneUsed, requiredLane);

            for (let i = Math.min(sIdx, eIdx); i <= Math.max(sIdx, eIdx); i++) {
                const iso = timelineDays[i].iso;
                if (!taskDates[iso]) taskDates[iso] = [];
                taskDates[iso].push(requiredLane);
            }
        });

        const laneCount = maxLaneUsed + 1;
        const newHeight = Math.max(BASE_ROW_HEIGHT, 30 + (laneCount * SEGMENT_OFFSET_Y));

        task.rowEl.style.height = newHeight + "px";
        task.leftRowEl.style.height = newHeight + "px";

        task.segments.forEach((seg) => {
            const lane = seg._lane || 0;
            const topPx = 30 + (lane * SEGMENT_OFFSET_Y);

            if (seg.type === "point") {
                const idx = dateToIndex(seg.startDate);
                if (idx !== -1) drawPointSegment(task, seg, idx, topPx);
            } else {
                const sdt = isoToDate(seg.startDate);
                const edt = isoToDate(seg.endDate);
                if (edt >= rangeStart && sdt <= rangeEnd) {
                    const vs = sdt < rangeStart ? rangeStart : sdt;
                    const ve = edt > rangeEnd ? rangeEnd : edt;
                    const sIdx = dateToIndex(dateToISO(vs));
                    const eIdx = dateToIndex(dateToISO(ve));
                    if (sIdx !== -1 && eIdx !== -1) drawRangeSegment(task, seg, sIdx, eIdx, topPx);
                }
            }
        });

        if (task.pendingStartIndex != null) drawDraftStart(task);
    });

    calculateTotals();
}

function calculateTotals() {
    const totals = {};
    timelineDays.forEach(d => totals[d.iso] = 0);

    taskObjects.forEach(task => {
        if (task.isHidden) return;
        task.segments.forEach(seg => {
            if (seg.dailyValues) {
                for (const [iso, val] of Object.entries(seg.dailyValues)) {
                    if (totals.hasOwnProperty(iso)) {
                        totals[iso] += parseFloat(val) || 0;
                    }
                }
            }
        });
    });

    const cells = totalRow.children;
    for (let i = 0; i < cells.length; i++) {
        const cell = cells[i];
        const iso = cell.dataset.iso;
        let val = totals[iso];

        if (val > 0) {
            if (val > 99.9) val = 99.9;
            cell.textContent = (val % 1 === 0) ? val : val.toFixed(1);
        } else {
            cell.textContent = "";
        }
    }
}

function drawRangeSegment(task, seg, sIdx, eIdx, topPx) {
    const sc = centerX(sIdx), ec = centerX(eIdx);
    const baseLeft = Math.min(sc, ec), baseWidth = Math.max(1, Math.abs(sc - ec));

    const isProgressSelected = activeProgressSegmentId === seg.id;
    const isPlanSelected = seg.id && isSegmentSelected(task.id, seg.id);

    const div = document.createElement("div");
    div.className = "segment" + (isPlanSelected ? " selected" : "") + (isProgressSelected ? " progress-active" : "");
    div.style.left = baseLeft + "px";
    div.style.width = baseWidth + "px";
    div.style.top = topPx + "px";
    addSegEvents(div, task, seg);
    task.segLayerEl.appendChild(div);

    const startRaw = dateToIndex(seg.startDate);
    const endRaw = dateToIndex(seg.endDate);
    if (startRaw !== -1 && endRaw !== -1) {
        const minI = Math.min(startRaw, endRaw);
        const maxI = Math.max(startRaw, endRaw);

        for (let i = minI; i <= maxI; i++) {
            const iso = timelineDays[i].iso;
            const x = centerX(i);

            const valDiv = document.createElement("div");
            valDiv.className = "daily-val";
            valDiv.style.left = x + "px";
            valDiv.style.top = (topPx + 8) + "px";

            if (seg.dailyValues && seg.dailyValues[iso] != null) {
                const v = parseFloat(seg.dailyValues[iso]);
                valDiv.textContent = (v % 1 === 0) ? v : v.toFixed(1);
            }

            valDiv.addEventListener("click", (e) => {
                e.stopPropagation();
                if (currentMode !== "plan") return;

                const curVal = (seg.dailyValues && seg.dailyValues[iso]) || "";
                let input = prompt("工数を入力 (0-10)", curVal);
                if (input !== null) {
                    input = input.trim();
                    if (input === "") {
                        if (seg.dailyValues) delete seg.dailyValues[iso];
                    } else {
                        let num = parseFloat(input);
                        if (isNaN(num)) return;
                        if (num < 0) num = 0;
                        if (num > 10) num = 10;
                        if (!seg.dailyValues) seg.dailyValues = {};
                        seg.dailyValues[iso] = num;
                    }
                    renderAllSegments();
                    triggerSave();
                }
            });
            task.segLayerEl.appendChild(valDiv);
        }
    }

    if (seg.progressEndDate) {
        const sIdxRaw = dateToIndex(seg.startDate);
        const pIdxRaw = dateToIndex(seg.progressEndDate);
        if (sIdxRaw !== -1 && pIdxRaw !== -1 && pIdxRaw >= sIdxRaw) {
            const left = centerX(sIdxRaw);
            const eIdxRaw = dateToIndex(seg.endDate);
            let right = (eIdxRaw !== -1 && pIdxRaw < eIdxRaw) ? (pIdxRaw + 1) * CELL_WIDTH : centerX(pIdxRaw);
            const w = right - left;
            if (w > 0) {
                const dDiv = document.createElement("div");
                dDiv.className = "segment done";
                dDiv.style.left = left + "px";
                dDiv.style.width = w + "px";
                dDiv.style.pointerEvents = "none";
                dDiv.style.top = topPx + "px";
                task.segLayerEl.appendChild(dDiv);
            }
        }
    }

    const pointsData = [
        { x: sc, d: isoToDate(seg.startDate), isEnd: false },
        { x: ec, d: isoToDate(seg.endDate), isEnd: true }
    ];

    pointsData.forEach((ptData) => {
        const pt = document.createElement("div");

        let isDone = false;
        const pDate = seg.progressEndDate ? isoToDate(seg.progressEndDate) : null;

        if (pDate) {
            if (ptData.isEnd) {
                if (pDate.getTime() >= ptData.d.getTime()) {
                    isDone = true;
                }
            } else {
                if (pDate.getTime() >= ptData.d.getTime()) {
                    isDone = true;
                }
            }
        }

        const classList = ["point"];
        if (isPlanSelected) classList.push("selected");
        if (isDone) classList.push("done");
        if (isProgressSelected) classList.push("progress-active");

        pt.className = classList.join(" ");

        pt.style.left = ptData.x + "px";
        pt.style.top = topPx + "px";
        addSegEvents(pt, task, seg);
        task.segLayerEl.appendChild(pt);
    });

    if (seg.label) {
        const lab = document.createElement("div");
        const isCompletedFull = seg.progressEndDate && isoToDate(seg.progressEndDate).getTime() >= isoToDate(seg.endDate).getTime();

        const classList = ["segment-label"];
        if (isPlanSelected) classList.push("selected");
        if (isCompletedFull) classList.push("done");
        if (isProgressSelected) classList.push("progress-active");

        lab.className = classList.join(" ");
        lab.textContent = seg.label;
        lab.style.left = (sc + ec) / 2 + "px";
        lab.style.top = (topPx - 20) + "px";
        lab.style.bottom = "auto";
        addSegEvents(lab, task, seg);
        task.segLayerEl.appendChild(lab);
    }
}

function drawPointSegment(task, seg, idx, topPx) {
    const c = centerX(idx);
    const isProgressSelected = activeProgressSegmentId === seg.id;
    const isPlanSelected = seg.id && isSegmentSelected(task.id, seg.id);

    const isDone = seg.progressEndDate && isoToDate(seg.progressEndDate).getTime() >= isoToDate(seg.startDate).getTime();

    const pt = document.createElement("div");

    const classList = ["point"];
    if (isPlanSelected) classList.push("selected");
    if (isDone) classList.push("done");
    if (isProgressSelected) classList.push("progress-active");

    pt.className = classList.join(" ");

    pt.style.left = c + "px";
    pt.style.top = topPx + "px";
    addSegEvents(pt, task, seg);
    task.segLayerEl.appendChild(pt);

    const iso = timelineDays[idx].iso;
    const valDiv = document.createElement("div");
    valDiv.className = "daily-val";
    valDiv.style.left = c + "px";
    valDiv.style.top = (topPx + 8) + "px";
    if (seg.dailyValues && seg.dailyValues[iso] != null) {
        const v = parseFloat(seg.dailyValues[iso]);
        valDiv.textContent = (v % 1 === 0) ? v : v.toFixed(1);
    }
    valDiv.addEventListener("click", (e) => {
        e.stopPropagation();
        if (currentMode !== "plan") return;
        const curVal = (seg.dailyValues && seg.dailyValues[iso]) || "";
        let input = prompt("工数を入力 (0-10)", curVal);
        if (input !== null) {
            input = input.trim();
            if (input === "") {
                if (seg.dailyValues) delete seg.dailyValues[iso];
            } else {
                let num = parseFloat(input);
                if (isNaN(num)) return;
                if (num < 0) num = 0;
                if (num > 10) num = 10;
                if (!seg.dailyValues) seg.dailyValues = {};
                seg.dailyValues[iso] = num;
            }
            renderAllSegments();
            triggerSave();
        }
    });
    task.segLayerEl.appendChild(valDiv);

    if (seg.label) {
        const lab = document.createElement("div");
        const classList = ["segment-label"];
        if (isPlanSelected) classList.push("selected");
        if (isDone) classList.push("done");
        if (isProgressSelected) classList.push("progress-active");

        lab.className = classList.join(" ");
        lab.textContent = seg.label;
        lab.style.left = c + "px";
        lab.style.top = (topPx - 20) + "px";
        lab.style.bottom = "auto";
        addSegEvents(lab, task, seg);
        task.segLayerEl.appendChild(lab);
    }
}

function drawDraftStart(task) {
    const c = centerX(task.pendingStartIndex);
    const pt = document.createElement("div"); pt.className = "point draft";
    pt.style.left = c + "px";
    pt.style.top = "30px";
    pt.style.cursor = "pointer"; pt.title = "キャンセル";
    pt.addEventListener("click", (e) => { e.stopPropagation(); task.pendingStartIndex = null; task.pendingStartDate = null; renderAllSegments(); });
    task.segLayerEl.appendChild(pt);
}

// 【イベントハンドラ】
function addSegEvents(el, task, seg) {
    el.addEventListener("click", (e) => {
        e.stopPropagation();
        if (currentMode === "plan") {
            handleSegClick(task, seg, e.shiftKey);
        } else if (currentMode === "progress") {
            selectProgressSegment(task.id, seg.id);
        }
    });
    el.addEventListener("dblclick", (e) => { e.stopPropagation(); if (currentMode === "plan") editSegmentLabel(task, seg.id); });
    el.addEventListener("contextmenu", (e) => { e.preventDefault(); if (currentMode === "plan") deleteSegment(task, seg.id); });
}

function editSegmentLabel(task, segId) {
    const seg = task.segments.find(s => s.id === segId);
    const nl = window.prompt("ラベル:", seg.label || "");
    if (nl === null) return;
    seg.label = nl.trim();
    renderAllSegments(); triggerSave();
}

function deleteSegment(task, segId) {
    if (!confirm("削除しますか？")) return;
    task.segments = task.segments.filter(s => s.id !== segId);
    selectedSegments = selectedSegments.filter(s => !(s.taskId === task.id && s.segId === segId));
    renderAllSegments(); triggerSave();
}

function handleSegClick(task, seg, addMode) {
    if (!seg.id || currentMode !== "plan") return;
    if (!addMode) selectedSegments = [{ taskId: task.id, segId: seg.id }];
    else {
        const idx = selectedSegments.findIndex(s => s.taskId === task.id && s.segId === seg.id);
        if (idx >= 0) selectedSegments.splice(idx, 1);
        else selectedSegments.push({ taskId: task.id, segId: seg.id });
    }
    activeTaskId = task.id;
    taskObjects.forEach(t => { t.pendingStartDate = null; t.pendingStartIndex = null; });
    updateActiveRowHighlight(); renderAllSegments();
}

function handleCellClick(task, dayIndex) {
    const day = timelineDays[dayIndex];
    if (!day) return;
    const dateStr = day.iso;

    // 1. Progress Mode
    if (currentMode === "progress") {
        if (!activeProgressSegmentId) {
            alert("進捗をマークする前に、目的の線（セグメント）を先にクリックして選択してください。");
            return;
        }
        const result = findSegmentById(activeProgressSegmentId);
        if (!result) return;
        const targetSeg = result.seg;

        if (!(dateStr >= targetSeg.startDate && dateStr <= targetSeg.endDate)) {
            alert("選択された日付は、このセグメントの期間外です。");
            return;
        }

        if (targetSeg.type === "point") {
            targetSeg.progressEndDate = targetSeg.progressEndDate ? null : targetSeg.startDate;
        } else {
            if (targetSeg.progressEndDate === dateStr) {
                const prev = shiftDateStr(dateStr, -1);
                targetSeg.progressEndDate = prev < targetSeg.startDate ? null : prev;
            } else {
                targetSeg.progressEndDate = dateStr;
            }
        }
        renderAllSegments();
        triggerSave();
        return;
    }

    // 2. Plan Mode
    if (activeTaskId !== task.id) {
        activeTaskId = task.id;
        taskObjects.forEach(t => { t.pendingStartDate = null; t.pendingStartIndex = null; });
        updateActiveRowHighlight();
    }

    // 最初のクリック（始点登録）
    if (task.pendingStartDate == null) {
        task.pendingStartDate = dateStr; task.pendingStartIndex = dayIndex;
        renderAllSegments(); return;
    }

    // 2回目のクリック（終点登録・作成）
    let sStr = task.pendingStartDate, eStr = dateStr;
    if (sStr > eStr) [sStr, eStr] = [eStr, sStr];

    // 【修正】ここから重複チェック (1日あたり最大3つまで = 重複が3つ未満ならOK)
    const pendingStartIdx = dateToIndex(sStr);
    const pendingEndIdx = dateToIndex(eStr);

    // 指定区間の全ての日付について、既存のセグメントがいくつ重なっているか確認
    for (let i = pendingStartIdx; i <= pendingEndIdx; i++) {
        const checkIso = timelineDays[i].iso;
        let count = 0;
        task.segments.forEach(seg => {
            // 対象日がそのセグメントの期間内ならカウント
            // (ポイントは s=e なので期間チェックでOK)
            if (checkIso >= seg.startDate && checkIso <= seg.endDate) {
                count++;
            }
        });

        // すでに3つ重なっている日があるなら、これ以上追加できない
        if (count >= 3) {
            alert("1日あたりの重複は最大3つまでです。");
            // キャンセル扱いにする
            task.pendingStartDate = null;
            task.pendingStartIndex = null;
            renderAllSegments();
            return;
        }
    }

    const label = prompt("区間ラベル（任意）", "") || "";
    const type = sStr === eStr ? "point" : "range";
    const segId = "seg_" + Math.random().toString(36).slice(2);
    task.segments.push({ id: segId, startDate: sStr, endDate: eStr, type, label, progressEndDate: null, dailyValues: {} });
    task.pendingStartDate = null; task.pendingStartIndex = null;
    selectedSegments = [{ taskId: task.id, segId }];
    renderAllSegments(); triggerSave();
}

function setupRowInteraction(task) {
    task.rowEl.addEventListener("click", (e) => {
        if (e.target.closest(".segment") || e.target.closest(".point") || e.target.closest(".segment-label") || e.target.closest(".daily-val")) return;

        const rect = task.rowEl.getBoundingClientRect();
        const idx = Math.max(0, Math.min(timelineDays.length - 1, Math.floor((e.clientX - rect.left) / CELL_WIDTH)));
        handleCellClick(task, idx);
    });
    task.leftRowEl.addEventListener("click", () => {
        activeTaskId = task.id;
        taskObjects.forEach(t => { t.pendingStartDate = null; t.pendingStartIndex = null; });
        updateActiveRowHighlight();
    });
}

document.getElementById("downloadBtn").addEventListener("click", () => {
    syncDataModel();
    const rawProjectName = appData.projectName.replace(/[^\w\u3040-\u30ff\u30a0-\u30ff\u30fc\u4e00-\u9faf\uff10-\uff19]+/g, '_');
    const sanitizedName = rawProjectName.replace(/_+/g, '_').replace(/^_|_$/g, '');
    const timestamp = formatTimestamp(new Date());

    const blob = new Blob([JSON.stringify(appData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${sanitizedName}_${timestamp}.json`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
});

const fileInput = document.getElementById("fileInput");
document.getElementById("uploadBtn").addEventListener("click", () => { fileInput.click(); });
fileInput.addEventListener("change", (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
        try {
            const data = JSON.parse(evt.target.result);
            if (confirm("データを上書きして読み込みますか？")) {
                restoreFromData(data); triggerSave(); alert("読み込み完了");
            }
        } catch (err) { alert("読み込み失敗"); }
        fileInput.value = "";
    };
    reader.readAsText(file);
});


function setupControlEvents() {
    window.addEventListener('beforeunload', (e) => {
        e.preventDefault();
        e.returnValue = '';
    });

    document.getElementById("settingsButton").addEventListener("click", () => {
        document.getElementById("settingsStartDate").value = appData.settings.startDate;
        document.getElementById("settingsEndDate").value = appData.settings.endDate;
        document.getElementById("settingsHolidays").value = appData.settings.holidays.join(", ");
        settingsPanel.classList.remove("settings-hidden");
    });

    document.getElementById("settingsCancel").addEventListener("click", () => settingsPanel.classList.add("settings-hidden"));

    document.getElementById("settingsSave").addEventListener("click", () => {
        if (!confirm("期間を変更しますか？")) return;
        appData.settings.startDate = document.getElementById("settingsStartDate").value;
        appData.settings.endDate = document.getElementById("settingsEndDate").value;
        const hText = document.getElementById("settingsHolidays").value.trim();
        appData.settings.holidays = hText ? hText.split(",").map(s => s.trim()).filter(s => s) : [];
        settingsPanel.classList.add("settings-hidden");
        restoreFromData(appData); triggerSave();
    });

    document.getElementById("clearAllBtn").addEventListener("click", () => {
        if (confirm("現在の計画を破棄し、新しい空の計画を開始しますか？")) {
            const blankData = createBlankAppData();
            restoreFromData(blankData);
            activeTaskId = null;
            selectedSegments = [];
            activeProgressSegmentId = null;
            triggerSave();
        }
    });

    document.getElementById("segMinus1d").addEventListener("click", () => modifySelected(s => { if (!s.progressEndDate) { s.startDate = shiftDateStr(s.startDate, -1); s.endDate = shiftDateStr(s.endDate, -1); } }));
    document.getElementById("segPlus1d").addEventListener("click", () => modifySelected(s => { if (!s.progressEndDate) { s.startDate = shiftDateStr(s.startDate, 1); s.endDate = shiftDateStr(s.endDate, 1); } }));
    document.getElementById("segMinus1w").addEventListener("click", () => modifySelected(s => { if (!s.progressEndDate) { s.startDate = shiftDateStr(s.startDate, -7); s.endDate = shiftDateStr(s.endDate, -7); } }));
    document.getElementById("segPlus1w").addEventListener("click", () => modifySelected(s => { if (!s.progressEndDate) { s.startDate = shiftDateStr(s.startDate, 7); s.endDate = shiftDateStr(s.endDate, 7); } }));
    document.getElementById("segStartMinus1d").addEventListener("click", () => modifySelected(s => { if (s.type === 'range' && !s.progressEndDate) s.startDate = shiftDateStr(s.startDate, -1); }));
    document.getElementById("segStartPlus1d").addEventListener("click", () => modifySelected(s => { if (s.type === 'range' && !s.progressEndDate) s.startDate = shiftDateStr(s.startDate, 1); }));
    document.getElementById("segEndMinus1d").addEventListener("click", () => modifySelected(s => { if (s.type === 'range') { const next = shiftDateStr(s.endDate, -1); if (!s.progressEndDate || next >= s.progressEndDate) s.endDate = next; } }));
    document.getElementById("segEndPlus1d").addEventListener("click", () => modifySelected(s => { if (s.type === 'range') s.endDate = shiftDateStr(s.endDate, 1); }));

    document.getElementById("rowMinus1d").addEventListener("click", () => {
        if (!activeTaskId) return;
        const t = taskObjects.find(t => t.id === activeTaskId);
        t.segments.forEach(s => { if (!s.progressEndDate) { s.startDate = shiftDateStr(s.startDate, -1); s.endDate = shiftDateStr(s.endDate, -1); } });
        renderAllSegments(); triggerSave();
    });
    document.getElementById("rowPlus1d").addEventListener("click", () => {
        if (!activeTaskId) return;
        const t = taskObjects.find(t => t.id === activeTaskId);
        t.segments.forEach(s => { if (!s.progressEndDate) { s.startDate = shiftDateStr(s.startDate, 1); s.endDate = shiftDateStr(s.endDate, 1); } });
        renderAllSegments(); triggerSave();
    });

    document.getElementById("modePlan").addEventListener("click", () => { currentMode = "plan"; document.getElementById("modePlan").classList.add("mode-active"); document.getElementById("modeProgress").classList.remove("mode-active"); taskObjects.forEach(t => t.segLayerEl.classList.remove("no-pointer")); activeProgressSegmentId = null; renderAllSegments(); });
    document.getElementById("modeProgress").addEventListener("click", () => { currentMode = "progress"; document.getElementById("modeProgress").classList.add("mode-active"); document.getElementById("modePlan").classList.remove("mode-active"); taskObjects.forEach(t => { t.segLayerEl.classList.add("no-pointer"); t.pendingStartDate = null; }); activeProgressSegmentId = null; renderAllSegments(); });
    document.getElementById("addRowBtn").addEventListener("click", () => addTaskRow());
}

function createBlankAppData() {
    return {
        projectName: "新しい計画",
        settings: appData.settings,
        tasks: [],
        memo: ""
    };
}

function modifySelected(modifierFunc) {
    if (currentMode !== "plan" || !selectedSegments.length) return;
    selectedSegments.forEach(sel => {
        const task = taskObjects.find(t => t.id === sel.taskId);
        if (task) {
            const seg = task.segments.find(s => s.id === sel.segId);
            if (seg) {
                if (seg.progressEndDate && seg.progressEndDate >= seg.endDate) return;
                modifierFunc(seg);
            }
        }
    });
    renderAllSegments(); triggerSave();
}


window.addEventListener("resize", renderAllSegments);
initializeApp();