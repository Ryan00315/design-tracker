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
// 🚀 工具函式區
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

let renderTimer = null;
window.triggerRenderProjects = function() {
  if (renderTimer) clearTimeout(renderTimer);
  renderTimer = setTimeout(() => {
      if (auth.currentUser) window.renderProjects();
  }, 150); 
};

// ==========================================
// 🚀 UI 介面與按鈕事件綁定
// ==========================================
function initDynamicUI() {
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

  const taskContainer = document.getElementById("task-list-container");
  if (taskContainer && !document.getElementById("template-section-wrapper")) {
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
  }

  if (!document.getElementById('template-edit-modal')) {
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
     document.body.insertAdjacentHTML('beforeend', html);
  }
}

function bindStaticEvents() {
  document.getElementById("btn-login")?.addEventListener("click", (e) => {
    e.preventDefault();
    const email = document.getElementById("login-email")?.value.trim();
    const pass = document.getElementById("login-password")?.value.trim();
    if (!email || !pass) return alert("請填寫帳號密碼！");
    signInWithEmailAndPassword(auth, email, pass).catch(err => alert("登入失敗: " + err.message));
  });

  document.getElementById("btn-logout")?.addEventListener("click", (e) => {
    e.preventDefault();
    signOut(auth);
  });

  document.getElementById("btn-toggle-edit-mode")?.addEventListener("click", (e) => {
    e.preventDefault();
    if (!auth.currentUser) return;
    isEditMode = !isEditMode;
    const btn = document.getElementById("btn-toggle-edit-mode");
    if (isEditMode) {
      btn.innerHTML = "❌ 關閉編輯模式"; 
      btn.style.background = "var(--warning-bg)";
    } else {
      btn.innerHTML = "✏️ 開啟編輯模式"; 
      btn.style.background = "transparent";
    }
    window.triggerRenderProjects(); 
    window.renderAdHocEvents(); 
    window.renderWeeklyReports();
  });

  document.getElementById('btn-toggle-create')?.addEventListener('click', (e) => {
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
      
      window.renderCollabCheckboxes([]);
      const taskContainer = document.getElementById("task-list-container");
      if(taskContainer) taskContainer.innerHTML = "";
      window.addTaskRow();
      window.renderTemplateSelect();
    }
  });

  document.getElementById("btn-add-project")?.addEventListener("click", async (e) => {
    e.preventDefault();
    await window.submitNewProject();
  });

  document.getElementById("btn-add-adhoc")?.addEventListener("click", async (e) => {
    e.preventDefault();
    await window.submitNewAdHoc();
  });

  document.getElementById("btn-add-weekly")?.addEventListener("click", async (e) => {
    e.preventDefault();
    await window.submitWeeklyReport();
  });

  document.getElementById("btn-create-user")?.addEventListener("click", async (e) => {
    e.preventDefault();
    await window.submitCreateUser();
  });

  document.getElementById("btn-update-password")?.addEventListener("click", async (e) => {
    e.preventDefault();
    await window.submitUpdatePassword();
  });
}

// ==========================================
// 🚀 核心身分驗證與啟動區 (重要：負責打開資料水龍頭)
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

    window.initWeeklyDateAndLeave(); 
    window.addTaskRow(); 
    window.addWeeklyRow(); 
    
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
    if (currentUserData.role !== 'staff') window.renderSidebarSubordinates();
    if (currentUserData.role === 'admin') window.renderOrgUsersTable();
    window.triggerRenderProjects();
  }));

  firebaseUnsubscribers.push(onSnapshot(doc(db, "settings", "project_templates"), (docSnap) => {
    if (docSnap.exists() && Object.keys(docSnap.data()).length > 0) {
      projectTemplates = { ...projectTemplates, ...docSnap.data() };
    }
    window.renderTemplateSelect();
  }));

  firebaseUnsubscribers.push(onSnapshot(query(collection(db, "projects")), (snapshot) => {
    allProjectsData = []; 
    snapshot.forEach(docSnap => allProjectsData.push({ id: docSnap.id, ...docSnap.data() })); 
    window.triggerRenderProjects(); 
    window.refreshAllWeeklyProjSelects();
  }));

  firebaseUnsubscribers.push(onSnapshot(query(collection(db, "ad_hoc_events")), (snapshot) => {
    allAdHocData = []; 
    snapshot.forEach(docSnap => allAdHocData.push({ id: docSnap.id, ...docSnap.data() })); 
    window.renderAdHocEvents(); 
    window.triggerRenderProjects();
  }));

  firebaseUnsubscribers.push(onSnapshot(query(collection(db, "weekly_reports")), (snapshot) => {
    allWeeklyData = []; 
    snapshot.forEach(docSnap => allWeeklyData.push({ id: docSnap.id, ...docSnap.data() })); 
    window.renderWeeklyReports(); 
    window.refreshAllWeeklyProjSelects();
  }));

  firebaseUnsubscribers.push(onSnapshot(query(collection(db, "calendar_todos"), where("ownerId", "==", uid)), (snapshot) => {
    myCalendarTodos = [];
    snapshot.forEach(docSnap => myCalendarTodos.push({ id: docSnap.id, ...docSnap.data() }));
    window.renderCalendar();
    if (activeCalDateStr) window.renderCalTodosModal(activeCalDateStr);
  }));
}

