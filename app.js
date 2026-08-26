import { initializeApp } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-app.js";
import { 
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged,
  updatePassword, createUserWithEmailAndPassword, sendPasswordResetEmail,
  setPersistence, browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/10.9.0/firebase-auth.js";
import { 
  getFirestore, doc, getDoc, setDoc, deleteDoc, collection, addDoc, updateDoc, 
  query, where, onSnapshot, serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.9.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBToAzkMoWVnWYIZnhdplJ50P6G9n6ZUtE",
  authDomain: "design-tracker-96d1e.firebaseapp.com",
  projectId: "design-tracker-96d1e",
  storageBucket: "design-tracker-96d1e.firebasestorage.app",
  messagingSenderId: "277352763092",
  appId: "1:277352763092:web:f4ebc36c496b81f498f541",
  measurementId: "G-WLKSM8JS99"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
setPersistence(auth, browserLocalPersistence).catch(console.error);
const db = getFirestore(app);

const roleNames = { admin: "系統管理員", top_manager: "高級主管", manager: "主管", assistant_manager: "副主管", staff: "人員" };
const departmentList = ["總經理室", "企劃部", "業務部", "設計部", "品檢部", "採購部", "廠部"];

// ==========================================
// 全域狀態變數
// ==========================================
let currentUserData = { role: "staff", name: "", dept: "設計部", canEdit: false };
let allUsersList = [];
let projectTemplates = {
  1: { name: "標準開發流程 1", tasks: [{ name: "需求訪談與規格確認", days: 2 }, { name: "設計打樣與確認", days: 3 }, { name: "量產製作", days: 5 }, { name: "品質檢驗", days: 2 }, { name: "交付驗收", days: 1 }] },
  2: { name: "快速專案模板 2", tasks: [{ name: "專案啟動與分工", days: 1 }, { name: "設計製作", days: 2 }, { name: "審核確認", days: 1 }] },
  3: { name: "自訂模板 3", tasks: [{ name: "前期規劃", days: 1 }, { name: "中期執行", days: 3 }, { name: "後期結案", days: 1 }] },
  4: { name: "自訂模板 4", tasks: [] },
  5: { name: "自訂模板 5", tasks: [] }
}; 

let viewingUserId = null; 
let allProjectsData = [];
let allAdHocData = [];
let allWeeklyData = [];
let myCalendarTodos = [];
let firebaseUnsubscribers = []; 

let currentFilter = 'ongoing'; 
let selectedProjectId = 'SUMMARY'; 
let ganttInstance = null;
let summaryGanttInstance = null;
let currentWeeklyReportId = null;
let isEditMode = false;
let renderTimer = null;
let currentEditData = {};

let calCurrentYear = new Date().getFullYear();
let calCurrentMonth = new Date().getMonth();
let activeCalDateStr = null;
let showCompletedTodos = true;

const taiwanHolidayMap = {
  '01-01': '元旦', '01-02': '彈性放假', '02-15': '小年夜', '02-16': '除夕',
  '02-17': '春節初一', '02-18': '初二', '02-19': '初三', '02-20': '補假',
  '02-27': '228連假', '02-28': '和平紀念日', '04-03': '清明補假', '04-04': '兒童節',
  '04-05': '清明節', '04-06': '補假', '05-01': '勞動節', '06-19': '端午節',
  '09-25': '中秋節', '09-28': '教師節', '10-09': '國慶補假', '10-10': '國慶日',
  '10-25': '光復節', '10-26': '補假', '12-25': '行憲紀念日'
};

// ==========================================
// 基礎核心工具函式
// ==========================================
function getTodayStr() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function getUserDept(uid) {
    if (!uid) return "設計部";
    if (uid === auth.currentUser?.uid) return currentUserData.dept || "設計部";
    const u = allUsersList.find(x => x.uid === uid);
    return u ? (u.dept || "設計部") : "設計部";
}

function getWorkingDays(startDate, endDate) {
  let count = 0; 
  let curDate = new Date(startDate); 
  let end = new Date(endDate);
  curDate.setHours(0,0,0,0); 
  end.setHours(0,0,0,0);
  while (curDate <= end) {
    if (curDate.getDay() !== 0 && curDate.getDay() !== 6) count++;
    curDate.setDate(curDate.getDate() + 1);
  }
  return Math.max(1, count);
}

function calculateEndDateByDays(startDateStr, days) {
  if (!startDateStr || isNaN(days) || days < 1) return startDateStr;
  let curDate = new Date(startDateStr);
  let added = 1;
  while (added < days) {
    curDate.setDate(curDate.getDate() + 1);
    if (curDate.getDay() !== 0 && curDate.getDay() !== 6) {
      added++;
    }
  }
  return formatDateSafe(curDate);
}

function getNextWorkingDayStr(dateStr) {
  if (!dateStr) return ''; 
  let d = new Date(dateStr); 
  d.setDate(d.getDate() + 1);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return d.toISOString().split('T')[0];
}

function formatDateSafe(dateObj) { 
  const y = dateObj.getFullYear(); 
  const m = String(dateObj.getMonth() + 1).padStart(2, '0'); 
  const d = String(dateObj.getDate()).padStart(2, '0'); 
  return `${y}-${m}-${d}`; 
}

function spansYear(p, y) {
  if(y === 'all') return true;
  if(!p.tasks || p.tasks.length === 0) {
      const createdDate = p.createdAt && typeof p.createdAt.toDate === 'function' ? p.createdAt.toDate() : new Date();
      return createdDate.getFullYear() === y;
  }
  let min = "9999-12-31", max = "0000-01-01";
  p.tasks.forEach(t => { 
      if (t.start < min) min = t.start; 
      if (t.end > max) max = t.end; 
  });
  const startY = parseInt(min.substring(0,4));
  const endY = parseInt(max.substring(0,4));
  return y >= startY && y <= endY;
}

function getAdHocDateStr(evt) {
  if (evt.startDate) return evt.startDate;
  if (evt.createdAt && evt.createdAt.toDate) return evt.createdAt.toDate().toISOString().split('T')[0];
  return new Date().toISOString().split('T')[0];
}

function isWithin7DaysGracePeriod(proj) {
  if (!proj || !proj.createdAt) return false;
  let createdTime;
  if (typeof proj.createdAt.toMillis === 'function') {
    createdTime = proj.createdAt.toMillis();
  } else if (proj.createdAt.seconds) {
    createdTime = proj.createdAt.seconds * 1000;
  } else {
    createdTime = Date.now(); 
  }
  const diffDays = (Date.now() - createdTime) / (1000 * 60 * 60 * 24);
  return diffDays <= 7;
}

function getGraceDaysLeft(proj) {
  if (!proj || !proj.createdAt) return 0;
  let createdTime;
  if (typeof proj.createdAt.toMillis === 'function') {
    createdTime = proj.createdAt.toMillis();
  } else if (proj.createdAt.seconds) {
    createdTime = proj.createdAt.seconds * 1000;
  } else {
    createdTime = Date.now(); 
  }
  const diffDays = (Date.now() - createdTime) / (1000 * 60 * 60 * 24);
  return Math.max(0, Math.ceil(7 - diffDays));
}

function triggerRenderProjects() {
  if (renderTimer) clearTimeout(renderTimer);
  renderTimer = setTimeout(() => {
      if (auth.currentUser) renderProjects();
  }, 100); 
}

// ==========================================
// 專案與模板功能
// ==========================================
function renderTemplateSelect() {
  const sel = document.getElementById("tpl-select");
  if (!sel) return;
  sel.innerHTML = `<option value="">-- 請選擇模板 --</option>`;
  for (let i = 1; i <= 5; i++) {
     const t = projectTemplates[i] || projectTemplates[String(i)] || { name: `自訂模板 ${i}` };
     sel.innerHTML += `<option value="${i}">${t.name}</option>`;
  }
}

function openTemplateEditModal() {
  const tplId = document.getElementById("tpl-select")?.value;
  if (!tplId) return alert("請先從下拉選單中選擇一個模板！");
  
  injectTemplateModal(); 
  
  const tpl = projectTemplates[tplId] || projectTemplates[String(tplId)] || { name: `自訂模板 ${tplId}`, tasks: [] };
  const editIdElem = document.getElementById("tpl-edit-id");
  const editNameElem = document.getElementById("tpl-edit-name");
  if(editIdElem) editIdElem.value = tplId;
  if(editNameElem) editNameElem.value = tpl.name;
  
  const container = document.getElementById("tpl-task-list-container");
  if(!container) return;
  container.innerHTML = "";
  if (tpl.tasks && tpl.tasks.length > 0) {
     tpl.tasks.forEach(task => addTplTaskRow(task.name, task.days));
  } else {
     addTplTaskRow("", 1);
  }
  document.getElementById("template-edit-modal")?.classList.add("active");
}

function addTplTaskRow(name = "", days = 1) {
  const container = document.getElementById("tpl-task-list-container");
  if(!container) return;
  const div = document.createElement('div');
  div.className = "form-row tpl-task-row";
  div.style.marginBottom = "8px";
  div.innerHTML = `
    <div class="form-group" style="margin:0; flex:3;"><input type="text" class="input-control tpl-task-name" placeholder="細項名稱" value="${name}"></div>
    <div class="form-group" style="margin:0; width:80px; flex-shrink:0;"><input type="number" min="1" class="input-control tpl-task-days" value="${days}" placeholder="天數" title="預設天數"></div>
    <div style="display:flex; gap:4px; margin:0; flex-shrink:0;">
      <button type="button" class="action-btn btn-sort" onclick="moveTplTaskRow(this, -1)">↑</button>
      <button type="button" class="action-btn btn-sort" onclick="moveTplTaskRow(this, 1)">↓</button>
      <button type="button" class="action-btn danger" onclick="this.closest('.tpl-task-row').remove()" style="padding:8px 10px;">X</button>
    </div>
  `;
  container.appendChild(div);
}

function moveTplTaskRow(btn, direction) {
   const row = btn.closest('.tpl-task-row');
   if (!row) return;
   if (direction === -1 && row.previousElementSibling) {
     row.parentNode.insertBefore(row, row.previousElementSibling);
   } else if (direction === 1 && row.nextElementSibling) {
     row.parentNode.insertBefore(row.nextElementSibling, row);
   }
}

function closeTemplateEditModal() {
  document.getElementById("template-edit-modal")?.classList.remove("active");
}

async function saveTemplate() {
  const tplId = document.getElementById("tpl-edit-id")?.value;
  const name = document.getElementById("tpl-edit-name")?.value.trim() || `自訂模板 ${tplId}`;
  const rows = document.querySelectorAll('.tpl-task-row');
  const tasks = [];
  rows.forEach(r => {
     const tName = r.querySelector('.tpl-task-name').value.trim();
     const tDays = parseInt(r.querySelector('.tpl-task-days').value) || 1;
     if (tName) tasks.push({ name: tName, days: tDays });
  });
  
  projectTemplates[tplId] = { name, tasks };
  try {
    await setDoc(doc(db, "settings", "project_templates"), projectTemplates, { merge: true });
  } catch (e) {
    console.log("快取儲存:", e);
  }
  renderTemplateSelect();
  closeTemplateEditModal();
  alert("🎉 模板儲存成功！");
}

function applyTemplate() {
  const tplId = document.getElementById("tpl-select")?.value;
  if (!tplId) return alert("請先選擇要帶入的模板！");
  const tpl = projectTemplates[tplId] || projectTemplates[String(tplId)];
  if (!tpl || !tpl.tasks || tpl.tasks.length === 0) return alert("此模板還是空的，請先點擊編輯模板建立任務！");
  
  const modeRadio = document.querySelector('input[name="tpl_mode"]:checked');
  const mode = modeRadio ? modeRadio.value : 'seq';
  const container = document.getElementById("task-list-container");
  if (!container) return;
  container.innerHTML = ""; 
  
  let currentDate = getTodayStr(); 
  
  tpl.tasks.forEach((t, i) => {
     let startStr = "";
     let endStr = "";
     let days = parseInt(t.days) || 1;

     if (mode === 'seq') {
        startStr = i === 0 ? currentDate : getNextWorkingDayStr(currentDate);
        endStr = calculateEndDateByDays(startStr, days);
        currentDate = endStr; 
     } else {
        days = 1; 
        startStr = "";
        endStr = "";
     }
     appendTaskRowWithData(t.name, startStr, days, endStr);
  });
  cascadeDates();
}

function appendTaskRowWithData(name = "", startStr = "", days = 1, endStr = "") {
  const container = document.getElementById("task-list-container");
  if (!container) return;
  const div = document.createElement('div');
  div.className = "form-row task-row";
  div.style.marginBottom = "8px";
  div.innerHTML = `
    <div class="form-group" style="margin:0; flex:2;"><input type="text" class="input-control task-name" value="${name}" placeholder="細項名稱"></div>
    <div class="form-group" style="margin:0; flex:1.2;"><input type="date" class="input-control task-start" value="${startStr}" onchange="onTaskStartChange(this, null); checkCascade();"></div>
    <div class="form-group" style="margin:0; width:65px; flex-shrink:0;"><input type="number" min="1" class="input-control task-days" value="${days}" placeholder="天數" title="工作天數" oninput="onTaskDaysChange(this, null, null); checkCascade();"></div>
    <div class="form-group" style="margin:0; flex:1.2;"><input type="date" class="input-control task-end" value="${endStr}" min="${startStr}" onchange="onTaskEndChange(this, null, null); checkCascade();"></div>
    <div style="display:flex; gap:4px; margin:0; flex-shrink:0;">
      <button type="button" class="action-btn btn-sort" onclick="moveTaskRow(this, -1); checkCascade();" title="上移">↑</button>
      <button type="button" class="action-btn btn-sort" onclick="moveTaskRow(this, 1); checkCascade();" title="下移">↓</button>
      <button type="button" class="action-btn danger" onclick="this.closest('.task-row').remove(); checkCascade();" style="padding:8px 10px;">X</button>
    </div>
  `;
  container.appendChild(div);
}

function cascadeDates() {
   const modeRadio = document.querySelector('input[name="tpl_mode"]:checked');
   if (!modeRadio || modeRadio.value !== 'seq') return;

   const container = document.getElementById("task-list-container");
   if (!container) return;
   const rows = container.querySelectorAll('.task-row');
   let prevEnd = null;
   rows.forEach((row, i) => {
      const startInput = row.querySelector('.task-start');
      const daysInput = row.querySelector('.task-days');
      const endInput = row.querySelector('.task-end');
      
      if (i === 0) {
         if (startInput.value) {
            endInput.value = calculateEndDateByDays(startInput.value, parseInt(daysInput.value) || 1);
            endInput.min = startInput.value;
            prevEnd = endInput.value;
         }
      } else {
         if (prevEnd) {
            startInput.value = getNextWorkingDayStr(prevEnd);
            endInput.value = calculateEndDateByDays(startInput.value, parseInt(daysInput.value) || 1);
            endInput.min = startInput.value;
            prevEnd = endInput.value;
         }
      }
   });
}

function checkCascade() { cascadeDates(); }

function checkWorkingDay(input) { 
  if (!input.value) return; 
  const d = new Date(input.value); 
  if (d.getDay() === 0 || d.getDay() === 6) { 
    alert("系統規定只能點選工作日喔！"); 
    input.value = ''; 
  } 
}

function onTaskStartChange(startInput, targetEndId) {
  checkWorkingDay(startInput);
  if (!startInput.value) return;
  const row = startInput.closest('.task-row') || startInput.closest('#general-edit-form') || startInput.closest('.modal-box');
  const endInput = typeof targetEndId === 'string' ? document.getElementById(targetEndId) : row?.querySelector('.task-end');
  const daysInput = row?.querySelector('.task-days') || row?.querySelector('#add-task-days') || row?.querySelector('#edit-val-days');

  if (endInput) {
    endInput.min = startInput.value;
    const days = daysInput ? parseInt(daysInput.value) || 1 : 1;
    endInput.value = calculateEndDateByDays(startInput.value, days);
  }
}

function onTaskDaysChange(daysInput, targetStartId, targetEndId) {
  const row = daysInput.closest('.task-row') || daysInput.closest('#general-edit-form') || daysInput.closest('.modal-box');
  const startInput = typeof targetStartId === 'string' ? document.getElementById(targetStartId) : row?.querySelector('.task-start') || row?.querySelector('#add-task-start');
  const endInput = typeof targetEndId === 'string' ? document.getElementById(targetEndId) : row?.querySelector('.task-end') || row?.querySelector('#add-task-end');

  const days = parseInt(daysInput.value) || 1;
  if (startInput && startInput.value && endInput) {
    endInput.value = calculateEndDateByDays(startInput.value, days);
    endInput.min = startInput.value;
  }
}

function onTaskEndChange(endInput, targetStartId, targetDaysId) {
  checkWorkingDay(endInput);
  const row = endInput.closest('.task-row') || endInput.closest('#general-edit-form') || endInput.closest('.modal-box');
  const startInput = typeof targetStartId === 'string' ? document.getElementById(targetStartId) : row?.querySelector('.task-start') || row?.querySelector('#add-task-start');
  const daysInput = typeof targetDaysId === 'string' ? document.getElementById(targetDaysId) : row?.querySelector('.task-days') || row?.querySelector('#add-task-days');

  if (startInput && startInput.value && endInput.value) {
    if (endInput.value < startInput.value) {
      alert("預計結束日不可早於開始日！");
      endInput.value = startInput.value;
    }
    const days = getWorkingDays(startInput.value, endInput.value);
    if (daysInput) daysInput.value = days;
  }
}

function addTaskRow() {
  const container = document.getElementById("task-list-container"); 
  if (!container) return;
  const rows = container.querySelectorAll('.task-row');
  let defaultStart = rows.length > 0 ? getNextWorkingDayStr(rows[rows.length - 1].querySelector('.task-end').value) : "";
  let defaultEnd = defaultStart ? defaultStart : "";
  appendTaskRowWithData("", defaultStart, 1, defaultEnd);
  cascadeDates();
}

function moveTaskRow(btn, direction) {
  const row = btn.closest('.task-row');
  if (!row) return;
  if (direction === -1 && row.previousElementSibling) {
    row.parentNode.insertBefore(row, row.previousElementSibling);
  } else if (direction === 1 && row.nextElementSibling) {
    row.parentNode.insertBefore(row.nextElementSibling, row);
  }
}

// ==========================================
// 🚀 UI 結構注入
// ==========================================
function initDynamicUI() {
  if (document.getElementById('filter-all')) return; 

  const kpiRow = document.querySelector('.kpi-row');
  if (kpiRow) {
    kpiRow.innerHTML = `
      <div class="kpi-card active" id="filter-ongoing" onclick="setProjectFilter('ongoing')"><div class="kpi-title">未完成</div><div class="kpi-number" id="stat-ongoing">0</div></div>
      <div class="kpi-card" id="filter-completed" onclick="setProjectFilter('completed')"><div class="kpi-title">完成</div><div class="kpi-number" id="stat-completed" style="color: var(--success);">0</div></div>
      <div class="kpi-card" id="filter-delayed" onclick="setProjectFilter('delayed')"><div class="kpi-title">Delay</div><div class="kpi-number" id="stat-delay" style="color: var(--danger);">0</div></div>
      <div class="kpi-card" id="filter-collab" onclick="setProjectFilter('collab')"><div class="kpi-title">協作專案</div><div class="kpi-number" id="stat-collab" style="color: var(--primary);">0</div></div>
      <div class="kpi-card" id="filter-all" onclick="setProjectFilter('all')"><div class="kpi-title">專案總覽</div><div class="kpi-number" id="stat-all" style="color: var(--warning);">0</div></div>
    `;
  }
  
  const style = document.createElement('style');
  style.innerHTML = `
    .kpi-card { padding: 8px 12px !important; min-height: unset !important; cursor: pointer; }
    .kpi-title { font-size: 11.5px !important; margin-bottom: 2px !important; }
    .kpi-number { font-size: 18px !important; }
    .col-sum-name.clickable { cursor: pointer; text-decoration: none; transition: 0.2s; }
    .col-sum-name.clickable:hover { opacity: 0.7; }
    .gantt-left-panel { flex: 0 0 55% !important; max-width: 55% !important; }
    .gantt-right-panel { flex: 0 0 45% !important; max-width: 45% !important; }
    .col-sum-name, .col-name { flex: 4 !important; } 
    .col-sum-date, .col-date { flex: 1.2 !important; }
    .col-sum-prog, .col-prog { flex: 0.8 !important; }
    .col-owner { flex: 1.2 !important; }
    .col-act { flex: 0.8 !important; }
    .mobile-fixed-dropdown {
        position: fixed !important; top: 60px !important; left: 0 !important; width: 100vw !important;
        height: calc(100vh - 60px) !important; background: #f1f5f9 !important; z-index: 999999 !important;
        display: flex !important; flex-direction: column; overflow-y: auto !important; padding: 20px !important;
        box-shadow: 0 10px 25px rgba(0,0,0,0.2);
    }
    @media (max-width: 768px) {
      .kpi-row { grid-template-columns: repeat(5, 1fr) !important; gap: 4px !important; }
      .kpi-title { font-size: 10px !important; }
      .kpi-card { padding: 6px 4px !important; }
      .gantt-left-panel { flex: 0 0 100% !important; max-width: 100% !important; }
      .gantt-right-panel { display: none !important; }
    }
  `;
  document.head.appendChild(style);

  const btnWrapper = document.getElementById('btn-create-wrapper');
  if (btnWrapper && !document.getElementById('project-year-filter')) {
    const currentY = new Date().getFullYear();
    let options = '';
    for (let y = currentY - 3; y <= currentY + 3; y++) {
        options += `<option value="${y}" ${y === currentY ? 'selected' : ''}>${y}年</option>`;
    }
    options += `<option value="all">所有年份</option>`;
    const sel = document.createElement('select');
    sel.id = "project-year-filter";
    sel.className = "input-control";
    sel.style.width = "100px";
    sel.style.marginRight = "10px";
    sel.style.fontWeight = "bold";
    sel.innerHTML = options;
    sel.onchange = () => {
      if (currentFilter === 'ongoing' || currentFilter === 'delayed') setProjectFilter('all');
      else triggerRenderProjects();
    };
    btnWrapper.insertBefore(sel, btnWrapper.firstChild);
  }
}

function injectTemplateModal() {
   if (document.getElementById('template-edit-modal')) return;
   const html = `
   <div class="modal" id="template-edit-modal" style="z-index:9999999;">
     <div class="modal-box" style="max-width: 600px;">
       <div class="modal-header">
         <h3>✏️ 編輯專案模板</h3>
         <button class="btn-close" onclick="closeTemplateEditModal()">×</button>
       </div>
       <div class="modal-body">
         <input type="hidden" id="tpl-edit-id">
         <div class="form-group">
           <label class="form-label">自訂模板名稱</label>
           <input type="text" id="tpl-edit-name" class="input-control" placeholder="例如：標準開發流程">
         </div>
         <div class="form-group" style="margin-bottom:0;">
           <label class="form-label" style="display:flex; justify-content:space-between; align-items:center;">
              <span>預設任務細項設定</span>
              <button type="button" class="action-btn" onclick="addTplTaskRow('', 1)">➕ 新增一列</button>
           </label>
           <div id="tpl-task-list-container" style="max-height:350px; overflow-y:auto; border:1px solid #e2e8f0; padding:12px; border-radius:8px; background:#f8fafc;"></div>
         </div>
       </div>
       <div class="modal-footer" style="text-align:right;">
         <button class="action-btn" onclick="closeTemplateEditModal()">取消</button>
         <button class="action-btn" style="background:var(--primary); color:#fff; border:none;" onclick="saveTemplate()">💾 儲存模板</button>
       </div>
     </div>
   </div>
   `;
   if (document.body) document.body.insertAdjacentHTML('beforeend', html);
}

// ==========================================
// 🚀 Firebase 驗證與資料流通道
// ==========================================
onAuthStateChanged(auth, async (user) => {
  if (user) {
    document.getElementById("auth-section").style.display = "none";
    const appSec = document.getElementById("app-section");
    if(appSec) appSec.style.display = "flex";
    
    viewingUserId = user.uid;

    try {
      const userDoc = await getDoc(doc(db, "users", user.uid));
      if (userDoc.exists()) {
        currentUserData = userDoc.data();
        if (!currentUserData.email && user.email) {
            currentUserData.email = user.email;
            await updateDoc(doc(db, "users", user.uid), { email: user.email });
        }
      } else {
        currentUserData = { name: user.email ? user.email.split('@')[0] : "User", email: user.email || "", dept: "設計部", role: "admin", canEdit: false };
        await setDoc(doc(db, "users", user.uid), currentUserData, { merge: true });
      }
    } catch (e) { 
      currentUserData = { name: user.email ? user.email.split('@')[0] : "User", email: user.email || "", dept: "設計部", role: "admin", canEdit: false }; 
    }
    
    const displayName = currentUserData.name || (currentUserData.email ? currentUserData.email.split('@')[0] : "User");
    const nameEl = document.getElementById("user-display-name");
    if (nameEl) nameEl.innerText = displayName;
    
    const avaEl = document.getElementById("user-avatar");
    if (avaEl) avaEl.innerText = displayName.charAt(0).toUpperCase();
    
    const roleEl = document.getElementById("user-role-badge");
    if (roleEl) roleEl.innerText = roleNames[currentUserData.role] || (currentUserData.role || "STAFF").toUpperCase();

    const navOrg = document.getElementById("nav-org-manage");
    const navDiv = document.getElementById("nav-divider-org");
    if (currentUserData.role === "admin") {
      if(navOrg) navOrg.style.display = "flex"; 
      if(navDiv) navDiv.style.display = "block"; 
    } else {
      if(navOrg) navOrg.style.display = "none"; 
      if(navDiv) navDiv.style.display = "none"; 
    }

    const navSub = document.getElementById('nav-sub-wrapper');
    if (currentUserData.role !== 'staff') { 
      if(navSub) navSub.style.display = 'block'; 
    } else {
      if(navSub) navSub.style.display = 'none';
    }

    initDynamicUI();
    injectTemplateModal();
    if(window.initWeeklyDateAndLeave) window.initWeeklyDateAndLeave(); 
    if(window.addWeeklyRow) window.addWeeklyRow(); 
    
    setupDataListeners(user.uid);

  } else {
    const authSec = document.getElementById("auth-section");
    if(authSec) authSec.style.display = "flex"; 
    const appSec = document.getElementById("app-section");
    if(appSec) appSec.style.display = "none";
    
    if (renderTimer) clearTimeout(renderTimer);
    firebaseUnsubscribers.forEach(unsub => unsub());
    firebaseUnsubscribers = [];
  }
});

function setupDataListeners(uid) {
  firebaseUnsubscribers.forEach(unsub => unsub());
  firebaseUnsubscribers = [];

  firebaseUnsubscribers.push(onSnapshot(collection(db, "users"), (snapshot) => {
    allUsersList = [];
    snapshot.forEach(docSnap => allUsersList.push({ uid: docSnap.id, ...docSnap.data() }));
    if (currentUserData.role !== 'staff' && renderSidebarSubordinates) renderSidebarSubordinates();
    if (currentUserData.role === 'admin' && renderOrgUsersTable) renderOrgUsersTable();
    triggerRenderProjects();
  }));

  firebaseUnsubscribers.push(onSnapshot(doc(db, "settings", "project_templates"), (docSnap) => {
    if (docSnap.exists() && Object.keys(docSnap.data()).length > 0) {
      projectTemplates = { ...projectTemplates, ...docSnap.data() };
    }
    renderTemplateSelect();
  }));

  firebaseUnsubscribers.push(onSnapshot(query(collection(db, "projects")), (snapshot) => {
    allProjectsData = []; 
    snapshot.forEach(docSnap => allProjectsData.push({ id: docSnap.id, ...docSnap.data() })); 
    triggerRenderProjects(); 
    if(window.refreshAllWeeklyProjSelects) window.refreshAllWeeklyProjSelects();
  }));

  firebaseUnsubscribers.push(onSnapshot(query(collection(db, "ad_hoc_events")), (snapshot) => {
    allAdHocData = []; 
    snapshot.forEach(docSnap => allAdHocData.push({ id: docSnap.id, ...docSnap.data() })); 
    renderAdHocEvents(); 
    triggerRenderProjects();
  }));

  firebaseUnsubscribers.push(onSnapshot(query(collection(db, "weekly_reports")), (snapshot) => {
    allWeeklyData = []; 
    snapshot.forEach(docSnap => allWeeklyData.push({ id: docSnap.id, ...docSnap.data() })); 
    renderWeeklyReports(); 
    if(window.refreshAllWeeklyProjSelects) window.refreshAllWeeklyProjSelects();
  }));
}

// ==========================================
// 🚀 專案與甘特圖渲染核心
// ==========================================
function renderProjects() {
  if (!auth.currentUser) return;
  checkEditModeVisibility();

  const isViewingSelf = (viewingUserId === auth.currentUser.uid);
  const myDept = currentUserData.dept || "設計部";
  const targetUser = allUsersList.find(u => u.uid === viewingUserId);
  const targetDept = isViewingSelf ? myDept : (targetUser?.dept || "設計部");
  
  const yearFilterVal = document.getElementById('project-year-filter')?.value || new Date().getFullYear().toString();
  const selectedYear = yearFilterVal === 'all' ? 'all' : parseInt(yearFilterVal);
  const todayStr = getTodayStr();

  const userProjects = allProjectsData.filter(p => p.ownerId === viewingUserId);
  const userAdHocs = allAdHocData.filter(e => e.ownerId === viewingUserId);

  const collabProjects = allProjectsData.filter(p => {
    const collabs = p.collaborators || [];
    if (collabs.length === 0) return false;
    return collabs.includes(targetDept) || p.ownerId === viewingUserId;
  });

  const allInvolvedProjectsMap = new Map();
  userProjects.forEach(p => allInvolvedProjectsMap.set(p.id, p));
  collabProjects.forEach(p => allInvolvedProjectsMap.set(p.id, p));
  const allInvolvedProjects = Array.from(allInvolvedProjectsMap.values());

  let countOngoing = 0, countCompleted = 0, countDelayed = 0, countAllInYear = 0;
  let projectsOngoing = [], projectsCompleted = [], projectsDelayed = [], projectsAll = [];

  allInvolvedProjects.forEach(p => {
    let relevantTasks = [];
    const ownerDept = getUserDept(p.ownerId);
    const isOwnerDept = (targetDept === ownerDept); 

    if (isOwnerDept) {
      relevantTasks = p.tasks || [];
    } else {
      relevantTasks = (p.tasks || []).filter(t => t.assigneeId === viewingUserId);
    }

    let isAllDone = false;
    let hasDelay = false;

    if (relevantTasks.length > 0) {
      isAllDone = relevantTasks.every(t => t.isCompleted);
      hasDelay = relevantTasks.some(t => !t.isCompleted && todayStr > t.end);
    }

    const inYear = spansYear(p, selectedYear);

    if (isOwnerDept) {
       if (relevantTasks.length === 0 || !isAllDone) { countOngoing++; projectsOngoing.push(p); }
       if (hasDelay) { countDelayed++; projectsDelayed.push(p); }
    } else {
       if (relevantTasks.length > 0 && !isAllDone) { countOngoing++; projectsOngoing.push(p); }
       if (relevantTasks.length > 0 && hasDelay) { countDelayed++; projectsDelayed.push(p); }
    }

    if (isAllDone && inYear && relevantTasks.length > 0) {
       countCompleted++;
       projectsCompleted.push(p);
    }
    if (inYear) {
       countAllInYear++;
       projectsAll.push(p);
    }
  });

  let adHocsOngoing = userAdHocs.filter(e => !e.isCompleted);
  let adHocsDelayed = userAdHocs.filter(e => !e.isCompleted && e.startDate < todayStr);
  let adHocsCompleted = userAdHocs.filter(e => e.isCompleted && (selectedYear === 'all' || parseInt(getAdHocDateStr(e).substring(0,4)) === selectedYear));
  let adHocsAll = userAdHocs.filter(e => selectedYear === 'all' || parseInt(getAdHocDateStr(e).substring(0,4)) === selectedYear);

  countOngoing += adHocsOngoing.length;
  countCompleted += adHocsCompleted.length;
  countDelayed += adHocsDelayed.length;
  countAllInYear += adHocsAll.length;

  const elOngoing = document.getElementById('stat-ongoing');
  if(elOngoing) elOngoing.innerText = countOngoing; 
  const elCompleted = document.getElementById('stat-completed');
  if(elCompleted) elCompleted.innerText = countCompleted; 
  const elDelay = document.getElementById('stat-delay');
  if(elDelay) elDelay.innerText = countDelayed;
  const elCollab = document.getElementById('stat-collab');
  if(elCollab) elCollab.innerText = collabProjects.length;
  const elAll = document.getElementById('stat-all');
  if(elAll) elAll.innerText = countAllInYear;

  let activeList = [];
  let activeAdHocs = [];

  if (currentFilter === 'ongoing') {
      activeList = projectsOngoing;
      activeAdHocs = adHocsOngoing;
  } else if (currentFilter === 'completed') {
      activeList = projectsCompleted;
      activeAdHocs = adHocsCompleted;
  } else if (currentFilter === 'delayed') {
      activeList = projectsDelayed;
      activeAdHocs = adHocsDelayed;
  } else if (currentFilter === 'collab') {
      activeList = collabProjects; 
      activeAdHocs = [];
  } else if (currentFilter === 'all') {
      activeList = projectsAll;
      activeAdHocs = adHocsAll;
  }
  activeList = Array.from(new Set(activeList)); 

  if (selectedProjectId !== 'SUMMARY') {
    if (!activeList.find(p => p.id === selectedProjectId)) selectedProjectId = 'SUMMARY';
  }

  const tabsContainer = document.getElementById("project-tabs-container");
  const detailView = document.getElementById("project-detail-view");
  const summaryView = document.getElementById("project-summary-view");
  const emptyState = document.getElementById("empty-state");
  if(tabsContainer) tabsContainer.innerHTML = "";

  if (activeList.length === 0 && activeAdHocs.length === 0) { 
    if(detailView) detailView.style.display = "none"; 
    if(summaryView) summaryView.style.display = "none"; 
    if(emptyState) emptyState.style.display = "block"; 
    lastSummaryGanttState = "";
    lastDetailGanttState = "";
    return; 
  }

  if (selectedProjectId !== 'SUMMARY' && tabsContainer) {
    const summaryBtn = document.createElement("button");
    summaryBtn.className = `proj-tab`;
    summaryBtn.style.border = "2px solid #8b5cf6"; 
    summaryBtn.style.color = "#8b5cf6";            
    summaryBtn.style.fontWeight = "bold";          
    summaryBtn.innerText = "🔙 返回總覽"; 
    summaryBtn.onclick = () => selectProject('SUMMARY'); 
    tabsContainer.appendChild(summaryBtn);
  }

  if (tabsContainer) {
    activeList.forEach(p => {
      const hasCollab = (p.collaborators && p.collaborators.length > 0);
      const btn = document.createElement("button"); 
      btn.className = `proj-tab ${hasCollab ? 'is-collab' : ''} ${p.id === selectedProjectId ? 'active' : ''}`;
      btn.title = p.title;
      if (hasCollab) btn.innerHTML = `<span>👥 ${p.title}</span>`;
      else btn.innerText = p.title;
      btn.onclick = () => selectProject(p.id); 
      tabsContainer.appendChild(btn);
    });
  }

  if (emptyState) emptyState.style.display = "none"; 

  // ==========================================
  // ⭐ 顯示總覽畫面
  // ==========================================
  if (selectedProjectId === 'SUMMARY') {
    if(detailView) detailView.style.display = "none"; 
    if(summaryView) summaryView.style.display = "block";
    
    let summaryLabel = "所有專案";
    if (currentFilter === 'ongoing') summaryLabel = "未完成";
    else if (currentFilter === 'completed') summaryLabel = "已完成";
    else if (currentFilter === 'delayed') summaryLabel = "Delay";
    else if (currentFilter === 'collab') summaryLabel = "協作專案";
    
    const panelHeadSpan = document.querySelector('#project-summary-view .panel-head span');
    if (panelHeadSpan) panelHeadSpan.innerText = `⭐ 專案與事件總覽排程 (${summaryLabel}清單)`;

    const sumLeftBody = document.getElementById("gantt-summary-left-body");
    if(sumLeftBody) sumLeftBody.innerHTML = "";
    const ganttTasksSum = [];
    
    let combinedItems = [];
    let sIdx = 0;

    activeList.forEach(p => {
      const ownerDept = getUserDept(p.ownerId);
      const isOwnerDept = (targetDept === ownerDept); 
      let relevantTasks = isOwnerDept ? p.tasks : (p.tasks || []).filter(t => t.assigneeId === viewingUserId);
      let tasksForTimeline = relevantTasks.length > 0 ? relevantTasks : (p.tasks || []); 
      
      let minStart = "9999-12-31"; 
      let maxEnd = "0000-01-01"; 
      if (tasksForTimeline.length === 0) {
          minStart = getTodayStr();
          maxEnd = getTodayStr();
      } else {
          tasksForTimeline.forEach(t => { 
            if (t.start < minStart) minStart = t.start; 
            if (t.end > maxEnd) maxEnd = t.end; 
          });
      }

      let avgProg = 0;
      let isDone = false;
      let hasDelay = false;

      if (relevantTasks.length > 0) {
        let totalProg = 0;
        relevantTasks.forEach(t => totalProg += (t.progress || 0));
        avgProg = Math.round(totalProg / relevantTasks.length);
        isDone = relevantTasks.every(t => t.isCompleted);
        hasDelay = relevantTasks.some(t => !t.isCompleted && todayStr > t.end);
      }
      
      const hasCollab = (p.collaborators && p.collaborators.length > 0);
      
      combinedItems.push({
        type: 'project', 
        sortDate: new Date(minStart).getTime(), 
        idStr: `s_p_${sIdx++}`,
        projId: p.id,
        title: p.title,
        start: minStart, 
        end: maxEnd, 
        progress: avgProg, 
        isDone: isDone, 
        hasDelay: hasDelay, 
        isCollab: hasCollab, 
        custom_class: isDone ? 'bar-success' : (p.color || 'bar-primary')
      });
    });

    activeAdHocs.forEach(evt => {
      let eDate = getAdHocDateStr(evt);
      let prog = evt.isCompleted ? 100 : 0;
      let hasDelay = !evt.isCompleted && eDate < todayStr;
      
      combinedItems.push({
        type: 'adhoc', 
        sortDate: new Date(eDate).getTime(), 
        idStr: `s_e_${sIdx++}`,
        title: evt.title, 
        start: eDate, 
        end: eDate, 
        progress: prog, 
        isDone: evt.isCompleted, 
        hasDelay: hasDelay,
        isCollab: false, 
        custom_class: 'bar-danger'
      });
    });

    combinedItems.sort((a, b) => a.sortDate - b.sortDate);

    combinedItems.forEach(item => {
      ganttTasksSum.push({ id: item.idStr, name: item.title, start: item.start, end: item.end, progress: item.progress, custom_class: item.custom_class });
      const row = document.createElement("div"); 
      row.className = "gantt-row";
      if (item.type === 'project') {
        let statusText = item.isDone ? '<span style="color:var(--success); font-weight:700;">完成</span>' : item.progress+'%';
        if (item.hasDelay && !item.isDone) {
            statusText = '<span style="color:var(--danger); font-weight:700;">Delay</span>';
        }

        let titleDisplay = item.isCollab 
          ? `<span style="color:#2563eb; font-weight:700;"><span style="color:#2563eb; margin-right:4px;">👥</span>${item.title}</span>`
          : `<span style="color:#0f172a; font-weight:700;">🗂️ ${item.title}</span>`;
          
        row.innerHTML = `<div class="col-sum-name clickable" title="點擊前往專案：${item.title}" onclick="selectProject('${item.projId}')">${titleDisplay}</div><div class="col-sum-date">${item.start.substring(5)} ~ ${item.end.substring(5)}</div><div class="col-sum-prog">${statusText}</div>`;
      } else {
        let statusText = item.isDone ? '<span style="color:var(--success); font-weight:700;">完成</span>' : '處理中';
        if (item.hasDelay && !item.isDone) {
            statusText = '<span style="color:var(--danger); font-weight:700;">Delay</span>';
        }
        row.innerHTML = `<div class="col-sum-name" style="color:var(--danger);" title="${item.title}">🚨 ${item.title}</div><div class="col-sum-date">${item.start.substring(5)}</div><div class="col-sum-prog">${statusText}</div>`;
      }
      if(sumLeftBody) sumLeftBody.appendChild(row);
    });

    const chartContainer = document.getElementById("gantt-chart-summary-container");
    if(!chartContainer) return;
    
    if (ganttTasksSum.length > 0) {
      const newSummaryState = JSON.stringify({ filter: currentFilter, tasks: ganttTasksSum });
      if (lastSummaryGanttState !== newSummaryState || !chartContainer.querySelector('svg')) {
          lastSummaryGanttState = newSummaryState;
          chartContainer.innerHTML = '<div id="gantt-chart-summary"></div>';
          setTimeout(() => {
            if (document.getElementById("tab-projects").style.display === "none") return;
            try {
              summaryGanttInstance = new Gantt("#gantt-chart-summary", ganttTasksSum, { 
                view_mode: 'Day', language: 'zh', header_height: 50, bar_height: 20, padding: 18, readonly: true 
              });
              patchGanttVisuals(summaryGanttInstance, '#gantt-chart-summary-container');
              scrollToTodayMinus2Days(summaryGanttInstance, '#gantt-chart-summary-container'); 
            } catch(e) {}
          }, 30); 
      }
    } else { 
      lastSummaryGanttState = "";
      chartContainer.innerHTML = ''; 
    }
    return;
  }

  // ==========================================
  // ⭐ 顯示詳細專案畫面
  // ==========================================
  if(summaryView) summaryView.style.display = "none"; 
  if(detailView) detailView.style.display = "block";
  const activeProj = activeList.find(p => p.id === selectedProjectId);
  if (!activeProj) return; 

  const ownerDept = getUserDept(activeProj.ownerId);
  const isProjOwnerDept = (currentUserData.dept === ownerDept); 
  const isProjOwner = (activeProj.ownerId === auth.currentUser.uid);
  
  const hasCollab = (activeProj.collaborators && activeProj.collaborators.length > 0);
  const isCollabMember = hasCollab && activeProj.collaborators.includes(currentUserData.dept);
  
  const hasGlobalEdit = (currentUserData.role === 'admin' || currentUserData.canEdit === true);
  const isAuthorizedMaster = hasGlobalEdit || isProjOwnerDept; 
  const inGracePeriod = isWithin7DaysGracePeriod(activeProj);
  
  let canEditMainProj = isEditMode && (hasGlobalEdit || (isAuthorizedMaster && inGracePeriod));
  let editProjBtn = canEditMainProj ? `<button class="action-btn" onclick="openGeneralEdit('project', '${activeProj.id}')" style="margin-left:8px; padding:2px 6px; font-size:10px; border-color:var(--warning); color:var(--warning);">✏️ 編輯主資訊</button>` : '';
  
  let collabBadge = hasCollab ? `<span class="pill" style="background:#eff6ff; color:#0f172a; border:1px solid #cbd5e1; margin-left:8px;">👥 協作：<span style="color:#2563eb; font-weight:600;">${activeProj.collaborators.join(', ')}</span></span>` : '';
  
  let graceBadge = inGracePeriod ? `<span class="pill pill-success" style="font-size:11px; margin-left:8px;">🟢 自由編輯期 (剩餘 ${getGraceDaysLeft(activeProj)} 天)</span>` : '';

  let titlePrefixIcon = hasCollab ? '<span style="color:#2563eb; margin-right:4px;">👥</span>' : '';
  let titleDisplayName = `<span style="color:#2563eb; font-weight:700;">${titlePrefixIcon}${activeProj.title}</span>`;
  
  const titleElem = document.getElementById("current-gantt-title");
  if(titleElem) titleElem.innerHTML = `<span style="color:#0f172a; font-weight:700;">專案：</span>${titleDisplayName} ${collabBadge} ${graceBadge} ${editProjBtn}`;
  
  const btnProjectAddTask = document.getElementById("btn-project-add-task");
  const lockBtn = document.getElementById("btn-toggle-lock");
  const delProjBtn = document.getElementById("btn-delete-project");

  if(lockBtn) lockBtn.style.display = "none"; 

  const canAddTask = hasGlobalEdit || isCollabMember || (isAuthorizedMaster && inGracePeriod);

  if (btnProjectAddTask) {
    if (canAddTask) {
      btnProjectAddTask.style.display = "inline-block";
      btnProjectAddTask.innerText = hasCollab ? "➕ 協作細項" : "➕ 新增細項";
    } else {
      btnProjectAddTask.style.display = "none";
    }
  }

  if (delProjBtn) {
    delProjBtn.style.display = (isEditMode && (hasGlobalEdit || (isAuthorizedMaster && inGracePeriod))) ? "inline-block" : "none";
  }

  const leftBody = document.getElementById("gantt-left-body");
  const listBody = document.getElementById("project-list-tbody");
  if(leftBody) leftBody.innerHTML = ""; 
  if(listBody) listBody.innerHTML = "";

  const ganttTasks = [];
  (activeProj.tasks || []).forEach((task, index) => {
    const currentProgress = task.progress || 0;
    const workDays = getWorkingDays(task.start, task.end);
    
    const isCollabTask = task.assigneeId && (task.assigneeId !== activeProj.ownerId);
    let projColorClass = isCollabTask ? 'bar-pink' : (activeProj.color || 'bar-primary');

    ganttTasks.push({ 
      id: `t_${index}`, 
      name: task.name, 
      start: task.start, 
      end: task.end, 
      progress: currentProgress, 
      custom_class: task.isCompleted ? 'bar-success' : projColorClass 
    });

    const taskAssigneeId = task.assigneeId || activeProj.ownerId;
    const taskAssigneeName = task.assigneeName || activeProj.ownerName || '原負責人';
    const isMyTask = (auth.currentUser?.uid === taskAssigneeId);

    let taskCreatedTime = task.createdAt || (activeProj.createdAt && typeof activeProj.createdAt.toMillis === 'function' ? activeProj.createdAt.toMillis() : Date.now());
    let isTaskInGrace = ((Date.now() - taskCreatedTime) / (1000 * 60 * 60 * 24)) <= 7;

    const canOperateThisTask = (hasGlobalEdit || isMyTask || isAuthorizedMaster);
    const isInputLocked = task.isCompleted || !canOperateThisTask; 
    
    let canEditTask = isEditMode && (
      hasGlobalEdit || ((isAuthorizedMaster || isMyTask) && isTaskInGrace)
    );
    
    let editHtml = canEditTask ? `
      <div style="display:inline-flex; align-items:center; gap:2px; margin-left:auto; flex-shrink:0;">
        <button type="button" class="btn-sort" onclick="moveActiveProjectTask('${activeProj.id}', ${index}, -1)" title="上移">↑</button>
        <button type="button" class="btn-sort" onclick="moveActiveProjectTask('${activeProj.id}', ${index}, 1)" title="下移">↓</button>
        <button class="action-btn" onclick="openGeneralEdit('task', '${activeProj.id}', ${index})" style="padding:2px 5px; font-size:10px; border-color:var(--warning); color:var(--warning);" title="編輯細項">✏️</button>
        <button class="action-btn danger" onclick="deleteActiveProjectTask('${activeProj.id}', ${index})" style="padding:2px 5px; font-size:10px;" title="刪除此細項">🗑️</button>
      </div>` : '';

    const row = document.createElement("div"); 
    row.className = "gantt-row";
    row.innerHTML = `
      <div class="col-name" title="${task.name}"><span style="overflow:hidden; text-overflow:ellipsis;">${task.name}</span>${editHtml}</div>
      <div class="col-date">${workDays} 天</div>
      <div class="col-prog"><input type="number" min="0" max="100" value="${currentProgress}" id="prog_input_${index}" ${isInputLocked ? 'disabled' : ''}> %</div>
      <div class="col-act"><button class="action-btn btn-sm" ${isInputLocked ? 'disabled' : ''} onclick="confirmProgress('${activeProj.id}', ${index}, '${task.end}')">${task.isCompleted ? '完成' : '確認'}</button></div>
      <div class="col-owner" title="${taskAssigneeName}">${taskAssigneeName}</div>
    `;
    if(leftBody) leftBody.appendChild(row);

    if (listBody) {
      let historyHtml = '';
      const historyList = task.history || [];
      if (historyList.length > 0) {
        const sortedHistory = [...historyList].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
        historyHtml = `<div style="max-height: 160px; overflow-y: auto;">` + 
          `<table style="width:100%; table-layout:fixed; border-collapse:collapse; margin:0; background:transparent;"><colgroup><col style="width:50%;"><col style="width:50%;"></colgroup><tbody>` +
          sortedHistory.map((h, i) => {
            let note = h.type === 'create' ? '<span style="color:var(--text-muted)">(建立)</span>' : (h.type === 'complete' ? '<span style="color:var(--success)">(結案)</span>' : '');
            let remarkHtml = '';
            if (h.type === 'complete' && h.delayReason) remarkHtml = `<span class="pill pill-danger" style="white-space:normal; word-wrap:break-word;">Delay: ${h.delayReason}</span>`;
            else if (h.remark) remarkHtml = `<span style="color: var(--text-muted); white-space:normal; word-wrap:break-word;">${h.remark}</span>`;
            else remarkHtml = `<span style="color: #cbd5e1;">-</span>`;
            const borderStyle = i === sortedHistory.length - 1 ? "" : "border-bottom:1px dashed var(--border-light);";
            return `<tr style="${borderStyle}"><td style="padding: 10px 14px 10px 0; vertical-align: top; font-size:12px; border-right: 1px solid var(--border-light);"><span style="color:var(--primary); font-weight:600;">[ ${h.timestamp} ]</span><br><div style="margin-top:4px;">歷時 <b>${h.daysPassed}</b> 工作天</div></td><td style="padding: 10px 0 10px 14px; vertical-align: top; font-size:12px;">${remarkHtml}</td></tr>`;
          }).join('') + `</tbody></table></div>`;
      } else {
        historyHtml = `<div style="padding: 12px 0; color:var(--text-muted); font-size: 12px;">尚無紀錄</div>`;
      }

      const statusHtml = task.isCompleted ? `<span class="pill pill-success" style="font-size:13px; padding:6px 10px;">已完成</span>` : `<span style="font-size:13px; font-weight:bold;">進度: ${task.progress || 0}%</span>`;
      const tr = document.createElement("tr");
      tr.innerHTML = `<td style="vertical-align: top; font-size: 14px;"><strong>${task.name}</strong></td><td style="vertical-align: top;">${taskAssigneeName}</td><td style="vertical-align: top;">${statusHtml}</td><td style="padding: 0 16px; vertical-align: top;">${historyHtml}</td><td style="padding: 0 16px; vertical-align: top;">${task.delayReason ? `<span class="pill pill-danger">Delay: ${task.delayReason}</span>` : '-'}</td>`;
      listBody.appendChild(tr);
    }
  });

  const chartContainer = document.getElementById("gantt-chart-container");
  if(!chartContainer) return;
  
  chartContainer.className = "gantt-right-panel"; 
  if (ganttTasks.length > 0) {
    const newDetailState = JSON.stringify({ id: selectedProjectId, tasks: ganttTasks });
    
    if (lastDetailGanttState !== newDetailState || !chartContainer.querySelector('svg')) {
        lastDetailGanttState = newDetailState;
        chartContainer.innerHTML = '<div id="gantt-chart"></div>';
        setTimeout(() => {
          if (document.getElementById("tab-projects")?.style.display === "none") return;
          try {
              ganttInstance = new Gantt("#gantt-chart", ganttTasks, { 
                view_mode: 'Day', language: 'zh', header_height: 50, bar_height: 20, padding: 18, readonly: true 
              });
              patchGanttVisuals(ganttInstance, '#gantt-chart-container');
              scrollToTodayMinus2Days(ganttInstance, '#gantt-chart-container'); 
          } catch(e) {}
        }, 50); 
    }
  } else {
    lastDetailGanttState = "";
    chartContainer.innerHTML = '';
  }
}
