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
// 工具函式
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

function triggerRenderProjects() {
  if (renderTimer) clearTimeout(renderTimer);
  renderTimer = setTimeout(() => {
      if (auth.currentUser) renderProjects();
  }, 100); 
}

// ==========================================
// 統一事件委派與攔截器 (確保按鈕 100% 響應)
// ==========================================
document.addEventListener("click", async (e) => {
  const target = e.target;

  if (target.closest("#btn-login")) {
    e.preventDefault();
    const email = document.getElementById("login-email")?.value.trim();
    const pass = document.getElementById("login-password")?.value.trim();
    if (!email || !pass) return alert("請填寫帳號密碼！");
    try { 
      await signInWithEmailAndPassword(auth, email, pass); 
    } catch (err) { 
      alert("登入失敗: " + err.message); 
    }
    return;
  }

  if (target.closest("#btn-logout")) {
    e.preventDefault();
    signOut(auth);
    return;
  }

  if (target.closest("#btn-toggle-edit-mode")) {
    e.preventDefault();
    if (!auth.currentUser) return;
    isEditMode = !isEditMode;
    const btn = document.getElementById("btn-toggle-edit-mode");
    if (btn) {
      btn.innerHTML = isEditMode ? "❌ 關閉編輯模式" : "✏️ 開啟編輯模式";
      btn.style.background = isEditMode ? "var(--warning-bg)" : "transparent";
    }
    triggerRenderProjects();
    renderAdHocEvents();
    renderWeeklyReports();
    return;
  }

  if (target.closest("#btn-toggle-create")) {
    e.preventDefault();
    const form = document.getElementById('create-project-section');
    if (!form) return;
    const isHidden = form.style.display === 'none';
    form.style.display = isHidden ? 'block' : 'none';

    if (isHidden) {
      const projName = document.getElementById("proj-name");
      if(projName) projName.value = "";
      const projColor = document.getElementById("proj-color");
      if(projColor) projColor.value = "bar-primary";
      
      renderCollabCheckboxes([]);
      const taskContainer = document.getElementById("task-list-container");
      if(taskContainer) taskContainer.innerHTML = "";
      
      addTaskRow();
      injectTemplateUI();
    }
    return;
  }

  if (target.closest("#btn-add-project")) {
    e.preventDefault();
    submitNewProject();
    return;
  }

  if (target.closest("#btn-project-add-task")) {
    e.preventDefault();
    openAddProjectTaskModal();
    return;
  }

  if (target.closest("#btn-delete-project")) {
    e.preventDefault();
    deleteCurrentProject();
    return;
  }

  // 模板編輯按鈕觸發
  if (target.closest("button") && target.closest("button").textContent.includes("編輯模板")) {
    e.preventDefault();
    openTemplateEditModal();
    return;
  }

  // 模板帶入按鈕觸發
  if (target.closest("button") && target.closest("button").textContent.includes("帶入")) {
    e.preventDefault();
    applyTemplate();
    return;
  }
});

// ==========================================
// 專案與模板 UI 管理
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

function injectTemplateUI() {
  const taskContainer = document.getElementById("task-list-container");
  if (!taskContainer || document.getElementById("template-section-wrapper")) return;

  const wrapper = document.createElement("div");
  wrapper.id = "template-section-wrapper";
  wrapper.className = "form-group";
  wrapper.style.marginBottom = "14px";
  wrapper.innerHTML = `
    <label class="form-label" style="font-weight:700; color:#8b5cf6; margin-bottom:6px; display:block;">📄 專案模板 (快速帶入排程)</label>
    <div style="display:inline-flex; align-items:center; gap:8px; flex-wrap:wrap; background:#f8fafc; padding:8px 12px; border-radius:8px; border:1px solid #e2e8f0;">
      <select id="tpl-select" class="input-control" style="width:170px; margin:0; font-size:13px;"></select>
      <button type="button" class="action-btn" onclick="openTemplateEditModal()" style="padding:6px 12px; font-size:12px; border-color:#8b5cf6; color:#8b5cf6; font-weight:600;">✏️ 編輯模板</button>
      
      <div style="display:inline-flex; gap:12px; align-items:center; margin-left:14px; padding-left:14px; border-left:1px solid #cbd5e1;">
        <label style="font-size:13px; cursor:pointer; display:inline-flex; align-items:center; gap:4px; margin:0; font-weight:500;">
          <input type="radio" name="tpl_mode" value="seq" checked onchange="checkCascade()"> 接續時間
        </label>
        <label style="font-size:13px; cursor:pointer; display:inline-flex; align-items:center; gap:4px; margin:0; font-weight:500;">
          <input type="radio" name="tpl_mode" value="free" onchange="checkCascade()"> 自由時間
        </label>
        <button type="button" class="action-btn" style="background:#10b981; color:#fff; border:none; padding:6px 14px; font-weight:bold; border-radius:4px; font-size:12px; margin-left:4px;" onclick="applyTemplate()">帶入</button>
      </div>
    </div>
  `;
  taskContainer.parentNode.insertBefore(wrapper, taskContainer);
  renderTemplateSelect();
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
   document.body.insertAdjacentHTML('beforeend', html);
}

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
  document.getElementById("tpl-edit-id").value = tplId;
  document.getElementById("tpl-edit-name").value = tpl.name;
  
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
            startInput.min = startInput.value;
            prevEnd = endInput.value;
         }
      }
   });
}