document.addEventListener("DOMContentLoaded", () => {
  initDynamicUI();
  bindStaticEvents();
});
if (document.readyState === "complete" || document.readyState === "interactive") {
  initDynamicUI();
  bindStaticEvents();
}

// ==========================================
// 🚀 全域視窗函式掛載區 (Global functions)
// ==========================================
window.setProjectFilter = function(status) {
  currentFilter = status;
  document.querySelectorAll('.kpi-card').forEach(el => el.classList.remove('active'));
  const activeBtn = document.getElementById('filter-' + status);
  if (activeBtn) activeBtn.classList.add('active');
  selectedProjectId = 'SUMMARY'; 
  window.triggerRenderProjects();
};

window.selectProject = function(projId) { 
  selectedProjectId = projId; 
  isEditMode = false;
  const editBtn = document.getElementById("btn-toggle-edit-mode");
  if (editBtn) {
     editBtn.innerHTML = "✏️ 開啟編輯模式";
     editBtn.style.background = "transparent";
  }
  window.triggerRenderProjects(); 
};

window.switchNav = function(tabId, title, elem) {
  document.querySelectorAll('.tab-pane').forEach(el => el.style.display = 'none');
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  const targetPane = document.getElementById(tabId);
  if (targetPane) targetPane.style.display = 'block';
  if (elem) elem.classList.add('active');
  const tTitle = document.getElementById('current-title');
  if (tTitle) tTitle.innerText = title;
  
  if (tabId === 'tab-projects') window.triggerRenderProjects();
  if (tabId === 'tab-weekly') window.initWeeklyDateAndLeave(); 
  if (tabId === 'tab-calendar') {
    window.initCalendarSelectors();
    window.renderCalendar();
  }
};

window.checkEditModeVisibility = function() {
  const btn = document.getElementById("btn-toggle-edit-mode");
  if (!btn || !auth.currentUser) return;

  let shouldShow = false;

  if (currentUserData.role === 'admin' || currentUserData.canEdit) {
    shouldShow = true;
  } else {
    if (selectedProjectId !== 'SUMMARY') {
      const p = allProjectsData.find(x => x.id === selectedProjectId);
      if (p) {
        const ownerDept = getUserDept(p.ownerId);
        const isOwnerDept = (currentUserData.dept === ownerDept);
        const inGrace = isWithin7DaysGracePeriod(p);

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
};

window.renderCollabCheckboxes = function(selectedDepts = []) {
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
};

window.toggleSubMenu = function() {
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
};

window.getWorkingDays = function(startDate, endDate) {
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
};

window.calculateEndDateByDays = function(startDateStr, days) {
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
};

function getNextWorkingDayStr(dateStr) {
  if (!dateStr) return ''; 
  let d = new Date(dateStr); 
  d.setDate(d.getDate() + 1);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return d.toISOString().split('T')[0];
}

window.cascadeDates = function() {
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
            endInput.value = window.calculateEndDateByDays(startInput.value, parseInt(daysInput.value) || 1);
            endInput.min = startInput.value;
            prevEnd = endInput.value;
         }
      } else {
         if (prevEnd) {
            startInput.value = getNextWorkingDayStr(prevEnd);
            endInput.value = window.calculateEndDateByDays(startInput.value, parseInt(daysInput.value) || 1);
            endInput.min = startInput.value;
            prevEnd = endInput.value;
         }
      }
   });
};

window.checkCascade = function() {
   window.cascadeDates();
};

window.checkWorkingDay = function(input) { 
  if (!input.value) return; 
  const d = new Date(input.value); 
  if (d.getDay() === 0 || d.getDay() === 6) { 
    alert("系統規定只能點選工作日喔！"); 
    input.value = ''; 
  } 
};

window.onTaskStartChange = function(startInput, targetEndId) {
  window.checkWorkingDay(startInput);
  if (!startInput.value) return;
  const row = startInput.closest('.task-row') || startInput.closest('#general-edit-form') || startInput.closest('.modal-box');
  const endInput = typeof targetEndId === 'string' ? document.getElementById(targetEndId) : row?.querySelector('.task-end');
  const daysInput = row?.querySelector('.task-days') || row?.querySelector('#add-task-days') || row?.querySelector('#edit-val-days');

  if (endInput) {
    endInput.min = startInput.value;
    const days = daysInput ? parseInt(daysInput.value) || 1 : 1;
    endInput.value = window.calculateEndDateByDays(startInput.value, days);
  }
};

