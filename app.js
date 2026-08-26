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
setPersistence(auth, browserLocalPersistence).catch((error) => console.log("Persistence Error:", error));
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

let calCurrentYear = new Date().getFullYear();
let calCurrentMonth = new Date().getMonth();
let activeCalDateStr = null;
let showCompletedTodos = true;

let lastSummaryGanttState = "";
let lastDetailGanttState = "";

const taiwanHolidayMap = {
  '01-01': '元旦', '01-02': '彈性放假', '02-15': '小年夜', '02-16': '除夕',
  '02-17': '春節初一', '02-18': '初二', '02-19': '初三', '02-20': '補假',
  '02-27': '228連假', '02-28': '和平紀念日', '04-03': '清明補假', '04-04': '兒童節',
  '04-05': '清明節', '04-06': '補假', '05-01': '勞動節', '06-19': '端午節',
  '09-25': '中秋節', '09-28': '教師節', '10-09': '國慶補假', '10-10': '國慶日',
  '10-25': '光復節', '10-26': '補假', '12-25': '行憲紀念日'
};

// ==========================================
// 🚀 核心防護：全域按鈕代理攔截
// ==========================================
document.addEventListener("click", async (e) => {
  const target = e.target;
  const btnLogin = target.closest("#btn-login");
  if (btnLogin) { 
      e.preventDefault(); 
      if(window.submitLogin) window.submitLogin(); 
      return; 
  }
  const btnLogout = target.closest("#btn-logout");
  if (btnLogout) { 
      e.preventDefault(); 
      signOut(auth); 
      return; 
  }
  const btnToggleEdit = target.closest("#btn-toggle-edit-mode");
  if (btnToggleEdit) { 
      e.preventDefault(); 
      if(window.toggleEditMode) window.toggleEditMode(); 
      return; 
  }
  const btnToggleCreate = target.closest("#btn-toggle-create");
  if (btnToggleCreate) { 
      e.preventDefault(); 
      if(window.toggleCreateProject) window.toggleCreateProject(); 
      return; 
  }
  const btnAddProject = target.closest("#btn-add-project");
  if (btnAddProject) { 
      e.preventDefault(); 
      if(window.submitNewProject) window.submitNewProject(); 
      return; 
  }
  const btnAddAdhoc = target.closest("#btn-add-adhoc");
  if (btnAddAdhoc) { 
      e.preventDefault(); 
      if(window.submitNewAdHoc) window.submitNewAdHoc(); 
      return; 
  }
  const btnAddWeekly = target.closest("#btn-add-weekly");
  if (btnAddWeekly) { 
      e.preventDefault(); 
      if(window.submitWeeklyReport) window.submitWeeklyReport(); 
      return; 
  }
  const btnCreateUser = target.closest("#btn-create-user");
  if (btnCreateUser) { 
      e.preventDefault(); 
      if(window.submitCreateUser) window.submitCreateUser(); 
      return; 
  }
  const btnUpdatePwd = target.closest("#btn-update-password");
  if (btnUpdatePwd) { 
      e.preventDefault(); 
      if(window.submitUpdatePassword) window.submitUpdatePassword(); 
      return; 
  }
});

// ==========================================
// 🚀 工具函式
// ==========================================
window.getTodayStr = () => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
};

window.getUserDept = (uid) => {
    if (!uid) return "設計部";
    if (uid === auth.currentUser?.uid) return currentUserData.dept || "設計部";
    const u = allUsersList.find(x => x.uid === uid);
    return u ? (u.dept || "設計部") : "設計部";
};

let renderTimer = null;
window.triggerRenderProjects = () => {
  if (renderTimer) clearTimeout(renderTimer);
  renderTimer = setTimeout(() => {
      if (auth.currentUser && window.renderProjects) window.renderProjects();
  }, 150); 
};