function checkCascade() { cascadeDates(); }

function addTaskRow() {
  const container = document.getElementById("task-list-container"); 
  if (!container) return;
  const rows = container.querySelectorAll('.task-row');
  let defaultStart = rows.length > 0 ? getNextWorkingDayStr(rows[rows.length - 1].querySelector('.task-end').value) : "";
  let defaultEnd = defaultStart ? defaultStart : "";
  appendTaskRowWithData("", defaultStart, 1, defaultEnd);
  cascadeDates();
}

// ==========================================
// Firebase 身份驗證與資料串流
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
      } else {
        currentUserData = { name: user.email ? user.email.split('@')[0] : "User", email: user.email || "", dept: "設計部", role: "admin", canEdit: false };
        await setDoc(doc(db, "users", user.uid), currentUserData, { merge: true });
      }
    } catch (e) { 
      currentUserData = { name: user.email ? user.email.split('@')[0] : "User", email: user.email || "", dept: "設計部", role: "admin", canEdit: false }; 
    }
    
    const displayName = currentUserData.name || (currentUserData.email ? currentUserData.email.split('@')[0] : "User");
    document.getElementById("user-display-name").innerText = displayName;
    document.getElementById("user-avatar").innerText = displayName.charAt(0).toUpperCase();
    document.getElementById("user-role-badge").innerText = roleNames[currentUserData.role] || (currentUserData.role || "STAFF").toUpperCase();

    if (currentUserData.role === "admin") {
      document.getElementById("nav-org-manage").style.display = "flex"; 
      document.getElementById("nav-divider-org").style.display = "block"; 
    } else {
      document.getElementById("nav-org-manage").style.display = "none"; 
      document.getElementById("nav-divider-org").style.display = "none"; 
    }

    if (currentUserData.role !== 'staff') { 
      document.getElementById('nav-sub-wrapper').style.display = 'block'; 
    } else {
      document.getElementById('nav-sub-wrapper').style.display = 'none';
    }

    initDynamicUI();
    injectTemplateModal();
    setupDataListeners(user.uid);

  } else {
    document.getElementById("auth-section").style.display = "flex"; 
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
    if (currentUserData.role !== 'staff' && typeof renderSidebarSubordinates === 'function') renderSidebarSubordinates();
    if (currentUserData.role === 'admin' && typeof renderOrgUsersTable === 'function') renderOrgUsersTable();
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
  }));

  firebaseUnsubscribers.push(onSnapshot(query(collection(db, "ad_hoc_events")), (snapshot) => {
    allAdHocData = []; 
    snapshot.forEach(docSnap => allAdHocData.push({ id: docSnap.id, ...docSnap.data() })); 
    if (typeof renderAdHocEvents === 'function') renderAdHocEvents(); 
    triggerRenderProjects();
  }));
}