window.onTaskDaysChange = function(daysInput, targetStartId, targetEndId) {
  const row = daysInput.closest('.task-row') || daysInput.closest('#general-edit-form') || daysInput.closest('.modal-box');
  const startInput = typeof targetStartId === 'string' ? document.getElementById(targetStartId) : row?.querySelector('.task-start') || row?.querySelector('#add-task-start');
  const endInput = typeof targetEndId === 'string' ? document.getElementById(targetEndId) : row?.querySelector('.task-end') || row?.querySelector('#add-task-end');

  const days = parseInt(daysInput.value) || 1;
  if (startInput && startInput.value && endInput) {
    endInput.value = window.calculateEndDateByDays(startInput.value, days);
    endInput.min = startInput.value;
  }
};

window.onTaskEndChange = function(endInput, targetStartId, targetDaysId) {
  window.checkWorkingDay(endInput);
  const row = endInput.closest('.task-row') || endInput.closest('#general-edit-form') || endInput.closest('.modal-box');
  const startInput = typeof targetStartId === 'string' ? document.getElementById(targetStartId) : row?.querySelector('.task-start') || row?.querySelector('#add-task-start');
  const daysInput = typeof targetDaysId === 'string' ? document.getElementById(targetDaysId) : row?.querySelector('.task-days') || row?.querySelector('#add-task-days');

  if (startInput && startInput.value && endInput.value) {
    if (endInput.value < startInput.value) {
      alert("預計結束日不可早於開始日！");
      endInput.value = startInput.value;
    }
    const days = window.getWorkingDays(startInput.value, endInput.value);
    if (daysInput) daysInput.value = days;
  }
};

window.addTaskRow = function() {
  const container = document.getElementById("task-list-container"); 
  if (!container) return;
  const rows = container.querySelectorAll('.task-row');
  let defaultStart = rows.length > 0 ? getNextWorkingDayStr(rows[rows.length - 1].querySelector('.task-end').value) : "";
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
};