// ==========================================
// 🚀 UI 與模板視窗強制注入
// ==========================================
window.initDynamicUI = () => {
  if (!document.getElementById('filter-all')) {
    const kpiRow = document.querySelector('.kpi-row');
    if (kpiRow) {
      kpiRow.innerHTML = `
        <div class="kpi-card active" id="filter-ongoing" onclick="window.setProjectFilter('ongoing')"><div class="kpi-title">未完成</div><div class="kpi-number" id="stat-ongoing">0</div></div>
        <div class="kpi-card" id="filter-completed" onclick="window.setProjectFilter('completed')"><div class="kpi-title">完成</div><div class="kpi-number" id="stat-completed" style="color: var(--success);">0</div></div>
        <div class="kpi-card" id="filter-delayed" onclick="window.setProjectFilter('delayed')"><div class="kpi-title">Delay</div><div class="kpi-number" id="stat-delay" style="color: var(--danger);">0</div></div>
        <div class="kpi-card" id="filter-collab" onclick="window.setProjectFilter('collab')"><div class="kpi-title">協作專案</div><div class="kpi-number" id="stat-collab" style="color: var(--primary);">0</div></div>
        <div class="kpi-card" id="filter-all" onclick="window.setProjectFilter('all')"><div class="kpi-title">專案總覽</div><div class="kpi-number" id="stat-all" style="color: var(--warning);">0</div></div>
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
        if (currentFilter === 'ongoing' || currentFilter === 'delayed') {
           window.setProjectFilter('all');
        } else {
           window.triggerRenderProjects();
        }
      };
      btnWrapper.insertBefore(sel, btnWrapper.firstChild);
    }
  }
  
  // 確保一開始就有 Modal 可以用
  window.injectTemplateModal();
};

window.injectTemplateUI = () => {
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
      <button type="button" class="action-btn" onclick="window.openTemplateEditModal()" style="padding:6px 12px; font-size:12px; border-color:#8b5cf6; color:#8b5cf6; font-weight:600;">✏️ 編輯模板</button>
      
      <div style="display:inline-flex; gap:12px; align-items:center; margin-left:14px; padding-left:14px; border-left:1px solid #cbd5e1;">
        <label style="font-size:13px; cursor:pointer; display:inline-flex; align-items:center; gap:4px; margin:0; font-weight:500;">
          <input type="radio" name="tpl_mode" value="seq" checked onchange="window.checkCascade()"> 接續時間
        </label>
        <label style="font-size:13px; cursor:pointer; display:inline-flex; align-items:center; gap:4px; margin:0; font-weight:500;">
          <input type="radio" name="tpl_mode" value="free" onchange="window.checkCascade()"> 自由時間
        </label>
        <button type="button" class="action-btn" style="background:#10b981; color:#fff; border:none; padding:6px 14px; font-weight:bold; border-radius:4px; font-size:12px; margin-left:4px;" onclick="window.applyTemplate()">帶入</button>
      </div>
    </div>
  `;
  taskContainer.parentNode.insertBefore(wrapper, taskContainer);
  window.renderTemplateSelect();
};

window.injectTemplateModal = () => {
   if (document.getElementById('template-edit-modal')) return;
   const html = `
   <div class="modal" id="template-edit-modal" style="z-index:9999999;">
     <div class="modal-box" style="max-width: 600px;">
       <div class="modal-header">
         <h3>✏️ 編輯專案模板</h3>
         <button class="btn-close" onclick="window.closeTemplateEditModal()">×</button>
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
              <button type="button" class="action-btn" onclick="window.addTplTaskRow('', 1)">➕ 新增一列</button>
           </label>
           <div id="tpl-task-list-container" style="max-height:350px; overflow-y:auto; border:1px solid #e2e8f0; padding:12px; border-radius:8px; background:#f8fafc;"></div>
         </div>
       </div>
       <div class="modal-footer" style="text-align:right;">
         <button class="action-btn" onclick="window.closeTemplateEditModal()">取消</button>
         <button class="action-btn" style="background:var(--primary); color:#fff; border:none;" onclick="window.saveTemplate()">💾 儲存模板</button>
       </div>
     </div>
   </div>
   `;
   if (document.body) document.body.insertAdjacentHTML('beforeend', html);
};

// ==========================================
// 🚀 Firebase 驗證與資料流通道
// ==========================================
onAuthStateChanged(auth, async (user) => {
  if (user) {
    const authSec = document.getElementById("auth-section");
    if(authSec) authSec.style.display = "none";
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

    window.initDynamicUI();
    if (window.initWeeklyDateAndLeave) window.initWeeklyDateAndLeave(); 
    if (window.addTaskRow) window.addTaskRow(); 
    if (window.addWeeklyRow) window.addWeeklyRow(); 
    
    window.setupDataListeners(user.uid);

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

window.setupDataListeners = function(uid) {
  firebaseUnsubscribers.forEach(unsub => unsub());
  firebaseUnsubscribers = [];

  firebaseUnsubscribers.push(onSnapshot(collection(db, "users"), (snapshot) => {
    allUsersList = [];
    snapshot.forEach(docSnap => allUsersList.push({ uid: docSnap.id, ...docSnap.data() }));
    if (currentUserData.role !== 'staff' && window.renderSidebarSubordinates) window.renderSidebarSubordinates();
    if (currentUserData.role === 'admin' && window.renderOrgUsersTable) window.renderOrgUsersTable();
    window.triggerRenderProjects();
  }));

  firebaseUnsubscribers.push(onSnapshot(doc(db, "settings", "project_templates"), (docSnap) => {
    if (docSnap.exists() && Object.keys(docSnap.data()).length > 0) {
      projectTemplates = { ...projectTemplates, ...docSnap.data() };
    }
    if (window.renderTemplateSelect) window.renderTemplateSelect();
  }));

  firebaseUnsubscribers.push(onSnapshot(query(collection(db, "projects")), (snapshot) => {
    allProjectsData = []; 
    snapshot.forEach(docSnap => allProjectsData.push({ id: docSnap.id, ...docSnap.data() })); 
    window.triggerRenderProjects(); 
    if (window.refreshAllWeeklyProjSelects) window.refreshAllWeeklyProjSelects();
  }));

  firebaseUnsubscribers.push(onSnapshot(query(collection(db, "ad_hoc_events")), (snapshot) => {
    allAdHocData = []; 
    snapshot.forEach(docSnap => allAdHocData.push({ id: docSnap.id, ...docSnap.data() })); 
    if (window.renderAdHocEvents) window.renderAdHocEvents(); 
    window.triggerRenderProjects();
  }));

  firebaseUnsubscribers.push(onSnapshot(query(collection(db, "weekly_reports")), (snapshot) => {
    allWeeklyData = []; 
    snapshot.forEach(docSnap => allWeeklyData.push({ id: docSnap.id, ...docSnap.data() })); 
    if (window.renderWeeklyReports) window.renderWeeklyReports(); 
    if (window.refreshAllWeeklyProjSelects) window.refreshAllWeeklyProjSelects();
  }));

  firebaseUnsubscribers.push(onSnapshot(query(collection(db, "calendar_todos"), where("ownerId", "==", uid)), (snapshot) => {
    myCalendarTodos = [];
    snapshot.forEach(docSnap => myCalendarTodos.push({ id: docSnap.id, ...docSnap.data() }));
    if (window.renderCalendar) window.renderCalendar();
    if (activeCalDateStr && window.renderCalTodosModal) window.renderCalTodosModal(activeCalDateStr);
  }));
};

// ==========================================
// 🚀 模板操作函式 (100% 保證可呼叫)
// ==========================================
window.renderTemplateSelect = function() {
  const sel = document.getElementById("tpl-select");
  if (!sel) return;
  sel.innerHTML = `<option value="">-- 請選擇模板 --</option>`;
  for (let i = 1; i <= 5; i++) {
     const t = projectTemplates[i] || projectTemplates[String(i)] || { name: `自訂模板 ${i}` };
     sel.innerHTML += `<option value="${i}">${t.name}</option>`;
  }
};

window.openTemplateEditModal = function() {
  const tplId = document.getElementById("tpl-select")?.value;
  if (!tplId) return alert("請先從下拉選單中選擇一個模板！");
  
  // 🚀 最終防護：如果視窗真的不見了，強制生一個出來！
  window.injectTemplateModal();

  const tpl = projectTemplates[tplId] || projectTemplates[String(tplId)] || { name: `自訂模板 ${tplId}`, tasks: [] };
  document.getElementById("tpl-edit-id").value = tplId;
  document.getElementById("tpl-edit-name").value = tpl.name;
  
  const container = document.getElementById("tpl-task-list-container");
  if(!container) return alert("系統載入中，請稍後再試！");
  container.innerHTML = "";
  
  if (tpl.tasks && tpl.tasks.length > 0) {
     tpl.tasks.forEach(task => window.addTplTaskRow(task.name, task.days));
  } else {
     window.addTplTaskRow("", 1);
  }
  
  document.getElementById("template-edit-modal").classList.add("active");
};

window.addTplTaskRow = function(name = "", days = 1) {
  const container = document.getElementById("tpl-task-list-container");
  if(!container) return;
  const div = document.createElement('div');
  div.className = "form-row tpl-task-row";
  div.style.marginBottom = "8px";
  div.innerHTML = `
    <div class="form-group" style="margin:0; flex:3;"><input type="text" class="input-control tpl-task-name" placeholder="細項名稱" value="${name}"></div>
    <div class="form-group" style="margin:0; width:80px; flex-shrink:0;"><input type="number" min="1" class="input-control tpl-task-days" value="${days}" placeholder="天數" title="預設天數"></div>
    <div style="display:flex; gap:4px; margin:0; flex-shrink:0;">
      <button type="button" class="action-btn btn-sort" onclick="window.moveTplTaskRow(this, -1)">↑</button>
      <button type="button" class="action-btn btn-sort" onclick="window.moveTplTaskRow(this, 1)">↓</button>
      <button type="button" class="action-btn danger" onclick="this.closest('.tpl-task-row').remove()" style="padding:8px 10px;">X</button>
    </div>
  `;
  container.appendChild(div);
};

window.moveTplTaskRow = function(btn, direction) {
   const row = btn.closest('.tpl-task-row');
   if (!row) return;
   if (direction === -1 && row.previousElementSibling) {
     row.parentNode.insertBefore(row, row.previousElementSibling);
   } else if (direction === 1 && row.nextElementSibling) {
     row.parentNode.insertBefore(row.nextElementSibling, row);
   }
};

window.closeTemplateEditModal = function() {
  const modal = document.getElementById("template-edit-modal");
  if (modal) modal.classList.remove("active");
};

window.saveTemplate = async function() {
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
    console.log("寫入資料庫失敗，已儲存至暫存區", e);
  }
  window.renderTemplateSelect();
  window.closeTemplateEditModal();
  alert("🎉 模板儲存成功！");
};

window.applyTemplate = function() {
  const tplId = document.getElementById("tpl-select")?.value;
  if (!tplId) return alert("請先選擇要帶入的模板！");
  const tpl = projectTemplates[tplId] || projectTemplates[String(tplId)];
  if (!tpl || !tpl.tasks || tpl.tasks.length === 0) return alert("此模板還是空的，請先點擊編輯模板建立任務！");
  
  const modeRadio = document.querySelector('input[name="tpl_mode"]:checked');
  const mode = modeRadio ? modeRadio.value : 'seq';
  const container = document.getElementById("task-list-container");
  if (!container) return;
  container.innerHTML = ""; 
  
  let currentDate = window.getTodayStr(); 
  
  tpl.tasks.forEach((t, i) => {
     const div = document.createElement('div');
     div.className = "form-row task-row";
     div.style.marginBottom = "8px";
     
     let startStr = "";
     let endStr = "";
     let days = parseInt(t.days) || 1;

     if (mode === 'seq') {
        startStr = i === 0 ? currentDate : window.getNextWorkingDayStr(currentDate);
        endStr = window.calculateEndDateByDays(startStr, days);
        currentDate = endStr; 
     } else {
        days = 1; 
        startStr = "";
        endStr = "";
     }

     div.innerHTML = `
        <div class="form-group" style="margin:0; flex:2;"><input type="text" class="input-control task-name" value="${t.name}" placeholder="細項名稱"></div>
        <div class="form-group" style="margin:0; flex:1.2;"><input type="date" class="input-control task-start" value="${startStr}" onchange="window.onTaskStartChange(this, null); window.checkCascade();"></div>
        <div class="form-group" style="margin:0; width:65px; flex-shrink:0;"><input type="number" min="1" class="input-control task-days" value="${days}" placeholder="天數" title="工作天數" oninput="window.onTaskDaysChange(this, null, null); window.checkCascade();"></div>
        <div class="form-group" style="margin:0; flex:1.2;"><input type="date" class="input-control task-end" value="${endStr}" min="${startStr}" onchange="window.onTaskEndChange(this, null, null); window.checkCascade();"></div>
        <div style="display:flex; gap:4px; margin:0; flex-shrink:0;">
          <button type="button" class="action-btn btn-sort" onclick="window.moveTaskRow(this, -1); window.checkCascade();" title="上移">↑</button>
          <button type="button" class="action-btn btn-sort" onclick="window.moveTaskRow(this, 1); window.checkCascade();" title="下移">↓</button>
          <button type="button" class="action-btn danger" onclick="this.closest('.task-row').remove(); window.checkCascade();" style="padding:8px 10px;">X</button>
        </div>
     `;
     container.appendChild(div);
  });
  window.checkCascade();
};

// ==========================================
// 🚀 全域事件對外接口 (防止 HTML 找不到函數)
// ==========================================
Object.assign(window, {
  submitLogin: async () => {
    const email = document.getElementById("login-email")?.value.trim();
    const pass = document.getElementById("login-password")?.value.trim();
    if (!email || !pass) return alert("請填寫帳號密碼！");
    try { await signInWithEmailAndPassword(auth, email, pass); } 
    catch (err) { alert("登入失敗: " + err.message); }
  },
  toggleEditMode: () => {
    if (!auth.currentUser) return;
    isEditMode = !isEditMode;
    const btn = document.getElementById("btn-toggle-edit-mode");
    if (btn) {
      btn.innerHTML = isEditMode ? "❌ 關閉編輯模式" : "✏️ 開啟編輯模式";
      btn.style.background = isEditMode ? "var(--warning-bg)" : "transparent";
    }
    window.triggerRenderProjects(); 
    if(window.renderAdHocEvents) window.renderAdHocEvents(); 
    if(window.renderWeeklyReports) window.renderWeeklyReports();
  },
  toggleCreateProject: () => {
    const form = document.getElementById('create-project-section');
    if (!form) return;
    const isHidden = form.style.display === 'none';
    form.style.display = isHidden ? 'block' : 'none';

    if (isHidden) {
      const projName = document.getElementById("proj-name");
      if(projName) projName.value = "";
      const projColor = document.getElementById("proj-color");
      if(projColor) projColor.value = "bar-primary";
      
      if(window.renderCollabCheckboxes) window.renderCollabCheckboxes([]);
      const taskContainer = document.getElementById("task-list-container");
      if(taskContainer) taskContainer.innerHTML = "";
      
      if(window.addTaskRow) window.addTaskRow();
      
      window.injectTemplateUI();
      if(window.renderTemplateSelect) window.renderTemplateSelect();
    }
  },
  setProjectFilter: (status) => {
    currentFilter = status;
    document.querySelectorAll('.kpi-card').forEach(el => el.classList.remove('active'));
    const activeBtn = document.getElementById('filter-' + status);
    if (activeBtn) activeBtn.classList.add('active');
    selectedProjectId = 'SUMMARY'; 
    window.triggerRenderProjects();
  },
  selectProject: (projId) => { 
    selectedProjectId = projId; 
    isEditMode = false;
    const editBtn = document.getElementById("btn-toggle-edit-mode");
    if (editBtn) {
       editBtn.innerHTML = "✏️ 開啟編輯模式";
       editBtn.style.background = "transparent";
    }
    window.triggerRenderProjects(); 
  },
  switchNav: (tabId, title, elem) => {
    document.querySelectorAll('.tab-pane').forEach(el => el.style.display = 'none');
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    const targetPane = document.getElementById(tabId);
    if (targetPane) targetPane.style.display = 'block';
    if (elem) elem.classList.add('active');
    const tTitle = document.getElementById('current-title');
    if (tTitle) tTitle.innerText = title;
    
    if (tabId === 'tab-projects') window.triggerRenderProjects();
    if (tabId === 'tab-weekly' && window.initWeeklyDateAndLeave) window.initWeeklyDateAndLeave(); 
    if (tabId === 'tab-calendar' && window.initCalendarSelectors && window.renderCalendar) {
      window.initCalendarSelectors();
      window.renderCalendar();
    }
  },
  checkEditModeVisibility: () => {
    const btn = document.getElementById("btn-toggle-edit-mode");
    if (!btn || !auth.currentUser) return;
    let shouldShow = false;
    if (currentUserData.role === 'admin' || currentUserData.canEdit) {
      shouldShow = true;
    } else {
      if (selectedProjectId !== 'SUMMARY') {
        const p = allProjectsData.find(x => x.id === selectedProjectId);
        if (p) {
          const ownerDept = window.getUserDept(p.ownerId);
          const isOwnerDept = (currentUserData.dept === ownerDept);
          const inGrace = window.isWithin7DaysGracePeriod(p);

          if (isOwnerDept && inGrace) {
            shouldShow = true;
          }
          const isCollab = p.collaborators && p.collaborators.includes(currentUserData.dept);
          if (isCollab) {
            const hasTaskInGrace = (p.tasks || []).some(t => {
               if (t.assigneeId !== auth.currentUser?.uid) return false;
               let tCreatedTime = t.createdAt || (p.createdAt && typeof p.createdAt.toMillis === 'function' ? p.createdAt.toMillis() : Date.now());
               return ((Date.now() - tCreatedTime) / (1000 * 60 * 60 * 24)) <= 7;
            });
            if (hasTaskInGrace) shouldShow = true;
          }
        }
      }
    }

    if (!shouldShow && isEditMode) {
      isEditMode = false;
      btn.innerHTML = "✏️ 開啟編輯模式";
      btn.style.background = "transparent";
    }

    btn.style.display = shouldShow ? "inline-block" : "none";
  },
  renderCollabCheckboxes: (selectedDepts = []) => {
    const container = document.getElementById("collab-departments-checkboxes");
    if (!container) return;
    container.innerHTML = "";
    departmentList.forEach(dept => {
      const isChecked = selectedDepts.includes(dept) ? "checked" : "";
      container.innerHTML += `
        <label style="display:flex; align-items:center; gap:6px; cursor:pointer;">
          <input type="checkbox" name="collab_dept" value="${dept}" ${isChecked}> <span>${dept}</span>
        </label>
      `;
    });
  },
  toggleSubMenu: () => {
    const wrapper = document.getElementById('nav-sub-wrapper');
    const list = document.getElementById('nav-sub-list');
    if(!wrapper || !list) return;
    const isOpen = wrapper.classList.toggle('nav-menu-open');
    if (window.innerWidth <= 850) {
      if (isOpen) {
        document.body.appendChild(list); 
        list.classList.add('mobile-fixed-dropdown'); 
      } else {
        wrapper.appendChild(list); 
        list.classList.remove('mobile-fixed-dropdown'); 
      }
    }
  },
  renderSidebarSubordinates: () => {
    if (!auth.currentUser) return;
    const list = document.getElementById("nav-sub-list");
    if (!list) return;
    list.innerHTML = `<li class="nav-sub-item active" id="sub-li-${auth.currentUser.uid}" onclick="window.switchViewingUser('${auth.currentUser.uid}', '自己 (個人專案)')">個人專案</li>`;

    const visibleUsers = [];
    const myUid = auth.currentUser.uid;
    const myRole = currentUserData.role; 
    const myDept = currentUserData.dept || "設計部";

    const isSubordinate = (bossUid, targetUid) => {
      let current = allUsersList.find(u => u.uid === targetUid);
      let depth = 0;
      while (current && current.supervisorId && depth < 10) {
        if (current.supervisorId === bossUid) return true;
        current = allUsersList.find(u => u.uid === current.supervisorId);
        depth++;
      }
      return false;
    };

    allUsersList.forEach(u => {
      if (u.uid === myUid) return;
      const targetRole = u.role; 
      const targetDept = u.dept || "設計部";
      let canView = false;
      if (myRole === 'admin' || myRole === 'top_manager') canView = true;
      else if (myRole === 'manager') { if (targetDept === myDept && (targetRole === 'assistant_manager' || targetRole === 'staff')) canView = true; }
      else if (myRole === 'assistant_manager') { if (targetDept === myDept && targetRole === 'staff') canView = true; }
      if (canView || isSubordinate(myUid, u.uid)) visibleUsers.push(u);
    });

    const rolePriority = { admin: 1, top_manager: 2, manager: 3, assistant_manager: 4, staff: 5 };

    departmentList.forEach((dept, dIdx) => {
      const deptMembers = visibleUsers.filter(u => (u.dept || "設計部") === dept);
      if (deptMembers.length === 0) return;
      deptMembers.sort((a, b) => (rolePriority[a.role] || 99) - (rolePriority[b.role] || 99));

      const deptGroupId = `dept-group-${dIdx}`;
      const isViewingMemberInDept = deptMembers.some(m => m.uid === viewingUserId);
      const isExpanded = isViewingMemberInDept;

      list.innerHTML += `
        <li class="nav-sub-dept-header ${isExpanded ? 'open' : ''}" onclick="window.toggleDeptSubList('${deptGroupId}', this)">
          <div style="display:flex; align-items:center; gap:6px;">
            <span>🏢</span>
            <span>${dept}</span>
            <span class="dept-count-badge">${deptMembers.length}</span>
          </div>
          <span class="dept-arrow">▶</span>
        </li>
      `;

      let membersHtml = `<div class="nav-sub-dept-members" id="${deptGroupId}" style="display:${isExpanded ? 'flex' : 'none'};">`;
      deptMembers.forEach(u => {
        const isActive = (viewingUserId === u.uid) ? 'active' : '';
        membersHtml += `
          <li class="nav-sub-item ${isActive}" id="sub-li-${u.uid}" onclick="window.switchViewingUser('${u.uid}', '${u.name}')">
            ${u.name || '未命名'} 
            <small style="color:#94a3b8; font-size:11px; margin-left:4px;">(${roleNames[u.role] || '人員'})</small>
          </li>
        `;
      });
      membersHtml += `</div>`;
      list.innerHTML += membersHtml;
    });
  },
  toggleDeptSubList: (groupId, headerElem) => {
    const container = document.getElementById(groupId);
    if (!container) return;
    const isHidden = container.style.display === 'none';
    container.style.display = isHidden ? 'flex' : 'none';
    headerElem.classList.toggle('open', isHidden);
  },
  switchViewingUser: (uid, name) => {
    viewingUserId = uid;
    document.querySelectorAll('.nav-sub-item').forEach(el => el.classList.remove('active'));
    const targetLi = document.getElementById(`sub-li-${uid}`);
    if (targetLi) targetLi.classList.add('active');

    const isSelf = viewingUserId === auth.currentUser.uid;
    const userN = document.getElementById('viewing-user-name');
    if(userN) userN.innerText = isSelf ? '' : `[ 正在檢視：${name} ]`;
    
    const btnWrap = document.getElementById('btn-create-wrapper');
    if(btnWrap) btnWrap.style.display = isSelf ? 'flex' : 'none';
    
    const createSec = document.getElementById('create-project-section');
    if(createSec) createSec.style.display = 'none';
    
    const adhocSec = document.getElementById('adhoc-form-panel');
    if(adhocSec) adhocSec.style.display = isSelf ? 'block' : 'none';
    
    const weekSec = document.getElementById('weekly-form-panel');
    if(weekSec) weekSec.style.display = isSelf ? 'block' : 'none';

    selectedProjectId = 'SUMMARY'; 
    
    isEditMode = false;
    const editBtn = document.getElementById("btn-toggle-edit-mode");
    if(editBtn) {
       editBtn.innerHTML = "✏️ 開啟編輯模式";
       editBtn.style.background = "transparent";
    }

    window.triggerRenderProjects(); 
    if(window.renderAdHocEvents) window.renderAdHocEvents(); 
    if(window.renderWeeklyReports) window.renderWeeklyReports();

    const wrapper = document.getElementById('nav-sub-wrapper');
    const list = document.getElementById('nav-sub-list');
    if(wrapper && list) {
      if (wrapper.classList.contains('nav-menu-open')) wrapper.classList.remove('nav-menu-open');
      if (list.classList.contains('mobile-fixed-dropdown')) {
        wrapper.appendChild(list); 
        list.classList.remove('mobile-fixed-dropdown'); 
      }
    }
  },
  checkCascade: () => { window.cascadeDates(); },
  addTaskRow: () => {
    const container = document.getElementById("task-list-container"); 
    if (!container) return;
    const rows = container.querySelectorAll('.task-row');
    let defaultStart = rows.length > 0 ? window.getNextWorkingDayStr(rows[rows.length - 1].querySelector('.task-end').value) : "";
    let defaultEnd = defaultStart ? defaultStart : "";

    const div = document.createElement('div'); 
    div.className = "form-row task-row"; 
    div.style.marginBottom = "8px";
    div.innerHTML = `
      <div class="form-group" style="margin:0; flex:2;"><input type="text" class="input-control task-name" placeholder="細項名稱"></div>
      <div class="form-group" style="margin:0; flex:1.2;"><input type="date" class="input-control task-start" value="${defaultStart}" onchange="window.onTaskStartChange(this, null); window.checkCascade();"></div>
      <div class="form-group" style="margin:0; width:65px; flex-shrink:0;"><input type="number" min="1" class="input-control task-days" value="1" placeholder="天數" title="工作天數" oninput="window.onTaskDaysChange(this, null, null); window.checkCascade();"></div>
      <div class="form-group" style="margin:0; flex:1.2;"><input type="date" class="input-control task-end" value="${defaultEnd}" min="${defaultStart}" onchange="window.onTaskEndChange(this, null, null); window.checkCascade();"></div>
      <div style="display:flex; gap:4px; margin:0; flex-shrink:0;">
        <button type="button" class="action-btn btn-sort" onclick="window.moveTaskRow(this, -1); window.checkCascade();" title="上移">↑</button>
        <button type="button" class="action-btn btn-sort" onclick="window.moveTaskRow(this, 1); window.checkCascade();" title="下移">↓</button>
        <button type="button" class="action-btn danger" onclick="this.closest('.task-row').remove(); window.checkCascade();" style="padding:8px 10px;">X</button>
      </div>
    `;
    container.appendChild(div);
    window.checkCascade();
  },
  moveTaskRow: (btn, direction) => {
    const row = btn.closest('.task-row');
    if (!row) return;
    if (direction === -1 && row.previousElementSibling) {
      row.parentNode.insertBefore(row, row.previousElementSibling);
    } else if (direction === 1 && row.nextElementSibling) {
      row.parentNode.insertBefore(row.nextElementSibling, row);
    }
  },
  renderProjects: () => {
    if (!auth.currentUser) return;
    window.checkEditModeVisibility();

    const isViewingSelf = (viewingUserId === auth.currentUser.uid);
    const myDept = currentUserData.dept || "設計部";
    const targetUser = allUsersList.find(u => u.uid === viewingUserId);
    const targetDept = isViewingSelf ? myDept : (targetUser?.dept || "設計部");
    
    const yearFilterVal = document.getElementById('project-year-filter')?.value || new Date().getFullYear().toString();
    const selectedYear = yearFilterVal === 'all' ? 'all' : parseInt(yearFilterVal);
    const todayStr = window.getTodayStr();

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
      const ownerDept = window.getUserDept(p.ownerId);
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

      const inYear = window.spansYear(p, selectedYear);

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
    let adHocsCompleted = userAdHocs.filter(e => e.isCompleted && (selectedYear === 'all' || parseInt(window.getAdHocDateStr(e).substring(0,4)) === selectedYear));
    let adHocsAll = userAdHocs.filter(e => selectedYear === 'all' || parseInt(window.getAdHocDateStr(e).substring(0,4)) === selectedYear);

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
      summaryBtn.onclick = () => window.selectProject('SUMMARY'); 
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
        btn.onclick = () => window.selectProject(p.id); 
        tabsContainer.appendChild(btn);
      });
    }

    if (emptyState) emptyState.style.display = "none"; 

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
        const ownerDept = window.getUserDept(p.ownerId);
        const isOwnerDept = (targetDept === ownerDept); 
        let relevantTasks = isOwnerDept ? p.tasks : (p.tasks || []).filter(t => t.assigneeId === viewingUserId);
        let tasksForTimeline = relevantTasks.length > 0 ? relevantTasks : (p.tasks || []); 
        
        let minStart = "9999-12-31"; 
        let maxEnd = "0000-01-01"; 
        if (tasksForTimeline.length === 0) {
            minStart = window.getTodayStr();
            maxEnd = window.getTodayStr();
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
        let eDate = window.getAdHocDateStr(evt);
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
            
          row.innerHTML = `<div class="col-sum-name clickable" title="點擊前往專案：${item.title}" onclick="window.selectProject('${item.projId}')">${titleDisplay}</div><div class="col-sum-date">${item.start.substring(5)} ~ ${item.end.substring(5)}</div><div class="col-sum-prog">${statusText}</div>`;
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
              if (document.getElementById("tab-projects")?.style.display === "none") return;
              try {
                  summaryGanttInstance = new Gantt("#gantt-chart-summary", ganttTasksSum, { 
                    view_mode: 'Day', language: 'zh', header_height: 50, bar_height: 20, padding: 18, readonly: true 
                  });
                  window.patchGanttVisuals(summaryGanttInstance, '#gantt-chart-summary-container');
                  window.scrollToTodayMinus2Days(summaryGanttInstance, '#gantt-chart-summary-container'); 
              } catch(e) {}
            }, 50); 
        }
      } else { 
        lastSummaryGanttState = "";
        chartContainer.innerHTML = ''; 
      }
      return;
    }

    if(summaryView) summaryView.style.display = "none"; 
    if(detailView) detailView.style.display = "block";
    const activeProj = activeList.find(p => p.id === selectedProjectId);
    if (!activeProj) return; 

    const ownerDept = window.getUserDept(activeProj.ownerId);
    const isProjOwnerDept = (currentUserData.dept === ownerDept); 
    const isProjOwner = (activeProj.ownerId === auth.currentUser.uid);
    
    const hasCollab = (activeProj.collaborators && activeProj.collaborators.length > 0);
    const isCollabMember = hasCollab && activeProj.collaborators.includes(currentUserData.dept);
    
    const hasGlobalEdit = (currentUserData.role === 'admin' || currentUserData.canEdit === true);
    const isAuthorizedMaster = hasGlobalEdit || isProjOwnerDept; 
    const inGracePeriod = window.isWithin7DaysGracePeriod(activeProj);
    
    let canEditMainProj = isEditMode && (hasGlobalEdit || (isAuthorizedMaster && inGracePeriod));
    let editProjBtn = canEditMainProj ? `<button class="action-btn" onclick="window.openGeneralEdit('project', '${activeProj.id}')" style="margin-left:8px; padding:2px 6px; font-size:10px; border-color:var(--warning); color:var(--warning);">✏️ 編輯主資訊</button>` : '';
    
    let collabBadge = hasCollab ? `<span class="pill" style="background:#eff6ff; color:#0f172a; border:1px solid #cbd5e1; margin-left:8px;">👥 協作：<span style="color:#2563eb; font-weight:600;">${activeProj.collaborators.join(', ')}</span></span>` : '';
    
    let graceBadge = inGracePeriod ? `<span class="pill pill-success" style="font-size:11px; margin-left:8px;">🟢 自由編輯期 (剩餘 ${window.getGraceDaysLeft(activeProj)} 天)</span>` : '';

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
      const workDays = window.getWorkingDays(task.start, task.end);
      
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
          <button type="button" class="btn-sort" onclick="window.moveActiveProjectTask('${activeProj.id}', ${index}, -1)" title="上移">↑</button>
          <button type="button" class="btn-sort" onclick="window.moveActiveProjectTask('${activeProj.id}', ${index}, 1)" title="下移">↓</button>
          <button class="action-btn" onclick="window.openGeneralEdit('task', '${activeProj.id}', ${index})" style="padding:2px 5px; font-size:10px; border-color:var(--warning); color:var(--warning);" title="編輯細項">✏️</button>
          <button class="action-btn danger" onclick="window.deleteActiveProjectTask('${activeProj.id}', ${index})" style="padding:2px 5px; font-size:10px;" title="刪除此細項">🗑️</button>
        </div>` : '';

      const row = document.createElement("div"); 
      row.className = "gantt-row";
      row.innerHTML = `
        <div class="col-name" title="${task.name}"><span style="overflow:hidden; text-overflow:ellipsis;">${task.name}</span>${editHtml}</div>
        <div class="col-date">${workDays} 天</div>
        <div class="col-prog"><input type="number" min="0" max="100" value="${currentProgress}" id="prog_input_${index}" ${isInputLocked ? 'disabled' : ''}> %</div>
        <div class="col-act"><button class="action-btn btn-sm" ${isInputLocked ? 'disabled' : ''} onclick="window.confirmProgress('${activeProj.id}', ${index}, '${task.end}')">${task.isCompleted ? '完成' : '確認'}</button></div>
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
                window.patchGanttVisuals(ganttInstance, '#gantt-chart-container');
                window.scrollToTodayMinus2Days(ganttInstance, '#gantt-chart-container'); 
            } catch(e) {}
          }, 50); 
      }
    } else {
      lastDetailGanttState = "";
      chartContainer.innerHTML = '';
    }
  },
  submitNewProject: async () => {
    const title = document.getElementById("proj-name")?.value.trim();
    const color = document.getElementById("proj-color")?.value;
    if (!title) return alert("請填寫主專案名稱！");
    const collabCheckboxes = document.querySelectorAll('input[name="collab_dept"]:checked');
    const collaborators = Array.from(collabCheckboxes).map(cb => cb.value);
    const taskRows = document.querySelectorAll('.task-row'); 
    const tasks = [];
    const todayStr = window.getTodayStr(); 
    const ts = new Date().toLocaleString('zh-TW', { hour12: false });
    const myName = currentUserData.name || auth.currentUser?.email.split('@')[0];
    for (let row of taskRows) {
      const name = row.querySelector('.task-name')?.value.trim(); 
      const start = row.querySelector('.task-start')?.value; 
      const end = row.querySelector('.task-end')?.value;
      if (!name || !start || !end) return alert("任務細項不可有空白欄位！");
      if (start > end) return alert(`任務 [${name}] 的起始日不可大於完成日！`);
      let passedDays = 0; 
      if (todayStr >= start) passedDays = window.getWorkingDays(start, todayStr);
      tasks.push({ 
        name, start, end, progress: 0, isCompleted: false, completedAt: null, delayReason: "", lastUpdatedAt: ts, reportedCompleted: false, 
        assigneeId: auth.currentUser.uid, assigneeName: myName, createdAt: Date.now(), 
        history: [{ timestamp: ts, progress: 0, type: 'create', daysPassed: passedDays, delayReason: '', remark: '專案建立' }] 
      });
    }
    const targetUser = allUsersList.find(u => u.uid === viewingUserId) || { name: currentUserData.name, uid: auth.currentUser.uid };
    const ownerNameToSave = targetUser.name || currentUserData.name;
    const docRef = await addDoc(collection(db, "projects"), { 
      title, color, collaborators, ownerId: viewingUserId, ownerName: ownerNameToSave, tasks: tasks, createdAt: serverTimestamp() 
    });
    alert("🎉 新專案已成功建立！您享有 7 天免解鎖自由編輯期。");
    const pName = document.getElementById("proj-name");
    if(pName) pName.value = ""; 
    const tList = document.getElementById("task-list-container");
    if(tList) tList.innerHTML = ""; 
    window.addTaskRow(); 
    const cSec = document.getElementById('create-project-section');
    if(cSec) cSec.style.display = 'none';
    currentFilter = 'ongoing';
    document.querySelectorAll('.kpi-card').forEach(el => el.classList.remove('active'));
    const fo = document.getElementById('filter-ongoing');
    if(fo) fo.classList.add('active');
    selectedProjectId = docRef.id;
    window.triggerRenderProjects(); 
  },
  deleteActiveProjectTask: async (projId, index) => {
    const proj = allProjectsData.find(p => p.id === projId);
    if (!proj || !proj.tasks || !proj.tasks[index]) return;
    const task = proj.tasks[index];
    let taskCreatedTime = task.createdAt || (proj.createdAt && typeof proj.createdAt.toMillis === 'function' ? proj.createdAt.toMillis() : Date.now());
    let isTaskInGrace = ((Date.now() - taskCreatedTime) / (1000 * 60 * 60 * 24)) <= 7;
    const ownerDept = window.getUserDept(proj.ownerId);
    const isProjOwnerDept = (currentUserData.dept === ownerDept); 
    let isAuthorized = currentUserData.role === 'admin' || currentUserData.canEdit || ((proj.ownerId === auth.currentUser.uid || task.assigneeId === auth.currentUser.uid || isProjOwnerDept) && isTaskInGrace);
    if (!isAuthorized) return alert("⚠️ 此細項已超過 7 天編輯期限，只能請管理員協助刪除！");
    const taskName = task.name;
    if (!confirm(`⚠️ 確定要刪除任務細項「${taskName}」嗎？刪除後無法復原。`)) return;
    const tasks = [...proj.tasks];
    tasks.splice(index, 1);
    if (tasks.length === 0) {
      if (!confirm("⚠️ 該專案已無任何細項，是否要直接刪除整個專案？")) return;
      await deleteDoc(doc(db, "projects", projId));
      selectedProjectId = 'SUMMARY';
      alert("專案已刪除！");
    } else {
      await updateDoc(doc(db, "projects", projId), { tasks });
      alert("已刪除該任務細項！");
    }
  },
  openAddProjectTaskModal: () => {
    const proj = allProjectsData.find(p => p.id === selectedProjectId);
    if (!proj) return;
    const hasCollab = (proj.collaborators && proj.collaborators.length > 0);
    document.getElementById("project-task-modal-title").innerText = hasCollab ? "➕ 協作細項" : "➕ 新增細項";
    document.getElementById("project-task-modal-hint").innerText = hasCollab 
      ? "* 送出後，此細項負責人將自動設定為您的帳號。" : "* 新增後自動加入目前專案中。";
    document.getElementById("add-task-name").value = "";
    document.getElementById("add-task-start").value = "";
    document.getElementById("add-task-days").value = "1";
    document.getElementById("add-task-end").value = "";
    document.getElementById("project-task-modal").classList.add("active");
  },
  closeAddProjectTaskModal: () => { document.getElementById("project-task-modal").classList.remove("active"); },
  submitAddProjectTask: async () => {
    const name = document.getElementById("add-task-name").value.trim();
    const start = document.getElementById("add-task-start").value;
    const end = document.getElementById("add-task-end").value;
    if (!name || !start || !end) return alert("任務細項欄位不可有空白！");
    if (start > end) return alert("起始日不可大於結束日！");
    const proj = allProjectsData.find(p => p.id === selectedProjectId);
    if (!proj) return alert("找不到目前專案！");
    const todayStr = window.getTodayStr();
    const ts = new Date().toLocaleString('zh-TW', { hour12: false });
    let passedDays = 0;
    if (todayStr >= start) passedDays = window.getWorkingDays(start, todayStr);
    const newTask = {
      name, start, end, progress: 0, isCompleted: false, completedAt: null, delayReason: "", lastUpdatedAt: ts, reportedCompleted: false, 
      assigneeId: auth.currentUser.uid, assigneeName: currentUserData.name || auth.currentUser.email.split('@')[0], createdAt: Date.now(), 
      history: [{ timestamp: ts, progress: 0, type: 'create', daysPassed: passedDays, delayReason: '', remark: '追加任務細項' }]
    };
    const updatedTasks = [...proj.tasks];
    let insertIndex = updatedTasks.length; 
    for (let i = 0; i < updatedTasks.length; i++) {
      if (start < updatedTasks[i].start) { insertIndex = i; break; }
    }
    updatedTasks.splice(insertIndex, 0, newTask);
    await updateDoc(doc(db, "projects", proj.id), { tasks: updatedTasks });
    window.closeAddProjectTaskModal();
    alert("🎉 任務細項追加成功！(已自動依日期排序)");
  },
  openCustomPrompt: (title, label, isRequired) => {
    return new Promise((resolve) => {
      document.getElementById('delay-reason-title').innerText = title;
      document.getElementById('delay-reason-label').innerText = label;
      document.getElementById('delay-reason-input').value = '';
      document.getElementById('delay-reason-input').dataset.required = isRequired;
      document.getElementById('delay-reason-input').placeholder = isRequired ? "請輸入原因 (必填)..." : "請輸入備註 (選填)...";
      document.getElementById('delay-reason-modal').classList.add('active');
      document.getElementById('delay-reason-input').focus();
      window.resolveDelayPrompt = resolve;
    });
  },
  closeDelayModal: () => {
    document.getElementById('delay-reason-modal').classList.remove('active');
    if (window.resolveDelayPrompt) window.resolveDelayPrompt(null);
  },
  submitDelayReason: () => {
    const val = document.getElementById('delay-reason-input').value.trim();
    const isReq = document.getElementById('delay-reason-input').dataset.required === 'true';
    if (isReq && !val) return alert("此為必填欄位，請務必填寫原因！");
    document.getElementById('delay-reason-modal').classList.remove('active');
    if (window.resolveDelayPrompt) window.resolveDelayPrompt(val);
  },
  confirmProgress: async (projId, taskIndex, plannedEnd) => {
    const proj = allProjectsData.find(p => p.id === projId);
    const tasks = [...proj.tasks];
    const targetTask = tasks[taskIndex];
    const ownerDept = window.getUserDept(proj.ownerId);
    const isOwnerDept = (currentUserData.dept === ownerDept); 
    const taskAssigneeId = targetTask.assigneeId || proj.ownerId;
    const isMyTask = (auth.currentUser.uid === taskAssigneeId);
    if (!isOwnerDept && !isMyTask && currentUserData.role !== 'admin') {
      return alert("權限不足：您並非此任務細項之負責人或專案建立部門，無法更新進度！");
    }
    const inputElem = document.getElementById(`prog_input_${taskIndex}`);
    let newProg = parseInt(inputElem.value); 
    const oldProg = targetTask.progress || 0;
    if (isNaN(newProg) || newProg < 0) newProg = 0; 
    if (newProg > 100) newProg = 100;
    if (newProg < oldProg) { 
      alert(`錯誤：進度不能往回倒扣！目前已達成 ${oldProg}%。`); 
      inputElem.value = oldProg; 
      return; 
    }
    const todayStr = window.getTodayStr();
    const ts = new Date().toLocaleString('zh-TW', { hour12: false });
    let passedDays = 0; 
    if (todayStr >= targetTask.start) passedDays = window.getWorkingDays(targetTask.start, todayStr);
    let delayReason = targetTask.delayReason || ""; 
    let currentRemark = "";
    if (newProg === 100) {
      if (todayStr > plannedEnd && !delayReason) {
        delayReason = await window.openCustomPrompt("⚠️ 任務已 Delay", "此任務已超出預計完成日，請填寫 Delay 原因 (必填)：", true);
        if (delayReason === null) { inputElem.value = oldProg; return; }
      } else {
        currentRemark = await window.openCustomPrompt("🎉 任務結案", "即將結案！可填寫結案備註 (選填)：", false);
        if (currentRemark === null) { inputElem.value = oldProg; return; }
      }
      targetTask.isCompleted = true; 
      targetTask.completedAt = ts; 
      targetTask.delayReason = delayReason;
      alert("🎉 進度已達 100%！該任務已結案。");
    } else { 
      currentRemark = await window.openCustomPrompt("📝 進度更新", "請輸入此次進度更新的備註事項 (選填)：", false);
      if (currentRemark === null) { inputElem.value = oldProg; return; }
      targetTask.isCompleted = false; 
      targetTask.completedAt = null; 
    }
    targetTask.progress = newProg; 
    targetTask.lastUpdatedAt = ts;
    if (!targetTask.history) targetTask.history = [];
    targetTask.history.push({ timestamp: ts, progress: newProg, type: newProg === 100 ? 'complete' : 'update', daysPassed: passedDays, remark: currentRemark, delayReason: delayReason || "" });
    await updateDoc(doc(db, "projects", projId), { tasks });
    if(newProg !== 100) alert(`進度已更新為 ${newProg}%`);
  },
  deleteCurrentProject: async () => { 
    const p = allProjectsData.find(x => x.id === selectedProjectId);
    const inGrace = p && (auth.currentUser.uid === p.ownerId) && window.isWithin7DaysGracePeriod(p);
    if (currentUserData.role !== 'admin' && !currentUserData.canEdit && !inGrace) return alert("權限不足！專案主檔已超過 7 天寬限期，請聯繫管理員刪除。");
    if (!confirm("⚠️ 確定要永久刪除此專案嗎？")) return; 
    await deleteDoc(doc(db, "projects", selectedProjectId)); 
    alert("專案已刪除！"); 
    selectedProjectId = 'SUMMARY'; 
    window.triggerRenderProjects(); 
  },
  completeAdHoc: async (id) => { await updateDoc(doc(db, "ad_hoc_events", id), { isCompleted: true, completedAt: new Date().toLocaleString() }); },
  deleteAdHoc: async (id) => { 
    if (currentUserData.role !== 'admin') return alert("權限不足！");
    if(confirm("確定刪除此紀錄？")) await deleteDoc(doc(db, "ad_hoc_events", id)); 
  },
  submitWeeklyReport: async () => {
    try {
      const today = new Date();
      const days = ['日', '一', '二', '三', '四', '五', '六'];
      let dateStr = document.getElementById("rep-date")?.value || `${today.getFullYear()}/${today.getMonth() + 1}/${today.getDate()} (${days[today.getDay()]})`; 

      let leaveType = "";
      let leaveReason = "";
      const leaveContainer = document.getElementById("leave-options-container");
      
      if (leaveContainer && leaveContainer.style.display === "flex") {
        const checked = document.querySelector('input[name="leave_type"]:checked');
        if (!checked) return alert("【注意】星期一至四提交週報，請務必勾選右側的請假或其他原因！");
        leaveType = checked.value;
        if (leaveType === "other") {
          leaveReason = document.getElementById("leave-other-reason")?.value.trim();
          if (!leaveReason) return alert("請填寫「其他」選項的理由說明！");
        }
      }

      const rows = document.querySelectorAll('.weekly-item-row'); 
      const items = [];
      let hasIncomplete = false;

      rows.forEach(r => {
        const pSel = r.querySelector('.weekly-proj-select'); 
        const tSel = r.querySelector('.weekly-task-select'); 
        const content = r.querySelector('.weekly-content')?.value.trim();
        
        if (pSel?.value || tSel?.value || content) {
          if (pSel?.value && tSel?.value && content) {
            items.push({ projectId: pSel.value, projectName: pSel.options[pSel.selectedIndex].text, taskId: tSel.value, taskName: tSel.options[tSel.selectedIndex].text, content: content });
          } else {
            hasIncomplete = true;
          }
        }
      });

      if (hasIncomplete) return alert("您有填寫到一半的進度項目，請確認填寫完整 (包含專案、細項與說明)，或將該列的文字清空/刪除！");
      if (items.length === 0 && !leaveType) return alert("請完整填寫至少一項任務進度說明！");

      const targetUser = allUsersList.find(u => u.uid === viewingUserId) || { name: currentUserData.name, supervisorId: null };
      const supervisorId = targetUser.supervisorId || null; 
      const currentOwnerId = viewingUserId || auth.currentUser?.uid;

      await addDoc(collection(db, "weekly_reports"), { 
        ownerId: currentOwnerId, ownerName: targetUser.name || '', ownerSupervisorId: supervisorId, reportDate: dateStr, 
        items: items, leaveType: leaveType || "", leaveReason: leaveReason || "", createdAt: serverTimestamp(), 
        supervisorNoted: false, topManagerNoted: false 
      });
      
      const projectUpdates = {};
      for (let item of items) {
        const p = allProjectsData.find(x => x.id === item.projectId);
        if (p) {
          const tIndex = parseInt(item.taskId);
          if (p.tasks[tIndex] && p.tasks[tIndex].isCompleted && !p.tasks[tIndex].reportedCompleted) {
            if (!projectUpdates[p.id]) projectUpdates[p.id] = [...p.tasks];
            projectUpdates[p.id][tIndex].reportedCompleted = true;
          }
        }
      }
      for (let pId in projectUpdates) await updateDoc(doc(db, "projects", pId), { tasks: projectUpdates[pId] });
      
      window.initWeeklyDateAndLeave(); 
      const wContainer = document.getElementById("weekly-items-container");
      if(wContainer) wContainer.innerHTML = ""; 
      window.addWeeklyRow(); 
      alert("週報已成功送出！在主管未閱讀前，您有 2 天修改寬限期。");
      
    } catch (err) {
      console.error("送出週報錯誤：", err);
      alert("發生系統錯誤導致無法送出：" + err.message);
    }
  },
  deleteWeekly: async (id) => { 
    const report = allWeeklyData.find(w => w.id === id);
    if (!report) return;
    const isOwner = (report.ownerId === auth.currentUser.uid);
    const isAllowed = window.isWeeklyReportEditable(report);
    if (!isOwner && currentUserData.role !== 'admin') return alert("權限不足！");
    if (isOwner && !isAllowed && currentUserData.role !== 'admin') return alert("此週報已逾 2 天或已經主管審閱鎖定，無法刪除！");
    if(confirm("確定永久刪除此週報嗎？")) await deleteDoc(doc(db, "weekly_reports", id)); 
  },
  openWeeklyModal: (id) => {
    currentWeeklyReportId = id; 
    const report = allWeeklyData.find(w => w.id === id); 
    if(!report) return;
    let leaveTag = '';
    if (report.leaveType === 'leave') leaveTag = `<span class="pill pill-danger" style="margin-left:12px; font-size:12px;">📌 原因：請假</span>`;
    else if (report.leaveType === 'other') leaveTag = `<span class="pill pill-warning" style="margin-left:12px; font-size:12px;">📌 原因：${report.leaveReason}</span>`;
    const days = ['日', '一', '二', '三', '四', '五', '六'];
    let fillTimeStr = '-';
    if (report.createdAt) {
      const d = report.createdAt.toDate();
      const yyyy = d.getFullYear(); const mm = d.getMonth() + 1; const dd = d.getDate();
      let hours = d.getHours(); let ampm = hours >= 12 ? '下午' : '上午';
      hours = hours % 12; hours = hours ? hours : 12; 
      let minutes = String(d.getMinutes()).padStart(2, '0'); let seconds = String(d.getSeconds()).padStart(2, '0');
      fillTimeStr = `${yyyy}/${mm}/${dd} ${ampm}${hours}:${minutes}:${seconds} (${days[d.getDay()]})`;
    }
    let contentHtml = `<div style="margin-bottom:16px;"><div style="font-size:16px; font-weight:bold; margin-bottom:4px;">${report.ownerName} 的工作週報</div><div style="font-size:13px; color:var(--text-muted); display:flex; align-items:center;">填寫時間：${fillTimeStr} ${leaveTag}</div></div>`;
    if (report.items && report.items.length > 0) {
      report.items.forEach((item, i) => { 
        contentHtml += `<div style="display:flex; gap:16px; margin-bottom: 12px; padding: 14px; background: #f8fafc; border: 1px solid var(--border); border-radius: 8px; align-items:flex-start;"><div style="flex:1; font-size:13px; font-weight:600; color:var(--primary); border-right: 1px dashed var(--border-light); padding-right:12px;"><div style="margin-bottom:6px; word-break: break-all;">🗂️ ${item.projectName}</div><div style="word-break: break-all;">📌 ${item.taskName}</div></div><div style="flex:2.5; font-size:13px; white-space:pre-wrap; line-height:1.6; padding-left:4px;">${item.content}</div></div>`; 
      });
    } else if (report.content) {
      contentHtml += `<div style="padding: 12px; font-size:13px; white-space:pre-wrap; background: #f8fafc; border-radius: 8px; line-height:1.6;">${report.content}</div>`;
    } else {
      contentHtml += `<div style="padding: 16px; font-size:13px; color:var(--text-muted); background: #f8fafc; border-radius: 8px; text-align:center;">(本日無填寫專案進度)</div>`;
    }
    document.getElementById('weekly-detail-content').innerHTML = contentHtml;
    const btnSup = document.getElementById('btn-supervisor-note'); 
    const btnTop = document.getElementById('btn-topmanager-note');
    if(btnSup) btnSup.style.display = 'none'; 
    if(btnTop) btnTop.style.display = 'none';
    const ownerUser = allUsersList.find(u => u.uid === report.ownerId);
    const isDirectSupervisor = ownerUser && (ownerUser.supervisorId === auth.currentUser.uid);
    const isTopManager = currentUserData.role === 'top_manager' || currentUserData.role === 'admin'; 
    if (isDirectSupervisor && !report.supervisorNoted && btnSup) btnSup.style.display = 'inline-block';
    if (isTopManager && !report.topManagerNoted && btnTop) btnTop.style.display = 'inline-block';
    document.getElementById('weekly-detail-modal').classList.add('active');
  },
  closeWeeklyModal: () => document.getElementById('weekly-detail-modal')?.classList.remove('active'),
  markWeeklyNoted: async (type) => {
    if(!currentWeeklyReportId) return; 
    const updateData = {};
    if(type === 'supervisor') updateData.supervisorNoted = true; 
    if(type === 'top_manager') updateData.topManagerNoted = true;
    await updateDoc(doc(db, "weekly_reports", currentWeeklyReportId), updateData);
    window.closeWeeklyModal(); 
    alert('已成功標記為 Noted (已閱)！該週報自此鎖定。');
  },
  openGeneralEdit: (type, id, extra) => {
    let isAuthorized = false;
    if (type === 'project' || type === 'task') {
      const p = allProjectsData.find(x => x.id === id);
      if (p) {
        if (currentUserData.role === 'admin' || currentUserData.canEdit) isAuthorized = true;
        if (type === 'task') {
          const t = p.tasks[extra];
          let tCreatedTime = t.createdAt || (p.createdAt && typeof p.createdAt.toMillis === 'function' ? p.createdAt.toMillis() : Date.now());
          let tInGrace = ((Date.now() - tCreatedTime) / (1000 * 60 * 60 * 24)) <= 7;
          let isMyTask = (auth.currentUser.uid === (t.assigneeId || p.ownerId));
          const ownerDept = window.getUserDept(p.ownerId);
          let isOwnerDept = (currentUserData.dept === ownerDept);
          if ((isOwnerDept || isMyTask) && tInGrace) isAuthorized = true;
        } else if (type === 'project') {
          const ownerDept = window.getUserDept(p.ownerId);
          const isOwnerDept = (currentUserData.dept === ownerDept);
          if (isOwnerDept && window.isWithin7DaysGracePeriod(p)) isAuthorized = true;
        }
      }
    } else if (type === 'weekly') {
      const w = allWeeklyData.find(x => x.id === id);
      if ((currentUserData.role === 'admin' || currentUserData.canEdit) || (w && w.ownerId === auth.currentUser.uid && window.isWeeklyReportEditable(w))) isAuthorized = true;
    } else if (type === 'adhoc') {
      if (currentUserData.role === 'admin' || currentUserData.canEdit) isAuthorized = true;
    }
    if (!isAuthorized) return alert("權限不足：您無法編輯此資料 (可能已超過 7 天寬限期)！");
    currentEditData = { type, id, extra };
    const form = document.getElementById("general-edit-form"); 
    if(!form) return;
    form.innerHTML = "";
    if (type === 'project') {
      const p = allProjectsData.find(x => x.id === id);
      const titleElem = document.getElementById("general-edit-title");
      if(titleElem) titleElem.innerText = "編輯主專案名稱與協作部門";
      let collabHtml = `<div class="form-group" style="margin-top:12px;"><label class="form-label">協作部門 (可複選)</label><div style="display:flex; flex-direction:column; gap:6px;">`;
      departmentList.forEach(dept => {
        const isChecked = (p.collaborators || []).includes(dept) ? 'checked' : '';
        collabHtml += `<label style="display:flex; align-items:center; gap:6px; cursor:pointer;"><input type="checkbox" name="edit_collab" value="${dept}" ${isChecked}> <span>${dept}</span></label>`;
      });
      collabHtml += `</div></div>`;
      form.innerHTML = `<div class="form-group"><label class="form-label">專案名稱</label><input type="text" id="edit-val-proj-title" class="input-control" value="${p.title}"></div>${collabHtml}`;
    } else if (type === 'task') {
      const proj = allProjectsData.find(p => p.id === id); 
      const task = proj.tasks[extra];
      const taskDays = window.getWorkingDays(task.start, task.end);
      const titleElem = document.getElementById("general-edit-title");
      if(titleElem) titleElem.innerText = "編輯專案細項";
      form.innerHTML = `
        <div class="form-group"><label class="form-label">細項名稱</label><input type="text" id="edit-val-name" class="input-control" value="${task.name}"></div>
        <div class="form-row">
          <div class="form-group" style="flex:1.2;"><label class="form-label">開始日期</label><input type="date" id="edit-val-start" class="input-control" value="${task.start}" onchange="window.onTaskStartChange(this, 'edit-val-end')"></div>
          <div class="form-group" style="width:65px; flex-shrink:0;"><label class="form-label">天數</label><input type="number" min="1" id="edit-val-days" class="input-control task-days" value="${taskDays}" oninput="window.onTaskDaysChange(this, 'edit-val-start', 'edit-val-end')"></div>
          <div class="form-group" style="flex:1.2;"><label class="form-label">結束日期</label><input type="date" id="edit-val-end" class="input-control" value="${task.end}" min="${task.start}" onchange="window.onTaskEndChange(this, 'edit-val-start', 'edit-val-days')"></div>
        </div>
      `;
    } else if (type === 'adhoc') {
      const adhoc = allAdHocData.find(a => a.id === id);
      const titleElem = document.getElementById("general-edit-title");
      if(titleElem) titleElem.innerText = "編輯事件紀錄";
      form.innerHTML = `
        <div class="form-group"><label class="form-label">事項名稱</label><input type="text" id="edit-val-title" class="input-control" value="${adhoc.title}"></div>
        <div class="form-group"><label class="form-label">開始日期</label><input type="date" id="edit-val-start" class="input-control" value="${adhoc.startDate || ''}"></div>
        <div class="form-group"><label class="form-label">原因說明</label><input type="text" id="edit-val-reason" class="input-control" value="${adhoc.reason}"></div>
      `;
    } else if (type === 'weekly') {
      const weekly = allWeeklyData.find(w => w.id === id);
      const titleElem = document.getElementById("general-edit-title");
      if(titleElem) titleElem.innerText = "編輯週報內容";
      let html = `<div style="display:flex; flex-direction:column; gap:12px; max-height:400px; overflow-y:auto;">`;
      const userProjects = allProjectsData.filter(p => p.ownerId === weekly.ownerId);
      if (weekly.items && weekly.items.length > 0) {
        weekly.items.forEach((item, idx) => {
          let projOptions = `<option value="">-- 請選擇專案 --</option>`;
          userProjects.forEach(p => { projOptions += `<option value="${p.id}" ${p.id === item.projectId ? 'selected' : ''}>${p.title}</option>`; });
          const activeProj = allProjectsData.find(p => p.id === item.projectId);
          let taskOptions = `<option value="">-- 請選擇細項 --</option>`;
          if (activeProj && activeProj.tasks) {
            activeProj.tasks.forEach((t, tIdx) => { taskOptions += `<option value="${tIdx}" ${String(tIdx) === String(item.taskId) ? 'selected' : ''}>${t.name}</option>`; });
          }
          html += `
            <div class="form-group" style="padding:12px; background:#f8fafc; border:1px solid var(--border); border-radius:8px; margin-bottom:0;">
              <div class="form-row" style="margin-bottom:8px;">
                <div class="form-group" style="flex:1; margin-bottom:0;">
                  <label class="form-label" style="font-size:12px;">主專案</label>
                  <select id="edit-weekly-proj-${idx}" class="input-control" style="font-size:12px; padding:6px 8px;" onchange="window.onEditWeeklyProjChange(${idx})">${projOptions}</select>
                </div>
                <div class="form-group" style="flex:1; margin-bottom:0;">
                  <label class="form-label" style="font-size:12px;">任務細項</label>
                  <select id="edit-weekly-task-${idx}" class="input-control" style="font-size:12px; padding:6px 8px;">${taskOptions}</select>
                </div>
              </div>
              <label class="form-label" style="font-size:12px;">進度說明</label>
              <textarea id="edit-val-item-${idx}" class="input-control" rows="3" style="font-size:13px;">${item.content}</textarea>
            </div>
          `;
        });
      } else {
        html += `<div style="color:var(--text-muted); text-align:center; padding: 20px;">無可編輯的專案進度項目</div>`;
      }
      html += `</div>`;
      form.innerHTML = html;
    }
    document.getElementById("general-edit-modal")?.classList.add("active");
  },
  saveGeneralEdit: async () => {
    const { type, id, extra } = currentEditData;
    try {
      if (type === 'project') {
        const title = document.getElementById("edit-val-proj-title")?.value.trim();
        const checkboxes = document.querySelectorAll('input[name="edit_collab"]:checked');
        const collaborators = Array.from(checkboxes).map(cb => cb.value);
        if (title) await updateDoc(doc(db, "projects", id), { title, collaborators });
        else return alert("專案名稱不可為空！");
      } else if (type === 'task') {
        const proj = allProjectsData.find(p => p.id === id); 
        const tasks = [...proj.tasks];
        tasks[extra].name = document.getElementById("edit-val-name")?.value.trim();
        tasks[extra].start = document.getElementById("edit-val-start")?.value;
        tasks[extra].end = document.getElementById("edit-val-end")?.value;
        await updateDoc(doc(db, "projects", id), { tasks });
      } else if (type === 'adhoc') {
        await updateDoc(doc(db, "ad_hoc_events", id), {
          title: document.getElementById("edit-val-title")?.value.trim(),
          startDate: document.getElementById("edit-val-start")?.value,
          reason: document.getElementById("edit-val-reason")?.value.trim()
        });
      } else if (type === 'weekly') {
        const weekly = allWeeklyData.find(w => w.id === id);
        const updateData = {};
        if (weekly.items && weekly.items.length > 0) {
          const newItems = [];
          for (let idx = 0; idx < weekly.items.length; idx++) {
            const pSel = document.getElementById(`edit-weekly-proj-${idx}`);
            const tSel = document.getElementById(`edit-weekly-task-${idx}`);
            const content = document.getElementById(`edit-val-item-${idx}`)?.value.trim();
            const pId = pSel ? pSel.value : weekly.items[idx].projectId;
            const pName = pSel && pSel.selectedIndex >= 0 ? pSel.options[pSel.selectedIndex].text : weekly.items[idx].projectName;
            const tId = tSel ? tSel.value : weekly.items[idx].taskId;
            const tName = tSel && tSel.selectedIndex >= 0 ? tSel.options[tSel.selectedIndex].text : weekly.items[idx].taskName;
            newItems.push({ projectId: pId, projectName: pName, taskId: tId, taskName: tName, content: content });
          }
          updateData.items = newItems;
        }
        await updateDoc(doc(db, "weekly_reports", id), updateData);
      }
      document.getElementById("general-edit-modal")?.classList.remove("active"); 
      alert("✅ 資料修改成功！");
    } catch (err) { alert("修改失敗：" + err.message); }
  },
  toggleUserEditPermission: async (uid, checked) => {
    if (currentUserData.role !== 'admin') return alert('權限不足！');
    try { await updateDoc(doc(db, "users", uid), { canEdit: checked }); } catch(err) { alert('設定失敗：'+err.message); }
  },
  resetUserPassword: (email) => {
    if (confirm(`確定要發送「重設密碼」信件至 ${email} 嗎？\n系統將寄送一封專屬連結信件，員工點擊後即可自行重設密碼。`)) {
      sendPasswordResetEmail(auth, email).then(() => alert(`✅ 重設密碼信件已成功發送至：${email}\n請員工前往信箱收信。`)).catch(err => alert("發送失敗: " + err.message));
    }
  },
  rescueUserProjects: async (uid, userName) => {
    if (!userName) return alert("請先為該人員設定姓名！");
    if (!confirm(`【資料救援】\n即將掃描系統中所有署名為「${userName}」的舊專案與事件，強制綁回給這個帳號。\n確定要進行修復嗎？`)) return;
    try {
      let pCount = 0, wCount = 0;
      for (let p of allProjectsData) { if (p.ownerName === userName && p.ownerId !== uid) { await updateDoc(doc(db, "projects", p.id), { ownerId: uid }); pCount++; } }
      for (let w of allWeeklyData) { if (w.ownerName === userName && w.ownerId !== uid) { await updateDoc(doc(db, "weekly_reports", w.id), { ownerId: uid }); wCount++; } }
      for (let a of allAdHocData) { if (a.ownerName === userName && a.ownerId !== uid) { await updateDoc(doc(db, "ad_hoc_events", a.id), { ownerId: uid }); } }
      alert(`🎉 救援成功！\n已為「${userName}」找回：\n- ${pCount} 個專案\n- ${wCount} 份週報\n請重新點擊左側人員檢視查看。`);
    } catch (err) { alert("救援失敗：" + err.message); }
  },
  openEditModal: (uid) => {
    const u = allUsersList.find(x => x.uid === uid);
    document.getElementById("edit-user-uid").value = u.uid; 
    document.getElementById("edit-user-name").value = u.name || ''; 
    document.getElementById("edit-user-dept").value = u.dept || '設計部';
    document.getElementById("edit-user-role").value = u.role || 'staff';
    const supSelect = document.getElementById("edit-user-supervisor"); 
    if(supSelect) {
      supSelect.innerHTML = '<option value="">-- 無 --</option>';
      allUsersList.forEach(user => { 
        if (user.uid !== uid && ["top_manager", "manager", "assistant_manager"].includes(user.role)) {
          supSelect.innerHTML += `<option value="${user.uid}">${user.name}</option>`;
        }
      });
      supSelect.value = u.supervisorId || ''; 
    }
    document.getElementById("edit-user-modal")?.classList.add("active");
  },
  deleteUserDoc: async (uid, name) => { 
    if (currentUserData.role !== 'admin') return alert("權限不足！");
    if (confirm(`確定刪除 ${name} 嗎？`)) { 
      try { await deleteDoc(doc(db, "users", uid)); alert(`已移除 ${name}！`); } catch (err) { alert("刪除失敗: " + err.message); } 
    } 
  },
  closeGeneralEditModal: () => document.getElementById("general-edit-modal")?.classList.remove("active"),
  onEditWeeklyProjChange: (idx) => {
    const pSel = document.getElementById(`edit-weekly-proj-${idx}`);
    const tSel = document.getElementById(`edit-weekly-task-${idx}`);
    if (!pSel || !tSel) return;
    tSel.innerHTML = '<option value="">-- 請選擇細項 --</option>';
    const proj = allProjectsData.find(p => p.id === pSel.value);
    if (proj && proj.tasks) {
      proj.tasks.forEach((t, tIdx) => {
        tSel.innerHTML += `<option value="${tIdx}">${t.name}</option>`;
      });
    }
  },
  switchOrgView: (viewType) => {
    const chartContainer = document.getElementById("org-chart-view-container");
    const tableContainer = document.getElementById("org-table-view-container");
    const btnChart = document.getElementById("btn-view-org-chart");
    const btnTable = document.getElementById("btn-view-org-table");
    if (!chartContainer || !tableContainer) return;
    if (viewType === 'chart') {
      chartContainer.style.display = "block"; tableContainer.style.display = "none";
      if (btnChart) btnChart.classList.add("active");
      if (btnTable) btnTable.classList.remove("active");
      window.renderOrgChart();
    } else {
      chartContainer.style.display = "none"; tableContainer.style.display = "block";
      if (btnTable) btnTable.classList.add("active");
      if (btnChart) btnChart.classList.remove("active");
    }
  }
});

// 最後確保所有視窗啟動函式綁定完畢
window.submitUpdatePassword = async () => {
  const newPass = document.getElementById("profile-new-pass")?.value;
  const confirmPass = document.getElementById("profile-confirm-pass")?.value;

  if (!newPass || newPass.length < 6) return alert("新密碼至少需要 6 個字元！");
  if (newPass !== confirmPass) return alert("兩次輸入的密碼不一致！");

  if (!confirm("確定要更改您的登入密碼嗎？")) return;

  try {
    await updatePassword(auth.currentUser, newPass);
    alert("✅ 密碼更換成功！下次登入請使用新密碼。");
    const np = document.getElementById("profile-new-pass");
    if(np) np.value = "";
    const cp = document.getElementById("profile-confirm-pass");
    if(cp) cp.value = "";
  } catch (error) {
    if (error.code === 'auth/requires-recent-login') {
      alert("⚠️ 基於安全考量，更換密碼需要您『最近剛登入過』。\n請先點擊右上角登出，重新使用舊密碼登入後，再嘗試修改密碼！");
    } else {
      alert("密碼更換失敗：" + error.message);
    }
  }
};