// 專案與甘特圖核心渲染
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

  if (selectedProjectId === 'SUMMARY') {
    if(detailView) detailView.style.display = "none"; 
    if(summaryView) summaryView.style.display = "block";
    
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
        type: 'project', sortDate: new Date(minStart).getTime(), idStr: `s_p_${sIdx++}`, projId: p.id,
        title: p.title, start: minStart, end: maxEnd, progress: avgProg, isDone: isDone, hasDelay: hasDelay, isCollab: hasCollab, custom_class: isDone ? 'bar-success' : (p.color || 'bar-primary')
      });
    });

    activeAdHocs.forEach(evt => {
      let eDate = getAdHocDateStr(evt);
      let prog = evt.isCompleted ? 100 : 0;
      let hasDelay = !evt.isCompleted && eDate < todayStr;
      
      combinedItems.push({
        type: 'adhoc', sortDate: new Date(eDate).getTime(), idStr: `s_e_${sIdx++}`,
        title: evt.title, start: eDate, end: eDate, progress: prog, isDone: evt.isCompleted, hasDelay: hasDelay, isCollab: false, custom_class: 'bar-danger'
      });
    });

    combinedItems.sort((a, b) => a.sortDate - b.sortDate);

    combinedItems.forEach(item => {
      ganttTasksSum.push({ id: item.idStr, name: item.title, start: item.start, end: item.end, progress: item.progress, custom_class: item.custom_class });
      const row = document.createElement("div"); 
      row.className = "gantt-row";
      if (item.type === 'project') {
        let statusText = item.isDone ? '<span style="color:var(--success); font-weight:700;">完成</span>' : item.progress+'%';
        if (item.hasDelay && !item.isDone) statusText = '<span style="color:var(--danger); font-weight:700;">Delay</span>';
        let titleDisplay = item.isCollab ? `<span style="color:#2563eb; font-weight:700;">👥 ${item.title}</span>` : `<span style="color:#0f172a; font-weight:700;">🗂️ ${item.title}</span>`;
        row.innerHTML = `<div class="col-sum-name clickable" onclick="selectProject('${item.projId}')">${titleDisplay}</div><div class="col-sum-date">${item.start.substring(5)} ~ ${item.end.substring(5)}</div><div class="col-sum-prog">${statusText}</div>`;
      } else {
        let statusText = item.isDone ? '<span style="color:var(--success); font-weight:700;">完成</span>' : '處理中';
        if (item.hasDelay && !item.isDone) statusText = '<span style="color:var(--danger); font-weight:700;">Delay</span>';
        row.innerHTML = `<div class="col-sum-name" style="color:var(--danger);">🚨 ${item.title}</div><div class="col-sum-date">${item.start.substring(5)}</div><div class="col-sum-prog">${statusText}</div>`;
      }
      if(sumLeftBody) sumLeftBody.appendChild(row);
    });

    const chartContainer = document.getElementById("gantt-chart-summary-container");
    if(chartContainer && ganttTasksSum.length > 0) {
      chartContainer.innerHTML = '<div id="gantt-chart-summary"></div>';
      setTimeout(() => {
        try {
          summaryGanttInstance = new Gantt("#gantt-chart-summary", ganttTasksSum, { view_mode: 'Day', language: 'zh', header_height: 50, bar_height: 20, padding: 18, readonly: true });
        } catch(e) {}
      }, 30);
    }
    return;
  }

  if(summaryView) summaryView.style.display = "none"; 
  if(detailView) detailView.style.display = "block";
  const activeProj = activeList.find(p => p.id === selectedProjectId);
  if (!activeProj) return; 

  const leftBody = document.getElementById("gantt-left-body");
  if(leftBody) leftBody.innerHTML = "";

  const ganttTasks = [];
  (activeProj.tasks || []).forEach((task, index) => {
    ganttTasks.push({ id: `t_${index}`, name: task.name, start: task.start, end: task.end, progress: task.progress || 0, custom_class: task.isCompleted ? 'bar-success' : 'bar-primary' });

    const row = document.createElement("div"); 
    row.className = "gantt-row";
    row.innerHTML = `
      <div class="col-name">${task.name}</div>
      <div class="col-date">${getWorkingDays(task.start, task.end)} 天</div>
      <div class="col-prog"><input type="number" min="0" max="100" value="${task.progress || 0}" id="prog_input_${index}" ${task.isCompleted ? 'disabled' : ''}> %</div>
      <div class="col-act"><button class="action-btn btn-sm" ${task.isCompleted ? 'disabled' : ''} onclick="confirmProgress('${activeProj.id}', ${index}, '${task.end}')">${task.isCompleted ? '完成' : '確認'}</button></div>
      <div class="col-owner">${task.assigneeName || '負責人'}</div>
    `;
    if(leftBody) leftBody.appendChild(row);
  });

  const chartContainer = document.getElementById("gantt-chart-container");
  if(chartContainer && ganttTasks.length > 0) {
    chartContainer.className = "gantt-right-panel";
    chartContainer.innerHTML = '<div id="gantt-chart"></div>';
    setTimeout(() => {
      try {
        ganttInstance = new Gantt("#gantt-chart", ganttTasks, { view_mode: 'Day', language: 'zh', header_height: 50, bar_height: 20, padding: 18, readonly: true });
      } catch(e) {}
    }, 30);
  }
}