window.moveTaskRow = function(btn, direction) {
  const row = btn.closest('.task-row');
  if (!row) return;
  if (direction === -1 && row.previousElementSibling) {
    row.parentNode.insertBefore(row, row.previousElementSibling);
  } else if (direction === 1 && row.nextElementSibling) {
    row.parentNode.insertBefore(row.nextElementSibling, row);
  }
};

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
  
  const tpl = projectTemplates[tplId] || projectTemplates[String(tplId)] || { name: `自訂模板 ${tplId}`, tasks: [] };
  document.getElementById("tpl-edit-id").value = tplId;
  document.getElementById("tpl-edit-name").value = tpl.name;
  
  const container = document.getElementById("tpl-task-list-container");
  if(!container) return;
  container.innerHTML = "";
  if (tpl.tasks && tpl.tasks.length > 0) {
     tpl.tasks.forEach(task => window.addTplTaskRow(task.name, task.days));
  } else {
     window.addTplTaskRow("", 1);
  }
  document.getElementById("template-edit-modal")?.classList.add("active");
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
  document.getElementById("template-edit-modal")?.classList.remove("active");
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
    console.log("儲存至本機:", e);
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
  
  let currentDate = getTodayStr(); 
  
  tpl.tasks.forEach((t, i) => {
     const div = document.createElement('div');
     div.className = "form-row task-row";
     div.style.marginBottom = "8px";
     
     let startStr = "";
     let endStr = "";
     let days = parseInt(t.days) || 1;

     if (mode === 'seq') {
        startStr = i === 0 ? currentDate : getNextWorkingDayStr(currentDate);
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

function scrollToTodayMinus2Days(ganttInst, containerSelector) {
  const wrapper = document.querySelector(containerSelector);
  if (!wrapper) return;

  [80, 200].forEach(delay => {
    setTimeout(() => {
      const scrollElement = wrapper.querySelector('.gantt-container') || wrapper;
      const svg = wrapper.querySelector('.gantt');
      if (!scrollElement || !svg) return;

      let todayIndex = -1;
      const today = new Date();
      today.setHours(0,0,0,0);

      if (ganttInst && ganttInst.dates) {
        ganttInst.dates.forEach((d, idx) => {
          const checkD = new Date(d);
          checkD.setHours(0,0,0,0);
          if (checkD.getTime() === today.getTime() && todayIndex === -1) {
            todayIndex = idx;
          }
        });
      }

      let colWidth = (ganttInst && ganttInst.options && ganttInst.options.column_width) ? ganttInst.options.column_width : 38;
      const firstTick = svg.querySelector('.tick');
      if (firstTick) {
        const w = parseFloat(firstTick.getAttribute('width'));
        if (!isNaN(w) && w > 0) colWidth = w;
      }

      let targetScrollLeft = 0;
      if (todayIndex !== -1) {
        targetScrollLeft = Math.max(0, (todayIndex - 2) * colWidth);
      } else {
        const todayHighlight = svg.querySelector('.today-highlight') || svg.querySelector('.current-date-highlight');
        if (todayHighlight) {
          const x = parseFloat(todayHighlight.getAttribute('x'));
          if (!isNaN(x)) {
            targetScrollLeft = Math.max(0, x - (colWidth * 2));
          }
        }
      }

      scrollElement.scrollLeft = targetScrollLeft;
      if (scrollElement !== wrapper) wrapper.scrollLeft = targetScrollLeft;
    }, delay);
  });
}

function patchGanttVisuals(ganttInst, containerSelector) {
  if (!ganttInst || !ganttInst.dates || ganttInst.dates.length === 0) return;
  const wrapper = document.querySelector(containerSelector);
  if (!wrapper) return;
  const svg = wrapper.querySelector('.gantt');
  if (!svg) return;

  const lowerTexts = Array.from(svg.querySelectorAll('.lower-text'));
  const dayTicks = Array.from(svg.querySelectorAll('.tick')).filter(t => !t.classList.contains('thick'));

  ganttInst.dates.forEach((date, i) => {
    if (i < lowerTexts.length) {
      const dStr = String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
      const isWeekend = date.getDay() === 0 || date.getDay() === 6;
      const isHoliday = !!taiwanHolidayMap[dStr];

      if (isWeekend || isHoliday) {
        lowerTexts[i].style.fill = '#ef4444'; 
        lowerTexts[i].style.fontWeight = 'bold';
        if (i < dayTicks.length) dayTicks[i].style.fill = 'rgba(239, 68, 68, 0.08)';
      }
    }
  });

  const scrollElement = wrapper.querySelector('.gantt-container') || wrapper;
  const upperTexts = Array.from(svg.querySelectorAll('.upper-text'));
  const colWidth = (ganttInst.options && ganttInst.options.column_width) ? ganttInst.options.column_width : 38;

  const updateStickyMonthHeader = () => {
    const currentScrollLeft = scrollElement.scrollLeft;
    const currentDayIndex = Math.min(
      ganttInst.dates.length - 1,
      Math.max(0, Math.floor(currentScrollLeft / colWidth))
    );

    const visibleDate = ganttInst.dates[currentDayIndex];
    if (!visibleDate || upperTexts.length === 0) return;

    const yyyy = visibleDate.getFullYear();
    const mm = visibleDate.getMonth() + 1;
    const currentHeaderStr = `${yyyy}年 ${mm}月`;

    upperTexts.forEach((el, idx) => {
      if (idx === 0) {
        el.textContent = currentHeaderStr;
        el.setAttribute('x', currentScrollLeft + 16);
        el.setAttribute('text-anchor', 'start');
        el.style.textAnchor = 'start';
        el.style.fontWeight = '700';
        el.style.fill = 'var(--primary)';
        el.style.display = 'block';
      } else {
        const origX = parseFloat(el.getAttribute('data-orig-x') || el.getAttribute('x'));
        if (!el.getAttribute('data-orig-x')) el.setAttribute('data-orig-x', origX);
        if (origX < currentScrollLeft + 120) {
          el.style.display = 'none';
        } else {
          el.style.display = 'block';
        }
      }
    });
  };

  scrollElement.removeEventListener('scroll', scrollElement._ganttScrollHandler);
  scrollElement._ganttScrollHandler = updateStickyMonthHeader;
  scrollElement.addEventListener('scroll', updateStickyMonthHeader);

  updateStickyMonthHeader();
  scrollToTodayMinus2Days(ganttInst, containerSelector);
}

window.renderProjects = function() {
  if (!auth.currentUser) return;
  window.checkEditModeVisibility();

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
            summaryGanttInstance = new Gantt("#gantt-chart-summary", ganttTasksSum, { 
              view_mode: 'Day', language: 'zh', header_height: 50, bar_height: 20, padding: 18, readonly: true 
            });
            patchGanttVisuals(summaryGanttInstance, '#gantt-chart-summary-container');
            scrollToTodayMinus2Days(summaryGanttInstance, '#gantt-chart-summary-container'); 
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
  let editProjBtn = canEditMainProj ? `<button class="action-btn" onclick="window.openGeneralEdit('project', '${activeProj.id}')" style="margin-left:8px; padding:2px 6px; font-size:10px; border-color:var(--warning); color:var(--warning);">✏️ 編輯主資訊</button>` : '';
  
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
          ganttInstance = new Gantt("#gantt-chart", ganttTasks, { 
            view_mode: 'Day', language: 'zh', header_height: 50, bar_height: 20, padding: 18, readonly: true 
          });
          patchGanttVisuals(ganttInstance, '#gantt-chart-container');
          scrollToTodayMinus2Days(ganttInstance, '#gantt-chart-container'); 
        }, 50); 
    }
  } else {
    lastDetailGanttState = "";
    chartContainer.innerHTML = '';
  }
};