// ==========================================
// 全域函式綁定 (將內部函式安全暴露給網頁)
// ==========================================
window.submitNewProject = async () => {
  const title = document.getElementById("proj-name")?.value.trim();
  if (!title) return alert("請填寫主專案名稱！");
  const color = document.getElementById("proj-color")?.value || "bar-primary";
  const collabCheckboxes = document.querySelectorAll('input[name="collab_dept"]:checked');
  const collaborators = Array.from(collabCheckboxes).map(cb => cb.value);
  const taskRows = document.querySelectorAll('.task-row'); 
  const tasks = [];
  const todayStr = getTodayStr(); 
  const ts = new Date().toLocaleString('zh-TW', { hour12: false });
  const myName = currentUserData.name || auth.currentUser?.email.split('@')[0];
  
  for (let row of taskRows) {
    const name = row.querySelector('.task-name')?.value.trim(); 
    const start = row.querySelector('.task-start')?.value; 
    const end = row.querySelector('.task-end')?.value;
    if (!name || !start || !end) return alert("任務細項不可有空白欄位！");
    tasks.push({ 
      name, start, end, progress: 0, isCompleted: false, completedAt: null, delayReason: "", lastUpdatedAt: ts, reportedCompleted: false, 
      assigneeId: auth.currentUser.uid, assigneeName: myName, createdAt: Date.now(), 
      history: [{ timestamp: ts, progress: 0, type: 'create', daysPassed: getWorkingDays(start, todayStr), delayReason: '', remark: '專案建立' }] 
    });
  }
  
  const docRef = await addDoc(collection(db, "projects"), { 
    title, color, collaborators, ownerId: viewingUserId, ownerName: myName, tasks, createdAt: serverTimestamp() 
  });
  alert("🎉 新專案已成功建立！");
  document.getElementById("proj-name").value = ""; 
  document.getElementById("task-list-container").innerHTML = ""; 
  addTaskRow(); 
  document.getElementById('create-project-section').style.display = 'none';
  selectedProjectId = docRef.id;
  triggerRenderProjects(); 
};

window.confirmProgress = async (projId, taskIndex, plannedEnd) => {
  const proj = allProjectsData.find(p => p.id === projId);
  const tasks = [...proj.tasks];
  const targetTask = tasks[taskIndex];
  const inputElem = document.getElementById(`prog_input_${taskIndex}`);
  let newProg = parseInt(inputElem.value); 
  if (isNaN(newProg)) newProg = 0;
  targetTask.progress = newProg;
  if (newProg >= 100) {
    targetTask.isCompleted = true;
    targetTask.completedAt = new Date().toLocaleString('zh-TW', { hour12: false });
  }
  await updateDoc(doc(db, "projects", projId), { tasks });
  alert("進度更新成功！");
};

window.switchNav = (tabId, title, elem) => {
  document.querySelectorAll('.tab-pane').forEach(el => el.style.display = 'none');
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  const targetPane = document.getElementById(tabId);
  if (targetPane) targetPane.style.display = 'block';
  if (elem) elem.classList.add('active');
  const tTitle = document.getElementById('current-title');
  if (tTitle) tTitle.innerText = title;
  if (tabId === 'tab-projects') triggerRenderProjects();
};

window.setProjectFilter = setProjectFilter;
window.selectProject = selectProject;
window.toggleSubMenu = toggleSubMenu;
window.addTaskRow = addTaskRow;
window.moveTaskRow = moveTaskRow;
window.renderTemplateSelect = renderTemplateSelect;
window.openTemplateEditModal = openTemplateEditModal;
window.addTplTaskRow = addTplTaskRow;
window.moveTplTaskRow = moveTplTaskRow;
window.closeTemplateEditModal = closeTemplateEditModal;
window.saveTemplate = saveTemplate;
window.applyTemplate = applyTemplate;
window.cascadeDates = cascadeDates;
window.checkCascade = checkCascade;
window.onTaskStartChange = onTaskStartChange;
window.onTaskDaysChange = onTaskDaysChange;
window.onTaskEndChange = onTaskEndChange;