window.submitNewProject = async () => {
  const title = document.getElementById("proj-name")?.value.trim();
  const color = document.getElementById("proj-color")?.value;
  if (!title) return alert("請填寫主專案名稱！");

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
    if (start > end) return alert(`任務 [${name}] 的起始日不可大於完成日！`);
    let passedDays = 0; 
    if (todayStr >= start) passedDays = getWorkingDays(start, todayStr);
    tasks.push({ 
      name, start, end, progress: 0, isCompleted: false, completedAt: null, delayReason: "", lastUpdatedAt: ts, reportedCompleted: false, 
      assigneeId: auth.currentUser.uid,
      assigneeName: myName,
      createdAt: Date.now(), 
      history: [{ timestamp: ts, progress: 0, type: 'create', daysPassed: passedDays, delayReason: '', remark: '專案建立' }] 
    });
  }
  
  const targetUser = allUsersList.find(u => u.uid === viewingUserId) || { name: currentUserData.name, uid: auth.currentUser.uid };
  const ownerNameToSave = targetUser.name || currentUserData.name;

  const docRef = await addDoc(collection(db, "projects"), { 
    title, color, collaborators, ownerId: viewingUserId, ownerName: ownerNameToSave, 
    tasks: tasks, createdAt: serverTimestamp() 
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
};

window.renderAdHocEvents = () => {
  if (!auth.currentUser) return;
  const tbody = document.getElementById("adhoc-list-tbody"); 
  if (!tbody) return;
  tbody.innerHTML = "";
  const filtered = allAdHocData.filter(e => e.ownerId === viewingUserId);
  
  filtered.sort((a, b) => {
    let tA = a.createdAt?.toMillis ? a.createdAt.toMillis() : Date.now();
    let tB = b.createdAt?.toMillis ? b.createdAt.toMillis() : Date.now();
    return tB - tA;
  });

  const isAuthorizedEditor = (currentUserData.role === 'admin' || currentUserData.canEdit === true);

  filtered.forEach(evt => {
    let isOwner = (evt.ownerId === auth.currentUser.uid);
    let canEditUI = isEditMode && isAuthorizedEditor && isOwner;
    
    let editHtml = canEditUI ? `<button class="action-btn" style="margin-left:4px; border-color:var(--warning); color:var(--warning);" onclick="window.openGeneralEdit('adhoc', '${evt.id}')">✏️</button>` : '';
    let actionHtml = !evt.isCompleted && isOwner ? `<button class="action-btn" onclick="window.completeAdHoc('${evt.id}')">完成</button>` : '';
    let delHtml = (currentUserData.role === 'admin' || currentUserData.role === 'top_manager' || canEditUI) ? `<button class="action-btn danger" style="margin-left:4px;" onclick="window.deleteAdHoc('${evt.id}')">刪除</button>` : '';

    const tr = document.createElement("tr"); 
    tr.innerHTML = `
      <td style="white-space: nowrap; width: 1%;"><strong>${evt.title}</strong></td>
      <td style="word-break: break-all; width: 100%; min-width: 200px;">${evt.reason}</td>
      <td style="white-space: nowrap; width: 1%;">${evt.startDate || '-'}</td>
      <td style="white-space: nowrap; width: 1%;">${evt.completedAt || '-'}</td>
      <td style="white-space: nowrap; width: 1%;">${evt.isCompleted ? '<span class="pill pill-success">已完成</span>' : '<span class="pill pill-warning">處理中</span>'}</td>
      <td style="white-space: nowrap; width: 1%;">${actionHtml}${editHtml}${delHtml}</td>
    `; 
    tbody.appendChild(tr);
  });
};

window.submitNewAdHoc = async () => {
  const title = document.getElementById("adhoc-title")?.value.trim(); 
  const reason = document.getElementById("adhoc-reason")?.value.trim(); 
  const start = document.getElementById("adhoc-start")?.value;
  if (!title || !reason || !start) return alert("請填寫完整名稱、開始日期與原因！");
  
  const targetUser = allUsersList.find(u => u.uid === viewingUserId) || { name: currentUserData.name };
  await addDoc(collection(db, "ad_hoc_events"), { 
    ownerId: viewingUserId, 
    ownerName: targetUser.name || '', 
    title, reason, startDate: start, startDateTime: new Date().toLocaleString(), isCompleted: false, createdAt: serverTimestamp() 
  });
  
  const atitle = document.getElementById("adhoc-title");
  if(atitle) atitle.value = ""; 
  const areason = document.getElementById("adhoc-reason");
  if(areason) areason.value = ""; 
  const astart = document.getElementById("adhoc-start");
  if(astart) astart.value = ""; 
  alert("事件紀錄完成！");
};

window.initWeeklyDateAndLeave = () => {
  const dateInput = document.getElementById("rep-date");
  const container = document.getElementById("leave-options-container");
  if (!dateInput || !container) return;

  const today = new Date();
  const days = ['日', '一', '二', '三', '四', '五', '六'];
  const day = today.getDay(); 
  
  dateInput.value = `${today.getFullYear()}/${today.getMonth() + 1}/${today.getDate()} (${days[day]})`; 

  const dStr = String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
  
  const tmr = new Date(today);
  tmr.setDate(today.getDate() + 1);
  const tmrDay = tmr.getDay();
  const tmrStr = String(tmr.getMonth() + 1).padStart(2, '0') + '-' + String(tmr.getDate()).padStart(2, '0');

  const isTodayHoliday = !!taiwanHolidayMap[dStr];
  const isTmrHoliday = !!taiwanHolidayMap[tmrStr];
  const isTmrWeekend = (tmrDay === 0 || tmrDay === 6);

  if (day >= 1 && day <= 4 && !isTodayHoliday && !isTmrHoliday && !isTmrWeekend) {
    container.style.display = "flex";
  } else {
    container.style.display = "none";
    document.querySelectorAll('input[name="leave_type"]').forEach(r => r.checked = false);
    const or = document.getElementById('leave-other-reason');
    if(or) {
      or.style.display = 'none';
      or.value = '';
    }
  }
};

window.populateWeeklyProjSelect = (selectElem) => {
  selectElem.innerHTML = '<option value="">-- 請選擇主專案 --</option>';
  const myProjs = allProjectsData.filter(p => p.ownerId === viewingUserId);
  const availableProjs = myProjs.filter(p => window.getAvailableTasks(p.id).length > 0);
  availableProjs.forEach(p => { selectElem.innerHTML += `<option value="${p.id}">${p.title}</option>`; });
};

window.updateWeeklyTaskSelect = (selectElem) => {
  const taskSelect = selectElem.parentElement.querySelector('.weekly-task-select');
  if(!taskSelect) return;
  taskSelect.innerHTML = '<option value="">-- 請選擇細項 --</option>';
  const projId = selectElem.value;
  if(!projId) return;
  const availableTasks = window.getAvailableTasks(projId);
  availableTasks.forEach(t => { taskSelect.innerHTML += `<option value="${t.index}">${t.name}</option>`; });
};

window.addWeeklyRow = () => {
  const container = document.getElementById("weekly-items-container");
  if(!container) return;
  const div = document.createElement('div'); 
  div.className = "weekly-item-row"; 
  div.style.cssText = "display:flex; gap:16px; margin-bottom:12px; align-items:flex-start; border: 1px solid var(--border-light); padding: 14px; border-radius: 8px; background: #fafafa;";
  div.innerHTML = `<div style="flex:1; display:flex; flex-direction:column; gap:10px; border-right: 1px dashed var(--border); padding-right:16px;"><select class="input-control weekly-proj-select" onchange="window.updateWeeklyTaskSelect(this)" style="background:#fff;"></select><select class="input-control weekly-task-select" style="background:#fff;"><option value="">-- 請先選擇主專案 --</option></select></div><div style="flex:2.5;"><textarea class="input-control weekly-content" rows="3" placeholder="請填寫此任務的進度說明..." style="background:#fff;"></textarea></div><button class="action-btn danger" onclick="this.parentElement.remove()" style="padding: 10px; margin-left: 8px;">X</button>`;
  container.appendChild(div); 
  window.populateWeeklyProjSelect(div.querySelector('.weekly-proj-select'));
};

window.refreshAllWeeklyProjSelects = () => {
  const selects = document.querySelectorAll('.weekly-proj-select');
  selects.forEach(sel => { 
    const currentVal = sel.value; 
    window.populateWeeklyProjSelect(sel); 
    sel.value = currentVal; 
  });
};

window.renderWeeklyReports = () => {
  const tbody = document.getElementById("weekly-list-tbody"); 
  if(!tbody) return;
  tbody.innerHTML = "";
  const filtered = allWeeklyData.filter(e => e.ownerId === viewingUserId);
  filtered.sort((a,b) => (b.createdAt?.toMillis() || 0) - (a.createdAt?.toMillis() || 0)); 
  
  const days = ['日', '一', '二', '三', '四', '五', '六'];

  filtered.forEach((w, index) => {
    let isOwner = (w.ownerId === auth.currentUser?.uid);
    let isAllowedTime = window.isWeeklyReportEditable(w);
    let canEditUI = (isEditMode || isAllowedTime) && isOwner && isAllowedTime;
    
    let editHtml = canEditUI ? `<button class="action-btn" style="margin-right:6px; border-color:var(--warning); color:var(--warning);" onclick="window.openGeneralEdit('weekly', '${w.id}')">✏️ 編輯</button>` : '';
    let delHtml = (currentUserData.role === 'admin' || currentUserData.role === 'top_manager' || (isOwner && isAllowedTime)) ? `<button class="action-btn danger" onclick="window.deleteWeekly('${w.id}')">刪除</button>` : '';
    
    let supText = w.supervisorNoted ? '<span style="color:var(--success); font-weight:bold;">Noted</span>' : '<span style="color:var(--text-muted);">待閱</span>';
    let topText = w.topManagerNoted ? '<span style="color:var(--success); font-weight:bold;">Noted</span>' : '<span style="color:var(--text-muted);">待閱</span>';
    
    let fillTimeStr = '-';
    if (w.createdAt) {
      const d = w.createdAt.toDate();
      const yyyy = d.getFullYear(); 
      const mm = d.getMonth() + 1; 
      const dd = d.getDate();
      let hours = d.getHours(); 
      let ampm = hours >= 12 ? '下午' : '上午';
      hours = hours % 12; 
      hours = hours ? hours : 12; 
      let minutes = String(d.getMinutes()).padStart(2, '0'); 
      let seconds = String(d.getSeconds()).padStart(2, '0');
      fillTimeStr = `${yyyy}/${mm}/${dd} ${ampm}${hours}:${minutes}:${seconds} (${days[d.getDay()]})`;
    }
    
    const tr = document.createElement("tr"); 
    tr.innerHTML = `<td>${index + 1}</td><td><strong>${w.ownerName}</strong></td><td>${fillTimeStr}</td><td>${supText}</td><td>${topText}</td><td><button class="action-btn" style="margin-right:6px;" onclick="window.openWeeklyModal('${w.id}')">瀏覽報告</button>${editHtml}${delHtml}</td>`; 
    tbody.appendChild(tr);
  });
};

window.submitWeeklyReport = async () => {
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
    
    if (items.length === 0 && !leaveType) {
      return alert("請完整填寫至少一項任務進度說明！");
    }

    const targetUser = allUsersList.find(u => u.uid === viewingUserId) || { name: currentUserData.name, supervisorId: null };
    const supervisorId = targetUser.supervisorId || null; 
    const currentOwnerId = viewingUserId || auth.currentUser?.uid;

    await addDoc(collection(db, "weekly_reports"), { 
      ownerId: currentOwnerId, 
      ownerName: targetUser.name || '', 
      ownerSupervisorId: supervisorId, 
      reportDate: dateStr, 
      items: items, 
      leaveType: leaveType || "", 
      leaveReason: leaveReason || "",
      createdAt: serverTimestamp(), 
      supervisorNoted: false, 
      topManagerNoted: false 
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
};

window.submitCreateUser = async () => {
  const name = document.getElementById("new-user-name")?.value.trim(); 
  const email = document.getElementById("new-user-email")?.value.trim(); 
  const pass = document.getElementById("new-user-pass")?.value.trim();
  const dept = document.getElementById("new-user-dept")?.value;
  const role = document.getElementById("new-user-role")?.value;
  const supervisorId = document.getElementById("new-user-supervisor")?.value || null;

  if (!name || !email || !pass || pass.length < 6) return alert("資料填寫不全或密碼太短！");
  try {
    const secApp = initializeApp(firebaseConfig, "Secondary"); 
    const secAuth = getAuth(secApp);
    const userCred = await createUserWithEmailAndPassword(secAuth, email, pass); 
    await signOut(secAuth);
    await setDoc(doc(db, "users", userCred.user.uid), { 
      name, email, dept, role, supervisorId, canEdit: false, createdAt: serverTimestamp() 
    });
    alert(`人員 ${name} 建立成功！`);
  } catch (err) { 
    alert("建立失敗: " + err.message); 
  }
};

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

window.renderOrgUsersTable = () => {
  const tbody = document.getElementById("user-list-tbody"); 
  const supervisorSelect = document.getElementById("new-user-supervisor");
  if (tbody) tbody.innerHTML = ""; 
  if (supervisorSelect) supervisorSelect.innerHTML = '<option value="">-- 無 --</option>'; 
  
  allUsersList.forEach(user => {
    if (supervisorSelect && ["top_manager", "manager", "assistant_manager"].includes(user.role)) {
      supervisorSelect.innerHTML += `<option value="${user.uid}">${user.name} (${roleNames[user.role] || user.role})</option>`;
    }
  });

  if (tbody) {
    let currentDeptGroup = "";
    allUsersList.forEach(u => {
      const uDept = u.dept || "設計部";
      if (uDept !== currentDeptGroup) {
        currentDeptGroup = uDept;
        const deptTr = document.createElement("tr");
        deptTr.innerHTML = `<td colspan="7" style="background: #f1f5f9; font-weight: 700; color: #334155; padding: 10px 16px;">🏢 ${currentDeptGroup}</td>`;
        tbody.appendChild(deptTr);
      }

      const supUser = allUsersList.find(x => x.uid === u.supervisorId); 
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td style="text-align: center;">
          <label style="display:inline-flex; align-items:center; gap:4px; cursor:pointer;">
            <input type="checkbox" onchange="window.toggleUserEditPermission('${u.uid}', this.checked)" ${u.canEdit ? 'checked' : ''} ${currentUserData.role === 'admin' ? '' : 'disabled'}>
            <span style="font-size:12px;">開放</span>
          </label>
        </td>
        <td><strong>${u.name || '未命名'}</strong></td>
        <td>${u.email || '-'}</td>
        <td><span class="pill" style="background:#f1f5f9; color:#334155;">${u.dept || '設計部'}</span></td>
        <td><span class="pill pill-role">${roleNames[u.role] || u.role}</span></td>
        <td>${supUser ? `${supUser.name}` : "-"}</td>
        <td>
          <button class="action-btn" onclick="window.openEditModal('${u.uid}')" style="margin-right:4px;">編輯</button>
          <button class="action-btn" onclick="window.resetUserPassword('${u.email}')" style="margin-right:4px;">重設密碼</button>
          <button class="action-btn" onclick="window.rescueUserProjects('${u.uid}', '${u.name}')" style="margin-right:4px; border-color:#f59e0b; color:#f59e0b;" title="找回建立錯ID的資料">找回資料</button>
          ${u.uid !== auth.currentUser?.uid ? `<button class="action-btn danger" onclick="window.deleteUserDoc('${u.uid}', '${u.name}')">刪除</button>` : ''}
        </td>`;
      tbody.appendChild(tr);
    });
  }

  if (document.getElementById("org-chart-view-container")) window.renderOrgChart();
};

Object.assign(window, {
  renderCalendar: () => {
    const grid = document.getElementById("calendar-grid");
    if (!grid) return;
    grid.innerHTML = "";
    const firstDayIndex = new Date(calCurrentYear, calCurrentMonth, 1).getDay();
    const lastDate = new Date(calCurrentYear, calCurrentMonth + 1, 0).getDate();
    const prevMonthLastDate = new Date(calCurrentYear, calCurrentMonth, 0).getDate();
    const todayStr = getTodayStr();

    for (let i = firstDayIndex - 1; i >= 0; i--) {
      const dNum = prevMonthLastDate - i;
      const prevM = calCurrentMonth === 0 ? 12 : calCurrentMonth;
      const prevY = calCurrentMonth === 0 ? calCurrentYear - 1 : calCurrentYear;
      const dStr = `${prevY}-${String(prevM).padStart(2, '0')}-${String(dNum).padStart(2, '0')}`;
      grid.appendChild(window.createCalCellNode(dNum, dStr, true, todayStr, myCalendarTodos));
    }
    for (let d = 1; d <= lastDate; d++) {
      const dStr = `${calCurrentYear}-${String(calCurrentMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      grid.appendChild(window.createCalCellNode(d, dStr, false, todayStr, myCalendarTodos));
    }
    const totalCells = firstDayIndex + lastDate;
    const remaining = (7 - (totalCells % 7)) % 7;
    for (let n = 1; n <= remaining; n++) {
      const nextM = calCurrentMonth === 11 ? 1 : calCurrentMonth + 2;
      const nextY = calCurrentMonth === 11 ? calCurrentYear + 1 : calCurrentYear;
      const dStr = `${nextY}-${String(nextM).padStart(2, '0')}-${String(n).padStart(2, '0')}`;
      grid.appendChild(window.createCalCellNode(n, dStr, true, todayStr, myCalendarTodos));
    }
  },
  createCalCellNode: (dayNum, dateStr, isOtherMonth, todayStr, userTodos) => {
    const cell = document.createElement("div");
    cell.className = `cal-cell ${isOtherMonth ? 'other-month' : ''} ${dateStr === todayStr ? 'today' : ''}`;
    const monthDayStr = dateStr.substring(5);
    const dayOfWeek = new Date(dateStr).getDay();
    const isWeekend = (dayOfWeek === 0 || dayOfWeek === 6);
    const holidayName = taiwanHolidayMap[monthDayStr] || null;
    if (!!holidayName || isWeekend) cell.classList.add("holiday");

    let html = `<div style="display:flex; align-items:center;"><div class="cal-date-num">${dayNum}</div>${holidayName ? `<span class="cal-holiday-tag" title="${holidayName}">${holidayName}</span>` : ''}</div>`;
    const dayTodos = userTodos.filter(t => t.date === dateStr);
    if (dayTodos.length > 0) {
      html += `<div class="cal-todo-preview-list">`;
      dayTodos.slice(0, 3).forEach(todo => {
        html += `<div class="cal-todo-pill ${todo.isCompleted ? 'completed' : ''}" style="color:${todo.color || '#0f172a'};">${todo.title}</div>`;
      });
      if (dayTodos.length > 3) html += `<div style="font-size:10px; color:var(--text-muted); text-align:right;">+${dayTodos.length - 3} 則...</div>`;
      html += `</div>`;
    }
    cell.innerHTML = html;
    cell.onclick = () => window.openCalDateModal(dateStr);
    return cell;
  }
});
