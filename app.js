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

const roleNames = { admin: "系統管理員", top_manager: "最高級主管", senior_manager: "高級主管", manager: "主管", assistant_manager: "副主管", staff: "人員" };
const departmentList = ["總經理室", "企劃部", "業務部", "設計部", "品檢部", "採購部", "廠部"];

let currentUserData = { role: "staff", name: "", dept: "設計部", canEdit: false };
let allUsersList = [];

let viewingUserId = null; 
let allProjectsData = [];
let allAdHocData = [];
let allWeeklyData = [];
let myCalendarTodos = [];
let projectTemplates = Array.from({length: 5}, (_, i) => ({ id: i, name: `模板${i+1}`, tasks: [] }));

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

const taiwanHolidayMap = {
  '01-01': '元旦', '01-02': '彈性放假', '02-15': '小年夜', '02-16': '除夕',
  '02-17': '春節初一', '02-18': '初二', '02-19': '初三', '02-20': '補假',
  '02-27': '228連假', '02-28': '和平紀念日', '04-03': '清明補假', '04-04': '兒童節',
  '04-05': '清明節', '04-06': '補假', '05-01': '勞動節', '06-19': '端午節',
  '09-25': '中秋節', '09-28': '教師節', '10-09': '國慶補假', '10-10': '國慶日',
  '10-25': '光復節', '10-26': '補假', '12-25': '行憲紀念日'
};

function isHolidayOrWeekend(dateObj) {
  const day = dateObj.getDay();
  if (day === 0 || day === 6) return true; // 週末 (六、日)
  
  const m = String(dateObj.getMonth() + 1).padStart(2, '0');
  const d = String(dateObj.getDate()).padStart(2, '0');
  const mmdd = `${m}-${d}`;
  return !!taiwanHolidayMap[mmdd]; // 國定假日
}

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

function initDynamicUI() {
  // 🌟 避免重複注入 CSS 樣式
  if (document.getElementById('custom-dynamic-ui-style')) return;

  const style = document.createElement('style');
  style.id = 'custom-dynamic-ui-style';
  style.innerHTML = `
    :root { --font-scale: 1.2; }
    .tab-pane { zoom: var(--font-scale, 1.2); }
    body.font-md { --font-scale: 1.5 !important; }
    body.font-lg { --font-scale: 1.8 !important; }
    .kpi-card { padding: 8px 12px !important; min-height: unset !important; }
    .kpi-title { font-size: 11.5px !important; margin-bottom: 2px !important; }
    .kpi-number { font-size: 18px !important; }
    .col-sum-name.clickable { cursor: pointer; text-decoration: none; transition: 0.2s; }
    .col-sum-name.clickable:hover { opacity: 0.7; }
    .gantt-left-panel, .gantt-left-panel-summary { flex: 0 0 40% !important; max-width: 40% !important; }
    .gantt-right-panel, .gantt-right-panel-summary { flex: 0 0 60% !important; max-width: 60% !important; }
    .col-sum-name { flex: 5.8 !important; } 
    .col-sum-date { flex: 1.4 !important; text-align: center; display: flex; flex-direction: column; justify-content: center; align-items: center; line-height: 1.2; } 
    .col-sum-prog { flex: 1.6 !important; text-align: center; display: flex; justify-content: center; align-items: center; } 
    .col-sum-owner { flex: 1.6 !important; text-align: center; display: flex; justify-content: center; align-items: center; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .col-name { flex: 1.8 !important; } 
    .col-expected-date { flex: 0.5 !important; min-width: 55px !important; text-align: center; display: flex; flex-direction: column; justify-content: center; align-items: center; line-height: 1.2; }
    .col-date { flex: 0.4 !important; min-width: 40px !important; text-align: center; display: flex; flex-direction: column; justify-content: center; align-items: center; line-height: 1.2; } 
    .col-prog { flex: 0.4 !important; min-width: 55px !important; text-align: center; display: flex; justify-content: center; align-items: center; }
    .col-act { flex: 0.4 !important; min-width: 45px !important; text-align: center; display: flex; justify-content: center; align-items: center; }
    .col-owner { flex: 0.5 !important; min-width: 50px !important; text-align: center; display: flex; justify-content: center; align-items: center; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .mobile-fixed-dropdown { position: fixed !important; top: 60px !important; left: 0 !important; width: 100vw !important; height: calc(100vh - 60px) !important; background: #ffffff !important; z-index: 999999 !important; display: flex !important; flex-direction: column; overflow-y: auto !important; padding: 20px !important; box-shadow: 0 10px 25px rgba(0,0,0,0.2); }
    .hide-on-mobile { display: flex !important; }
    .font-btn { transition: 0.2s; }
    .font-btn.active { background: #4f46e5 !important; color: #fff !important; border-color: #4f46e5 !important; }
    @media (max-width: 768px) {
      :root { --font-scale: 1 !important; }
      .kpi-row { grid-template-columns: repeat(5, 1fr) !important; gap: 4px !important; }
      .kpi-title { font-size: 10px !important; }
      .kpi-card { padding: 6px 4px !important; }
      .gantt-master-layout { display: flex !important; flex-direction: column !important; }
      .gantt-left-panel, .gantt-left-panel-summary { flex: 0 0 100% !important; max-width: 100% !important; margin-bottom: 16px !important; overflow-x: auto !important; }
      .gantt-right-panel, .gantt-right-panel-summary { display: block !important; flex: 0 0 100% !important; max-width: 100% !important; }
      .hide-on-mobile { display: none !important; }
      .mobile-fixed-dropdown .nav-sub-dept-header { color: #1e293b !important; background: #e2e8f0 !important; font-size: 14px !important; padding: 10px 14px !important; border-radius: 6px !important; margin-top: 8px !important; }
      .mobile-fixed-dropdown .nav-sub-dept-header span { color: #1e293b !important; }
      .mobile-fixed-dropdown .dept-count-badge { background: #cbd5e1 !important; color: #0f172a !important; }
      .mobile-fixed-dropdown .dept-arrow { color: #475569 !important; }
      .mobile-fixed-dropdown .nav-sub-item { color: #0f172a !important; font-size: 15px !important; padding: 10px 16px !important; border-bottom: 1px solid #f1f5f9 !important; }
      .mobile-fixed-dropdown .nav-sub-item small { color: #64748b !important; }
      .mobile-fixed-dropdown .nav-sub-item:hover, .mobile-fixed-dropdown .nav-sub-item.active { background: #eff6ff !important; color: #2563eb !important; font-weight: 700 !important; }
      .mobile-fixed-dropdown .nav-sub-item.active small { color: #3b82f6 !important; }
    }
  `;
  document.head.appendChild(style);

  const btnWrapper = document.getElementById('btn-create-wrapper');
  if (btnWrapper && !document.getElementById('project-year-filter')) {
    const currentY = new Date().getFullYear();
    let options = '';
    for(let y = currentY - 3; y <= currentY + 3; y++){
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
      if(currentFilter === 'ongoing' || currentFilter === 'delayed'){
         setProjectFilter('all');
      } else {
         renderProjects();
      }
    };
    btnWrapper.insertBefore(sel, btnWrapper.firstChild);
  }
}

initDynamicUI();

// 🌟🌟🌟 Quill 富文本編輯器初始化 (用於「事件紀錄」的原因說明) 🌟🌟🌟
// 🌟🌟🌟 Quill 富文本編輯器初始化 🌟🌟🌟
let adhocQuill;      // 用於「事件紀錄」的原因說明
let approvalQuill;   // 👈 新增：用於「專案簽核說明」

// 工具列只顯示需要的功能
const toolbarOptions = [
  ['bold', 'underline', 'strike'],        // 加粗、底線、刪除線
  [{ 'color': [] }],                      // 字體顏色
  [{ 'list': 'ordered'}, { 'list': 'bullet' }], // 數字編號、項目點點
  [{ 'indent': '-1'}, { 'indent': '+1' }],      // 減少縮排、增加縮排 (多層次清單)
  ['clean']                               // 一鍵清除格式
];

// 用 setTimeout 確保 #adhoc-editor-container 元素已經存在於 DOM 中
setTimeout(() => {
  const editorEl = document.getElementById('adhoc-editor-container');
  if (editorEl) {
    adhocQuill = new Quill('#adhoc-editor-container', {
      modules: { toolbar: toolbarOptions },
      theme: 'snow',
      placeholder: '請填寫事件原因說明 (Enter 換行)'
    });
  }
}, 500);

// 🌟🌟🌟 新增：專案簽核流程開關與 Quill 初始化控制邏輯 🌟🌟🌟
window.toggleApprovalOptions = (isNeed) => {
  const collabWrapper = document.getElementById("collab-apply-wrapper");
  const reasonSec = document.getElementById("approval-reason-section");
  const chkCollab = document.getElementById("chk-apply-collab");

  if (isNeed) {
    if (collabWrapper) collabWrapper.style.display = "block";
    if (reasonSec) reasonSec.style.display = "block";
    
    // 延遲確保 DOM 渲染出來後再初始化 Quill，避免抓不到容器
    if (!approvalQuill) {
      setTimeout(() => {
        const approvalEl = document.getElementById('approval-quill-container');
        if (approvalEl && !approvalEl.classList.contains('ql-container')) {
          approvalQuill = new Quill('#approval-quill-container', {
            modules: { toolbar: toolbarOptions },
            theme: 'snow',
            placeholder: '請填寫簽核說明或申請協作原因 (Enter 換行)...'
          });
        }
      }, 50);
    }
  } else {
    if (collabWrapper) collabWrapper.style.display = "none";
    if (reasonSec) reasonSec.style.display = "none";
    if (chkCollab) chkCollab.checked = false;
    if (approvalQuill) approvalQuill.root.innerHTML = "";
  }
};

window.toggleCollabApply = (isChecked) => {
  // 保持開關狀態即可
};
// 🌟🌟🌟 Quill 初始化與開關設定結束 🌟🌟🌟

function fixHeaders() {
  const sumHeader = document.querySelector('#project-summary-view .gantt-row-header');
  if (sumHeader) {
     sumHeader.innerHTML = `
       <div class="col-sum-name" style="font-weight:bold; color:var(--primary); display: flex; align-items: center;">主專案 / 事件名稱</div>
       <div class="col-sum-date" style="font-size: 13px; color: #64748b; font-weight: normal; line-height: 1.2;">起訖<br>日期</div>
       <div class="col-sum-prog" style="font-size: 13px; color: #64748b; font-weight: normal;">總進度</div>
       <div class="col-sum-owner" style="font-size: 13px; color: #64748b; font-weight: normal;">開案者</div>
     `;
     sumHeader.style.display = "flex";
  }
  const detHeader = document.querySelector('#project-detail-view .gantt-row-header');
  if (detHeader) {
     detHeader.innerHTML = `
       <div class="col-name" style="font-weight:bold; color:var(--primary); display: flex; align-items: center;">任務細項排程</div>
       <div class="col-expected-date" style="font-size: 13px; color: #64748b; font-weight: normal; line-height: 1.2;">預計<br>日期</div>
       <div class="col-date" style="font-size: 13px; color: #64748b; font-weight: normal; line-height: 1.2;">預計<br>天數</div>
       <div class="col-prog" style="font-size: 13px; color: #64748b; font-weight: normal;">進度</div>
       <div class="col-act" style="font-size: 13px; color: #64748b; font-weight: normal;">操作</div>
       <div class="col-owner" style="font-size: 13px; color: #64748b; font-weight: normal;">負責人</div>
     `;
     detHeader.style.display = "flex";
  }
}

window.injectFontSizeUI = () => {
  if (document.getElementById('font-size-control-container')) return;
  const userNameEl = document.getElementById('user-display-name');
  const avatarEl = document.getElementById('user-avatar');
  if (!userNameEl) return;
  
  const div = document.createElement('div');
  div.id = 'font-size-control-container';
  div.className = 'hide-on-mobile';
  div.style.cssText = "display:flex; align-items:center; gap:4px; margin-right: 12px; background: #e0e7ff; padding: 4px 8px; border-radius: 6px; border: 1px solid #c7d2fe; height: 32px;";
  div.innerHTML = `
    <span style="font-size:12px; font-weight:bold; color:#3730a3; margin-right:4px;">字體</span>
    <button id="btn-font-sm" class="action-btn font-btn active" style="padding:2px 8px; font-size:12px; border-color:#a5b4fc;" onclick="setGlobalFontSize('sm')">小</button>
    <button id="btn-font-md" class="action-btn font-btn" style="padding:2px 8px; font-size:12px; border-color:#a5b4fc;" onclick="setGlobalFontSize('md')">中</button>
    <button id="btn-font-lg" class="action-btn font-btn" style="padding:2px 8px; font-size:12px; border-color:#a5b4fc;" onclick="setGlobalFontSize('lg')">大</button>
  `;
  
  if (avatarEl && avatarEl.parentNode) {
     avatarEl.parentNode.style.display = 'flex';
     avatarEl.parentNode.style.alignItems = 'center';
     avatarEl.parentNode.insertBefore(div, avatarEl);
  } else {
     userNameEl.parentNode.style.display = 'flex';
     userNameEl.parentNode.style.alignItems = 'center';
     userNameEl.parentNode.insertBefore(div, userNameEl);
  }
  const savedSize = localStorage.getItem('desktop-font-size') || 'sm';
  window.setGlobalFontSize(savedSize);
};

window.setGlobalFontSize = (size) => {
  document.body.classList.remove('font-md', 'font-lg');
  document.querySelectorAll('.font-btn').forEach(btn => btn.classList.remove('active'));
  
  if (size === 'md') {
    document.body.classList.add('font-md');
    document.getElementById('btn-font-md')?.classList.add('active');
  } else if (size === 'lg') {
    document.body.classList.add('font-lg');
    document.getElementById('btn-font-lg')?.classList.add('active');
  } else {
    document.getElementById('btn-font-sm')?.classList.add('active');
    size = 'sm';
  }
  localStorage.setItem('desktop-font-size', size);
};

function initTemplateUI() {
  let container = document.getElementById('template-selector-container');
  const taskContainer = document.getElementById("task-list-container");
  
  if (!container && taskContainer) {
    container = document.createElement("div");
    container.id = "template-selector-container";
    container.style.cssText = "margin: 15px 0; padding: 15px; background: #eef2ff; border: 2px dashed #818cf8; border-radius: 8px;";
    taskContainer.parentNode.insertBefore(container, taskContainer);
  }
  if (container) {
    renderTemplateUI();
    if (!window.hasInitTemplateSnapshot && auth.currentUser) {
      window.hasInitTemplateSnapshot = true;
      try {
        onSnapshot(doc(db, "user_templates", auth.currentUser.uid), (docSnap) => {
          if(docSnap.exists()) {
            projectTemplates = docSnap.data().templates || projectTemplates;
          }
          renderTemplateUI(); 
        });
      } catch (e) {
        console.warn("模板讀取錯誤:", e);
      }
    }
  }
}

window.renderTemplateUI = () => {
  const container = document.getElementById("template-selector-container");
  if(!container) return;
  
  let html = `<div style="font-size:14px; font-weight:bold; margin-bottom:10px; color:#312e81;">⭐ 專案模板快速套用 (帶入會清除下方草稿)</div>`;
  html += `<div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">`;
  
  projectTemplates.forEach((tpl, i) => {
      html += `
      <div style="display:flex; align-items:center; gap:6px; border:1px solid #c7d2fe; padding:6px 10px; border-radius:6px; background:#fff; cursor:pointer;" onclick="document.getElementById('tpl_${i}').checked = true;">
          <input type="radio" name="selected_template" value="${i}" id="tpl_${i}" style="cursor:pointer; transform:scale(1.1); margin:0;">
          <label for="tpl_${i}" style="cursor:pointer; margin:0; font-size:13px; font-weight:700; color:#3730a3;">${tpl.name}</label>
          <button type="button" class="action-btn" style="padding:2px 6px; font-size:11px; background:#f1f5f9; color:#475569; border-color:#cbd5e1; margin-left:2px;" onclick="event.stopPropagation(); openTemplateEditor(${i})">✏️</button>
      </div>`;
  });
  
  html += `
      <div style="width:2px; height:24px; background:#94a3b8; margin:0 8px; border-radius:2px;"></div>
      <div style="display:flex; gap:12px; align-items:center; background:#fff; padding:6px 12px; border-radius:6px; border:1px solid #e2e8f0;">
          <label style="cursor:pointer; font-size:13px; font-weight:bold; color:#0f172a; margin:0; display:flex; align-items:center;">
              <input type="radio" name="template_mode" value="sequential" checked style="margin-right:4px; margin-bottom:0;"> 接續時間
          </label>
          <label style="cursor:pointer; font-size:13px; font-weight:bold; color:#0f172a; margin:0; display:flex; align-items:center;">
              <input type="radio" name="template_mode" value="free" style="margin-right:4px; margin-bottom:0;"> 自由時間
          </label>
          <button type="button" class="action-btn" style="background:#4f46e5; color:#fff; border:none; margin-left:4px; font-weight:bold; padding:4px 12px;" onclick="applySelectedTemplate()">✅ 帶入模板</button>
      </div>
  </div>`;
  
  container.innerHTML = html;
};

window.applySelectedTemplate = () => {
  const checked = document.querySelector('input[name="selected_template"]:checked');
  if(!checked) return alert("請先選擇一個模板！");
  
  if(!confirm("⚠️ 確定要帶入此模板嗎？\n注意：這將會清除您目前在下方輸入的所有草稿細項！")) return;

  const mode = document.querySelector('input[name="template_mode"]:checked').value;
  const tpl = projectTemplates[checked.value];

  const container = document.getElementById("task-list-container");
  container.innerHTML = ""; 
  container.dataset.cascadeMode = mode;

  if(!tpl.tasks || tpl.tasks.length === 0) {
      addTaskRow();
      return alert("套用成功，但此模板目前沒有預設的細項喔！");
  }

  // 🌟 解析讀取：區分一般任務與子專案
  tpl.tasks.forEach(t => {
      if (!t.type || t.type === 'task') {
          const div = document.createElement('div'); 
          div.className = "form-row task-row"; 
          div.style.marginBottom = "8px";
          let days = mode === 'free' ? 1 : (t.days || 1);

          div.innerHTML = `
              <div class="form-group" style="margin:0; flex:3;"><input type="text" class="input-control task-name" placeholder="細項名稱" value="${t.name}"></div>
              <div class="form-group" style="margin:0; flex:1.5;"><input type="date" class="input-control task-start" value="" onchange="onTaskStartChange(this, null)"></div>
              <div class="form-group" style="margin:0; width:65px; flex-shrink:0;"><input type="number" min="1" class="input-control task-days" value="${days}" placeholder="天數" title="工作天數" oninput="onTaskDaysChange(this, null, null)"></div>
              <div class="form-group" style="margin:0; flex:1.5;"><input type="date" class="input-control task-end" value="" onchange="onTaskEndChange(this, null, null)"></div>
              <div style="display:flex; gap:4px; margin:0; flex-shrink:0;">
                <button type="button" class="action-btn btn-sort" onclick="moveTaskRow(this, -1)" title="上移">↑</button>
                <button type="button" class="action-btn btn-sort" onclick="moveTaskRow(this, 1)" title="下移">↓</button>
                <button type="button" class="action-btn danger" onclick="this.closest('.task-row').remove()" style="padding:8px 10px;">X</button>
              </div>
          `;
          container.appendChild(div);
      } else if (t.type === 'subproject') {
          window.addSubProjectRow(t.name, t.assigneeId, t.subTasks, mode);
      }
  });
};

window.switchNav = (tabId, title, elem) => {
  document.querySelectorAll('.tab-pane').forEach(el => el.style.display = 'none');
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  document.getElementById(tabId).style.display = 'block';
  if (elem) elem.classList.add('active');
  document.getElementById('current-title').innerText = title;
  
  if (tabId === 'tab-projects') setTimeout(renderProjects, 100);
  if (tabId === 'tab-weekly') initWeeklyDateAndLeave(); 
  if (tabId === 'tab-calendar') {
    initCalendarSelectors();
    renderCalendar();
  }
};

document.getElementById("btn-toggle-edit-mode").addEventListener("click", () => {
  isEditMode = !isEditMode;
  const btn = document.getElementById("btn-toggle-edit-mode");
  if (isEditMode) {
    btn.innerHTML = "❌ 關閉編輯模式"; 
    btn.style.background = "var(--warning-bg)";
  } else {
    btn.innerHTML = "✏️ 開啟編輯模式"; 
    btn.style.background = "transparent";
  }
  renderProjects(); 
  renderAdHocEvents(); 
  renderWeeklyReports();
});

function checkEditModeVisibility() {
  const btn = document.getElementById("btn-toggle-edit-mode");
  if (!btn) return;
  let shouldShow = (currentUserData.role === 'admin' || currentUserData.canEdit === true);
  if (!shouldShow && isEditMode) {
    isEditMode = false;
    btn.innerHTML = "✏️ 開啟編輯模式";
    btn.style.background = "transparent";
  }
  btn.style.display = shouldShow ? "inline-block" : "none";
}

document.getElementById('btn-toggle-create').addEventListener('click', () => {
  const form = document.getElementById('create-project-section');
  const isHidden = form.style.display === 'none';
  form.style.display = isHidden ? 'block' : 'none';

  if (isHidden) {
    document.getElementById("proj-name").value = "";
    document.getElementById("proj-color").value = "bar-primary";
    renderCollabCheckboxes([]);
    initTemplateUI();
    document.getElementById("task-list-container").innerHTML = "";
    document.getElementById("task-list-container").dataset.cascadeMode = ""; 
    addTaskRow();
  }
});

function renderCollabCheckboxes(selectedDepts = []) {
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
}

window.toggleSubMenu = () => {
  const wrapper = document.getElementById('nav-sub-wrapper');
  const list = document.getElementById('nav-sub-list');
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

function getWorkingDays(startDate, endDate) {
  let count = 0; 
  let curDate = new Date(startDate); 
  let end = new Date(endDate);
  curDate.setHours(0,0,0,0); 
  end.setHours(0,0,0,0);
  while (curDate <= end) {
    if (!isHolidayOrWeekend(curDate)) count++;
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
    if (!isHolidayOrWeekend(curDate)) added++;
  }
  return formatDateSafe(curDate);
}

function formatDateSafe(dateObj) { 
  const y = dateObj.getFullYear(); 
  const m = String(dateObj.getMonth() + 1).padStart(2, '0'); 
  const d = String(dateObj.getDate()).padStart(2, '0'); 
  return `${y}-${m}-${d}`; 
}

function scrollToTodayMinus2Days(ganttInst, containerSelector) {
  const wrapper = document.querySelector(containerSelector);
  if (!wrapper) return;
  [80, 200, 400].forEach(delay => {
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
          if (checkD.getTime() === today.getTime() && todayIndex === -1) todayIndex = idx;
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
          if (!isNaN(x)) targetScrollLeft = Math.max(0, x - (colWidth * 2));
        }
      }
      scrollElement.scrollLeft = targetScrollLeft;
      if (scrollElement !== wrapper) wrapper.scrollLeft = targetScrollLeft;
    }, delay);
  });
}

function patchGanttVisuals(ganttInst, containerSelector, currentProjData = null) {
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

  if (currentProjData && currentProjData.pauseHistory) {
    const firstDateMs = ganttInst.dates[0].getTime();
    function getDateX(dateString, isEnd = false) {
        let d = new Date(dateString.replace(/-/g, '/'));
        if (isEnd) d.setHours(23, 59, 59, 999);
        else d.setHours(0, 0, 0, 0);
        return ((d.getTime() - firstDateMs) / (1000 * 60 * 60 * 24)) * colWidth;
    }

    currentProjData.pauseHistory.forEach(pause => {
      const pStart = pause.start; 
      const pEnd = pause.end || getTodayStr();
      let startX = getDateX(pStart, false);
      let endX = getDateX(pEnd, true);
      let lineWidth = endX - startX;
      if (lineWidth < 4) lineWidth = 4;

      const barWrappers = svg.querySelectorAll('.bar-wrapper');
      barWrappers.forEach(barWrapper => {
        const taskId = barWrapper.getAttribute('data-id'); 
        if (!taskId || !taskId.startsWith('t_')) return;
        
        const taskIndex = parseInt(taskId.replace('t_', ''));
        const rawTask = currentProjData.tasks[taskIndex]; 
        if (!rawTask) return;

        if (rawTask.start <= pStart && rawTask.end >= pStart) {
          const barRect = barWrapper.querySelector('.bar');
          if (barRect) {
            const barY = parseFloat(barRect.getAttribute('y') || 0);
            const barHeight = parseFloat(barRect.getAttribute('height') || 0);
            const redLine = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            redLine.setAttribute('x', startX);
            redLine.setAttribute('y', barY + barHeight / 2 - 6); 
            redLine.setAttribute('width', lineWidth);
            redLine.setAttribute('height', 10); 
            redLine.setAttribute('fill', '#dc2626'); 
            redLine.setAttribute('rx', '4');
            redLine.style.pointerEvents = 'none'; 
            barWrapper.appendChild(redLine);
          }
        }
      });
    });
  }

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
        if (origX < currentScrollLeft + 120) el.style.display = 'none';
        else el.style.display = 'block';
      }
    });
  };

  scrollElement.removeEventListener('scroll', scrollElement._ganttScrollHandler);
  scrollElement._ganttScrollHandler = updateStickyMonthHeader;
  scrollElement.addEventListener('scroll', updateStickyMonthHeader);
  updateStickyMonthHeader();
  scrollToTodayMinus2Days(ganttInst, containerSelector);
}

onAuthStateChanged(auth, async (user) => {
  if (user) {
    document.getElementById("auth-section").style.display = "none";
    document.getElementById("app-section").style.display = "flex";
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
        currentUserData = { name: user.email.split('@')[0], email: user.email, dept: "設計部", role: "admin", canEdit: false };
        await setDoc(doc(db, "users", user.uid), currentUserData, { merge: true });
      }
    } catch (e) { 
      currentUserData = { name: user.email.split('@')[0], email: user.email, dept: "設計部", role: "admin", canEdit: false }; 
    }
    
    const displayName = currentUserData.name || user.email.split('@')[0];
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

    const navApp = document.getElementById("nav-approvals");
    if (navApp) {
      navApp.style.display = "none";
    }
    
    if (currentUserData.role !== 'staff') { 
      document.getElementById('nav-sub-wrapper').style.display = 'block'; 
      loadSidebarSubordinates(); 
    } else {
      document.getElementById('nav-sub-wrapper').style.display = 'none';
    }
    window.initNotificationsUI();
    loadOrgUsers();
    initWeeklyDateAndLeave(); 
    addTaskRow(); 
    addWeeklyRow(); 
    loadProjects(); 
    loadAdHocEvents(); 
    loadWeeklyReports();
    loadMyCalendarTodos(user.uid);
    initTemplateUI();
    window.injectFontSizeUI();
  } else {
    document.getElementById("auth-section").style.display = "flex"; 
    document.getElementById("app-section").style.display = "none";
  }
});

function loadSidebarSubordinates() {
  const rolePriority = { admin: 1, top_manager: 2, senior_manager: 3, manager: 4, assistant_manager: 5, staff: 6 };
  onSnapshot(collection(db, "users"), (snapshot) => {
    const list = document.getElementById("nav-sub-list");
    if (!list) return;

    list.innerHTML = `<li class="nav-sub-item active" id="sub-li-${auth.currentUser.uid}" onclick="switchViewingUser('${auth.currentUser.uid}', '自己 (個人專案)')">個人專案</li>`;
    const visibleUsers = [];
    const myUid = auth.currentUser.uid;
    const myRole = currentUserData.role; 
    const myDept = currentUserData.dept || "設計部";

    allUsersList = [];
    snapshot.forEach(docSnap => allUsersList.push({ uid: docSnap.id, ...docSnap.data() }));

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
      if (myRole === 'admin' || myRole === 'top_manager' || myRole === 'senior_manager') canView = true;
      else if (myRole === 'manager') {
        if (targetDept === myDept && (targetRole === 'assistant_manager' || targetRole === 'staff')) canView = true;
      }
      else if (myRole === 'assistant_manager') {
        if (targetDept === myDept && targetRole === 'staff') canView = true;
      }
      if (canView || isSubordinate(myUid, u.uid)) visibleUsers.push(u);
    });

    departmentList.forEach((dept, dIdx) => {
      const deptMembers = visibleUsers.filter(u => (u.dept || "設計部") === dept);
      if (deptMembers.length === 0) return;
      deptMembers.sort((a, b) => (rolePriority[a.role] || 99) - (rolePriority[b.role] || 99));

      const deptGroupId = `dept-group-${dIdx}`;
      const isViewingMemberInDept = deptMembers.some(m => m.uid === viewingUserId);
      const isExpanded = isViewingMemberInDept;

      list.innerHTML += `
        <li class="nav-sub-dept-header ${isExpanded ? 'open' : ''}" onclick="toggleDeptSubList('${deptGroupId}', this)">
          <div style="display:flex; align-items:center; gap:6px;">
            <span>🏢</span><span>${dept}</span><span class="dept-count-badge">${deptMembers.length}</span>
          </div>
          <span class="dept-arrow">▶</span>
        </li>
      `;

      let membersHtml = `<div class="nav-sub-dept-members" id="${deptGroupId}" style="display:${isExpanded ? 'flex' : 'none'};">`;
      deptMembers.forEach(u => {
        const isActive = (viewingUserId === u.uid) ? 'active' : '';
        membersHtml += `
          <li class="nav-sub-item ${isActive}" id="sub-li-${u.uid}" onclick="switchViewingUser('${u.uid}', '${u.name}')">
            ${u.name || '未命名'} <small style="color:#94a3b8; font-size:11px; margin-left:4px;">(${roleNames[u.role] || '人員'})</small>
          </li>
        `;
      });
      membersHtml += `</div>`;
      list.innerHTML += membersHtml;
    });
    renderProjects();
  });
}

window.toggleDeptSubList = (groupId, headerElem) => {
  const container = document.getElementById(groupId);
  if (!container) return;
  const isHidden = container.style.display === 'none';
  container.style.display = isHidden ? 'flex' : 'none';
  headerElem.classList.toggle('open', isHidden);
};

window.switchViewingUser = (uid, name) => {
    viewingUserId = uid;
    document.querySelectorAll('.nav-sub-item').forEach(el => el.classList.remove('active'));
    const targetLi = document.getElementById(`sub-li-${uid}`);
    if (targetLi) targetLi.classList.add('active');

    const isSelf = viewingUserId === auth.currentUser.uid;
    document.getElementById('viewing-user-name').innerText = isSelf ? '' : `[ 正在檢視：${name} ]`;
    document.getElementById('btn-create-wrapper').style.display = isSelf ? 'flex' : 'none';
    document.getElementById('create-project-section').style.display = 'none';
    document.getElementById('adhoc-form-panel').style.display = isSelf ? 'block' : 'none';
    document.getElementById('weekly-form-panel').style.display = isSelf ? 'block' : 'none';

    selectedProjectId = 'SUMMARY'; 
    isEditMode = false;
    const editBtn = document.getElementById("btn-toggle-edit-mode");
    if(editBtn) {
       editBtn.innerHTML = "✏️ 開啟編輯模式";
       editBtn.style.background = "transparent";
    }

    const activePane = Array.from(document.querySelectorAll('.tab-pane')).find(el => el.style.display === 'block');
    const activeTabId = activePane ? activePane.id : 'tab-projects';

    if (activeTabId !== 'tab-projects' && activeTabId !== 'tab-adhoc' && activeTabId !== 'tab-weekly') {
        document.querySelectorAll('.tab-pane').forEach(el => el.style.display = 'none');
        document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
        const projPane = document.getElementById('tab-projects');
        if (projPane) projPane.style.display = 'block';
        const projectNavElem = document.querySelector('li[onclick*="tab-projects"]') || document.querySelector('.nav-item');
        if (projectNavElem) projectNavElem.classList.add('active');
        const titleEl = document.getElementById('current-title');
        if (titleEl) titleEl.innerText = '專案進度';
    }

    renderProjects(); 
    renderAdHocEvents(); 
    renderWeeklyReports();

    const wrapper = document.getElementById('nav-sub-wrapper');
    const list = document.getElementById('nav-sub-list');
    if (wrapper.classList.contains('nav-menu-open')) wrapper.classList.remove('nav-menu-open');
    if (list.classList.contains('mobile-fixed-dropdown')) {
      wrapper.appendChild(list); 
      list.classList.remove('mobile-fixed-dropdown'); 
    }
};

document.getElementById("btn-login").addEventListener("click", () => { 
  signInWithEmailAndPassword(auth, document.getElementById("login-email").value.trim(), document.getElementById("login-password").value.trim()).catch(e=>alert(e.message)); 
});
document.getElementById("btn-logout").addEventListener("click", () => signOut(auth));

function getNextWorkingDayStr(dateStr) {
  if (!dateStr) return ''; 
  let d = new Date(dateStr); 
  d.setDate(d.getDate() + 1);
  while (isHolidayOrWeekend(d)) {
    d.setDate(d.getDate() + 1);
  }
  return formatDateSafe(d);
}

window.checkWorkingDay = (input) => { 
  if (!input.value) return; 
  const d = new Date(input.value); 
  if (isHolidayOrWeekend(d)) { 
    alert("系統只能點選工作日！(已自動避開週末與國定假日)"); 
    input.value = ''; 
  } 
};

window.cascadeDatesIfSequential = (startRow) => {
    const container = document.getElementById("task-list-container");
    if (!container || container.dataset.cascadeMode !== 'sequential') return;

    const rows = Array.from(container.querySelectorAll('.task-row'));
    const startIndex = rows.indexOf(startRow);
    if (startIndex === -1) return;

    for (let i = startIndex; i < rows.length; i++) {
        const row = rows[i];
        const startInput = row.querySelector('.task-start');
        const daysInput = row.querySelector('.task-days');
        const endInput = row.querySelector('.task-end');

        if (!startInput.value) break; 
        const days = parseInt(daysInput.value) || 1;
        endInput.value = calculateEndDateByDays(startInput.value, days);
        endInput.min = startInput.value;

        if (i + 1 < rows.length) {
            const nextRow = rows[i + 1];
            const nextStartInput = nextRow.querySelector('.task-start');
            nextStartInput.value = getNextWorkingDayStr(endInput.value);
        }
    }
};

window.onTaskStartChange = (startInput, targetEndId) => {
  window.checkWorkingDay(startInput);
  if (!startInput.value) return;
  const row = startInput.closest('.task-row') || startInput.closest('.tpl-task-row') || startInput.closest('#general-edit-form') || startInput.closest('.modal-box');
  const endInput = typeof targetEndId === 'string' ? document.getElementById(targetEndId) : row?.querySelector('.task-end') || row?.querySelector('.tpl-task-end');
  const daysInput = row?.querySelector('.task-days') || row?.querySelector('.tpl-task-days') || row?.querySelector('#add-task-days') || row?.querySelector('#edit-val-days');

  if (endInput) {
    endInput.min = startInput.value;
    const days = daysInput ? parseInt(daysInput.value) || 1 : 1;
    endInput.value = calculateEndDateByDays(startInput.value, days);
  }

  if (row && row.classList.contains('task-row') && row.closest('#task-list-container')) {
      cascadeDatesIfSequential(row);
  }
};

window.onTaskDaysChange = (daysInput, targetStartId, targetEndId) => {
  const row = daysInput.closest('.task-row') || daysInput.closest('.tpl-task-row') || daysInput.closest('#general-edit-form') || daysInput.closest('.modal-box');
  const startInput = typeof targetStartId === 'string' ? document.getElementById(targetStartId) : row?.querySelector('.task-start') || row?.querySelector('.tpl-task-start') || row?.querySelector('#add-task-start');
  const endInput = typeof targetEndId === 'string' ? document.getElementById(targetEndId) : row?.querySelector('.task-end') || row?.querySelector('.tpl-task-end') || row?.querySelector('#add-task-end');

  const days = parseInt(daysInput.value) || 1;
  if (startInput && startInput.value && endInput) {
    endInput.value = calculateEndDateByDays(startInput.value, days);
    endInput.min = startInput.value;
  }

  if (row && row.classList.contains('task-row') && row.closest('#task-list-container')) {
      cascadeDatesIfSequential(row);
  }
};

window.onTaskEndChange = (endInput, targetStartId, targetDaysId) => {
  window.checkWorkingDay(endInput);
  const row = endInput.closest('.task-row') || endInput.closest('.tpl-task-row') || endInput.closest('#general-edit-form') || endInput.closest('.modal-box');
  const startInput = typeof targetStartId === 'string' ? document.getElementById(targetStartId) : row?.querySelector('.task-start') || row?.querySelector('.tpl-task-start') || row?.querySelector('#add-task-start');
  const daysInput = typeof targetDaysId === 'string' ? document.getElementById(targetDaysId) : row?.querySelector('.task-days') || row?.querySelector('.tpl-task-days') || row?.querySelector('#add-task-days');

  if (startInput && startInput.value && endInput.value) {
    if (endInput.value < startInput.value) {
      alert("預計結束日不可早於開始日！");
      endInput.value = startInput.value;
    }
    const days = getWorkingDays(startInput.value, endInput.value);
    if (daysInput) daysInput.value = days;
  }

  if (row && row.classList.contains('task-row') && row.closest('#task-list-container')) {
      cascadeDatesIfSequential(row);
  }
};

window.addTaskRow = () => {
  const container = document.getElementById("task-list-container"); 
  const rows = container.querySelectorAll('.task-row');
  let defaultStart = rows.length > 0 ? getNextWorkingDayStr(rows[rows.length - 1].querySelector('.task-end').value) : "";
  let defaultEnd = defaultStart ? defaultStart : "";

  const div = document.createElement('div'); 
  div.className = "form-row task-row"; 
  div.style.marginBottom = "8px";
  div.innerHTML = `
    <div class="form-group" style="margin:0; flex:3;"><input type="text" class="input-control task-name" placeholder="細項名稱"></div>
    <div class="form-group" style="margin:0; flex:1.5;"><input type="date" class="input-control task-start" value="${defaultStart}" onchange="onTaskStartChange(this, null)"></div>
    <div class="form-group" style="margin:0; width:65px; flex-shrink:0;"><input type="number" min="1" class="input-control task-days" value="1" placeholder="天數" title="工作天數" oninput="onTaskDaysChange(this, null, null)"></div>
    <div class="form-group" style="margin:0; flex:1.5;"><input type="date" class="input-control task-end" value="${defaultEnd}" min="${defaultStart}" onchange="onTaskEndChange(this, null, null)"></div>
    <div style="display:flex; gap:4px; margin:0; flex-shrink:0;">
      <button type="button" class="action-btn btn-sort" onclick="moveTaskRow(this, -1)" title="上移">↑</button>
      <button type="button" class="action-btn btn-sort" onclick="moveTaskRow(this, 1)" title="下移">↓</button>
      <button type="button" class="action-btn danger" onclick="this.closest('.task-row').remove()" style="padding:8px 10px;">X</button>
    </div>
  `;
  container.appendChild(div);
};

window.moveTaskRow = (btn, direction) => {
  const row = btn.closest('.task-row') || btn.closest('.tpl-task-row');
  if (!row) return;
  if (direction === -1 && row.previousElementSibling) {
    row.parentNode.insertBefore(row, row.previousElementSibling);
  } else if (direction === 1 && row.nextElementSibling) {
    row.parentNode.insertBefore(row.nextElementSibling, row);
  }
};

window.setProjectFilter = (status) => {
  currentFilter = status;
  document.querySelectorAll('.kpi-card').forEach(el => el.classList.remove('active'));
  const activeBtn = document.getElementById('filter-' + status);
  if(activeBtn) activeBtn.classList.add('active');
  
  selectedProjectId = 'SUMMARY'; 
  renderProjects();
};

window.selectProject = (projId) => { 
  selectedProjectId = projId; 
  isEditMode = false;
  const editBtn = document.getElementById("btn-toggle-edit-mode");
  if(editBtn) {
     editBtn.innerHTML = "✏️ 開啟編輯模式";
     editBtn.style.background = "transparent";
  }
  renderProjects(); 
};

window.getAvailableTasks = (projId) => {
  const proj = allProjectsData.find(p => p.id === projId);
  if(!proj || !proj.tasks) return [];
  return proj.tasks.map((t, index) => ({ ...t, index })).filter(t => {
    // 🌟 加入這行：強制排除所有系統通知任務，不讓它出現在週報選項中
    if (t.name && t.name.includes("[系統通知]")) return false;

    const isMyTask = (t.assigneeId === viewingUserId) || (!t.assigneeId && proj.ownerId === viewingUserId);
    if (!isMyTask) return false;
    if (!t.isCompleted) return true;
    if (t.reportedCompleted === true) return false;
    
    const taskCompletedTime = t.completedAt ? new Date(t.completedAt.replace(/-/g, '/')).getTime() : 0;
    const alreadyReported = allWeeklyData.some(w => {
      if(w.ownerId !== viewingUserId) return false;
      const reportTime = w.createdAt && typeof w.createdAt.toDate === 'function' ? w.createdAt.toDate().getTime() : Date.now();
      const hasTask = (w.items || []).some(item => item.projectId === proj.id && String(item.taskId) === String(t.index));
      return hasTask && reportTime > (taskCompletedTime - 60000);
    });
    return !alreadyReported;
  });
};

window.getAvailableAdHocEvents = () => {
  const myAdHocs = allAdHocData.filter(e => e.ownerId === viewingUserId);
  return myAdHocs.filter(evt => {
    if (!evt.isCompleted) return true;
    if (evt.reportedCompleted === true) return false; 
    
    const evtCompletedTime = evt.completedAt ? new Date(evt.completedAt).getTime() : 0;
    const alreadyReportedAfterCompletion = allWeeklyData.some(w => {
      if(w.ownerId !== viewingUserId) return false;
      const reportTime = w.createdAt ? w.createdAt.toDate().getTime() : Date.now();
      const hasItem = (w.items || []).some(item => item.projectId === 'SPECIAL_ADHOC' && item.taskId === evt.id);
      return hasItem && reportTime >= (evtCompletedTime - 60000); 
    });
    return !alreadyReportedAfterCompletion;
  });
};

function getAdHocDateStr(evt) {
  if (evt.startDate) return evt.startDate;
  if (evt.createdAt && evt.createdAt.toDate) return evt.createdAt.toDate().toISOString().split('T')[0];
  return new Date().toISOString().split('T')[0];
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

function getDynamicallyShiftedTasks(proj, todayStr) {
    let displayTasks = JSON.parse(JSON.stringify(proj.tasks || []));
    if (proj.status === 'paused' && proj.pauseHistory && proj.pauseHistory.length > 0) {
        const lastPause = proj.pauseHistory[proj.pauseHistory.length - 1];
        if (!lastPause.end) {
            let shift = getWorkingDays(lastPause.start, todayStr);
            let currentShiftDays = Math.max(0, shift - 1);
            if (currentShiftDays > 0) {
                displayTasks = displayTasks.map(t => {
                    if (t.isCompleted) return t;
                    if (t.start >= lastPause.start) return { ...t, start: calculateEndDateByDays(t.start, currentShiftDays + 1), end: calculateEndDateByDays(t.end, currentShiftDays + 1) };
                    if (t.end >= lastPause.start) return { ...t, end: calculateEndDateByDays(t.end, currentShiftDays + 1) };
                    return t;
                });
            }
        }
    }
    return displayTasks;
}

function renderProjects() {
  fixHeaders(); 
  checkEditModeVisibility();

  const isViewingSelf = (viewingUserId === auth.currentUser.uid);
  const myDept = currentUserData.dept || "設計部";
  const targetUser = allUsersList.find(u => u.uid === viewingUserId);
  const targetDept = isViewingSelf ? myDept : (targetUser?.dept || "設計部");
  
  const yearFilterVal = document.getElementById('project-year-filter')?.value || new Date().getFullYear().toString();
  const selectedYear = yearFilterVal === 'all' ? 'all' : parseInt(yearFilterVal);
  const todayStr = getTodayStr();

  // 1. 自己開案的專案
  const userProjects = allProjectsData.filter(p => p.ownerId === viewingUserId);
  const userAdHocs = allAdHocData.filter(e => e.ownerId === viewingUserId);

  // 2. 開放瀏覽專案 (部門被開放瀏覽，且自己不是開案者)
  const viewOnlyProjects = allProjectsData.filter(p => {
    const collabs = Array.isArray(p.collaborators) ? p.collaborators : [];
    return collabs.includes(targetDept) && p.ownerId !== viewingUserId;
  });

  // 3. 有細項指派給自己的專案 (自己非開案者，但有負責的細項)
  const assignedProjects = allProjectsData.filter(p => {
    const hasMyTask = (p.tasks || []).some(t => t.assigneeId === viewingUserId && !t.name?.includes("[系統通知]"));
    return hasMyTask && p.ownerId !== viewingUserId;
  });

  const allInvolvedProjectsMap = new Map();
  userProjects.forEach(p => allInvolvedProjectsMap.set(p.id, p));
  viewOnlyProjects.forEach(p => allInvolvedProjectsMap.set(p.id, p));
  assignedProjects.forEach(p => allInvolvedProjectsMap.set(p.id, p));

  // 🌟 修復核心漏洞 1：若為管理員/主管，或專案當前審核人是自己，將所有簽核中與退回中的專案納入檢視
  allProjectsData.forEach(p => {
    const isApprovalOrReject = (p.status === 'pending_approval' || p.status === 'rejected' || p.approvalConfig?.approvalStatus === 'rejected');
    if (isApprovalOrReject) {
      if (p.ownerId === viewingUserId || p.approvalConfig?.currentAssigneeUid === auth.currentUser.uid || currentUserData.role === 'admin' || currentUserData.role === 'top_manager') {
        allInvolvedProjectsMap.set(p.id, p);
      }
    }
  });
  
  const allInvolvedProjects = Array.from(allInvolvedProjectsMap.values()).map(p => {
      const shiftedTasks = getDynamicallyShiftedTasks(p, todayStr);
      const cleanTasks = shiftedTasks.filter(t => {
          if (!t || !t.name) return false;
          if (t.name.includes("[系統通知]")) return false;
          if (t.parentSubProject === "專案審核通知" || t.parentSubProject === "專案指派確認" || t.parentSubProject === "協作指派審核") return false;
          return true;
      });
      return { ...p, tasks: cleanTasks };
  });

  let countOngoing = 0, countCompleted = 0, countDelayed = 0, countPendingApproval = 0;
  let projectsOngoing = [], projectsCompleted = [], projectsDelayed = [], projectsPendingApproval = [];

  allInvolvedProjects.forEach(p => {
    const isRealOwner = (p.ownerId === viewingUserId);
    
    // 🌟 修復核心漏洞 2：兼容舊資料 (含 approvalStatus: 'rejected')
    const isApprovalOrRejected = (p.status === 'pending_approval' || p.status === 'rejected' || p.approvalConfig?.approvalStatus === 'rejected');
    if (isApprovalOrRejected) {
      if (isRealOwner || p.approvalConfig?.currentAssigneeUid === auth.currentUser.uid || currentUserData.role === 'admin' || currentUserData.role === 'top_manager') {
        countPendingApproval++;
        projectsPendingApproval.push(p);
      }
      return;
    }
    // 🌟 核心過濾邏輯：
    // 開案者看專案全部任務；非開案者只看「指派給自己」的任務細項
    let relevantTasks = [];
    if (isRealOwner) {
      relevantTasks = (p.tasks || []).filter(t => !t.name || !t.name.includes("[系統通知]"));
    } else {
      relevantTasks = (p.tasks || []).filter(t => t.assigneeId === viewingUserId && !t.name?.includes("[系統通知]"));
    }

    // 🌟 關鍵限制：如果不是開案者，且在該專案中「完全沒有指派給自己的細項」
    // 表示這純粹是「開放瀏覽」的專案，絕對不能跑到未完成、已完成或 Delay！
    if (!isRealOwner && relevantTasks.length === 0) {
      return; 
    }

    const isAllDone = relevantTasks.length > 0 ? relevantTasks.every(t => t.isCompleted) : false;
    const hasDelay = relevantTasks.length > 0 ? relevantTasks.some(t => !t.isCompleted && todayStr > t.end) : false;
    const inYear = spansYear(p, selectedYear);

    if (!isAllDone) { 
      countOngoing++; 
      projectsOngoing.push(p); 
    }
    if (hasDelay) { 
      countDelayed++; 
      projectsDelayed.push(p); 
    }
    if (isAllDone && inYear && relevantTasks.length > 0) {
      countCompleted++;
      projectsCompleted.push(p);
    }
  });

  let adHocsOngoing = userAdHocs.filter(e => !e.isCompleted);
  let adHocsDelayed = userAdHocs.filter(e => !e.isCompleted && e.startDate < todayStr);
  let adHocsCompleted = userAdHocs.filter(e => e.isCompleted && (selectedYear === 'all' || parseInt(getAdHocDateStr(e).substring(0,4)) === selectedYear));

  countOngoing += adHocsOngoing.length;
  countCompleted += adHocsCompleted.length;
  countDelayed += adHocsDelayed.length;

  const elOngoing = document.getElementById('stat-ongoing');
  if(elOngoing) elOngoing.innerText = countOngoing; 
  const elCompleted = document.getElementById('stat-completed');
  if(elCompleted) elCompleted.innerText = countCompleted; 
  const elDelay = document.getElementById('stat-delay');
  if(elDelay) elDelay.innerText = countDelayed;
  const elCollab = document.getElementById('stat-collab');
  if(elCollab) elCollab.innerText = viewOnlyProjects.length; // 開放瀏覽數量
  const elPendingApp = document.getElementById('stat-pending-approval');
  if(elPendingApp) elPendingApp.innerText = countPendingApproval;

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
      activeList = viewOnlyProjects; // 🌟 點選「開放瀏覽」只看開放瀏覽的專案
      activeAdHocs = [];
  } else if (currentFilter === 'pending_approval') {
      activeList = projectsPendingApproval;
      activeAdHocs = [];
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
    summaryBtn.innerText = "🔙 返回列表"; 
    summaryBtn.onclick = () => selectProject('SUMMARY'); 
    tabsContainer.appendChild(summaryBtn);
  }

  activeList.forEach(p => {
    const isPendingPause = (p.status === 'pause_requested');
    const isPaused = (p.status === 'paused');
    const isApproval = (p.status === 'pending_approval');
    const isRejected = (p.status === 'rejected' || p.approvalConfig?.approvalStatus === 'rejected');
    
    const btn = document.createElement("button"); 
    btn.className = `proj-tab ${p.id === selectedProjectId ? 'active' : ''}`;
    btn.title = p.title || '未命名專案';
    
    let tabText = p.title || '未命名專案';
    if (isApproval) tabText = `⏳ ` + tabText;
    if (isRejected) tabText = `❌ ` + tabText; // 🌟 標註退回圖示
    if (isPendingPause) tabText += ` 🔔`;
    if (isPaused) tabText += ` 🛑`;
    
    btn.innerHTML = `<span>${tabText}</span>`;
    
    if (isApproval) {
      btn.style.border = "2px solid #f59e0b";
      btn.style.color = "#b45309";
    } else if (isRejected) {
      btn.style.border = "2px solid #ef4444";
      btn.style.color = "#b91c1c";
    }
    btn.onclick = () => selectProject(p.id); 
    if(tabsContainer) tabsContainer.appendChild(btn);
  });

  if(emptyState) emptyState.style.display = "none"; 

  // ==========================================
  // 檢視 1：列表總覽 (SUMMARY)
  // ==========================================
  if (selectedProjectId === 'SUMMARY') {
    if(detailView) detailView.style.display = "none"; 
    if(summaryView) summaryView.style.display = "block";
    
    let summaryLabel = "未完成";
    if (currentFilter === 'completed') summaryLabel = "已完成";
    else if (currentFilter === 'delayed') summaryLabel = "Delay";
    else if (currentFilter === 'collab') summaryLabel = "開放瀏覽";
    else if (currentFilter === 'pending_approval') summaryLabel = "簽核中";
    
    const panelHeadSpan = document.querySelector('#project-summary-view .panel-head span');
    if (panelHeadSpan) panelHeadSpan.innerText = `⭐ 專案清單 (${summaryLabel})`;

    const sumLeftBody = document.getElementById("gantt-summary-left-body");
    if(sumLeftBody) sumLeftBody.innerHTML = "";
    
    const ganttTasksSum = [];
    let combinedItems = [];
    let sIdx = 0;

    activeList.forEach(p => {
      let tasksForTimeline = p.tasks || []; 
      let minStart = "9999-12-31"; 
      let maxEnd = "0000-01-01"; 
      if (tasksForTimeline.length === 0) {
          minStart = getTodayStr();
          maxEnd = getTodayStr();
      } else {
          tasksForTimeline.forEach(t => { 
            if (t.start && t.start < minStart) minStart = t.start; 
            if (t.end && t.end > maxEnd) maxEnd = t.end; 
          });
          if (minStart === "9999-12-31") minStart = getTodayStr();
          if (maxEnd === "0000-01-01") maxEnd = getTodayStr();
      }

      let avgProg = 0;
      let isDone = false;
      let hasDelay = false;

      if (tasksForTimeline.length > 0) {
        let totalProg = 0;
        tasksForTimeline.forEach(t => totalProg += (t.progress || 0));
        avgProg = Math.round(totalProg / tasksForTimeline.length);
        isDone = tasksForTimeline.every(t => t.isCompleted);
        hasDelay = tasksForTimeline.some(t => !t.isCompleted && todayStr > t.end);
      }
      
      combinedItems.push({
        type: 'project', 
        sortDate: new Date(minStart.replace(/-/g, '/')).getTime() || 0, 
        idStr: `s_p_${sIdx++}`,
        projId: p.id,
        title: p.title || '未命名專案',
        start: minStart, 
        end: maxEnd, 
        progress: avgProg, 
        isDone: isDone, 
        hasDelay: hasDelay, 
        status: p.status,
        custom_class: isDone ? 'bar-success' : (p.color || 'bar-primary'),
        ownerName: p.ownerName || '未知'
      });
    });

    activeAdHocs.forEach(evt => {
      let eDate = getAdHocDateStr(evt);
      let prog = evt.isCompleted ? 100 : 0;
      let hasDelay = !evt.isCompleted && eDate < todayStr;
      
      combinedItems.push({
        type: 'adhoc', 
        sortDate: new Date(eDate.replace(/-/g, '/')).getTime() || 0, 
        idStr: `s_e_${sIdx++}`,
        title: evt.title || '未命名事件', 
        start: eDate, 
        end: eDate, 
        progress: prog, 
        isDone: evt.isCompleted, 
        hasDelay: hasDelay, 
        custom_class: 'bar-danger',
        ownerName: evt.ownerName || '未知'
      });
    });

    combinedItems.sort((a, b) => a.sortDate - b.sortDate);

    combinedItems.forEach(item => {
      ganttTasksSum.push({ id: item.idStr, name: item.title, start: item.start, end: item.end, progress: item.progress, custom_class: item.custom_class });
      const row = document.createElement("div"); 
      row.className = "gantt-row";

      if (item.type === 'project') {
        const origProj = allProjectsData.find(p => p.id === item.projId);
        const isCollabOrSubApproval = origProj?.approvalConfig?.isApplyCollab || 
                                      (origProj?.tasks || []).some(t => t.name?.includes("簽核流程") || t.parentSubProject?.includes("審核"));
        const projIcon = isCollabOrSubApproval ? "👥" : "🗂️";

        let statusText = item.isDone ? '<span style="color:var(--success); font-weight:700;">完成</span>' : `<span>${item.progress}%</span>`;
        if (item.status === 'pending_approval') {
          statusText = '<span style="color:var(--warning); font-weight:700;">⏳ 簽核中</span>';
        } else if (item.status === 'rejected' || origProj?.approvalConfig?.approvalStatus === 'rejected') {
          statusText = '<span style="color:var(--danger); font-weight:700;">❌ 已退回</span>';
        } else if (item.hasDelay && !item.isDone) {
          statusText = '<span style="color:var(--danger); font-weight:700;">Delay</span>';
        }

        let badgeHtml = "";
        if (item.status === 'pause_requested') {
            badgeHtml = `<span style="background: rgba(245, 158, 11, 0.15); color: #b45309; border: 1px solid rgba(245, 158, 11, 0.4); padding: 2px 6px; border-radius: 4px; font-size: 11px; margin-right: 6px; flex-shrink: 0; white-space: nowrap;">🔔 待審核暫停</span>`;
        } else if (item.status === 'paused') {
            badgeHtml = `<span style="background: rgba(239, 68, 68, 0.15); color: #b91c1c; border: 1px solid rgba(239, 68, 68, 0.4); padding: 2px 6px; border-radius: 4px; font-size: 11px; margin-right: 6px; flex-shrink: 0; white-space: nowrap;">🛑 暫停</span>`;
        }

        // 🌟 已恢復 font-weight:700 粗體顯示
        let titleDisplay = `${badgeHtml}<span style="color:#0f172a; font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${projIcon} ${item.title}</span>`;
          
        row.innerHTML = `<div class="col-sum-name clickable" title="點擊前往專案：${item.title}" onclick="selectProject('${item.projId}')" style="display:flex; align-items:center; overflow:hidden;">${titleDisplay}</div><div class="col-sum-date"><span>${item.start.substring(5)}</span><span>~ ${item.end.substring(5)}</span></div><div class="col-sum-prog">${statusText}</div><div class="col-sum-owner" title="開案者：${item.ownerName}">${item.ownerName}</div>`;
      } else {
        let statusText = item.isDone ? '<span style="color:var(--success); font-weight:700;">完成</span>' : '處理中';
        if (item.hasDelay && !item.isDone) {
            statusText = '<span style="color:var(--danger); font-weight:700;">Delay</span>';
        }
        // 🌟 事件紀錄也維持 font-weight:700 粗體
        row.innerHTML = `<div class="col-sum-name" style="color:var(--danger); font-weight:700;" title="${item.title}">🚨 ${item.title}</div><div class="col-sum-date"><span>${item.start.substring(5)}</span></div><div class="col-sum-prog">${statusText}</div><div class="col-sum-owner" title="開案者：${item.ownerName}">${item.ownerName}</div>`;
      }
      if(sumLeftBody) sumLeftBody.appendChild(row);
    });
    
    if (ganttTasksSum.length > 0) {
      document.getElementById("gantt-chart-summary-container").innerHTML = '<div id="gantt-chart-summary"></div>';
      setTimeout(() => {
        if (document.getElementById("tab-projects").style.display === "none") return;
        summaryGanttInstance = new Gantt("#gantt-chart-summary", ganttTasksSum, { 
          view_mode: 'Day', 
          language: 'zh', 
          header_height: 50, 
          bar_height: 20, 
          padding: 18, 
          readonly: true 
        });
        patchGanttVisuals(summaryGanttInstance, '#gantt-chart-summary-container');
        scrollToTodayMinus2Days(summaryGanttInstance, '#gantt-chart-summary-container'); 
      }, 100); 
    } else { 
      document.getElementById("gantt-chart-summary-container").innerHTML = ''; 
    }
    return;
  }

  // ==========================================
  // 檢視 2：專案詳細內容檢視
  // ==========================================
  if(summaryView) summaryView.style.display = "none"; 
  if(detailView) detailView.style.display = "block";
  const activeProj = activeList.find(p => p.id === selectedProjectId);
  if(!activeProj) return; 

  const isProjOwner = (activeProj.ownerId === auth.currentUser.uid);
  const isGlobalAdmin = (currentUserData.role === 'admin');
  const inGracePeriod = isWithin7DaysGracePeriod(activeProj);
  const collabList = Array.isArray(activeProj.collaborators) ? activeProj.collaborators : [];
  const hasViewOnly = collabList.length > 0;
  
  // 核心控制權：只有開案者或全域管理員可以新增細項、新增子專案、刪除或修改專案主檔
  let canOperateProject = (isGlobalAdmin || isProjOwner);
  let canEditMainProj = (isGlobalAdmin && isEditMode) || (isProjOwner && inGracePeriod);

  let editProjBtn = canEditMainProj ? `<button class="action-btn" onclick="openGeneralEdit('project', '${activeProj.id}')" style="margin-left:8px; padding:2px 6px;">✏️ 編輯主資訊</button>` : '';
  let viewOnlyBadge = hasViewOnly ? `<span class="pill" style="background:#f1f5f9; color:#475569; border:1px solid #cbd5e1; margin-left:8px;">👁️ 開放瀏覽：<span style="color:#0f172a; font-weight:600;">${collabList.join(', ')}</span></span>` : '';
  let graceBadge = (inGracePeriod && canOperateProject) ? `<span class="pill pill-success" style="margin-left:8px;">🟢 自由編輯期 (剩餘 ${getGraceDaysLeft(activeProj)} 天)</span>` : '';
  let titleDisplayName = `<span style="color:#2563eb; font-weight:700; word-break: break-all;">${activeProj.title || '未命名專案'}</span>`;
  
  let approvalLogBtn = (activeProj.approvalHistory && activeProj.approvalHistory.length > 0)
    ? `<button class="action-btn" onclick="openApprovalLogModal('${activeProj.id}')" style="margin-left:8px; border-color:#818cf8; color:#4f46e5; font-weight:bold; padding:2px 8px;">📜 簽核紀錄</button>`
    : '';

  let statusBadge = "";
  let pauseBtnHtml = "";
  let resubmitBtnHtml = ""; // 🌟 新增：重新送審按鈕容器
  const isAdminOrTop = currentUserData.role === 'admin' || currentUserData.role === 'top_manager';

  if (activeProj.status === 'pending_approval') {
      statusBadge = `<span class="pill pill-warning" style="margin-left:8px; white-space:nowrap;">⏳ 簽核審查中</span>`;
  } else if (activeProj.status === 'rejected') {
      // 🌟 當專案被退回時，顯示紅底退回標籤；若當前使用者為開案者，則顯示重新送審按鈕
      statusBadge = `<span class="pill pill-danger" style="margin-left:8px; white-space:nowrap;">❌ 專案已被退回</span>`;
      if (activeProj.ownerId === auth.currentUser.uid) {
          resubmitBtnHtml = `<button class="action-btn" onclick="openResubmitModal('${activeProj.id}')" style="margin-left:8px; background:#4f46e5; color:#fff; border:none; padding:3px 10px; font-weight:bold; border-radius:4px; cursor:pointer;">🔄 重新送審</button>`;
      }
  } else if (activeProj.status === 'pause_requested') {
      statusBadge = `<span class="pill pill-warning" style="margin-left:8px; white-space:nowrap;">⏸️ 暫停審核中 (${activeProj.pauseRequestedBy || '有人'} 申請)</span>`;
      if (isAdminOrTop) {
          pauseBtnHtml = `<button class="action-btn" onclick="approvePause('${activeProj.id}')" style="margin-left:8px; background:var(--danger); color:#fff; border:none; padding:4px 10px; width:auto; display:inline-block; font-weight:bold;">同意暫停</button><button class="action-btn" onclick="rejectPause('${activeProj.id}')" style="margin-left:4px; padding:4px 10px; width:auto; display:inline-block; font-weight:bold;">退回</button>`;
      }
  } else if (activeProj.status === 'resume_requested') {
      statusBadge = `<span class="pill pill-warning" style="margin-left:8px; white-space:nowrap;">⏳ 恢復審核中 (${activeProj.resumeRequestedBy || '有人'} 申請)</span>`;
      if (isAdminOrTop) {
          pauseBtnHtml = `<button class="action-btn" onclick="approvePause('${activeProj.id}')" style="margin-left:8px; background:var(--success); color:#fff; border:none; padding:4px 10px; width:auto; display:inline-block; font-weight:bold;">同意恢復</button><button class="action-btn" onclick="rejectPause('${activeProj.id}')" style="margin-left:4px; padding:4px 10px; width:auto; display:inline-block; font-weight:bold;">退回</button>`;
      }
  } else if (activeProj.status === 'paused') {
      statusBadge = `<span class="pill pill-danger" style="margin-left:8px; white-space:nowrap;">🛑 專案已暫停</span>`;
      if (isAdminOrTop) {
          pauseBtnHtml = `<button class="action-btn" onclick="resumeProject('${activeProj.id}')" style="margin-left:8px; background:var(--success); color:#fff; border:none; padding:4px 10px; width:auto; display:inline-block; font-weight:bold;">▶️ 恢復執行</button>`;
      } else if (canOperateProject) {
          pauseBtnHtml = `<button class="action-btn" onclick="openResumeModal('${activeProj.id}')" style="margin-left:8px; border-color:var(--success); color:var(--success); padding:4px 10px; width:auto; display:inline-block; font-weight:bold;">▶️ 申請恢復</button>`;
      }
  } else {
      if (canOperateProject) {
          pauseBtnHtml = `<button class="action-btn" onclick="openPauseModal('${activeProj.id}')" style="margin-left:8px; border-color:var(--danger); color:var(--danger); padding:4px 10px; width:auto; display:inline-block; font-weight:bold;">⏸️ 申請暫停</button>`;
      }
  }
  
  let canDeleteProj = (isProjOwner && inGracePeriod) || (isGlobalAdmin && isEditMode);
  let inlineDelBtn = canDeleteProj ? `<button class="action-btn danger" onclick="deleteCurrentProject()" style="padding:2px 8px; font-size:12px; margin-left:4px; font-weight:bold;">🗑️ 刪除專案</button>` : '';

  const currentTitleEl = document.getElementById("current-gantt-title");
  if (currentTitleEl) currentTitleEl.innerHTML = `
      <span style="color:#0f172a; font-weight:700;">專案：</span>${titleDisplayName} 
      <span style="display:inline-flex; flex-wrap:wrap; align-items:center; gap:4px; margin-top:2px;">
          ${viewOnlyBadge} ${statusBadge} ${resubmitBtnHtml} ${graceBadge} ${approvalLogBtn} ${pauseBtnHtml} ${editProjBtn} ${inlineDelBtn}
      </span>
  `;
  
  // 🌟 嚴格控制：只有開案者或系統管理員可以看見新增細項/子專案按鈕
  const btnProjectAddTask = document.getElementById("btn-project-add-task");
  const btnProjectAddSubProject = document.getElementById("btn-project-add-subproject");
  const delProjBtn = document.getElementById("btn-project-del"); 

  if (btnProjectAddTask) {
    btnProjectAddTask.style.display = canOperateProject ? "inline-block" : "none";
    btnProjectAddTask.innerText = "➕ 新增細項";
  }
  if (btnProjectAddSubProject) {
    btnProjectAddSubProject.style.display = canOperateProject ? "inline-block" : "none";
  }
  if (delProjBtn) {
    delProjBtn.style.display = canDeleteProj ? "inline-block" : "none";
  }

  const leftBody = document.getElementById("gantt-left-body");
  const listBody = document.getElementById("project-list-tbody");
  if(leftBody) leftBody.innerHTML = ""; 
  if(listBody) listBody.innerHTML = "";

  if (!window.collapsedSubProjects) window.collapsedSubProjects = {};
  
  window.isSubProjCollapsed = (projId, subProjName) => {
      const key = `${projId}_${subProjName}`;
      if (window.collapsedSubProjects[key] === undefined) window.collapsedSubProjects[key] = true;
      return window.collapsedSubProjects[key];
  };
  window.toggleSubProject = (projId, subProjName) => {
      const key = `${projId}_${subProjName}`;
      window.collapsedSubProjects[key] = !window.collapsedSubProjects[key]; 
      renderProjects(); 
  };

  const renderList = [];
  const subProjMap = {};
  const handledGroups = new Set();

  (activeProj.tasks || []).forEach((task, index) => {
      if (task.isSubProjectTask && task.parentSubProject) {
          if (!subProjMap[task.parentSubProject]) {
              subProjMap[task.parentSubProject] = {
                  isGroupHeader: true,
                  parentSubProject: task.parentSubProject,
                  tasks: [],
                  originalIndexes: [],
                  start: "9999-12-31",
                  end: "0000-01-01",
                  isCompleted: true,
                  assigneeName: task.assigneeName || '原負責人'
              };
          }
          const group = subProjMap[task.parentSubProject];
          group.tasks.push(task);
          group.originalIndexes.push(index);
          
          if (task.start && task.start !== "尚未建立細項" && task.start < group.start) group.start = task.start;
          if (task.end && task.end !== "尚未建立細項" && task.end > group.end) group.end = task.end;
          if (!task.isCompleted) group.isCompleted = false;
      }
  });

  // 🌟 尋找第一個 forEach（建立 subProjMap）：
  (activeProj.tasks || []).forEach((task, index) => {
      // 👈 加入這行防呆：如果是系統通知，絕對不當成子專案！
      if (task.name && task.name.includes("[系統通知]")) return;

      if (task.isSubProjectTask && task.parentSubProject) {
          if (!subProjMap[task.parentSubProject]) {
              subProjMap[task.parentSubProject] = {
                  isGroupHeader: true,
                  parentSubProject: task.parentSubProject,
                  tasks: [],
                  originalIndexes: [],
                  start: "9999-12-31",
                  end: "0000-01-01",
                  isCompleted: true,
                  assigneeName: task.assigneeName || '原負責人'
              };
          }
          const group = subProjMap[task.parentSubProject];
          group.tasks.push(task);
          group.originalIndexes.push(index);
          
          if (task.start && task.start !== "尚未建立細項" && task.start < group.start) group.start = task.start;
          if (task.end && task.end !== "尚未建立細項" && task.end > group.end) group.end = task.end;
          if (!task.isCompleted) group.isCompleted = false;
      }
  });

  // 🌟 尋找第二個 forEach（推入 renderList）：
  (activeProj.tasks || []).forEach((task, index) => {
      // 👈 同樣加入這行防呆：系統通知絕不單獨渲染成子專案或細項
      if (task.name && task.name.includes("[系統通知]")) return;

      if (task.isSubProjectTask && task.parentSubProject) {
          if (!handledGroups.has(task.parentSubProject)) {
              handledGroups.add(task.parentSubProject);
              const group = subProjMap[task.parentSubProject];
              let totalProg = 0;
              group.tasks.forEach(t => totalProg += (t.progress || 0));
              group.progress = group.tasks.length ? Math.round(totalProg / group.tasks.length) : 0;
              
              if(group.start === "9999-12-31") group.start = getTodayStr();
              if(group.end === "0000-01-01") group.end = getTodayStr();

              renderList.push(group); 
              
              const isCollapsed = window.isSubProjCollapsed(activeProj.id, task.parentSubProject);
              if (!isCollapsed) {
                  group.tasks.forEach((t, i) => {
                      renderList.push({ ...t, originalIndex: group.originalIndexes[i], isChild: true });
                  });
              }
          }
      } else {
          renderList.push({ ...task, originalIndex: index });
      }
  });

  const ganttTasks = [];
  renderList.forEach((item, displayIndex) => {
      if (item.isGroupHeader) {
          const isCollapsed = window.isSubProjCollapsed(activeProj.id, item.parentSubProject);
          const chevron = isCollapsed ? '▶' : '▼';
          const workDays = getWorkingDays(item.start, item.end);
          
          ganttTasks.push({ 
              id: `g_${displayIndex}`,
              name: `📦 ${item.parentSubProject}`, 
              start: item.start, 
              end: item.end, 
              progress: item.progress, 
              custom_class: item.isCompleted ? 'bar-success' : 'bar-warning' 
          });

          const sDate = new Date((item.start || getTodayStr()).replace(/-/g, '/'));
          const eDate = new Date((item.end || getTodayStr()).replace(/-/g, '/'));
          const sMonth = !isNaN(sDate.getMonth()) ? sDate.getMonth() + 1 : '-';
          const sDay = !isNaN(sDate.getDate()) ? sDate.getDate() : '-';
          const eMonth = !isNaN(eDate.getMonth()) ? eDate.getMonth() + 1 : '-';
          const eDay = !isNaN(eDate.getDate()) ? eDate.getDate() : '-';

          const subProjEditBtn = canOperateProject
            ? `<button class="action-btn" onclick="event.stopPropagation(); openEditSubProjectModal('${activeProj.id}', '${item.parentSubProject}')" style="padding:2px 6px; font-size:11px;" title="編輯子專案名稱與負責人">✏️</button>`
            : '';

          const row = document.createElement("div"); 
          row.className = "gantt-row";
          row.style.backgroundColor = "#fffbeb";
          row.innerHTML = `
              <div class="col-name" style="cursor:pointer; font-weight:bold; color:#d97706; flex:1.8; display:flex; align-items:center;" onclick="window.toggleSubProject('${activeProj.id}', '${item.parentSubProject}')">
                  <span>📦 ${item.parentSubProject}</span>
                  <span style="margin-left: 8px; font-size: 11px;">${chevron}</span>
              </div>
              <div class="col-expected-date" style="color: #64748b; font-size:12px;"><span>${sMonth}/${sDay}</span><span>~ ${eMonth}/${eDay}</span></div>
              <div class="col-date" style="color: #64748b;"><span>${workDays} 天</span></div>
              <div class="col-prog"><span style="font-weight:bold;">${item.progress}%</span></div>
              <div class="col-act">${subProjEditBtn}</div>
              <div class="col-owner" title="${item.assigneeName}">${item.assigneeName}</div>
          `;
          if(leftBody) leftBody.appendChild(row);
          
          if (listBody) {
              const tr = document.createElement("tr");
              tr.style.backgroundColor = "#fffbeb";
              tr.innerHTML = `
                  <td style="padding:8px 4px; font-weight:bold; color:#d97706; cursor:pointer;" colspan="4" onclick="window.toggleSubProject('${activeProj.id}', '${item.parentSubProject}')">
                      <div style="display:inline-flex; align-items:center;">
                          <span>📦 ${item.parentSubProject} (總進度: ${item.progress}%)</span>
                          <span style="margin-left: 8px; font-size: 11px;">${chevron}</span>
                      </div>
                  </td>
              `;
              listBody.appendChild(tr);
          }
      } else {
          const task = item;
          const index = item.originalIndex;
          try {
            const currentProgress = task.progress || 0;
            const safeStart = task.start || getTodayStr();
            const safeEnd = task.end || getTodayStr();
            const workDays = getWorkingDays(safeStart, safeEnd);
            
            ganttTasks.push({ 
              id: `t_${index}`, 
              name: task.name || '未命名任務', 
              start: safeStart, 
              end: safeEnd, 
              progress: currentProgress, 
              custom_class: task.isCompleted ? 'bar-success' : (activeProj.color || 'bar-primary')
            });

            const taskAssigneeId = task.assigneeId || activeProj.ownerId;
            let taskAssigneeName = task.assigneeName || activeProj.ownerName || '原負責人';
            
            if (task.isPendingAcceptance) taskAssigneeName = `⏳ ${taskAssigneeName}(待同意)`;
            const isMyTask = (auth.currentUser.uid === taskAssigneeId);

            let taskCreatedTime = Date.now();
            if (task.createdAt) {
                taskCreatedTime = typeof task.createdAt.toMillis === 'function' ? task.createdAt.toMillis() : task.createdAt;
            } else if (activeProj.createdAt) {
                taskCreatedTime = typeof activeProj.createdAt.toMillis === 'function' ? activeProj.createdAt.toMillis() : Date.now();
            }

            let isTaskInGrace = true;
            if (task.isSubProjectTask && !task.name?.includes("簽核流程")) {
                if (task.datesSetAt) {
                    isTaskInGrace = ((Date.now() - task.datesSetAt) / (1000 * 60 * 60 * 24)) <= 14;
                } else {
                    isTaskInGrace = true; 
                }
            } else {
                isTaskInGrace = ((Date.now() - taskCreatedTime) / (1000 * 60 * 60 * 24)) <= 7;
            }

            // 🌟 只有開案者、管理員、或被指派該任務的負責人才能操作此細項
            const canOperateThisTask = (isGlobalAdmin || isProjOwner || isMyTask);
            const isProjectPaused = activeProj.status === 'paused' || activeProj.status === 'pause_requested' || activeProj.status === 'pending_approval';
            const isInputLocked = task.isCompleted || !canOperateThisTask || isProjectPaused; 

            let canEditTask = canOperateThisTask && ((isGlobalAdmin && isEditMode) || ((isProjOwner || isMyTask) && isTaskInGrace));
            
            let editHtml = canEditTask ? `
              <div style="display:inline-flex; align-items:center; gap:2px; margin-left:auto; flex-shrink:0;">
                <button type="button" class="btn-sort" onclick="moveActiveProjectTask('${activeProj.id}', ${index}, -1)" title="上移">↑</button>
                <button type="button" class="btn-sort" onclick="moveActiveProjectTask('${activeProj.id}', ${index}, 1)" title="下移">↓</button>
                <button class="action-btn" onclick="openGeneralEdit('task', '${activeProj.id}', ${index})" style="padding:2px 5px; font-size:10px;" title="編輯細項">✏️</button>
                <button class="action-btn danger" onclick="deleteActiveProjectTask('${activeProj.id}', ${index})" style="padding:2px 5px; font-size:10px;" title="刪除此細項">🗑️</button>
              </div>` : '';

            const sDate = new Date(safeStart.replace(/-/g, '/'));
            const eDate = new Date(safeEnd.replace(/-/g, '/'));
            const sMonth = !isNaN(sDate.getMonth()) ? sDate.getMonth() + 1 : '-';
            const sDay = !isNaN(sDate.getDate()) ? sDate.getDate() : '-';
            const eMonth = !isNaN(eDate.getMonth()) ? eDate.getMonth() + 1 : '-';
            const eDay = !isNaN(eDate.getDate()) ? eDate.getDate() : '-';

            const expectedDateHtml = `<div class="col-expected-date" style="color: #64748b;"><span>${sMonth}/${sDay}</span><span>~ ${eMonth}/${eDay}</span></div>`;

            const progressInputStyle = task.isCompleted 
              ? 'width:46px; padding:2px 0px; text-align:center; height:24px; font-weight:bold; color:var(--success);' 
              : 'width:46px; padding:2px 0px; text-align:center; height:24px; font-weight:bold;';

            const confirmBtnStyle = (task.isCompleted || isInputLocked) ? 'opacity: 0.4; cursor: not-allowed;' : '';

            let displayName = task.name || '未命名任務';
            if (item.isChild && task.parentSubProject) {
                displayName = displayName.replace(`[${task.parentSubProject}] `, '');
            }
            const nameIndent = item.isChild ? 'padding-left: 22px; color: var(--text-muted);' : '';

            const row = document.createElement("div"); 
            row.className = "gantt-row";
            row.innerHTML = `
              <div class="col-name" title="${task.name || '未命名任務'}" style="${nameIndent}"><span style="overflow:hidden; text-overflow:ellipsis;">${displayName}</span>${editHtml}</div>
              ${expectedDateHtml}
              <div class="col-date" style="color: #64748b;"><span>${workDays} 天</span></div>
              <div class="col-prog"><input type="number" min="0" max="100" value="${currentProgress}" id="prog_input_${index}" ${isInputLocked ? 'disabled' : ''} style="${progressInputStyle}"><span style="font-weight:bold; margin-left:2px;">%</span></div>
              <div class="col-act"><button class="action-btn btn-sm" ${isInputLocked ? 'disabled' : ''} style="${confirmBtnStyle}" onclick="confirmProgress('${activeProj.id}', ${index}, '${safeEnd}')">${task.isCompleted ? '完成' : '確認'}</button></div>
              <div class="col-owner" title="${taskAssigneeName}">${taskAssigneeName}</div>
            `;
            if(leftBody) leftBody.appendChild(row);

            if (listBody) {
              let historyHtml = '';
              const historyList = task.history || [];
              if (historyList.length > 0) {
                const sortedHistory = [...historyList].sort((a, b) => {
                    let timeA = (a.timestamp && typeof a.timestamp === 'string') ? new Date(a.timestamp.replace(/-/g, '/')).getTime() : 0;
                    let timeB = (b.timestamp && typeof b.timestamp === 'string') ? new Date(b.timestamp.replace(/-/g, '/')).getTime() : 0;
                    return timeB - timeA;
                });
                
                historyHtml = `<div style="max-height: 180px; overflow-y: auto; padding-right: 2px;">` + 
                  `<table style="width:100%; table-layout:fixed; border-collapse:collapse; margin:0; background:transparent;"><colgroup><col style="width:22%;"><col style="width:78%;"></colgroup><tbody>` +
                  sortedHistory.map((h, i) => {
                     let histTimeMs = (h.timestamp && typeof h.timestamp === 'string') ? new Date(h.timestamp.replace(/-/g, '/')).getTime() : NaN;
                     let isHistWithin2Days = !isNaN(histTimeMs) && (Date.now() - histTimeMs) <= (2 * 24 * 60 * 60 * 1000);
                     let hasContent = (h.delayReason && h.delayReason.trim() !== "") || 
                                      (h.remark && h.remark.trim() !== "" && h.remark !== '專案建立' && h.remark !== '追加任務細項');

                     let canEditThisHist = canOperateThisTask && isHistWithin2Days && hasContent;
                     let rowEditBtn = canEditThisHist ? `<button class="action-btn" style="padding:1px 4px; font-size:10px; margin-left:6px;" onclick="openEditRemarkModal('${activeProj.id}', ${index}, '${h.timestamp}')">✏️ 修改</button>` : '';

                     let contentText = '';
                     if (h.type === 'complete' && h.delayReason) {
                         contentText = `<span class="pill pill-danger">Delay: ${h.delayReason}</span>`;
                     } else if (h.remark && h.remark !== '專案建立' && h.remark !== '追加任務細項' && h.remark !== '子專案指派建立' && h.remark !== '建立空子專案' && h.remark !== '追加空子專案') {
                         contentText = `<span style="color: var(--text-muted);">${h.remark}</span>`;
                     } else {
                         contentText = `<span style="color: #cbd5e1;">${h.remark || '-'}</span>`;
                     }

                     const borderStyle = i === sortedHistory.length - 1 ? "" : "border-bottom:1px dashed var(--border-light);";
                     return `<tr style="${borderStyle}">
                               <td style="padding: 6px 2px 6px 0; vertical-align: top;">
                                 <span style="color:var(--primary); font-weight:600; font-size:11px; white-space:nowrap;">[ ${h.timestamp || '-'} ]</span>
                                 <div style="margin-top:1px; font-size:10.5px; color:#64748b; white-space:nowrap;">歷時 <b>${h.daysPassed || 0}</b> 工作天</div>
                               </td>
                               <td style="padding: 6px 0 6px 4px; vertical-align: top; word-break: break-all;">
                                 <div style="display:flex; align-items:center; flex-wrap:wrap; margin-bottom:2px;">
                                   <span>${contentText}</span>
                                   ${rowEditBtn}
                                 </div>
                               </td>
                             </tr>`;
                  }).join('') + `</tbody></table></div>`;
              } else {
                historyHtml = `<div style="padding: 6px 0; color:var(--text-muted);">尚無紀錄</div>`;
              }

              const statusHtml = task.isCompleted ? `<span class="pill pill-success" style="padding:4px 8px;">已完成</span>` : `<span style="font-weight:bold;">進度: ${task.progress || 0}%</span>`;

              const tr = document.createElement("tr");
              tr.innerHTML = `
                <td style="vertical-align: top; padding: 8px 4px; ${nameIndent}"><strong>${displayName}</strong></td>
                <td style="vertical-align: top; padding: 8px 4px; width: 90px;">${taskAssigneeName}</td>
                <td style="vertical-align: top; padding: 8px 4px; width: 100px;">${statusHtml}</td>
                <td style="padding: 6px 4px; vertical-align: top;">
                    ${historyHtml}
                </td>`;
              listBody.appendChild(tr);
            }
          } catch (e) {
            console.error("渲染任務細項時發生錯誤:", e, task);
          }
      }
  });

  if (ganttTasks.length > 0) {
    const chartContainer = document.getElementById("gantt-chart-container");
    if(chartContainer) {
      chartContainer.className = "gantt-right-panel"; 
      chartContainer.innerHTML = '<div id="gantt-chart"></div>';
      setTimeout(() => {
        if (document.getElementById("tab-projects").style.display === "none") return;
        ganttInstance = new Gantt("#gantt-chart", ganttTasks, { 
          view_mode: 'Day', 
          language: 'zh', 
          header_height: 50, 
          bar_height: 20, 
          padding: 18, 
          readonly: true 
        });
        patchGanttVisuals(ganttInstance, '#gantt-chart-container', activeProj);
        scrollToTodayMinus2Days(ganttInstance, '#gantt-chart-container'); 
      }, 100); 
    }
  }

  // 暫停紀錄
  const pauseRecordsContainer = document.getElementById("project-pause-records");
  if (pauseRecordsContainer) {
      if (activeProj.pauseHistory && activeProj.pauseHistory.length > 0) {
          pauseRecordsContainer.style.display = "block";
          let histHtml = `<div class="panel-head"><span>🛑 專案暫停/恢復紀錄</span></div>
                         <div class="table-responsive"><table style="width:100%;">
                         <thead>
                             <tr><th style="width:20%">暫停起始日</th><th style="width:20%">恢復日期</th><th style="width:15%">暫停天數</th><th style="width:45%">暫停原因</th></tr>
                         </thead><tbody>`;
          let reversedHistory = [...activeProj.pauseHistory].reverse();
          reversedHistory.forEach(h => {
              let endStr = h.end ? h.end : '<span class="pill pill-danger" style="margin:0; padding:4px 8px;">🛑 暫停中</span>';
              let daysStr = h.days !== undefined ? `<strong style="color:var(--danger)">${h.days} 天</strong>` : '-';
              histHtml += `<tr>
                            <td>${h.start}</td>
                            <td>${endStr}</td>
                            <td>${daysStr}</td>
                            <td style="color:var(--text-muted); word-break:break-all;">${h.reason || ''}</td>
                           </tr>`;
          });
          histHtml += `</tbody></table></div>`;
          pauseRecordsContainer.innerHTML = histHtml;
      } else {
          pauseRecordsContainer.style.display = "none";
      }
  }
}
window.moveActiveProjectTask = async (projId, index, direction) => {
  const proj = allProjectsData.find(p => p.id === projId);
  if (!proj || !proj.tasks) return;
  const targetIndex = index + direction;
  if (targetIndex < 0 || targetIndex >= proj.tasks.length) return;

  const tasks = [...proj.tasks];
  const temp = tasks[index];
  tasks[index] = tasks[targetIndex];
  tasks[targetIndex] = temp;

  await updateDoc(doc(db, "projects", projId), { tasks });
};

window.deleteActiveProjectTask = async (projId, index) => {
  const proj = allProjectsData.find(p => p.id === projId);
  if (!proj || !proj.tasks || !proj.tasks[index]) return;
  
  const task = proj.tasks[index];
  let taskCreatedTime = task.createdAt || (proj.createdAt && typeof proj.createdAt.toMillis === 'function' ? proj.createdAt.toMillis() : Date.now());
  let isTaskInGrace = true;
  if (task.isSubProjectTask && !task.name.includes("簽核流程")) {
      if (task.datesSetAt) {
          isTaskInGrace = ((Date.now() - task.datesSetAt) / (1000 * 60 * 60 * 24)) <= 14;
      } else {
          isTaskInGrace = true;
      }
  } else {
      isTaskInGrace = ((Date.now() - taskCreatedTime) / (1000 * 60 * 60 * 24)) <= 7;
  }

  let isAuthorized = currentUserData.role === 'admin' || currentUserData.canEdit || ((proj.ownerId === auth.currentUser.uid || task.assigneeId === auth.currentUser.uid) && isTaskInGrace);
  
  if (!isAuthorized) return alert("⚠️ 此細項已超過 7 天編輯期限，只能請管理員協助刪除！");

  const taskName = task.name;
  if (!confirm(`⚠️ 確定要刪除任務細項「${taskName}」嗎？刪除後無法復原。`)) return;

  const tasks = [...proj.tasks];
  tasks.splice(index, 1);

 if (tasks.length === 0) {
    if (confirm("⚠️ 刪除此細項後，專案將沒有任何任務。\n是否要連同「整個主專案」一起刪除？\n(按【確定】刪除專案，按【取消】則保留空專案)")) {
      await deleteDoc(doc(db, "projects", projId));
      selectedProjectId = 'SUMMARY';
      alert("專案已刪除！");
      renderProjects();
      return;
    }
  }
  
  await updateDoc(doc(db, "projects", projId), { tasks });
  alert("已刪除該任務細項！");
};

window.openAddProjectTaskModal = () => {
  const proj = allProjectsData.find(p => p.id === selectedProjectId);
  if (!proj) return;
  const hasCollab = (proj.collaborators && proj.collaborators.length > 0);
  
  document.getElementById("project-task-modal-title").innerText = hasCollab ? "➕ 協作細項" : "➕ 新增細項";
  document.getElementById("project-task-modal-hint").innerText = hasCollab 
    ? "* 送出後，此細項負責人將自動設定為您的帳號。" 
    : "* 新增後自動加入目前專案中。";

  document.getElementById("add-task-name").value = "";
  document.getElementById("add-task-start").value = "";
  document.getElementById("add-task-days").value = "1";
  document.getElementById("add-task-end").value = "";
  document.getElementById("project-task-modal").classList.add("active");
};

window.closeAddProjectTaskModal = () => {
  document.getElementById("project-task-modal").classList.remove("active");
};

window.submitAddProjectTask = async () => {
  const name = document.getElementById("add-task-name").value.trim();
  const start = document.getElementById("add-task-start").value;
  const end = document.getElementById("add-task-end").value;

  if (!name || !start || !end) return alert("任務細項欄位不可有空白！");
  if (start > end) return alert("起始日不可大於結束日！");

  const proj = allProjectsData.find(p => p.id === selectedProjectId);
  if (!proj) return alert("找不到目前專案！");

  const todayStr = getTodayStr();
  const ts = new Date().toLocaleString('zh-TW', { hour12: false });
  let passedDays = 0;
  if (todayStr >= start) passedDays = getWorkingDays(start, todayStr);

  const newTask = {
    name,
    start,
    end,
    progress: 0,
    isCompleted: false,
    completedAt: null,
    delayReason: "",
    lastUpdatedAt: ts,
    reportedCompleted: false,
    assigneeId: auth.currentUser.uid,
    assigneeName: currentUserData.name || auth.currentUser.email.split('@')[0],
    createdAt: Date.now(), 
    isPendingAcceptance: false,
    history: [{ timestamp: ts, progress: 0, type: 'create', daysPassed: passedDays, delayReason: '', remark: '追加任務細項' }]
  };

  const updatedTasks = [...proj.tasks];
  let insertIndex = updatedTasks.length; 
  for (let i = 0; i < updatedTasks.length; i++) {
    if (start < updatedTasks[i].start) {
      insertIndex = i;
      break;
    }
  }
  updatedTasks.splice(insertIndex, 0, newTask);

  await updateDoc(doc(db, "projects", proj.id), { tasks: updatedTasks });
  closeAddProjectTaskModal();
  alert("🎉 任務細項追加成功！(已自動依日期排序)");
};

let resolveDelayPrompt = null;
window.openCustomPrompt = (title, label, isRequired, defaultValue = "") => {
    return new Promise((resolve) => {
        document.getElementById('delay-reason-title').innerText = title;
        document.getElementById('delay-reason-label').innerText = label;
        
        const inputElem = document.getElementById('delay-reason-input');
        inputElem.value = defaultValue !== undefined && defaultValue !== null ? String(defaultValue) : "";
        
        inputElem.dataset.required = isRequired;
        inputElem.placeholder = isRequired ? "請輸入原因 (必填)..." : "請輸入備註 (選填)...";
        
        document.getElementById('delay-reason-modal').classList.add('active');
        
        setTimeout(() => {
            inputElem.focus();
        }, 50);
        
        resolveDelayPrompt = resolve;
    });
};

window.closeDelayModal = () => {
  document.getElementById('delay-reason-modal').classList.remove('active');
  if (resolveDelayPrompt) resolveDelayPrompt(null);
};

window.submitDelayReason = () => {
  const val = document.getElementById('delay-reason-input').value.trim();
  const isReq = document.getElementById('delay-reason-input').dataset.required === 'true';
  if (isReq && !val) return alert("此為必填欄位，請務必填寫原因！");
  
  document.getElementById('delay-reason-modal').classList.remove('active');
  if (resolveDelayPrompt) resolveDelayPrompt(val);
};

window.confirmProgress = async (projId, taskIndex, plannedEnd) => {
  const proj = allProjectsData.find(p => p.id === projId);
  const tasks = [...proj.tasks];
  const targetTask = tasks[taskIndex];
  
  const isProjOwner = (proj.ownerId === auth.currentUser.uid);
  const taskAssigneeId = targetTask.assigneeId || proj.ownerId;
  const isMyTask = (auth.currentUser.uid === taskAssigneeId);
  
  if (!isProjOwner && !isMyTask && currentUserData.role !== 'admin') {
    return alert("權限不足：您並非此任務細項之負責人或專案建立者，無法更新進度！");
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

  const todayStr = getTodayStr();
  const ts = new Date().toLocaleString('zh-TW', { hour12: false });
  let passedDays = 0; 
  if (todayStr >= targetTask.start) passedDays = getWorkingDays(targetTask.start, todayStr);

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
    
    if (targetTask.isSubProjectTask && targetTask.name.includes("簽核流程")) {
        const parentSubName = targetTask.parentSubProject;
        const nextWorkingDay = getNextWorkingDayStr(todayStr); 
        let modifiedCount = 0;
        
        tasks.forEach(t => {
            if (t.isSubProjectTask && t.parentSubProject === parentSubName && !t.name.includes("簽核流程")) {
                if (!t.isCompleted) {
                    t.start = nextWorkingDay;
                    if (t.end < t.start) t.end = nextWorkingDay;
                    modifiedCount++;
                }
            }
        });
        if (modifiedCount > 0) {
            alert(`🎉 簽核流程已結案！後續 ${modifiedCount} 個細項的起始日，已自動展延至下一個工作日 (${nextWorkingDay})。`);
        } else {
            alert("🎉 簽核流程已結案！");
        }
    } else {
        alert("🎉 進度已達 100%！該任務已結案。");
    }

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
};

document.getElementById("btn-add-project").addEventListener("click", async () => {
  const title = document.getElementById("proj-name").value.trim();
  const color = document.getElementById("proj-color").value;
  if (!title) return alert("請填寫主專案名稱！");

  // 開放瀏覽部門 (原協作部門)
  const collabCheckboxes = document.querySelectorAll('input[name="collab_dept"]:checked');
  const collaborators = Array.from(collabCheckboxes).map(cb => cb.value);

  const isNeedApproval = document.getElementById("chk-need-approval")?.checked || false;
  const isApplyCollab = document.getElementById("chk-apply-collab")?.checked || false;
  
  let approvalDesc = approvalQuill ? approvalQuill.root.innerHTML.trim() : "";
  if (approvalDesc === '<p><br></p>') approvalDesc = "";
  if (isNeedApproval && !approvalDesc) return alert("請填寫簽核說明！");

  const tasks = [];
  const todayStr = getTodayStr(); 
  const ts = new Date().toLocaleString('zh-TW', { hour12: false });
  const myName = currentUserData.name || auth.currentUser.email.split('@')[0];

  const allRows = document.querySelectorAll('#task-list-container > .form-row');

  for (let row of allRows) {
    if (row.classList.contains('task-row')) {
        const name = row.querySelector('.task-name').value.trim(); 
        const start = row.querySelector('.task-start').value; 
        const end = row.querySelector('.task-end').value;
        
        if (!name) continue; 
        if (!start || !end) return alert(`任務 [${name}] 不可有空白日期！`);
        if (start > end) return alert(`任務 [${name}] 的起始日不可大於完成日！`);
        
        let passedDays = 0; 
        if (todayStr >= start) passedDays = getWorkingDays(start, todayStr);
        
        tasks.push({ 
          name, start, end, progress: 0, isCompleted: false, completedAt: null, delayReason: "", lastUpdatedAt: ts, reportedCompleted: false, 
          assigneeId: auth.currentUser.uid,
          assigneeName: myName,
          createdAt: Date.now(), 
          isPendingAcceptance: false, 
          history: [{ timestamp: ts, progress: 0, type: 'create', daysPassed: passedDays, delayReason: '', remark: '專案建立' }] 
        });

    } else if (row.classList.contains('subproject-row')) {
        const subProjName = row.querySelector('.subproject-name').value.trim() || "未命名子專案";
        const assigneeSelect = row.querySelector('.subproject-assignee');
        const assigneeId = assigneeSelect.value;
        const assigneeName = assigneeId ? assigneeSelect.options[assigneeSelect.selectedIndex].text.split(' ')[0] : myName;
        const uidToAssign = assigneeId || auth.currentUser.uid;
        const isPending = (uidToAssign !== auth.currentUser.uid); 
        const subTasks = row.querySelectorAll('.sub-task-item');
        
        if (subTasks.length === 0) {
             tasks.push({ 
              name: `[${subProjName}] 尚未建立細項`, 
              start: todayStr, end: todayStr, progress: 0, isCompleted: false, completedAt: null, delayReason: "", lastUpdatedAt: ts, reportedCompleted: false, 
              assigneeId: uidToAssign,
              assigneeName: assigneeName,
              isSubProjectTask: true,
              parentSubProject: subProjName, 
              createdAt: Date.now(), 
              isPendingAcceptance: isPending, 
              assignedByUid: auth.currentUser.uid,
              assignedByName: myName,
              assignedAt: ts,
              history: [{ timestamp: ts, progress: 0, type: 'create', daysPassed: 0, delayReason: '', remark: '建立空子專案' }] 
            });
        } else {
            for (let subRow of subTasks) {
                const sName = subRow.querySelector('.sub-task-name').value.trim();
                const sStart = subRow.querySelector('.sub-task-start').value;
                const sEnd = subRow.querySelector('.sub-task-end').value;
                
                if (!sName) continue;
                if (!sStart || !sEnd) return alert(`子專案 [${subProjName}] 內的細項不可有空白日期！(請確認是否已填寫天數)`);
                if (sStart > sEnd) return alert(`子專案任務 [${sName}] 的起始日不可大於完成日！`);
                
                let passedDays = 0; 
                if (todayStr >= sStart) passedDays = getWorkingDays(sStart, todayStr);

                tasks.push({ 
                  name: `[${subProjName}] ${sName}`, 
                  start: sStart, end: sEnd, progress: 0, isCompleted: false, completedAt: null, delayReason: "", lastUpdatedAt: ts, reportedCompleted: false, 
                  assigneeId: uidToAssign,
                  assigneeName: assigneeName,
                  isSubProjectTask: true,
                  parentSubProject: subProjName, 
                  createdAt: Date.now(), 
                  isPendingAcceptance: isPending, 
                  assignedByUid: auth.currentUser.uid,
                  assignedByName: myName,
                  assignedAt: ts,
                  history: [{ timestamp: ts, progress: 0, type: 'create', daysPassed: passedDays, delayReason: '', remark: '子專案指派建立' }] 
                });
            }
        }
    }
  }
  
  if (tasks.length === 0) return alert("請至少新增一項任務或子專案！(名稱不可空白)");

  const targetUser = allUsersList.find(u => u.uid === viewingUserId) || { name: currentUserData.name, uid: auth.currentUser.uid };
  const ownerNameToSave = targetUser.name || currentUserData.name;

  let projectStatus = 'active';
  const approvalHistory = [];

  if (isNeedApproval) {
    projectStatus = 'pending_approval'; // 需簽核專案進入簽核狀態

    if (isApplyCollab) {
      approvalHistory.push({
        step: '提出申請協作',
        operatorName: myName,
        operatorUid: auth.currentUser.uid,
        role: roleNames[currentUserData.role] || currentUserData.role,
        time: ts,
        remark: approvalDesc,
        targetRole: '第一道關卡：待最高級主管審核指派'
      });
    } else {
      approvalHistory.push({
        step: '送出專案簽核',
        operatorName: myName,
        operatorUid: auth.currentUser.uid,
        role: roleNames[currentUserData.role] || currentUserData.role,
        time: ts,
        remark: approvalDesc,
        targetRole: '第一道關卡：待最高級主管同意'
      });
    }
  }

  const docRef = await addDoc(collection(db, "projects"), { 
    title, 
    color, 
    collaborators, 
    ownerId: viewingUserId, 
    ownerName: ownerNameToSave, 
    tasks: tasks, 
    status: projectStatus,
    createdAt: serverTimestamp(),
    approvalConfig: {
      isNeedApproval,
      isApplyCollab,
      approvalDesc,
      // 🌟 第一道關卡：明確鎖定由最高級主管審核
      currentStage: isNeedApproval ? 'top_manager' : 'done',
      approvalStatus: isNeedApproval ? (isApplyCollab ? 'pending_collab_dispatch' : 'pending_top_approval') : 'none'
    },
    approvalHistory: approvalHistory
  });

  alert(isNeedApproval ? "🎉 專案已成功送出簽核！已送交最高級主管審核。" : "🎉 新專案已成功建立！開放 7 日自由編輯期。");

  const chkApproval = document.getElementById("chk-need-approval");
  if (chkApproval) {
    chkApproval.checked = false;
    window.toggleApprovalOptions(false);
  }
  document.getElementById("proj-name").value = ""; 
  document.getElementById("task-list-container").innerHTML = ""; 
  addTaskRow(); 
  document.getElementById('create-project-section').style.display = 'none';
  
  if (isNeedApproval) {
    setProjectFilter('pending_approval');
  } else {
    setProjectFilter('ongoing');
  }
  selectedProjectId = docRef.id;
  renderProjects(); 
});

window.deleteCurrentProject = async () => { 
  const p = allProjectsData.find(x => x.id === selectedProjectId);
  const inGrace = p && (auth.currentUser.uid === p.ownerId) && isWithin7DaysGracePeriod(p);
  if (currentUserData.role !== 'admin' && !currentUserData.canEdit && !inGrace) return alert("權限不足！專案主檔已超過 7 天寬限期，請聯繫管理員刪除。");
  
  if (!confirm("⚠️ 確定要永久刪除此專案嗎？")) return; 
  await deleteDoc(doc(db, "projects", selectedProjectId)); 
  alert("專案已刪除！"); 
  selectedProjectId = 'SUMMARY'; 
  renderProjects(); 
};

function loadAdHocEvents() { 
  onSnapshot(query(collection(db, "ad_hoc_events")), (snapshot) => { 
    allAdHocData = []; 
    snapshot.forEach(docSnap => allAdHocData.push({ id: docSnap.id, ...docSnap.data() })); 
    renderAdHocEvents(); 
    renderProjects();
  }); 
}

function renderAdHocEvents() {
  const tbody = document.getElementById("adhoc-list-tbody"); 
  tbody.innerHTML = "";
  const filtered = allAdHocData.filter(e => e.ownerId === viewingUserId);
  
  filtered.sort((a, b) => {
    let tA = a.createdAt?.toMillis ? a.createdAt.toMillis() : Date.now();
    let tB = b.createdAt?.toMillis ? b.createdAt.toMillis() : Date.now();
    return tB - tA;
  });

  const isGlobalEditor = (currentUserData.role === 'admin' || currentUserData.canEdit === true);

  filtered.forEach(evt => {
    let isOwner = (evt.ownerId === auth.currentUser.uid);
    let createdTime = evt.createdAt && typeof evt.createdAt.toMillis === 'function' ? evt.createdAt.toMillis() : Date.now();
    let inGracePeriod = ((Date.now() - createdTime) / (1000 * 60 * 60 * 24)) <= 7;
    let canEditEvent = isGlobalEditor || (isOwner && inGracePeriod);
    
    let editHtml = canEditEvent ? `<button class="action-btn" style="margin-left:4px; border-color:var(--warning); color:var(--warning);" onclick="openGeneralEdit('adhoc', '${evt.id}')">✏️</button>` : '';
    let actionHtml = !evt.isCompleted && isOwner ? `<button class="action-btn" onclick="completeAdHoc('${evt.id}')">完成</button>` : '';
    let delHtml = (currentUserData.role === 'admin' || currentUserData.role === 'top_manager' || canEditEvent) ? `<button class="action-btn danger" style="margin-left:4px;" onclick="deleteAdHoc('${evt.id}')">刪除</button>` : '';

    // 🌟 新增：精算事件共計時數 (使用 startDateTime 與 completedAt 比對)
    let durationHtml = "";
    if (evt.isCompleted && evt.completedAt) {
        try {
            let startStr = evt.startDateTime || (evt.startDate + ' 00:00:00');
            let startMs = new Date(startStr.replace(/-/g, '/')).getTime();
            let endMs = new Date(evt.completedAt.replace(/-/g, '/')).getTime();
            if (!isNaN(startMs) && !isNaN(endMs) && endMs >= startMs) {
                let diffHours = ((endMs - startMs) / (1000 * 60 * 60)).toFixed(1);
                durationHtml = `<div style="font-size:12px; color:var(--success); font-weight:bold; margin-top:4px;">共計 ${diffHours} 小時</div>`;
            }
        } catch (e) { console.error("時數解析錯誤:", e); }
    }

    const tr = document.createElement("tr"); 
    tr.innerHTML = `
      <td style="white-space: nowrap; width: 1%;"><strong>${evt.title}</strong></td>
      <td style="word-break: break-all; width: 100%; min-width: 200px;">
          <!-- 🌟 包在 ql-snow / ql-editor 內，才能正確套用 Quill 的多層次清單縮排樣式 -->
          <div class="ql-snow" style="border: none;">
              <div class="ql-editor" style="padding: 0; min-height: auto; font-size: inherit;">
                  ${evt.reason}
              </div>
          </div>
      </td>
      <td style="white-space: nowrap; width: 1%;">${evt.startDate || '-'}</td>
      <td style="white-space: nowrap; width: 1%;">${evt.completedAt || '-'}${durationHtml}</td>
      <td style="white-space: nowrap; width: 1%;">${evt.isCompleted ? '<span class="pill pill-success">已完成</span>' : '<span class="pill pill-warning">處理中</span>'}</td>
      <td style="white-space: nowrap; width: 1%;">${actionHtml}${editHtml}${delHtml}</td>
    `; 
    tbody.appendChild(tr);
  });
}

document.getElementById("btn-add-adhoc").addEventListener("click", async () => {
  const title = document.getElementById("adhoc-title").value.trim(); 

  // 🌟 從 Quill 抓取 HTML 內容 (而非純文字 input)
  let reason = adhocQuill ? adhocQuill.root.innerHTML.trim() : "";
  if (reason === '<p><br></p>') reason = ""; // Quill 預設空內容防呆

  const start = document.getElementById("adhoc-start").value;
  if (!title || !reason || !start) return alert("請填寫完整名稱、開始日期與原因！");
  
  const targetUser = allUsersList.find(u => u.uid === viewingUserId) || { name: currentUserData.name };
  await addDoc(collection(db, "ad_hoc_events"), { 
    ownerId: viewingUserId, 
    ownerName: targetUser.name || '', 
    title, 
    reason, // 存入包含格式的 HTML
    startDate: start, startDateTime: new Date().toLocaleString(), isCompleted: false, createdAt: serverTimestamp() 
  });
  document.getElementById("adhoc-title").value = ""; 
  document.getElementById("adhoc-start").value = ""; 

  // 🌟 存檔後清空 Quill 編輯器
  if (adhocQuill) adhocQuill.root.innerHTML = "";

  alert("事件紀錄完成！");
});

window.completeAdHoc = async (id) => { 
  await updateDoc(doc(db, "ad_hoc_events", id), { isCompleted: true, completedAt: new Date().toLocaleString() }); 
};

window.deleteAdHoc = async (id) => { 
  const evt = allAdHocData.find(e => e.id === id);
  if (!evt) return;

  let createdTime = evt.createdAt && typeof evt.createdAt.toMillis === 'function' ? evt.createdAt.toMillis() : Date.now();
  let inGracePeriod = ((Date.now() - createdTime) / (1000 * 60 * 60 * 24)) <= 7;
  let isOwner = (evt.ownerId === auth.currentUser.uid);
  let isGlobalEditor = (currentUserData.role === 'admin' || currentUserData.role === 'top_manager' || currentUserData.canEdit);

  if (!isGlobalEditor && !(isOwner && inGracePeriod)) {
    return alert("權限不足！事件已超過 7 天寬限期，無法刪除！");
  }

  if(confirm("確定刪除此紀錄？")) await deleteDoc(doc(db, "ad_hoc_events", id)); 
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
    document.getElementById('leave-other-reason').style.display = 'none';
    document.getElementById('leave-other-reason').value = '';
  }
};

document.querySelectorAll('input[name="leave_type"]').forEach(radio => {
  radio.addEventListener("change", (e) => {
    const reasonInput = document.getElementById("leave-other-reason");
    if(e.target.value === "other") {
      reasonInput.style.display = "block";
    } else {
      reasonInput.style.display = "none";
      reasonInput.value = "";
    }
  });
});

window.populateWeeklyProjSelect = (selectElem) => {
  selectElem.innerHTML = '<option value="">-- 請選擇主專案/事件/其他 --</option>';
  
  const availableProjs = allProjectsData.filter(p => window.getAvailableTasks(p.id).length > 0);
  
  availableProjs.forEach(p => { 
    const prefix = p.ownerId !== viewingUserId ? '👥 ' : '';
    selectElem.innerHTML += `<option value="${p.id}">${prefix}${p.title}</option>`; 
  });
  
  selectElem.innerHTML += `<option value="SPECIAL_ADHOC">📝 事件紀錄</option>`;
  selectElem.innerHTML += `<option value="SPECIAL_OTHER">📌 其他</option>`;
};

window.onWeeklyTaskSelectChange = (selectElem) => {
  const row = selectElem.closest('.weekly-item-row');
  if (!row) return;
  const projSelect = row.querySelector('.weekly-proj-select');
  const contentArea = row.querySelector('.weekly-content');
  
  if (projSelect.value === 'SPECIAL_ADHOC') {
     const eventId = selectElem.value;
     if (eventId) {
        const evt = allAdHocData.find(e => e.id === eventId);
        if (evt) {
           contentArea.value = evt.reason || '';
        }
     } else {
        contentArea.value = '';
     }
  }
};

window.updateWeeklyTaskSelect = (selectElem) => {
  const row = selectElem.closest('.weekly-item-row');
  const taskSelect = selectElem.parentElement.querySelector('.weekly-task-select');
  const contentArea = row ? row.querySelector('.weekly-content') : null;
  const projId = selectElem.value;
  
  if (projId === 'SPECIAL_OTHER') {
     taskSelect.style.display = 'none'; 
     taskSelect.innerHTML = '<option value="">-- 無需細項 --</option>';
     taskSelect.value = '';
     if (contentArea) contentArea.value = '';
     return;
  }
  
  taskSelect.style.display = 'block'; 
  
  if (projId === 'SPECIAL_ADHOC') {
     taskSelect.innerHTML = '<option value="">-- 請選擇事件紀錄 --</option>';
     const availableAdHocs = window.getAvailableAdHocEvents();
     availableAdHocs.forEach(evt => {
        taskSelect.innerHTML += `<option value="${evt.id}">${evt.title}</option>`;
     });
     if (contentArea) contentArea.value = '';
     return;
  }
  
  taskSelect.innerHTML = '<option value="">-- 請選擇細項 --</option>';
  if(!projId) return;
  const availableTasks = window.getAvailableTasks(projId);
  availableTasks.forEach(t => { taskSelect.innerHTML += `<option value="${t.index}">${t.name}</option>`; });
};

window.addWeeklyRow = () => {
  const container = document.getElementById("weekly-items-container");
  const div = document.createElement('div'); 
  div.className = "weekly-item-row"; 
  div.style.cssText = "display:flex; gap:16px; margin-bottom:12px; align-items:flex-start; border: 1px solid var(--border-light); padding: 14px; border-radius: 8px; background: #fafafa;";
  div.innerHTML = `<div style="flex:1; display:flex; flex-direction:column; gap:10px; border-right: 1px dashed var(--border); padding-right:16px;"><select class="input-control weekly-proj-select" onchange="updateWeeklyTaskSelect(this)" style="background:#fff;"></select><select class="input-control weekly-task-select" onchange="onWeeklyTaskSelectChange(this)" style="background:#fff;"><option value="">-- 請先選擇主專案 --</option></select></div><div style="flex:2.5;"><textarea class="input-control weekly-content" rows="3" placeholder="請填寫此任務的進度說明..." style="background:#fff;"></textarea></div><button class="action-btn danger" onclick="this.parentElement.remove()" style="padding: 10px; margin-left: 8px;">X</button>`;
  container.appendChild(div); 
  populateWeeklyProjSelect(div.querySelector('.weekly-proj-select'));
};

function refreshAllWeeklyProjSelects() {
  const selects = document.querySelectorAll('.weekly-proj-select');
  selects.forEach(sel => { 
    const currentVal = sel.value; 
    populateWeeklyProjSelect(sel); 
    sel.value = currentVal; 
  });
}

function loadWeeklyReports() { 
  onSnapshot(query(collection(db, "weekly_reports")), (snapshot) => { 
    allWeeklyData = []; 
    snapshot.forEach(docSnap => allWeeklyData.push({ id: docSnap.id, ...docSnap.data() })); 
    renderWeeklyReports(); 
    refreshAllWeeklyProjSelects();
  }); 
}

function isWeeklyReportEditable(w) {
  if (w.supervisorNoted || w.topManagerNoted) return false;
  if (!w.createdAt) return true;
  const createdTime = w.createdAt.toMillis ? w.createdAt.toMillis() : Date.now();
  const diffDays = (Date.now() - createdTime) / (1000 * 60 * 60 * 24);
  return diffDays <= 2;
}

function renderWeeklyReports() {
  const tbody = document.getElementById("weekly-list-tbody"); 
  tbody.innerHTML = "";
  const filtered = allWeeklyData.filter(e => e.ownerId === viewingUserId);
  filtered.sort((a,b) => (b.createdAt?.toMillis() || 0) - (a.createdAt?.toMillis() || 0)); 
  
  const days = ['日', '一', '二', '三', '四', '五', '六'];

  filtered.forEach((w, index) => {
    let isOwner = (w.ownerId === auth.currentUser.uid);
    let isAllowedTime = isWeeklyReportEditable(w);
    let canEditUI = (isEditMode || isAllowedTime) && isOwner && isAllowedTime;
    
    let editHtml = canEditUI ? `<button class="action-btn" style="margin-right:6px; border-color:var(--warning); color:var(--warning);" onclick="openGeneralEdit('weekly', '${w.id}')">✏️ 編輯</button>` : '';
    let delHtml = (currentUserData.role === 'admin' || currentUserData.role === 'top_manager' || (isOwner && isAllowedTime)) ? `<button class="action-btn danger" onclick="deleteWeekly('${w.id}')">刪除</button>` : '';
    
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
    tr.innerHTML = `<td>${index + 1}</td><td><strong>${w.ownerName}</strong></td><td>${fillTimeStr}</td><td>${supText}</td><td>${topText}</td><td><button class="action-btn" style="margin-right:6px;" onclick="openWeeklyModal('${w.id}')">瀏覽報告</button>${editHtml}${delHtml}</td>`; 
    tbody.appendChild(tr);
  });
}

document.getElementById("btn-add-weekly").addEventListener("click", async () => {
  try {
    const today = new Date();
    const days = ['日', '一', '二', '三', '四', '五', '六'];
    let dateStr = document.getElementById("rep-date").value || `${today.getFullYear()}/${today.getMonth() + 1}/${today.getDate()} (${days[today.getDay()]})`; 

    let leaveType = "";
    let leaveReason = "";
    const leaveContainer = document.getElementById("leave-options-container");
    
    if (leaveContainer.style.display === "flex") {
      const checked = document.querySelector('input[name="leave_type"]:checked');
      if (!checked) return alert("【注意】星期一至四提交週報，請務必勾選右側的請假或其他原因！");
      leaveType = checked.value;
      if (leaveType === "other") {
        leaveReason = document.getElementById("leave-other-reason").value.trim();
        if (!leaveReason) return alert("請填寫「其他」選項的理由說明！");
      }
    }

    const rows = document.querySelectorAll('.weekly-item-row'); 
    const items = [];
    let hasIncomplete = false;

    rows.forEach(r => {
      const pSel = r.querySelector('.weekly-proj-select'); 
      const tSel = r.querySelector('.weekly-task-select'); 
      const content = r.querySelector('.weekly-content').value.trim();
      
      if (pSel.value || content) {
        if (pSel.value === 'SPECIAL_OTHER') {
          if (content) {
            items.push({ projectId: pSel.value, projectName: "📌 其他", taskId: "", taskName: "", content: content });
          } else {
            hasIncomplete = true;
          }
        } else if (pSel.value === 'SPECIAL_ADHOC') {
          if (tSel.value && content) {
            items.push({ projectId: pSel.value, projectName: "📝 事件紀錄", taskId: tSel.value, taskName: tSel.options[tSel.selectedIndex].text, content: content });
          } else {
            hasIncomplete = true;
          }
        } else if (pSel.value && tSel.value && content) {
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
    const currentOwnerId = viewingUserId || auth.currentUser.uid;

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
    const adhocUpdates = [];
    
    for (let item of items) {
      if (item.projectId === 'SPECIAL_OTHER') continue;
      
      if (item.projectId === 'SPECIAL_ADHOC') {
        const evt = allAdHocData.find(a => a.id === item.taskId);
        if (evt && evt.isCompleted && !evt.reportedCompleted) {
           adhocUpdates.push(item.taskId);
        }
        continue;
      }
      
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
    for (let aId of adhocUpdates) await updateDoc(doc(db, "ad_hoc_events", aId), { reportedCompleted: true });
    
    initWeeklyDateAndLeave(); 
    document.getElementById("weekly-items-container").innerHTML = ""; 
    addWeeklyRow(); 
    alert("週報已成功送出！在主管未閱讀前，您有 2 天修改寬限期。");
    
  } catch (err) {
    console.error("送出週報錯誤：", err);
    alert("發生系統錯誤導致無法送出：" + err.message);
  }
});

window.deleteWeekly = async (id) => { 
  const report = allWeeklyData.find(w => w.id === id);
  if (!report) return;
  const isOwner = (report.ownerId === auth.currentUser.uid);
  const isAllowed = isWeeklyReportEditable(report);
  if (!isOwner && currentUserData.role !== 'admin') return alert("權限不足！");
  if (isOwner && !isAllowed && currentUserData.role !== 'admin') return alert("此週報已逾 2 天或已經主管審閱鎖定，無法刪除！");
  if(confirm("確定永久刪除此週報嗎？")) await deleteDoc(doc(db, "weekly_reports", id)); 
};

window.openWeeklyModal = (id) => {
  currentWeeklyReportId = id; 
  const report = allWeeklyData.find(w => w.id === id); 
  if(!report) return;
  
  let leaveTag = '';
  if (report.leaveType === 'leave') leaveTag = `<span class="pill pill-danger" style="margin-left:12px;">📌 原因：請假</span>`;
  else if (report.leaveType === 'other') leaveTag = `<span class="pill pill-warning" style="margin-left:12px;">📌 原因：${report.leaveReason}</span>`;

  const days = ['日', '一', '二', '三', '四', '五', '六'];
  let fillTimeStr = '-';
  if (report.createdAt) {
    const d = report.createdAt.toDate();
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

  let contentHtml = `<div style="margin-bottom:16px;"><div style="font-weight:bold; margin-bottom:4px;">${report.ownerName} 的工作週報</div><div style="color:var(--text-muted); display:flex; align-items:center;">填寫時間：${fillTimeStr} ${leaveTag}</div></div>`;
  
  if (report.items && report.items.length > 0) {
    report.items.forEach((item, i) => { 
      let icon = item.projectId === 'SPECIAL_ADHOC' ? '📝' : (item.projectId === 'SPECIAL_OTHER' ? '📌' : '🗂️');
      let taskHtml = item.taskName ? `<div style="word-break: break-all;">📌 ${item.taskName}</div>` : '';
      contentHtml += `<div style="display:flex; gap:16px; margin-bottom: 12px; padding: 14px; background: #f8fafc; border: 1px solid var(--border); border-radius: 8px; align-items:flex-start;"><div style="flex:1; font-weight:600; color:var(--primary); border-right: 1px dashed var(--border-light); padding-right:12px;"><div style="margin-bottom:6px; word-break: break-all;">${icon} ${item.projectName}</div>${taskHtml}</div><div style="flex:2.5; white-space:pre-wrap; line-height:1.6; padding-left:4px;">${item.content}</div></div>`; 
    });
  } else if (report.content) {
    contentHtml += `<div style="padding: 12px; white-space:pre-wrap; background: #f8fafc; border-radius: 8px; line-height:1.6;">${report.content}</div>`;
  } else {
    contentHtml += `<div style="padding: 16px; color:var(--text-muted); background: #f8fafc; border-radius: 8px; text-align:center;">(本日無填寫專案進度)</div>`;
  }
  
  document.getElementById('weekly-detail-content').innerHTML = contentHtml;

  const btnSup = document.getElementById('btn-supervisor-note'); 
  const btnTop = document.getElementById('btn-topmanager-note');
  btnSup.style.display = 'none'; 
  btnTop.style.display = 'none';
  const ownerUser = allUsersList.find(u => u.uid === report.ownerId);
  const isDirectSupervisor = ownerUser && (ownerUser.supervisorId === auth.currentUser.uid);
  const isTopManager = currentUserData.role === 'top_manager' || currentUserData.role === 'admin'; 
  if (isDirectSupervisor && !report.supervisorNoted) btnSup.style.display = 'inline-block';
  if (isTopManager && !report.topManagerNoted) btnTop.style.display = 'inline-block';
  document.getElementById('weekly-detail-modal').classList.add('active');
};

window.closeWeeklyModal = () => document.getElementById('weekly-detail-modal').classList.remove('active');

window.markWeeklyNoted = async (type) => {
  if(!currentWeeklyReportId) return; 
  const updateData = {};
  if(type === 'supervisor') updateData.supervisorNoted = true; 
  if(type === 'top_manager') updateData.topManagerNoted = true;
  await updateDoc(doc(db, "weekly_reports", currentWeeklyReportId), updateData);
  closeWeeklyModal(); 
  alert('已成功標記為 Noted (已閱)！該週報自此鎖定。');
};

function loadMyCalendarTodos(myUid) {
  const q = query(collection(db, "calendar_todos"), where("ownerId", "==", myUid));
  onSnapshot(q, (snapshot) => {
    myCalendarTodos = [];
    snapshot.forEach(docSnap => {
      myCalendarTodos.push({ id: docSnap.id, ...docSnap.data() });
    });
    renderCalendar();
    if (activeCalDateStr) renderCalTodosModal(activeCalDateStr);
  }, (err) => {
    console.error("載入行事曆失敗:", err);
  });
}

function initCalendarSelectors() {
  const ySel = document.getElementById("cal-year-select");
  const mSel = document.getElementById("cal-month-select");
  if (!ySel || !mSel) return;

  ySel.innerHTML = "";
  const currentY = new Date().getFullYear();
  for (let y = currentY - 5; y <= currentY + 5; y++) {
    ySel.innerHTML += `<option value="${y}" ${y === calCurrentYear ? 'selected' : ''}>${y} 年</option>`;
  }

  mSel.innerHTML = "";
  for (let m = 0; m < 12; m++) {
    mSel.innerHTML += `<option value="${m}" ${m === calCurrentMonth ? 'selected' : ''}>${m + 1} 月</option>`;
  }
}

window.onCalSelectChange = () => {
  calCurrentYear = parseInt(document.getElementById("cal-year-select").value);
  calCurrentMonth = parseInt(document.getElementById("cal-month-select").value);
  renderCalendar();
};

window.changeCalMonth = (delta) => {
  calCurrentMonth += delta;
  if (calCurrentMonth > 11) {
    calCurrentMonth = 0;
    calCurrentYear++;
  } else if (calCurrentMonth < 0) {
    calCurrentMonth = 11;
    calCurrentYear--;
  }
  initCalendarSelectors();
  renderCalendar();
};

window.jumpCalToday = () => {
  const today = new Date();
  calCurrentYear = today.getFullYear();
  calCurrentMonth = today.getMonth();
  initCalendarSelectors();
  renderCalendar();
};

function renderCalendar() {
  const grid = document.getElementById("calendar-grid");
  if (!grid) return;
  grid.innerHTML = "";

  const firstDayIndex = new Date(calCurrentYear, calCurrentMonth, 1).getDay();
  const lastDate = new Date(calCurrentYear, calCurrentMonth + 1, 0).getDate();
  const prevMonthLastDate = new Date(calCurrentYear, calCurrentMonth, 0).getDate();

  const today = new Date();
  const todayStr = formatDateSafe(today);

  for (let i = firstDayIndex - 1; i >= 0; i--) {
    const dNum = prevMonthLastDate - i;
    const prevM = calCurrentMonth === 0 ? 12 : calCurrentMonth;
    const prevY = calCurrentMonth === 0 ? calCurrentYear - 1 : calCurrentYear;
    const dStr = `${prevY}-${String(prevM).padStart(2, '0')}-${String(dNum).padStart(2, '0')}`;
    grid.appendChild(createCalCellNode(dNum, dStr, true, todayStr, myCalendarTodos));
  }

  for (let d = 1; d <= lastDate; d++) {
    const dStr = `${calCurrentYear}-${String(calCurrentMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    grid.appendChild(createCalCellNode(d, dStr, false, todayStr, myCalendarTodos));
  }

  const totalCells = firstDayIndex + lastDate;
  const remaining = (7 - (totalCells % 7)) % 7;
  for (let n = 1; n <= remaining; n++) {
    const nextM = calCurrentMonth === 11 ? 1 : calCurrentMonth + 2;
    const nextY = calCurrentMonth === 11 ? calCurrentYear + 1 : calCurrentYear;
    const dStr = `${nextY}-${String(nextM).padStart(2, '0')}-${String(n).padStart(2, '0')}`;
    grid.appendChild(createCalCellNode(n, dStr, true, todayStr, myCalendarTodos));
  }
}

function createCalCellNode(dayNum, dateStr, isOtherMonth, todayStr, userTodos) {
  const cell = document.createElement("div");
  cell.className = `cal-cell ${isOtherMonth ? 'other-month' : ''} ${dateStr === todayStr ? 'today' : ''}`;

  const monthDayStr = dateStr.substring(5);
  const dayOfWeek = new Date(dateStr).getDay();
  const isWeekend = (dayOfWeek === 0 || dayOfWeek === 6);
  
  const holidayName = taiwanHolidayMap[monthDayStr] || null;
  const isHoliday = !!holidayName;

  if (isHoliday || isWeekend) cell.classList.add("holiday");

  let holidayBadgeHtml = holidayName ? `<span class="cal-holiday-tag" title="${holidayName}">${holidayName}</span>` : '';
  let html = `<div style="display:flex; align-items:center;"><div class="cal-date-num">${dayNum}</div>${holidayBadgeHtml}</div>`;

  const dayTodos = userTodos.filter(t => t.date === dateStr);
  if (dayTodos.length > 0) {
    html += `<div class="cal-todo-preview-list">`;
    dayTodos.slice(0, 3).forEach(todo => {
      const isDone = todo.isCompleted ? 'completed' : '';
      html += `<div class="cal-todo-pill ${isDone}" style="color:${todo.color || '#0f172a'};">${todo.title}</div>`;
    });
    if (dayTodos.length > 3) {
      html += `<div style="color:var(--text-muted); text-align:right;">+${dayTodos.length - 3} 則...</div>`;
    }
    html += `</div>`;
  }

  cell.innerHTML = html;
  cell.onclick = () => openCalDateModal(dateStr);
  return cell;
}

window.openCalDateModal = (dateStr) => {
  activeCalDateStr = dateStr;
  const parts = dateStr.split('-');
  document.getElementById("cal-modal-date-title").innerText = `${parts[0]}年${parseInt(parts[1])}月${parseInt(parts[2])}日`;
  document.getElementById("cal-add-todo-box").style.display = "none";
  renderCalTodosModal(dateStr);
  document.getElementById("cal-todo-modal").classList.add("active");
};

window.closeCalTodoModal = () => {
  document.getElementById("cal-todo-modal").classList.remove("active");
  activeCalDateStr = null;
};

window.toggleAddTodoInput = () => {
  const box = document.getElementById("cal-add-todo-box");
  const isHidden = box.style.display === "none";
  box.style.display = isHidden ? "block" : "none";
  if (isHidden) {
    document.getElementById("cal-new-todo-text").value = "";
    document.getElementById("cal-new-todo-text").focus();
  }
};

window.submitCalendarTodo = async () => {
  const text = document.getElementById("cal-new-todo-text").value.trim();
  const color = document.getElementById("cal-new-todo-color").value;
  if (!text) return alert("請填寫待辦事項內容！");
  if (!activeCalDateStr) return;

  const myUid = auth.currentUser?.uid;
  if (!myUid) return alert("尚未登入帳號！");

  try {
    await addDoc(collection(db, "calendar_todos"), {
      date: activeCalDateStr,
      title: text,
      color: color,
      isCompleted: false,
      ownerId: myUid,
      createdAt: serverTimestamp()
    });
    document.getElementById("cal-new-todo-text").value = "";
    document.getElementById("cal-add-todo-box").style.display = "none";
  } catch (err) {
    alert("新增失敗: " + err.message);
  }
};

function renderCalTodosModal(dateStr) {
  const myUid = auth.currentUser?.uid;
  const dayTodos = myCalendarTodos.filter(t => t.date === dateStr && t.ownerId === myUid);

  const uncompletedList = document.getElementById("cal-uncompleted-list");
  const completedList = document.getElementById("cal-completed-list");
  if (!uncompletedList || !completedList) return;

  uncompletedList.innerHTML = "";
  completedList.innerHTML = "";

  const uncompleted = dayTodos.filter(t => !t.isCompleted);
  const completed = dayTodos.filter(t => t.isCompleted);

  document.getElementById("cal-uncompleted-count").innerText = uncompleted.length;
  document.getElementById("cal-completed-count").innerText = completed.length;

  if (uncompleted.length === 0) {
    uncompletedList.innerHTML = `<div style="color:var(--text-muted); padding:8px 0;">尚無未完成事項</div>`;
  } else {
    uncompleted.forEach(todo => {
      const div = document.createElement("div");
      div.className = "cal-todo-item";
      div.innerHTML = `
        <label style="display:flex; align-items:center; gap:8px; cursor:pointer; flex:1;">
          <input type="checkbox" onchange="toggleCalTodoStatus('${todo.id}', true)">
          <span style="color:${todo.color || '#0f172a'}; font-weight:600;">${todo.title}</span>
        </label>
        <button class="btn-close" style="color:var(--text-muted);" onclick="deleteCalendarTodo('${todo.id}')">×</button>
      `;
      uncompletedList.appendChild(div);
    });
  }

  if (completed.length === 0) {
    completedList.innerHTML = `<div style="color:var(--text-muted); padding:8px 0;">尚無已完成事項</div>`;
  } else {
    completed.forEach(todo => {
      const div = document.createElement("div");
      div.className = "cal-todo-item done";
      div.innerHTML = `
        <label style="display:flex; align-items:center; gap:8px; cursor:pointer; flex:1;">
          <input type="checkbox" checked onchange="toggleCalTodoStatus('${todo.id}', false)">
          <span style="color:${todo.color || '#0f172a'};">${todo.title}</span>
        </label>
        <button class="btn-close" style="color:var(--text-muted);" onclick="deleteCalendarTodo('${todo.id}')">×</button>
      `;
      completedList.appendChild(div);
    });
  }

  completedList.style.display = showCompletedTodos ? "flex" : "none";
}

window.toggleCalTodoStatus = async (id, isDone) => {
  try {
    await updateDoc(doc(db, "calendar_todos", id), { isCompleted: isDone });
  } catch (err) {
    alert("更新狀態失敗: " + err.message);
  }
};

window.deleteCalendarTodo = async (id) => {
  if (confirm("確定刪除此待辦事項？")) {
    try {
      await deleteDoc(doc(db, "calendar_todos", id));
    } catch (err) {
      alert("刪除失敗: " + err.message);
    }
  }
};

window.toggleCompletedTodosView = () => {
  showCompletedTodos = !showCompletedTodos;
  document.getElementById("cal-completed-list").style.display = showCompletedTodos ? "flex" : "none";
  document.getElementById("cal-toggle-completed-text").innerText = showCompletedTodos ? "隱藏 ▲" : "展開 ▼";
};

window.switchOrgView = (viewType) => {
  const chartContainer = document.getElementById("org-chart-view-container");
  const tableContainer = document.getElementById("org-table-view-container");
  const btnChart = document.getElementById("btn-view-org-chart");
  const btnTable = document.getElementById("btn-view-org-table");

  if (viewType === 'chart') {
    chartContainer.style.display = "block";
    tableContainer.style.display = "none";
    btnChart.classList.add("active");
    btnTable.classList.remove("active");
    renderOrgChart();
  } else {
    chartContainer.style.display = "none";
    tableContainer.style.display = "block";
    btnTable.classList.add("active");
    btnChart.classList.remove("active");
  }
};

function renderOrgChart() {
  const container = document.getElementById("org-chart-view-container");
  if (!container) return;
  container.innerHTML = "";

  const mainWrapper = document.createElement("div");
  mainWrapper.className = "org-dept-container";

  const roleTiers = [
    { key: "top_manager", label: "👑 最高級主管 / 管理員", roles: ["top_manager", "admin"] },
    { key: "senior_manager", label: "👔 高級主管", roles: ["senior_manager"] },
    { key: "manager", label: "👔 主管", roles: ["manager"] },
    { key: "assistant_manager", label: "💼 副主管", roles: ["assistant_manager"] },
    { key: "staff", label: "👥 部門人員", roles: ["staff"] }
  ];

  departmentList.forEach(dept => {
    const deptUsers = allUsersList.filter(u => (u.dept || "設計部") === dept);
    if (deptUsers.length === 0) return;

    let tierHtml = "";
    roleTiers.forEach(tier => {
      const tierMembers = deptUsers.filter(u => tier.roles.includes(u.role));
      if (tierMembers.length === 0) return;

      let memberCardsHtml = "";
      tierMembers.forEach(u => {
        const supUser = allUsersList.find(x => x.uid === u.supervisorId);
        const isMgr = ["top_manager", "senior_manager", "manager"].includes(tier.key);
        const supText = supUser ? `直屬: ${supUser.name}` : "直屬: 無";

        memberCardsHtml += `
          <div class="org-user-card ${isMgr ? 'is-mgr' : ''}" onclick="openEditModal('${u.uid}')" title="點擊編輯 ${u.name || '人員'} 的資訊">
            <div class="org-card-avatar-sm ${isMgr ? 'mgr' : ''}">${(u.name || 'U').charAt(0).toUpperCase()}</div>
            <div class="org-card-text">
              <div class="org-card-user-name">${u.name || '未命名'} <small style="font-weight:normal; color:#64748b;">(${roleNames[u.role] || u.role})</small></div>
              <div class="org-card-sup-name">${supText}</div>
            </div>
          </div>
        `;
      });

      tierHtml += `
        <div class="org-role-tier">
          <div class="org-role-label">${tier.label}</div>
          <div class="org-member-cards">${memberCardsHtml}</div>
        </div>
      `;
    });

    const deptBlock = document.createElement("div");
    deptBlock.className = "org-dept-block";
    deptBlock.innerHTML = `
      <div class="org-dept-header">
        <div class="org-dept-title">
          <span>🏢</span>
          <span>${dept}</span>
        </div>
        <span style="font-weight:600; background:#f1f5f9; color:#475569; padding:2px 8px; border-radius:12px;">共 ${deptUsers.length} 人</span>
      </div>
      <div class="org-hierarchy-grid">
        ${tierHtml}
      </div>
    `;

    mainWrapper.appendChild(deptBlock);
  });

  container.appendChild(mainWrapper);
}

let currentEditData = {};

window.openGeneralEdit = (type, id, extra) => {
  let isAuthorized = false;

  if (type === 'project' || type === 'task') {
    const p = allProjectsData.find(x => x.id === id);
    if (p) {
      if (currentUserData.role === 'admin' || currentUserData.canEdit) {
        isAuthorized = true;
      }
      
      if (type === 'task') {
        const t = p.tasks[extra];
        let tCreatedTime = t.createdAt || (p.createdAt && typeof p.createdAt.toMillis === 'function' ? p.createdAt.toMillis() : Date.now());
        
        let tInGrace = true;
        if (t.isSubProjectTask && !t.name.includes("簽核流程")) {
            if (t.datesSetAt) {
                tInGrace = ((Date.now() - t.datesSetAt) / (1000 * 60 * 60 * 24)) <= 14;
            } else {
                tInGrace = true;
            }
        } else {
            tInGrace = ((Date.now() - tCreatedTime) / (1000 * 60 * 60 * 24)) <= 7;
        }

        let isMyTask = (auth.currentUser.uid === (t.assigneeId || p.ownerId));
        let isProjOwner = (p.ownerId === auth.currentUser.uid);

        if ((isProjOwner || isMyTask) && tInGrace) isAuthorized = true;
      } else if (type === 'project') {
        let isProjOwner = (p.ownerId === auth.currentUser.uid);
        if (isProjOwner && isWithin7DaysGracePeriod(p)) isAuthorized = true;
      }
    }
  } else if (type === 'weekly') {
    const w = allWeeklyData.find(x => x.id === id);
    if ((currentUserData.role === 'admin' || currentUserData.canEdit) || (w && w.ownerId === auth.currentUser.uid && isWeeklyReportEditable(w))) {
      isAuthorized = true;
    }
  } else if (type === 'adhoc') {
    const a = allAdHocData.find(x => x.id === id);
    if (a) {
      let createdTime = a.createdAt && typeof a.createdAt.toMillis === 'function' ? a.createdAt.toMillis() : Date.now();
      let inGracePeriod = ((Date.now() - createdTime) / (1000 * 60 * 60 * 24)) <= 7;
      let isOwner = (a.ownerId === auth.currentUser.uid);

      if (currentUserData.role === 'admin' || currentUserData.canEdit || (isOwner && inGracePeriod)) {
        isAuthorized = true;
      }
    }
  }

  if (!isAuthorized) {
    return alert("權限不足：您無法編輯此資料 (可能已超過 7 天寬限期)！");
  }

  currentEditData = { type, id, extra };
  const form = document.getElementById("general-edit-form"); 
  form.innerHTML = "";

  if (type === 'project') {
    const p = allProjectsData.find(x => x.id === id);
    document.getElementById("general-edit-title").innerText = "編輯主專案名稱與瀏覽部門";
    let collabHtml = `<div class="form-group" style="margin-top:12px;"><label class="form-label">瀏覽部門 (可複選)</label><div style="display:flex; flex-direction:column; gap:6px;">`;
    departmentList.forEach(dept => {
      const isChecked = (p.collaborators || []).includes(dept) ? 'checked' : '';
      collabHtml += `<label style="display:flex; align-items:center; gap:6px; cursor:pointer;"><input type="checkbox" name="edit_collab" value="${dept}" ${isChecked}> <span>${dept}</span></label>`;
    });
    collabHtml += `</div></div>`;

    form.innerHTML = `
      <div class="form-group"><label class="form-label">專案名稱</label><input type="text" id="edit-val-proj-title" class="input-control" value="${p.title}"></div>
      ${collabHtml}
    `;
  } else if (type === 'task') {
    const proj = allProjectsData.find(p => p.id === id); 
    const task = proj.tasks[extra];
    const taskDays = getWorkingDays(task.start, task.end);
    document.getElementById("general-edit-title").innerText = "編輯專案細項";

    // 🌟 自動過濾掉名稱中的 [子專案名稱] 前綴，讓編輯時只顯示純細項名稱
    let cleanTaskName = task.name || '';
    if (task.isSubProjectTask && task.parentSubProject) {
        cleanTaskName = cleanTaskName.replace(`[${task.parentSubProject}] `, '');
    }

    form.innerHTML = `
      <div class="form-group"><label class="form-label">細項名稱</label><input type="text" id="edit-val-name" class="input-control" value="${cleanTaskName}"></div>
      <div class="form-row">
        <div class="form-group" style="flex:1.5;"><label class="form-label">開始日期</label><input type="date" id="edit-val-start" class="input-control" value="${task.start}" onchange="onTaskStartChange(this, 'edit-val-end')"></div>
        <div class="form-group" style="width:65px; flex-shrink:0;"><label class="form-label">天數</label><input type="number" min="1" id="edit-val-days" class="input-control task-days" value="${taskDays}" oninput="onTaskDaysChange(this, 'edit-val-start', 'edit-val-end')"></div>
        <div class="form-group" style="flex:1.5;"><label class="form-label">結束日期</label><input type="date" id="edit-val-end" class="input-control" value="${task.end}" min="${task.start}" onchange="onTaskEndChange(this, 'edit-val-start', 'edit-val-days')"></div>
      </div>
    `;
  } else if (type === 'adhoc') {
    const adhoc = allAdHocData.find(a => a.id === id);
    document.getElementById("general-edit-title").innerText = "編輯事件紀錄";

    // 🌟 將原因說明改用 Quill 編輯器容器，取代純文字 input
    form.innerHTML = `
      <div class="form-group"><label class="form-label">事項名稱</label><input type="text" id="edit-val-title" class="input-control" value="${adhoc.title}"></div>
      <div class="form-group"><label class="form-label">開始日期</label><input type="date" id="edit-val-start" class="input-control" value="${adhoc.startDate || ''}"></div>
      <div class="form-group">
        <label class="form-label">原因說明</label>
        <div id="edit-val-reason-container" style="background:#fff; min-height:80px;"></div>
      </div>
    `;

    // 🌟 等待 Modal 的 DOM 渲染完成後，才綁定 Quill，並帶入原本存在 Firebase 的 HTML 內容
    setTimeout(() => {
      window.editAdhocQuill = new Quill('#edit-val-reason-container', {
        modules: { toolbar: toolbarOptions },
        theme: 'snow'
      });
      window.editAdhocQuill.root.innerHTML = adhoc.reason || '';
    }, 100);

  } else if (type === 'weekly') {
    const weekly = allWeeklyData.find(w => w.id === id);
    document.getElementById("general-edit-title").innerText = "編輯週報內容";
    
    let html = `<div style="display:flex; flex-direction:column; gap:12px; max-height:400px; overflow-y:auto;">`;
    const userProjects = allProjectsData.filter(p => {
        if (p.ownerId === weekly.ownerId) return true;
        if (p.tasks && p.tasks.some(t => t.assigneeId === weekly.ownerId)) return true;
        return false;
    });

    if (weekly.items && weekly.items.length > 0) {
      weekly.items.forEach((item, idx) => {
        let projOptions = `<option value="">-- 請選擇專案/事件/其他 --</option>`;
        userProjects.forEach(p => {
          projOptions += `<option value="${p.id}" ${p.id === item.projectId ? 'selected' : ''}>${p.title}</option>`;
        });
        
        projOptions += `<option value="SPECIAL_ADHOC" ${item.projectId === 'SPECIAL_ADHOC' ? 'selected' : ''}>📝 事件紀錄</option>`;
        projOptions += `<option value="SPECIAL_OTHER" ${item.projectId === 'SPECIAL_OTHER' ? 'selected' : ''}>📌 其他</option>`;

        const activeProj = allProjectsData.find(p => p.id === item.projectId);
        let taskOptions = `<option value="">-- 請選擇細項 --</option>`;
        
        let taskDisplay = 'block';
        if (item.projectId === 'SPECIAL_OTHER') {
          taskOptions = `<option value="">-- 無需細項 --</option>`;
          taskDisplay = 'none';
        } else if (item.projectId === 'SPECIAL_ADHOC') {
          const myAdHocs = window.getAvailableAdHocEvents();
          const currentAdHoc = allAdHocData.find(a => a.id === item.taskId);
          if (currentAdHoc && !myAdHocs.find(a => a.id === currentAdHoc.id)) {
             myAdHocs.push(currentAdHoc); 
          }
          myAdHocs.forEach(a => {
            taskOptions += `<option value="${a.id}" ${a.id === item.taskId ? 'selected' : ''}>${a.title}</option>`;
          });
        } else {
          if (activeProj && activeProj.tasks) {
            activeProj.tasks.forEach((t, tIdx) => {
              taskOptions += `<option value="${tIdx}" ${String(tIdx) === String(item.taskId) ? 'selected' : ''}>${t.name}</option>`;
            });
          }
        }

        html += `
          <div class="form-group" style="padding:12px; background:#f8fafc; border:1px solid var(--border); border-radius:8px; margin-bottom:0;">
            <div class="form-row" style="margin-bottom:8px;">
              <div class="form-group" style="flex:1; margin-bottom:0;">
                <label class="form-label">主專案 / 類別</label>
                <select id="edit-weekly-proj-${idx}" class="input-control" style="padding:6px 8px;" onchange="onEditWeeklyProjChange(${idx})">${projOptions}</select>
              </div>
              <div class="form-group" style="flex:1; margin-bottom:0;">
                <select id="edit-weekly-task-${idx}" class="input-control" style="padding:6px 8px; margin-top:20px; display:${taskDisplay};" onchange="onEditWeeklyTaskChange(${idx})">${taskOptions}</select>
              </div>
            </div>
            <label class="form-label">進度說明</label>
            <textarea id="edit-val-item-${idx}" class="input-control" rows="3">${item.content}</textarea>
          </div>
        `;
      });
    } else {
      html += `<div style="color:var(--text-muted); text-align:center; padding: 20px;">無可編輯的專案進度項目</div>`;
    }
    html += `</div>`;
    form.innerHTML = html;
  }
  
  const modal = document.getElementById("general-edit-modal");
  const modalBox = modal.querySelector('.modal-box');
  if (modalBox) {
    if (type === 'weekly') {
      modalBox.style.width = "90vw";
      modalBox.style.maxWidth = "800px";
    } else {
      modalBox.style.width = "";     
      modalBox.style.maxWidth = "";   
    }
  }
  modal.classList.add("active");
};

window.onEditWeeklyTaskChange = (idx) => {
  const pSel = document.getElementById(`edit-weekly-proj-${idx}`);
  const tSel = document.getElementById(`edit-weekly-task-${idx}`);
  const contentArea = document.getElementById(`edit-val-item-${idx}`);
  
  if (pSel && pSel.value === 'SPECIAL_ADHOC') {
     const eventId = tSel.value;
     if (eventId) {
        const evt = allAdHocData.find(e => e.id === eventId);
        if (evt && contentArea) {
           contentArea.value = evt.reason || '';
        }
     } else if (contentArea) {
        contentArea.value = '';
     }
  }
};

window.openTemplateEditor = (index) => {
    const tpl = projectTemplates[index];
    currentEditData = { type: 'template', id: index };
    document.getElementById("general-edit-title").innerText = `編輯模板：${tpl.name}`;

    let html = `
        <div class="form-group">
            <label class="form-label">模板名稱</label>
            <input type="text" id="edit-tpl-name" class="input-control" value="${tpl.name}">
        </div>
        <div class="form-group">
            <label class="form-label">預設任務/子專案配置</label>
            <div id="edit-tpl-tasks-container"></div>
            <div style="display:flex; gap:10px; margin-top:8px;">
                <button type="button" class="action-btn" onclick="addTemplateTaskRow()">➕ 新增模板細項</button>
                <button type="button" class="action-btn" onclick="addTemplateSubProjectRow()" style="border-color: #d97706; color: #d97706;">➕ 新增子專案</button>
            </div>
        </div>
    `;
    const form = document.getElementById("general-edit-form");
    form.innerHTML = html;

    const tplContainer = document.getElementById("edit-tpl-tasks-container");
    if (tpl.tasks && tpl.tasks.length > 0) {
        tpl.tasks.forEach(t => {
            if (!t.type || t.type === 'task') {
                tplContainer.appendChild(createTemplateTaskRow(t.name, t.start, t.days, t.end));
            } else if (t.type === 'subproject') {
                window.addTemplateSubProjectRow(t.name, t.assigneeId, t.subTasks);
            }
        });
    } else {
        tplContainer.appendChild(createTemplateTaskRow("", "", 1, ""));
    }

    const modal = document.getElementById("general-edit-modal");
    const modalBox = modal.querySelector('.modal-box');
    if (modalBox) {
        modalBox.style.width = "90vw";
        modalBox.style.maxWidth = "1000px";
    }
    
    modal.classList.add("active");
};

window.addTemplateTaskRow = () => {
    document.getElementById("edit-tpl-tasks-container").appendChild(createTemplateTaskRow("", "", 1, ""));
};

window.createTemplateTaskRow = (name, start, days, end) => {
    const div = document.createElement('div');
    div.className = "form-row tpl-task-row";
    div.style.marginBottom = "8px";
    div.innerHTML = `
        <div class="form-group" style="margin:0; flex:3;"><input type="text" class="input-control task-name" placeholder="細項名稱" value="${name}"></div>
        <div class="form-group" style="margin:0; flex:1.5;"><input type="date" class="input-control task-start tpl-task-start" value="${start}" onchange="onTaskStartChange(this, null)"></div>
        <div class="form-group" style="margin:0; width:65px; flex-shrink:0;"><input type="number" min="1" class="input-control task-days tpl-task-days" value="${days||1}" placeholder="天數" title="工作天數" oninput="onTaskDaysChange(this, null, null)"></div>
        <div class="form-group" style="margin:0; flex:1.5;"><input type="date" class="input-control task-end tpl-task-end" value="${end}" min="${start}" onchange="onTaskEndChange(this, null, null)"></div>
        <div style="display:flex; gap:4px; margin:0; flex-shrink:0; align-items:center;">
            <button type="button" class="action-btn btn-sort" onclick="moveTaskRow(this, -1)" title="上移">↑</button>
            <button type="button" class="action-btn btn-sort" onclick="moveTaskRow(this, 1)" title="下移">↓</button>
            <button type="button" class="action-btn danger" onclick="this.closest('.tpl-task-row').remove()" style="padding:8px 10px;">X</button>
        </div>
    `;
    return div;
};

window.onEditWeeklyProjChange = (idx) => {
  const pSel = document.getElementById(`edit-weekly-proj-${idx}`);
  const tSel = document.getElementById(`edit-weekly-task-${idx}`);
  const contentArea = document.getElementById(`edit-val-item-${idx}`);
  if (!pSel || !tSel) return;
  
  if (pSel.value === 'SPECIAL_OTHER') {
     tSel.style.display = 'none';
     tSel.innerHTML = '<option value="">-- 無需細項 --</option>';
     tSel.value = '';
     if (contentArea) contentArea.value = '';
     return;
  }
  
  tSel.style.display = 'block';
  
  if (pSel.value === 'SPECIAL_ADHOC') {
     tSel.innerHTML = '<option value="">-- 請選擇事件紀錄 --</option>';
     const availableAdHocs = window.getAvailableAdHocEvents();
     availableAdHocs.forEach(evt => {
        tSel.innerHTML += `<option value="${evt.id}">${evt.title}</option>`;
     });
     if (contentArea) contentArea.value = '';
     return;
  }
  
  tSel.innerHTML = '<option value="">-- 請選擇細項 --</option>';
  const proj = allProjectsData.find(p => p.id === pSel.value);
  if (proj && proj.tasks) {
    proj.tasks.forEach((t, tIdx) => {
      tSel.innerHTML += `<option value="${tIdx}">${t.name}</option>`;
    });
  }
};

window.closeGeneralEditModal = () => {
    const modal = document.getElementById("general-edit-modal");
    modal.classList.remove("active");
    const modalBox = modal.querySelector('.modal-box');
    if (modalBox) {
        modalBox.style.width = "";
        modalBox.style.maxWidth = "";
    }
};

window.saveGeneralEdit = async () => {
  const { type, id, extra } = currentEditData;

  try {
    if (type === 'project') {
      const title = document.getElementById("edit-val-proj-title").value.trim();
      const checkboxes = document.querySelectorAll('input[name="edit_collab"]:checked');
      const collaborators = Array.from(checkboxes).map(cb => cb.value);

      if(title) await updateDoc(doc(db, "projects", id), { title, collaborators });
      else return alert("專案名稱不可為空！");
      
    } else if (type === 'subproject_edit') {
      const newName = document.getElementById("edit-subproj-name").value.trim();
      const newAssigneeId = document.getElementById("edit-subproj-assignee").value;
      const assigneeSelect = document.getElementById("edit-subproj-assignee");
      const newAssigneeName = newAssigneeId ? assigneeSelect.options[assigneeSelect.selectedIndex].text.split(' ')[0] : currentUserData.name;

      if (!newName) return alert("子專案名稱不可空白！");

      const proj = allProjectsData.find(p => p.id === currentEditData.projId);
      if (!proj) return alert("找不到專案！");

      const tasks = [...proj.tasks];
      const oldName = currentEditData.oldSubProjName;
      const isPending = (newAssigneeId !== proj.ownerId && newAssigneeId !== auth.currentUser.uid);

      tasks.forEach(t => {
          if (t.isSubProjectTask && t.parentSubProject === oldName) {
              t.parentSubProject = newName;
              t.name = t.name.replace(`[${oldName}]`, `[${newName}]`);
              if (newAssigneeId) {
                  t.assigneeId = newAssigneeId;
                  t.assigneeName = newAssigneeName;
                  t.isPendingAcceptance = isPending; 
              }
          }
      });

      await updateDoc(doc(db, "projects", proj.id), { tasks });
      closeGeneralEditModal();
      alert("✅ 子專案資訊修改成功！");
      renderProjects();
      return;
      
    } else if (type === 'task') {
      const proj = allProjectsData.find(p => p.id === id); 
      const tasks = [...proj.tasks];
      
      tasks[extra].name = document.getElementById("edit-val-name").value.trim();
      tasks[extra].start = document.getElementById("edit-val-start").value;
      tasks[extra].end = document.getElementById("edit-val-end").value;
      
      if (tasks[extra].isSubProjectTask && !tasks[extra].name.includes("簽核流程")) {
          if (!tasks[extra].datesSetAt) tasks[extra].datesSetAt = Date.now();
      }
      
      await updateDoc(doc(db, "projects", id), { tasks });
      
    } else if (type === 'adhoc') {
      // 🌟 從 Quill 編輯器抓取 HTML 內容，取代原本讀取純文字 input 的方式
      let newReason = window.editAdhocQuill ? window.editAdhocQuill.root.innerHTML.trim() : "";
      if (newReason === '<p><br></p>') newReason = "";

      await updateDoc(doc(db, "ad_hoc_events", id), {
        title: document.getElementById("edit-val-title").value.trim(),
        startDate: document.getElementById("edit-val-start").value,
        reason: newReason
      });
      
    } else if (type === 'weekly') {
      const weekly = allWeeklyData.find(w => w.id === id);
      const updateData = {};
      if (weekly.items && weekly.items.length > 0) {
        const newItems = [];
        for (let idx = 0; idx < weekly.items.length; idx++) {
          const pSel = document.getElementById(`edit-weekly-proj-${idx}`);
          const tSel = document.getElementById(`edit-weekly-task-${idx}`);
          const content = document.getElementById(`edit-val-item-${idx}`).value.trim();

          const pId = pSel ? pSel.value : weekly.items[idx].projectId;
          const pName = pSel && pSel.selectedIndex >= 0 ? pSel.options[pSel.selectedIndex].text : weekly.items[idx].projectName;
          
          const tId = (pId === 'SPECIAL_ADHOC' || pId === 'SPECIAL_OTHER') ? (tSel ? tSel.value : "") : (tSel ? tSel.value : weekly.items[idx].taskId);
          const tName = (pId === 'SPECIAL_ADHOC' || pId === 'SPECIAL_OTHER') ? (tSel && tSel.selectedIndex >= 0 ? tSel.options[tSel.selectedIndex].text : "") : (tSel && tSel.selectedIndex >= 0 ? tSel.options[tSel.selectedIndex].text : weekly.items[idx].taskName);

          newItems.push({
            projectId: pId,
            projectName: pName,
            taskId: tId,
            taskName: tName,
            content: content
          });
        }
        updateData.items = newItems;
      }
      await updateDoc(doc(db, "weekly_reports", id), updateData);
      
    } else if (type === 'template') {
      const newName = document.getElementById("edit-tpl-name").value.trim();
      const container = document.getElementById("edit-tpl-tasks-container");
      const tasks = [];
      
      for (let r of container.children) {
          if (r.classList.contains('tpl-task-row')) {
              const name = r.querySelector('.task-name').value.trim();
              const start = r.querySelector('.task-start').value;
              const days = parseInt(r.querySelector('.task-days').value) || 1;
              const end = r.querySelector('.task-end').value;
              if (name) tasks.push({ type: 'task', name, start, days, end });
          } else if (r.classList.contains('tpl-subproject-row')) {
              const subProjName = r.querySelector('.subproject-name').value.trim() || "未命名子專案";
              const assigneeId = r.querySelector('.subproject-assignee').value;
              
              const subTasks = [];
              r.querySelectorAll('.sub-task-item').forEach(st => {
                  const sName = st.querySelector('.sub-task-name').value.trim();
                  const sStart = st.querySelector('.sub-task-start').value;
                  const sDays = parseInt(st.querySelector('.sub-task-days').value) || 1;
                  const sEnd = st.querySelector('.sub-task-end').value;
                  const isApproval = st.classList.contains('is-approval-task');
                  if (sName) subTasks.push({ name: sName, start: sStart, days: sDays, end: sEnd, isApproval });
              });
              tasks.push({ type: 'subproject', name: subProjName, assigneeId, subTasks });
          }
      }
      
      projectTemplates[id].name = newName || `模板${id+1}`;
      projectTemplates[id].tasks = tasks;
      await setDoc(doc(db, "user_templates", auth.currentUser.uid), { templates: projectTemplates }, { merge: true });
    }
    
    closeGeneralEditModal(); 
    alert("✅ 資料修改成功！");
  } catch (err) { 
    alert("修改失敗：" + err.message); 
  }
};

window.toggleUserEditPermission = async (uid, checked) => {
  if (currentUserData.role !== 'admin') return alert('權限不足！');
  try { 
    await updateDoc(doc(db, "users", uid), { canEdit: checked }); 
  } catch(err) { 
    alert('設定失敗：'+err.message); 
  }
};

window.resetUserPassword = (email) => {
  if (confirm(`確定要發送「重設密碼」信件至 ${email} 嗎？\n系統將寄送一封專屬連結信件，員工點擊後即可自行重設密碼。`)) {
    sendPasswordResetEmail(auth, email).then(() => alert(`✅ 重設密碼信件已成功發送至：${email}\n請員工前往信箱收信。`)).catch(err => alert("發送失敗: " + err.message));
  }
};

window.rescueUserProjects = async (uid, userName) => {
  if (!userName) return alert("請先為該人員設定姓名！");
  if (!confirm(`【資料救援】\n即將掃描系統中所有署名為「${userName}」的舊專案與事件，強制綁回給這個帳號。\n確定要進行修復嗎？`)) return;
  try {
    let pCount = 0, wCount = 0;
    for (let p of allProjectsData) { 
      if (p.ownerName === userName && p.ownerId !== uid) { 
        await updateDoc(doc(db, "projects", p.id), { ownerId: uid }); 
        pCount++; 
      } 
    }
    for (let w of allWeeklyData) { 
      if (w.ownerName === userName && w.ownerId !== uid) { 
        await updateDoc(doc(db, "weekly_reports", w.id), { ownerId: uid }); 
        wCount++; 
      } 
    }
    for (let a of allAdHocData) { 
      if (a.ownerName === userName && a.ownerId !== uid) { 
        await updateDoc(doc(db, "ad_hoc_events", a.id), { ownerId: uid }); 
      } 
    }
    alert(`🎉 救援成功！\n已為「${userName}」找回：\n- ${pCount} 個專案\n- ${wCount} 份週報\n請重新點擊左側人員檢視查看。`);
  } catch (err) { 
    alert("救援失敗：" + err.message); 
  }
};

function loadOrgUsers() {
  const rolePriority = { admin: 1, top_manager: 2, senior_manager: 3, manager: 4, assistant_manager: 5, staff: 6 };

  onSnapshot(collection(db, "users"), (snapshot) => {
    const tbody = document.getElementById("user-list-tbody"); 
    const supervisorSelect = document.getElementById("new-user-supervisor");
    tbody.innerHTML = ""; 
    supervisorSelect.innerHTML = '<option value="">-- 無 --</option>'; 
    allUsersList = [];
    
    snapshot.forEach(docSnap => {
      const u = docSnap.data(); 
      allUsersList.push({ uid: docSnap.id, ...u });
      if (["top_manager", "senior_manager", "manager", "assistant_manager"].includes(u.role)) {
        supervisorSelect.innerHTML += `<option value="${docSnap.id}">${u.name} (${roleNames[u.role] || u.role})</option>`;
      }
    });

    allUsersList.sort((a, b) => {
      const deptA = a.dept || "設計部";
      const deptB = b.dept || "設計部";
      const deptIdxA = departmentList.indexOf(deptA);
      const deptIdxB = departmentList.indexOf(deptB);

      if (deptIdxA !== deptIdxB) {
        return (deptIdxA === -1 ? 99 : deptIdxA) - (deptIdxB === -1 ? 99 : deptIdxB);
      }
      return (rolePriority[a.role] || 99) - (rolePriority[b.role] || 99);
    });

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
            <input type="checkbox" onchange="toggleUserEditPermission('${u.uid}', this.checked)" ${u.canEdit ? 'checked' : ''} ${currentUserData.role === 'admin' ? '' : 'disabled'}>
            <span>開放</span>
          </label>
        </td>
        <td><strong>${u.name || '未命名'}</strong></td>
        <td>${u.email || '-'}</td>
        <td><span class="pill" style="background:#f1f5f9; color:#334155;">${u.dept || '設計部'}</span></td>
        <td><span class="pill pill-role">${roleNames[u.role] || u.role}</span></td>
        <td>${supUser ? `${supUser.name}` : "-"}</td>
        <td>
          <button class="action-btn" onclick="openEditModal('${u.uid}')" style="margin-right:4px;">編輯</button>
          <button class="action-btn" onclick="resetUserPassword('${u.email}')" style="margin-right:4px;">重設密碼</button>
          <button class="action-btn" onclick="rescueUserProjects('${u.uid}', '${u.name}')" style="margin-right:4px; border-color:#f59e0b; color:#f59e0b;" title="找回建立錯ID的資料">找回資料</button>
          ${u.uid !== auth.currentUser.uid ? `<button class="action-btn danger" onclick="deleteUserDoc('${u.uid}', '${u.name}')">刪除</button>` : ''}
        `;
      tbody.appendChild(tr);
    });
    renderOrgChart(); 
  });
}

document.getElementById("btn-create-user").addEventListener("click", async () => {
  const name = document.getElementById("new-user-name").value.trim(); 
  const email = document.getElementById("new-user-email").value.trim(); 
  const pass = document.getElementById("new-user-pass").value.trim();
  const dept = document.getElementById("new-user-dept").value;
  const role = document.getElementById("new-user-role").value;
  const supervisorId = document.getElementById("new-user-supervisor").value || null;

  if (!name || !email || pass.length < 6) return alert("資料填寫不全或密碼太短！");
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
});

window.openEditModal = (uid) => {
  const u = allUsersList.find(x => x.uid === uid);
  document.getElementById("edit-user-uid").value = u.uid; 
  document.getElementById("edit-user-name").value = u.name || ''; 
  document.getElementById("edit-user-dept").value = u.dept || '設計部';
  document.getElementById("edit-user-role").value = u.role || 'staff';
  
  const supSelect = document.getElementById("edit-user-supervisor"); 
  supSelect.innerHTML = '<option value="">-- 無 --</option>';
  allUsersList.forEach(user => { 
    if (user.uid !== uid && ["top_manager", "senior_manager", "manager", "assistant_manager"].includes(user.role)) {
      supSelect.innerHTML += `<option value="${user.uid}">${user.name} (${roleNames[user.role] || user.role})</option>`;
    }
  });
  supSelect.value = u.supervisorId || ''; 
  document.getElementById("edit-user-modal").classList.add("active");
};

window.closeEditModal = () => document.getElementById("edit-user-modal").classList.remove("active");

window.submitEditUser = async () => {
  try {
    const uidToEdit = document.getElementById("edit-user-uid").value;
    const newName = document.getElementById("edit-user-name").value.trim();
    
    await updateDoc(doc(db, "users", uidToEdit), { 
      name: newName, 
      dept: document.getElementById("edit-user-dept").value,
      role: document.getElementById("edit-user-role").value, 
      supervisorId: document.getElementById("edit-user-supervisor").value || null 
    });
    
    closeEditModal(); 
    alert("人員資訊更新成功！");

    if (uidToEdit === auth.currentUser.uid) {
      currentUserData.name = newName;
      document.getElementById("user-display-name").innerText = newName;
      document.getElementById("user-avatar").innerText = newName.charAt(0).toUpperCase();
    }
  } catch (err) { 
    alert("更新失敗: " + err.message); 
  }
};

window.deleteUserDoc = async (uid, name) => { 
  if (currentUserData.role !== 'admin') return alert("權限不足！");
  if (confirm(`確定刪除 ${name} 嗎？`)) { 
    try { 
      await deleteDoc(doc(db, "users", uid)); 
      alert(`已移除 ${name}！`); 
    } catch (err) { 
      alert("刪除失敗: " + err.message); 
    } 
  } 
};

document.getElementById("btn-update-password").addEventListener("click", async () => {
  const newPass = document.getElementById("profile-new-pass").value;
  const confirmPass = document.getElementById("profile-confirm-pass").value;

  if (!newPass || newPass.length < 6) return alert("新密碼至少需要 6 個字元！");
  if (newPass !== confirmPass) return alert("兩次輸入的密碼不一致！");

  if (!confirm("確定要更改您的登入密碼嗎？")) return;

  try {
    await updatePassword(auth.currentUser, newPass);
    alert("✅ 密碼更換成功！下次登入請使用新密碼。");
    document.getElementById("profile-new-pass").value = "";
    document.getElementById("profile-confirm-pass").value = "";
  } catch (error) {
    if (error.code === 'auth/requires-recent-login') {
      alert("⚠️ 基於安全考量，更換密碼需要您『最近剛登入過』。\n請先點擊右上角登出，重新使用舊密碼登入後，再嘗試修改密碼！");
    } else {
      alert("密碼更換失敗：" + error.message);
    }
  }
});

function getNowTimeStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

window.openPauseModal = (projId) => {
  document.getElementById("pause-proj-id").value = projId;
  document.getElementById("pause-reason-input").value = "";
  const todayStr = getTodayStr();
  const dateInput = document.getElementById("pause-start-date");
  dateInput.value = todayStr;
  dateInput.min = todayStr;
  document.getElementById("pause-request-modal").classList.add("active");
};

window.closePauseModal = () => document.getElementById("pause-request-modal").classList.remove("active");

window.submitPauseRequest = async () => {
  const projId = document.getElementById("pause-proj-id").value;
  const reason = document.getElementById("pause-reason-input").value.trim();
  const startDate = document.getElementById("pause-start-date").value; 
  
  if (!startDate) return alert("請選擇暫停起始日期！");
  if (!reason) return alert("請務必填寫暫停原因！");

  try {
    await updateDoc(doc(db, "projects", projId), {
      status: "pause_requested",
      pauseReason: reason,
      pauseStartDate: startDate, 
      pauseRequestedBy: currentUserData.name || "人員",
      pauseRequestedAt: getNowTimeStr(),
      lastPauseRequestedUid: auth.currentUser.uid
    });
    
    window.closePauseModal(); 
    alert("已送出暫停申請，請等待最高主管或管理員審核！");
  } catch (err) {
    alert("送出失敗：" + err.message);
  }
};

window.approvePause = async (projId) => {
    if (!confirm("確定要執行此同意審核嗎？")) return;
    const proj = allProjectsData.find(p => p.id === projId);
    if (!proj) return;
    
    const history = proj.pauseHistory || [];
    const logs = proj.auditLogs || []; 
    const tasks = [...proj.tasks];
    const ts = getNowTimeStr();
    const managerName = currentUserData.name || "主管";

    if (proj.status === 'pause_requested') {
        const startDateToUse = proj.pauseStartDate || getTodayStr();
        const reqBy = proj.pauseRequestedBy || "未記錄";
        const reqAt = proj.pauseRequestedAt || "未記錄";
        const reason = proj.pauseReason || "未記錄";
        const reqByUid = proj.lastPauseRequestedUid || proj.ownerId;

        history.push({ start: startDateToUse, end: null, reason: reason, requestedAt: reqAt });
        
        logs.push({ 
            action: '✅ 同意暫停', 
            manager: managerName, 
            time: ts,
            reqBy: reqBy, reqAt: reqAt, reqStart: startDateToUse, reqReason: reason
        });

        tasks.push({
            name: `[系統通知] 您的專案 [${proj.title}] 暫停申請已被【${managerName}】✅ 同意 (原因: ${reason || '無'})`,
            start: getTodayStr(),
            end: getTodayStr(),
            progress: 100,
            isCompleted: true,
            isSubProjectTask: true,
            parentSubProject: "專案審核通知",
            assigneeId: reqByUid,
            assigneeName: reqBy,
            isPendingAcceptance: false,
            isSystemNotifUnread: true,
            assignedByUid: auth.currentUser.uid,
            assignedByName: managerName,
            assignedAt: ts,
            history: [{ timestamp: ts, progress: 100, type: 'create', daysPassed: 0, delayReason: '', remark: `✅ 主管已同意專案暫停 (原因: ${reason || '無'})` }]
        });

        await updateDoc(doc(db, "projects", projId), {
            status: "paused",
            pauseHistory: history,
            auditLogs: logs,
            tasks: tasks,
            pauseStartDate: "", 
            pauseRequestedAt: "", 
            pauseRequestedBy: "", 
            pauseReason: ""
            // 🌟 保留 lastPauseRequestedUid，千萬不要刪除！
        });
        alert("已同意暫停申請，並已發送系統通知給申請人！");
    } 
    else if (proj.status === 'resume_requested') {
        const lastPause = history[history.length - 1];
        const resumeDate = proj.resumeRequestedDate || getTodayStr();
        const reqBy = proj.resumeRequestedBy || "未記錄";
        const targetResumeUid = proj.lastResumeRequestedUid || proj.ownerId;

        if (lastPause && !lastPause.end) {
            lastPause.end = resumeDate;
            let shiftDays = getWorkingDays(lastPause.start, resumeDate);
            let actualShift = Math.max(0, shiftDays - 1); 
            lastPause.days = actualShift;

            logs.push({ 
                action: `▶️ 同意恢復執行 (遞延 ${actualShift} 天)`, 
                manager: managerName, 
                time: ts,
                reqBy: reqBy, reqAt: proj.resumeRequestedAt || '-', reqStart: resumeDate, reqReason: '專案申請恢復執行'
            });

            const updatedTasks = proj.tasks.map(t => {
              if (t.isCompleted) return t;
              if (t.start >= lastPause.start) return { ...t, start: calculateEndDateByDays(t.start, actualShift + 1), end: calculateEndDateByDays(t.end, actualShift + 1) };
              if (t.end >= lastPause.start) return { ...t, end: calculateEndDateByDays(t.end, actualShift + 1) };
              return t;
            });

            updatedTasks.push({
                name: `[系統通知] 您的專案 [${proj.title}] 恢復執行申請已被【${managerName}】✅ 同意`,
                start: getTodayStr(),
                end: getTodayStr(),
                progress: 100,
                isCompleted: true,
                isSubProjectTask: true,
                parentSubProject: "專案審核通知",
                assigneeId: targetResumeUid,
                assigneeName: reqBy,
                isPendingAcceptance: false,
                isSystemNotifUnread: true,
                assignedByUid: auth.currentUser.uid,
                assignedByName: managerName,
                assignedAt: ts,
                history: [{ timestamp: ts, progress: 100, type: 'create', daysPassed: 0, delayReason: '', remark: '主管已同意恢復' }]
            });

            await updateDoc(doc(db, "projects", projId), {
                status: 'active',
                pauseHistory: history,
                auditLogs: logs,
                tasks: updatedTasks,
                resumeRequestedDate: "", 
                resumeRequestedBy: "", 
                resumeRequestedAt: ""
                // 🌟 保留 lastResumeRequestedUid，千萬不要刪除！
            });
            alert("已同意恢復執行，並已發送系統通知給申請人！");
        }
    }
};

window.rejectPause = async (projId) => {
    const reason = prompt("請輸入退回原因：", "");
    if (reason === null) return; 

    const proj = allProjectsData.find(p => p.id === projId);
    if (!proj) return;
    
    const logs = proj.auditLogs || [];
    const tasks = [...proj.tasks];
    const ts = getNowTimeStr();
    const managerName = currentUserData.name || "主管";
  
    if (proj.status === 'pause_requested') {
        const reqBy = proj.pauseRequestedBy || "未記錄";
        // 🌟 確保優先抓取申請人 UID
        const targetApplicantUid = proj.lastPauseRequestedUid || proj.ownerId;

        logs.push({ action: '❌ 退回暫停申請', manager: managerName, time: ts, reqBy: reqBy, reqAt: proj.pauseRequestedAt, reqStart: proj.pauseStartDate, reqReason: proj.pauseReason });

        tasks.push({
            name: `[系統通知] 您的專案 [${proj.title}] 暫停申請已被退回 (原因: ${reason || '無'})`,
            start: getTodayStr(),
            end: getTodayStr(),
            progress: 100,
            isCompleted: true,
            isSubProjectTask: true,
            parentSubProject: "專案審核通知",
            assigneeId: targetApplicantUid,
            assigneeName: reqBy,
            isPendingAcceptance: false, // 設為 false，直接顯示已通知
            isSystemNotifUnread: true,   // 🌟 標記為未讀，方便紅點提示
            assignedByUid: auth.currentUser.uid,
            assignedByName: managerName,
            assignedAt: ts,
            history: [{ timestamp: ts, progress: 100, type: 'create', daysPassed: 0, delayReason: '', remark: `暫停申請被退回: ${reason || '無'}` }]
        });

        await updateDoc(doc(db, "projects", projId), {
            status: "active", pauseReason: "", pauseRequestedBy: "", pauseStartDate: "", pauseRequestedAt: "", auditLogs: logs, tasks: tasks
        });
        alert("已退回暫停申請，並已發送系統通知給申請人！");
        
    } else if (proj.status === 'resume_requested') {
        const reqBy = proj.resumeRequestedBy || "未記錄";
        // 🌟 確保優先抓取申請人 UID
        const targetApplicantUid = proj.lastResumeRequestedUid || proj.ownerId;

        logs.push({ action: '❌ 退回恢復申請', manager: managerName, time: ts, reqBy: reqBy, reqAt: proj.resumeRequestedAt, reqStart: proj.resumeRequestedDate, reqReason: '恢復執行申請' });

        tasks.push({
            name: `[系統通知] 您的專案 [${proj.title}] 恢復執行申請已被退回 (原因: ${reason || '無'})`,
            start: getTodayStr(),
            end: getTodayStr(),
            progress: 100,
            isCompleted: true,
            isSubProjectTask: true,
            parentSubProject: "專案審核通知",
            assigneeId: targetApplicantUid,
            assigneeName: reqBy,
            isPendingAcceptance: false,
            isSystemNotifUnread: true,
            assignedByUid: auth.currentUser.uid,
            assignedByName: managerName,
            assignedAt: ts,
            history: [{ timestamp: ts, progress: 100, type: 'create', daysPassed: 0, delayReason: '', remark: `恢復申請被退回: ${reason || '無'}` }]
        });

        await updateDoc(doc(db, "projects", projId), {
            status: "paused", resumeRequestedDate: "", resumeRequestedBy: "", resumeRequestedAt: "", auditLogs: logs, tasks: tasks
        });
        alert("已退回恢復執行申請，並已發送系統通知給申請人！");
    }
};
window.resumeProject = async (projId) => {
  if (!confirm("確定要恢復執行此專案嗎？\n系統將會自動結算暫停天數，並將尚未完成的任務時程往後遞延！")) return;
  const proj = allProjectsData.find(p => p.id === projId);
  if (!proj) return;

  const todayStr = getTodayStr();
  const history = proj.pauseHistory || [];
  const logs = proj.auditLogs || [];
  const lastPause = history[history.length - 1];

  if (lastPause && !lastPause.end) {
    lastPause.end = todayStr;
    let shiftDays = getWorkingDays(lastPause.start, todayStr);
    let actualShift = Math.max(0, shiftDays - 1); 
    lastPause.days = actualShift;

    logs.push({ 
        action: `▶️ 恢復執行 (遞延 ${actualShift} 天)`, 
        manager: currentUserData.name, 
        time: getNowTimeStr(),
        reqBy: '-', reqAt: '-', reqStart: '-', reqReason: '專案重新啟動'
    });

    const updatedTasks = proj.tasks.map(t => {
      if (t.isCompleted) return t;
      if (t.start >= lastPause.start) return { ...t, start: calculateEndDateByDays(t.start, actualShift + 1), end: calculateEndDateByDays(t.end, actualShift + 1) };
      if (t.end >= lastPause.start) return { ...t, end: calculateEndDateByDays(t.end, actualShift + 1) };
      return t;
    });

    await updateDoc(doc(db, "projects", projId), {
      status: 'active',
      pauseHistory: history,
      auditLogs: logs,
      tasks: updatedTasks
    });
  }
};

window.renderApprovals = () => {
  const tbody = document.getElementById("sub-approvals-list-tbody") || document.getElementById("approvals-list-tbody");
  const emptyState = document.getElementById("sub-approvals-empty-state") || document.getElementById("approvals-empty-state");
  const tableContainer = document.getElementById("sub-approvals-table-container");
  const historyTbody = document.getElementById("sub-approval-history-tbody") || document.getElementById("approval-history-tbody");
  
  if (!tbody) return;
  tbody.innerHTML = "";

  // 2. 主管審核數量計算與按鈕顯示 (加入 pending_approval 案件)
    const isTopOrAdmin = (currentUserData.role === 'admin' || currentUserData.role === 'top_manager' || currentUserData.role === 'senior_manager');
    const isDeptManager = (currentUserData.role === 'manager' || currentUserData.role === 'assistant_manager');
    let approvalPendingCount = 0;

    if (isTopOrAdmin || isDeptManager) {
        if (btnApprovals) btnApprovals.style.display = 'inline-flex';
        
    // ==========================================
    // 4. 🌟 主管審核、協作指派與退回重審事項 (資料過濾)
    // ==========================================
    const pendingApprovals = allProjectsData.filter(p => {
      // 1. 暫停與恢復申請：最高主管與管理員負責
      if (p.status === 'pause_requested' || p.status === 'resume_requested') {
        return isTopOrAdmin;
      }
      
      // 2. 🌟 開案者看自己被退回的專案（提示重新送審）
      const isRejected = (p.status === 'rejected' || p.approvalConfig?.approvalStatus === 'rejected');
      if (isRejected && p.ownerId === myUid) {
        return true;
      }

      // 3. 專案開案簽核與協作指派審核
      if (p.status === 'pending_approval') {
        const cfg = p.approvalConfig || {};
        if (cfg.currentAssigneeUid) {
          return cfg.currentAssigneeUid === myUid;
        }
        if (isTopOrAdmin && (cfg.currentStage === 'top_manager' || !cfg.currentStage)) {
          return true;
        }
      }

      return false;
    });

    totalPendingCount += pendingApprovals.length;
        approvalPendingCount = pendingApprovals.length;
    } else {
        if (btnApprovals) btnApprovals.style.display = 'none';
    }

  // 🌟 抓取：1. 暫停/恢復申請 2. 新專案開案簽核/協作指派 (依照層級權限)
  const pendingProjects = allProjectsData.filter(p => {
    // 暫停與恢復申請 (僅管理員/最高級主管審核)
    if (p.status === 'pause_requested' || p.status === 'resume_requested') {
      return isTopOrAdmin;
    }
    // 專案開案簽核流程
    if (p.status === 'pending_approval') {
      const cfg = p.approvalConfig || {};
      // 最高主管/管理員：接收所有頂層簽核與頂層協作指派
      if (isTopOrAdmin) return true;
      // 部門主管：如果協作指派給了自己
      if (isDeptManager && cfg.currentAssigneeUid === auth.currentUser.uid) return true;
    }
    return false;
  });

  if (pendingProjects.length === 0) {
    if (emptyState) emptyState.style.display = "block";
    if (tableContainer) tableContainer.style.display = "none";
  } else {
    if (emptyState) emptyState.style.display = "none";
    if (tableContainer) tableContainer.style.display = "block";
    
    pendingProjects.forEach(p => {
      const isPauseResume = (p.status === 'pause_requested' || p.status === 'resume_requested');
      const isPendingApproval = (p.status === 'pending_approval');
      const cfg = p.approvalConfig || {};

      let reqTitle = p.title;
      let reqBy = p.ownerName;
      let reqAt = '-';
      let reqDate = '-';
      let reqReason = '';
      let actionButtons = '';

      if (isPauseResume) {
        let isResume = (p.status === 'resume_requested');
        reqTitle = isResume ? '<span style="color:var(--success); font-weight:bold;">[申請恢復]</span> ' + p.title : '<span style="color:var(--danger); font-weight:bold;">[申請暫停]</span> ' + p.title;
        reqDate = isResume ? (p.resumeRequestedDate || '-') : (p.pauseStartDate || '-');
        reqReason = isResume ? '預計恢復執行' : (p.pauseReason || '');
        reqBy = isResume ? p.resumeRequestedBy : p.pauseRequestedBy;
        reqAt = isResume ? p.resumeRequestedAt : p.pauseRequestedAt;

        actionButtons = `
          <button class="btn-primary" style="background:var(--danger); border:none; padding:4px 10px; font-size:12px; width:auto; margin-right:4px;" onclick="approvePause('${p.id}')">同意</button>
          <button class="action-btn" style="padding:4px 10px; font-size:12px; width:auto;" onclick="rejectPause('${p.id}')">退回</button>
        `;
      } else if (isPendingApproval) {
        if (cfg.isApplyCollab) {
          reqTitle = `<span style="color:var(--primary); font-weight:bold;">[協作申請]</span> ${p.title}`;
          reqDate = '待指派';
        } else {
          reqTitle = `<span style="color:#d97706; font-weight:bold;">[專案簽核]</span> ${p.title}`;
          reqDate = '待審核同意';
        }
        reqBy = p.ownerName;
        reqReason = cfg.approvalDesc || (p.approvalHistory && p.approvalHistory[0]?.remark) || '無說明';
        
        if (p.createdAt?.toDate) {
          reqAt = p.createdAt.toDate().toLocaleString('zh-TW', { hour12: false });
        } else {
          reqAt = p.approvalHistory && p.approvalHistory[0]?.time ? p.approvalHistory[0].time : '-';
        }

        if (cfg.isApplyCollab) {
          actionButtons = `
            <button class="action-btn" style="background:#3b82f6; color:#fff; border:none; padding:4px 10px; font-size:12px; width:auto; margin-right:4px;" onclick="openDispatchModal('${p.id}')">👥 指派</button>
            <button class="action-btn" style="background:#10b981; color:#fff; border:none; padding:4px 10px; font-size:12px; width:auto; margin-right:4px;" onclick="selfAcceptCollabProject('${p.id}')">自行承接</button>
            <button class="action-btn danger" style="padding:4px 10px; font-size:12px; width:auto;" onclick="rejectProjectApproval('${p.id}')">退回</button>
          `;
        } else {
          actionButtons = `
            <button class="action-btn" style="background:#10b981; color:#fff; border:none; padding:4px 10px; font-size:12px; width:auto; margin-right:4px;" onclick="approveProjectApproval('${p.id}')">✅ 同意開案</button>
            <button class="action-btn danger" style="padding:4px 10px; font-size:12px; width:auto;" onclick="rejectProjectApproval('${p.id}')">❌ 退回</button>
          `;
        }
      }

      const tr = document.createElement("tr");
      tr.style.borderBottom = "1px solid var(--border-light)";
      tr.innerHTML = `
        <td style="padding: 12px 8px;"><span style="color:var(--primary); font-weight:bold; cursor:pointer;" onclick="switchViewingUser('${p.ownerId}', '${p.ownerName || '人員'}'); switchNav('tab-projects', '專案進度', document.querySelector('li[onclick*=\\'tab-projects\\']')); setTimeout(() => selectProject('${p.id}'), 150);">${reqTitle}</span></td>
        <td style="padding: 12px 8px;"><span class="pill" style="background:#eff6ff; color:#1e40af;">${reqBy || '未知'}</span></td>
        <td style="padding: 12px 8px;"><span style="font-size:12px; color:var(--text-muted);">${reqAt || '未記錄'}</span></td>
        <td style="padding: 12px 8px;"><strong style="color:var(--danger);">${reqDate}</strong></td>
        <td style="padding: 12px 8px; word-break: break-all; color: var(--text-muted);">${reqReason}</td>
        <td style="padding: 12px 8px; text-align: center; white-space: nowrap;">
          ${actionButtons}
        </td>
      `;
      tbody.appendChild(tr);
    });
  }

  // 渲染主管歷史審核與操作紀錄
  if (historyTbody) {
    historyTbody.innerHTML = "";
    let allLogs = [];
    allProjectsData.forEach(p => {
        if (p.auditLogs) {
            p.auditLogs.forEach(log => allLogs.push({ 
                projId: p.id, 
                ownerId: p.ownerId, 
                ownerName: p.ownerName || '人員', 
                title: p.title, 
                ...log 
            }));
        }
        // 亦將簽核歷史整合進操作紀錄
        if (p.approvalHistory && p.approvalHistory.length > 1) {
          p.approvalHistory.slice(1).forEach(h => {
            allLogs.push({
              projId: p.id,
              ownerId: p.ownerId,
              ownerName: p.ownerName || '人員',
              title: p.title,
              time: h.time,
              action: h.step,
              manager: h.operatorName,
              reqBy: p.ownerName,
              reqAt: p.approvalHistory[0]?.time || '-',
              reqStart: '-',
              reqReason: h.remark || '-'
            });
          });
        }
    });
    allLogs.sort((a, b) => new Date((b.time||'').replace(/-/g, '/')) - new Date((a.time||'').replace(/-/g, '/')));
    
    allLogs.forEach(log => {
      let actionStyle = (log.action.includes('同意') || log.action.includes('承接')) ? 'color:var(--success);font-weight:bold;' : log.action.includes('退回') ? 'color:var(--danger);font-weight:bold;' : 'color:var(--primary);font-weight:bold;';
      let delBtnHtml = `<button class="action-btn danger" style="padding: 2px 6px; font-size: 11px;" onclick="deleteAuditLog('${log.projId}', '${log.time}', '${log.action}')">刪除</button>`;

      const tr = document.createElement("tr");
      tr.style.borderBottom = "1px solid var(--border-light)";
      tr.innerHTML = `
        <td style="padding: 10px 8px;"><span style="font-size:12px; color:#475569;">${log.time}</span></td>
        <td style="padding: 10px 8px;">
          <span style="color:var(--primary); font-weight:bold; cursor:pointer;" 
                onclick="switchViewingUser('${log.ownerId}', '${log.ownerName}'); switchNav('tab-projects', '專案進度', document.querySelector('li[onclick*=\\'tab-projects\\']')); setTimeout(() => selectProject('${log.projId}'), 150);" 
                title="點擊前往查看此專案">
            ${log.title}
          </span>
        </td>
        <td style="padding: 10px 8px;"><span style="${actionStyle}">${log.action}</span></td>
        <td style="padding: 10px 8px;"><span class="pill" style="background:#f1f5f9; color:#334155;">${log.manager}</span></td>
        <td style="padding: 10px 8px;">
          <span class="pill" style="background:#eff6ff; color:#1e40af; margin-bottom:2px; display:inline-block;">${log.reqBy || '-'}</span><br>
          <span style="font-size:11px; color:#94a3b8;">${log.reqAt || '-'}</span>
        </td>
        <td style="padding: 10px 8px;"><strong style="color:var(--danger); font-size:12px;">${log.reqStart || '-'}</strong></td>
        <td style="padding: 10px 8px; word-break:break-all; color:var(--text-muted); font-size:12px;">${log.reqReason || '-'}</td>
        <td style="padding: 10px 8px; text-align: center;">${delBtnHtml}</td>
      `;
      historyTbody.appendChild(tr);
    });
  }
};

window.deleteAuditLog = async (projId, logTime, logAction) => {
  if (currentUserData.role !== 'admin' && currentUserData.role !== 'top_manager') {
    return alert("權限不足：只有系統管理員或高級主管可以刪除歷史紀錄！");
  }
  if (!confirm("⚠️ 確定要刪除這筆歷史操作紀錄嗎？刪除後將無法復原。")) return;

  const proj = allProjectsData.find(p => p.id === projId);
  if (!proj || !proj.auditLogs) return;

  const newLogs = proj.auditLogs.filter(log => !(log.time === logTime && log.action === logAction));

  try {
    await updateDoc(doc(db, "projects", projId), { auditLogs: newLogs });
  } catch (err) {
    alert("刪除失敗：" + err.message);
  }
};

window.openResumeModal = (projId) => {
  document.getElementById("resume-proj-id").value = projId;
  const todayStr = getTodayStr();
  const dateInput = document.getElementById("resume-date-input");
  dateInput.value = todayStr;
  dateInput.min = todayStr;
  document.getElementById("resume-request-modal").classList.add("active");
};

window.closeResumeModal = () => document.getElementById("resume-request-modal").classList.remove("active");

window.submitResumeRequest = async () => {
  const projId = document.getElementById("resume-proj-id").value;
  const resumeDate = document.getElementById("resume-date-input").value;
  
  if (!resumeDate) return alert("請選擇預計恢復日期！");

  try {
    await updateDoc(doc(db, "projects", projId), {
      status: "resume_requested",
      resumeRequestedDate: resumeDate,
      resumeRequestedBy: currentUserData.name || "人員",
      resumeRequestedAt: getNowTimeStr(),
      lastResumeRequestedUid: auth.currentUser.uid
    });
    window.closeResumeModal(); 
    alert("已送出恢復執行申請，請等待最高主管或管理員審核！");
  } catch (err) {
    alert("送出失敗：" + err.message);
  }
};

window.openEditRemarkModal = async (projId, taskIndex, targetTimestamp) => {
    const proj = allProjectsData.find(p => p.id === projId);
    if (!proj || !proj.tasks[taskIndex]) return;
    const task = proj.tasks[taskIndex];
    if (!task.history || task.history.length === 0) return;

    const targetHist = task.history.find(h => h.timestamp === targetTimestamp);
    if (!targetHist) return alert("找不到此筆歷史紀錄！");

    let currentRemark = targetHist.delayReason || targetHist.remark || "";
    const newRemark = await window.openCustomPrompt(
        "✏️ 修改原因", 
        "修改紀錄的備註 / Delay 內容：", 
        false, 
        currentRemark
    );
    
    if (newRemark === null) return;

    targetHist.remark = newRemark;
    if (targetHist.delayReason !== undefined && targetHist.delayReason !== null && targetHist.delayReason !== "") {
        targetHist.delayReason = newRemark;
    }
    
    if (task.history[task.history.length - 1].timestamp === targetTimestamp && task.delayReason) {
        task.delayReason = newRemark;
    }

    try {
        await updateDoc(doc(db, "projects", projId), { tasks: proj.tasks });
        alert("✅ 內容修改成功！");
    } catch (err) {
        alert("修改失敗：" + err.message);
    }
};

window.addPreFilledInnerSubTask = (container, name, start, days, end, isApproval) => {
   const div = document.createElement('div');
   div.className = isApproval ? "sub-task-item is-approval-task" : "sub-task-item normal-sub-task";
   div.style.cssText = "display:flex; gap:6px; align-items:center;";
   
   if (isApproval) {
       div.innerHTML = `
          <span style="font-size:12px; color:var(--danger); font-weight:bold; width:20px;"></span>
          <input type="text" class="input-control sub-task-name" value="${name}" readonly style="flex:2; background:#fef2f2; color:var(--danger); font-weight:bold; border-color:#fca5a5;">
          <input type="date" class="input-control sub-task-start" value="${start}" onchange="onTaskStartChange(this, null); window.syncSubTasksDate(this)" style="flex:1;">
          <input type="number" class="input-control sub-task-days" value="${days}" placeholder="天數" oninput="onTaskDaysChange(this, null, null)" style="width:60px;">
          <input type="date" class="input-control sub-task-end" value="${end}" onchange="onTaskEndChange(this, null, null)" style="flex:1;">
        `;
   } else {
       div.innerHTML = `
          <span style="font-size:12px; font-weight:bold; width:20px;"></span>
          <input type="text" class="input-control sub-task-name" placeholder="子細項名稱" value="${name}" style="flex:2;">
          <input type="date" class="input-control sub-task-start" value="${start}" style="flex:1;" onchange="onTaskStartChange(this, null)">
          <input type="number" class="input-control sub-task-days" value="${days}" placeholder="天" style="width:60px;" oninput="onTaskDaysChange(this, null, null)">
          <input type="date" class="input-control sub-task-end" value="${end}" style="flex:1;" onchange="onTaskEndChange(this, null, null)">
          <button type="button" class="btn-close" style="font-size:14px; color:var(--danger);" onclick="const c = this.closest('.sub-tasks-container'); this.parentElement.remove(); window.updateSubTaskNumbers(c);">×</button>
       `;
   }
   container.appendChild(div);
   window.updateSubTaskNumbers(container);
};

window.addSubProjectRow = (defaultName = "", defaultAssignee = "", subTasks = [], mode = "sequential") => {
  const container = document.getElementById("task-list-container"); 
  
  let assigneeOptions = '<option value="">-- 指派給 (選填) --</option>';
  let purchasingUsers = allUsersList.filter(u => u.dept === '採購部');
  purchasingUsers.forEach(u => {
      const selected = (u.uid === defaultAssignee) ? "selected" : "";
      assigneeOptions += `<option value="${u.uid}" ${selected}>${u.name} (採購部)</option>`;
  });

  const div = document.createElement('div'); 
  div.className = "form-row subproject-row"; 
  div.style.cssText = "margin-bottom: 8px; background: #fffbeb; border: 1px solid #fcd34d; border-radius: 6px; padding: 10px; flex-direction: column; gap: 8px;";
  
  div.innerHTML = `
    <div style="display:flex; gap:8px; align-items:center;">
      <span style="font-weight:bold; color:#d97706;">📦 子專案</span>
      <div class="form-group" style="margin:0; flex:2;">
        <input type="text" class="input-control task-name subproject-name" placeholder="子專案名稱 (例: 零件採購)" value="${defaultName}">
      </div>
      <div class="form-group" style="margin:0; flex:1;">
        <select class="input-control subproject-assignee" onchange="onSubProjectAssigneeChange(this)">
           ${assigneeOptions}
        </select>
      </div>
      <div style="display:flex; gap:4px; margin:0; flex-shrink:0;">
        <button type="button" class="action-btn btn-sort" onclick="moveTaskRow(this, -1)" title="上移">↑</button>
        <button type="button" class="action-btn btn-sort" onclick="moveTaskRow(this, 1)" title="下移">↓</button>
        <button type="button" class="action-btn danger" onclick="this.closest('.subproject-row').remove()" style="padding:8px 10px;">X</button>
      </div>
    </div>
    <div class="sub-tasks-container" style="margin-left: 20px; border-left: 2px solid #fcd34d; padding-left: 10px; display:flex; flex-direction:column; gap:6px;">
    </div>
    <button type="button" class="action-btn" onclick="window.addInnerSubTask(this)" style="margin-left: 30px; font-size: 11px; padding: 2px 8px; width: fit-content; border-color:#fcd34d; color:#b45309;">+ 追加子細項</button>
  `;
  container.appendChild(div);
  
  const tasksContainer = div.querySelector('.sub-tasks-container');
  if (subTasks && subTasks.length > 0) {
      subTasks.forEach(st => {
         let sDays = mode === 'free' ? 1 : (st.days || 1);
         window.addPreFilledInnerSubTask(tasksContainer, st.name, "", sDays, "", st.isApproval);
      });
  }
};

window.addInnerSubTask = (btn) => {
   const container = btn.previousElementSibling;
   let defaultStart = "";
   const existingApproval = container.querySelector('.is-approval-task .sub-task-start');
   if (existingApproval && existingApproval.value) defaultStart = existingApproval.value;

   const div = document.createElement('div');
   div.className = "sub-task-item normal-sub-task";
   div.style.cssText = "display:flex; gap:6px; align-items:center;";
   div.innerHTML = `
      <span style="font-size:12px; font-weight:bold; width:20px;"></span>
      <input type="text" class="input-control sub-task-name" placeholder="子細項名稱" style="flex:2;">
      <input type="date" class="input-control sub-task-start" value="${defaultStart}" style="flex:1;" onchange="onTaskStartChange(this, null)">
      <input type="number" class="input-control sub-task-days" placeholder="天" style="width:60px;" oninput="onTaskDaysChange(this, null, null)">
      <input type="date" class="input-control sub-task-end" value="${defaultStart}" style="flex:1;" onchange="onTaskEndChange(this, null, null)">
      <button type="button" class="btn-close" style="font-size:14px; color:var(--danger);" onclick="const c = this.closest('.sub-tasks-container'); this.parentElement.remove(); window.updateSubTaskNumbers(c);">×</button>
   `;
   container.appendChild(div);
   window.updateSubTaskNumbers(container);
};

window.addTemplateSubProjectRow = (defaultName = "", defaultAssignee = "", subTasks = []) => {
    const container = document.getElementById("edit-tpl-tasks-container");
    
    let assigneeOptions = '<option value="">-- 指派給 (選填) --</option>';
    let purchasingUsers = allUsersList.filter(u => u.dept === '採購部');
    purchasingUsers.forEach(u => {
        const selected = (u.uid === defaultAssignee) ? "selected" : "";
        assigneeOptions += `<option value="${u.uid}" ${selected}>${u.name} (採購部)</option>`;
    });

    const div = document.createElement('div');
    div.className = "form-row tpl-subproject-row"; 
    div.style.cssText = "margin-bottom: 8px; background: #fffbeb; border: 1px solid #fcd34d; border-radius: 6px; padding: 10px; flex-direction: column; gap: 8px;";
    
    div.innerHTML = `
      <div style="display:flex; gap:8px; align-items:center;">
        <span style="font-weight:bold; color:#d97706;">📦 子專案</span>
        <div class="form-group" style="margin:0; flex:2;">
          <input type="text" class="input-control task-name subproject-name" placeholder="子專案名稱 (例: 零件採購)" value="${defaultName}">
        </div>
        <div class="form-group" style="margin:0; flex:1;">
            <select class="input-control subproject-assignee" onchange="onSubProjectAssigneeChange(this)">
               ${assigneeOptions}
            </select>
        </div>
        <div style="display:flex; gap:4px; margin:0; flex-shrink:0;">
          <button type="button" class="action-btn btn-sort" onclick="moveTaskRow(this, -1)" title="上移">↑</button>
          <button type="button" class="action-btn btn-sort" onclick="moveTaskRow(this, 1)" title="下移">↓</button>
          <button type="button" class="action-btn danger" onclick="this.closest('.tpl-subproject-row').remove()" style="padding:8px 10px;">X</button>
        </div>
      </div>
      <div class="sub-tasks-container" style="margin-left: 20px; border-left: 2px solid #fcd34d; padding-left: 10px; display:flex; flex-direction:column; gap:6px;">
      </div>
      <button type="button" class="action-btn" onclick="window.addInnerSubTask(this)" style="margin-left: 30px; font-size: 11px; padding: 2px 8px; width: fit-content; border-color:#fcd34d; color:#b45309;">+ 追加子細項</button>
    `;
    container.appendChild(div);

    const tasksContainer = div.querySelector('.sub-tasks-container');
    if (subTasks && subTasks.length > 0) {
        subTasks.forEach(st => {
           window.addPreFilledInnerSubTask(tasksContainer, st.name, st.start, st.days, st.end, st.isApproval);
        });
    }
};

window.onSubProjectAssigneeChange = (selectElem) => {
    const uid = selectElem.value;
    let isPurchasing = false;
    if (uid) {
        const user = allUsersList.find(u => u.uid === uid);
        if (user && user.dept === '採購部') isPurchasing = true;
    }

    const row = selectElem.closest('.subproject-row') || selectElem.closest('.tpl-subproject-row');
    const tasksContainer = row.querySelector('.sub-tasks-container');
    const existingApproval = tasksContainer.querySelector('.is-approval-task');

    if (isPurchasing) {
        if (!existingApproval) {
            let defaultStart = getTodayStr();
            const div = document.createElement('div');
            div.className = "sub-task-item is-approval-task";
            div.style.cssText = "display:flex; gap:6px; align-items:center;";
            div.innerHTML = `
              <span style="font-size:12px; color:var(--danger); font-weight:bold; width:20px;"></span>
              <input type="text" class="input-control sub-task-name" value="簽核流程" readonly style="flex:2; background:#fef2f2; color:var(--danger); font-weight:bold; border-color:#fca5a5;">
              <input type="date" class="input-control sub-task-start" value="${defaultStart}" onchange="onTaskStartChange(this, null); window.syncSubTasksDate(this)" style="flex:1;">
              <input type="number" class="input-control sub-task-days" value="1" placeholder="天數" oninput="onTaskDaysChange(this, null, null)" style="width:60px;">
              <input type="date" class="input-control sub-task-end" value="${defaultStart}" onchange="onTaskEndChange(this, null, null)" style="flex:1;">
            `;
            tasksContainer.insertBefore(div, tasksContainer.firstChild);
            window.syncSubTasksDate(div.querySelector('.sub-task-start'));
        }
    } else {
        if (existingApproval) existingApproval.remove();
    }
    window.updateSubTaskNumbers(tasksContainer);
};

window.updateSubTaskNumbers = (container) => {
    if (!container) return;
    const items = container.querySelectorAll('.sub-task-item');
    items.forEach((item, idx) => {
        const span = item.querySelector('span');
        if (span) {
            span.innerText = (idx + 1) + ".";
            span.style.color = item.classList.contains('is-approval-task') ? "var(--danger)" : "var(--text-muted)";
        }
    });
};

window.openAddSubProjectModal = () => {
    const proj = allProjectsData.find(p => p.id === selectedProjectId);
    if (!proj) return;
    
    const container = document.getElementById("add-subproject-container");
    container.innerHTML = ""; 
    
    const titleHeader = document.createElement('div');
    titleHeader.style.cssText = "margin-bottom: 15px; font-size: 15px; font-weight: bold; color: var(--primary); background: #e0e7ff; padding: 8px 12px; border-radius: 6px; border: 1px solid #c7d2fe;";
    titleHeader.innerHTML = `📝 目前主專案：<span style="color: #312e81;">${proj.title}</span>`;
    container.appendChild(titleHeader);
    
    let assigneeOptions = '<option value="">-- 指派給 (選填) --</option>';
    let purchasingUsers = allUsersList.filter(u => u.dept === '採購部');
    purchasingUsers.forEach(u => {
        assigneeOptions += `<option value="${u.uid}">${u.name} (採購部)</option>`;
    });

    const div = document.createElement('div'); 
    div.className = "form-row subproject-row"; 
    div.style.cssText = "background: #fffbeb; border: 1px solid #fcd34d; border-radius: 6px; padding: 10px; flex-direction: column; gap: 8px;";
    
    div.innerHTML = `
      <div style="display:flex; gap:8px; align-items:center;">
        <span style="font-weight:bold; color:#d97706;">📦 子專案</span>
        <div class="form-group" style="margin:0; flex:2;">
          <input type="text" class="input-control task-name subproject-name" placeholder="子專案名稱 (例: 零件採購)">
        </div>
        <div class="form-group" style="margin:0; flex:1;">
          <select class="input-control subproject-assignee" onchange="onSubProjectAssigneeChange(this)">
             ${assigneeOptions}
          </select>
        </div>
      </div>
      <div class="sub-tasks-container" style="margin-top: 10px; margin-left: 20px; border-left: 2px solid #fcd34d; padding-left: 10px; display:flex; flex-direction:column; gap:6px;">
      </div>
      <button type="button" class="action-btn" onclick="window.addInnerSubTask(this)" style="margin-left: 30px; font-size: 11px; padding: 2px 8px; width: fit-content; border-color:#fcd34d; color:#b45309;">+ 追加子細項</button>
    `;
    
    container.appendChild(div);
    document.getElementById("project-subproject-modal").classList.add("active");
};

window.closeAddSubProjectModal = () => {
    document.getElementById("project-subproject-modal").classList.remove("active");
};

window.submitAddSubProject = async () => {
    const container = document.getElementById("add-subproject-container");
    const subProjName = container.querySelector('.subproject-name').value.trim() || "未命名子專案";
    
    const assigneeSelect = container.querySelector('.subproject-assignee');
    const assigneeId = assigneeSelect.value;
    const assigneeName = assigneeId ? assigneeSelect.options[assigneeSelect.selectedIndex].text.split(' ')[0] : (currentUserData.name || auth.currentUser.email.split('@')[0]);
    const uidToAssign = assigneeId || auth.currentUser.uid;
    
    const ts = new Date().toLocaleString('zh-TW', { hour12: false });
    const todayStr = getTodayStr();
    const newTasks = [];
    
    const isPending = (uidToAssign !== auth.currentUser.uid);
    const currentUserName = currentUserData.name || auth.currentUser.email.split('@')[0];

    const taskItems = container.querySelectorAll('.sub-task-item');
    if (taskItems.length === 0) {
        newTasks.push({ 
            name: `[${subProjName}] 尚未建立細項`, 
            start: todayStr, end: todayStr, progress: 0, isCompleted: false, completedAt: null, delayReason: "", lastUpdatedAt: ts, reportedCompleted: false, 
            assigneeId: uidToAssign,
            assigneeName: assigneeName,
            isSubProjectTask: true,
            parentSubProject: subProjName, 
            createdAt: Date.now(), 
            isPendingAcceptance: isPending,
            assignedByUid: auth.currentUser.uid,
            assignedByName: currentUserName,
            assignedAt: ts,
            history: [{ timestamp: ts, progress: 0, type: 'create', daysPassed: 0, delayReason: '', remark: '追加空子專案' }] 
        });
    } else {
        for (let subRow of taskItems) {
            const sName = subRow.querySelector('.sub-task-name').value.trim();
            const sStart = subRow.querySelector('.sub-task-start').value;
            const sEnd = subRow.querySelector('.sub-task-end').value;
            
            if (!sName) continue;
            if (!sStart || !sEnd) return alert(`子細項不可有空白日期！`);
            if (sStart > sEnd) return alert(`子細項 [${sName}] 的起始日不可大於完成日！`);
            
            let passedDays = 0; 
            if (todayStr >= sStart) passedDays = getWorkingDays(sStart, todayStr);

            newTasks.push({ 
              name: `[${subProjName}] ${sName}`, 
              start: sStart, end: sEnd, progress: 0, isCompleted: false, completedAt: null, delayReason: "", lastUpdatedAt: ts, reportedCompleted: false, 
              assigneeId: uidToAssign,
              assigneeName: assigneeName,
              isSubProjectTask: true,
              parentSubProject: subProjName, 
              createdAt: Date.now(),
              isPendingAcceptance: isPending,
              assignedByUid: auth.currentUser.uid,
              assignedByName: currentUserName,
              assignedAt: ts,
              history: [{ timestamp: ts, progress: 0, type: 'create', daysPassed: passedDays, delayReason: '', remark: '追加子專案細項' }] 
            });
        }
    }
    
    if (newTasks.length === 0) return alert("沒有有效的新增細項！");

    const proj = allProjectsData.find(p => p.id === selectedProjectId);
    if (!proj) return alert("找不到目前專案！");
    
    const updatedTasks = [...proj.tasks, ...newTasks];
    updatedTasks.sort((a, b) => (a.start || "").localeCompare(b.start || ""));

    await updateDoc(doc(db, "projects", proj.id), { tasks: updatedTasks });
    
    closeAddSubProjectModal();
    alert("🎉 子專案追加成功！");
};

window.syncSubTasksDate = (startInput) => {
    const container = startInput.closest('.sub-tasks-container');
    if (!container || !startInput.value) return;
    
    const normalTasks = container.querySelectorAll('.normal-sub-task');
    normalTasks.forEach(task => {
        const startEl = task.querySelector('.sub-task-start');
        const endEl = task.querySelector('.sub-task-end');
        const daysEl = task.querySelector('.sub-task-days');
        
        startEl.value = startInput.value;
        if (daysEl && endEl) {
           let days = parseInt(daysEl.value) || 1;
           endEl.value = calculateEndDateByDays(startInput.value, days);
           endEl.min = startInput.value;
        }
    });
};
// ==========================================
// 🌟 專案指派通知系統 (UI生成與邏輯)
// ==========================================
window.initNotificationsUI = () => {
    const navUl = document.querySelector(".sidebar-menu") || document.querySelector("ul");
    if (navUl && !document.getElementById("nav-notifications")) {
        const li = document.createElement("li");
        li.className = "nav-item";
        li.id = "nav-notifications";
        li.innerHTML = `
          <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none" style="flex-shrink:0;">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
            <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
          </svg>
          <span>系統通知</span>
          <span class="badge" id="notif-badge" style="display:none; background:var(--danger); color:white; border-radius:10px; padding:2px 6px; font-size:10px; margin-left:auto;">0</span>
        `;
        li.onclick = () => window.switchNav('tab-notifications', '系統通知', li);
        
        const weeklyNav = document.querySelector('li[onclick*="tab-weekly"]');
        if (weeklyNav && weeklyNav.parentNode) {
            weeklyNav.parentNode.insertBefore(li, weeklyNav.nextSibling);
        } else {
            navUl.appendChild(li);
        }
    }

    const samplePane = document.getElementById("tab-projects") || document.querySelector(".tab-pane");
    const mainContent = samplePane ? samplePane.parentNode : (document.querySelector(".main-content") || document.getElementById("app-section"));
    
    if (mainContent && !document.getElementById("tab-notifications")) {
        const tab = document.createElement("div");
        tab.className = "tab-pane";
        tab.id = "tab-notifications";
        tab.style.display = "none";
        tab.innerHTML = `
            <div style="display: flex; flex-direction: column; gap: 20px;">
                
                <!-- 上半部：整合後的待處理與待審核大表格 -->
                <div class="panel" style="margin-bottom: 0;">
                    <div class="panel-head">
                        <span>🔔 待處理與待審核事項 (指派回覆 / 專案開案 / 暫停恢復與協作審核)</span>
                    </div>
                    <div class="table-responsive" style="max-height: 280px; overflow-y: auto;">
                        <table style="width:100%;">
                            <thead style="position: sticky; top: 0; background: #f8fafc; z-index: 2;">
                                <tr>
                                    <th style="width:16%">專案名稱</th>
                                    <th style="width:24%">通知訊息</th> <!-- 🌟 已改為「通知訊息」 -->
                                    <th style="width:10%">發布/申請人</th>
                                    <th style="width:12%">事項類型</th>
                                    <th style="width:14%">時間</th>
                                    <th style="width:14%">說明 / 原因</th>
                                    <th style="width:10%; text-align:center;">操作</th>
                                </tr>
                            </thead>
                            <tbody id="notif-list-tbody"></tbody>
                        </table>
                    </div>
                </div>

                <!-- 下半部：歷史紀錄區塊 (位於約 2/3 處) -->
                <div style="margin-top: 100px; border-top: 1px dashed var(--border); padding-top: 20px;">
                    <div class="panel" style="background: #fafafa; border: 1px solid var(--border-light);">
                        <div class="panel-head" style="color: #64748b; font-size: 14px;">
                            <span>📜 系統通知與歷史審核紀錄 (包含開案/暫停/恢復/指派所有紀錄)</span>
                        </div>
                        <div class="table-responsive" style="max-height: 260px; overflow-y: auto;">
                            <table style="width:100%;">
                                <thead style="position: sticky; top: 0; background: #f1f5f9; z-index: 2;">
                                    <tr>
                                        <th style="width:15%">時間</th>
                                        <th style="width:18%">專案名稱</th>
                                        <th style="width:18%">項目 / 事項名稱</th>
                                        <th style="width:14%">執行動作 / 結果</th>
                                        <th style="width:13%">相關人員</th>
                                        <th style="width:16%">備註 / 說明</th>
                                        <th style="width:6%; text-align:center;">操作</th>
                                    </tr>
                                </thead>
                                <tbody id="notif-history-tbody"></tbody>
                            </table>
                        </div>
                    </div>
                </div>

            </div>
        `;
        mainContent.appendChild(tab);
    }
};

window.switchNotifSubTab = (type) => {
    const btnNotifs = document.getElementById("tab-btn-sub-notifs");
    const btnApprovals = document.getElementById("tab-btn-sub-approvals");
    const panelNotifs = document.getElementById("sub-panel-notifs");
    const panelApprovals = document.getElementById("sub-panel-approvals");

    if (type === 'notifs') {
        panelNotifs.style.display = 'block';
        panelApprovals.style.display = 'none';

        btnNotifs.style.background = 'var(--primary)';
        btnNotifs.style.color = '#fff';
        btnNotifs.style.borderColor = 'var(--primary)';

        btnApprovals.style.background = 'var(--surface)';
        btnApprovals.style.color = 'var(--text-muted)';
        btnApprovals.style.borderColor = 'var(--border)';
    } else {
        panelNotifs.style.display = 'none';
        panelApprovals.style.display = 'block';

        btnApprovals.style.background = 'var(--primary)';
        btnApprovals.style.color = '#fff';
        btnApprovals.style.borderColor = 'var(--primary)';

        btnNotifs.style.background = 'var(--surface)';
        btnNotifs.style.color = 'var(--text-muted)';
        btnNotifs.style.borderColor = 'var(--border)';

        if (window.renderApprovals) window.renderApprovals();
    }
};

window.renderNotifications = () => {
    const tbody = document.getElementById("notif-list-tbody");
    const historyTbody = document.getElementById("notif-history-tbody");
    const badge = document.getElementById("notif-badge");
    
    if (!tbody || !auth.currentUser) return;
    
    tbody.innerHTML = "";
    if (historyTbody) historyTbody.innerHTML = "";

    let totalPendingCount = 0;
    const myUid = auth.currentUser.uid;
    const groupMap = new Map();
    const systemNotifs = [];
    const allHistoryList = [];

    const isTopOrAdmin = (currentUserData.role === 'admin' || currentUserData.role === 'top_manager');
    const isSeniorManager = (currentUserData.role === 'senior_manager');
    const isDeptManager = (currentUserData.role === 'manager' || currentUserData.role === 'assistant_manager');
    const canApproveAny = isTopOrAdmin || isSeniorManager || isDeptManager;

    // ==========================================
    // 1. 收集個人指派與操作歷史
    // ==========================================
    allProjectsData.forEach(p => {
        (p.tasks || []).forEach((t, tIdx) => {
            const isSystemNotif = t.name && t.name.includes("[系統通知]");

            // 待處理子專案細項指派
            if (t.assigneeId === myUid && t.isPendingAcceptance === true && !isSystemNotif) {
                const key = `${p.id}_${t.parentSubProject || t.name}`;
                if (!groupMap.has(key)) {
                    groupMap.set(key, {
                        projId: p.id,
                        projTitle: p.title,
                        ownerId: p.ownerId,
                        ownerName: p.ownerName,
                        subProjName: t.parentSubProject || t.name,
                        assignedByName: t.assignedByName || '未知',
                        assignedAt: t.assignedAt || '-'
                    });
                }
            }
            
            // 系統知悉通知 (過濾掉協作指派，由專案主層級統一顯示)
            if (t.assigneeId === myUid && isSystemNotif && t.isSystemNotifUnread !== false) {
                if (t.name.includes("您已被指派協作專案") || t.name.includes("收到來自")) {
                    return;
                }
                systemNotifs.push({
                    projId: p.id,
                    taskIndex: tIdx,
                    projTitle: p.title,
                    ownerId: p.ownerId,
                    ownerName: p.ownerName,
                    msg: t.name.replace("[系統通知] ", ""),
                    assignedByName: t.assignedByName || '主管',
                    assignedAt: t.assignedAt || '-'
                });
            }

            // 個人操作歷史
            if (t.assigneeId === myUid && t.history && t.history.length > 0) {
                if (t.isPendingAcceptance === false || isSystemNotif) {
                    t.history.forEach(h => {
                        allHistoryList.push({
                            time: h.timestamp || t.assignedAt || '-',
                            sortTime: new Date((h.timestamp || '').replace(/-/g, '/')).getTime() || 0,
                            projTitle: p.title,
                            itemName: t.name,
                            action: h.remark || (isSystemNotif ? '✔️ 確認知悉' : '已處理'),
                            person: t.assignedByName || '系統主管',
                            note: h.delayReason ? `Delay: ${h.delayReason}` : (h.remark || '-'),
                            canDelete: false
                        });
                    });
                }
            }
        });

        // 專案操作歷史 (auditLogs)
        if (p.auditLogs && p.auditLogs.length > 0) {
            if (canApproveAny || p.ownerId === myUid) {
                p.auditLogs.forEach(log => {
                    allHistoryList.push({
                        time: log.time || '-',
                        sortTime: new Date((log.time || '').replace(/-/g, '/')).getTime() || 0,
                        projTitle: p.title,
                        itemName: '🛑 專案暫停/恢復審核',
                        action: log.action || '審核操作',
                        person: `${log.manager || '主管'} (申請人: ${log.reqBy || '-'})`,
                        note: log.reqReason || '-',
                        canDelete: isTopOrAdmin,
                        projId: p.id,
                        rawLog: log
                    });
                });
            }
        }

        // 專案開案簽核與協作歷史 (approvalHistory)
        if (p.approvalHistory && p.approvalHistory.length > 0) {
            if (canApproveAny || p.ownerId === myUid) {
                p.approvalHistory.forEach(h => {
                    allHistoryList.push({
                        time: h.time || '-',
                        sortTime: new Date((h.time || '').replace(/-/g, '/')).getTime() || 0,
                        projTitle: p.title,
                        itemName: '📝 專案開案/協作簽核',
                        action: h.step || '簽核進程',
                        person: `${h.operatorName || '人員'} (${h.role || '-'})`,
                        note: h.remark || '-',
                        canDelete: false
                    });
                });
            }
        }
    });
    
    // ==========================================
    // 2. 渲染個人子專案指派
    // ==========================================
    groupMap.forEach(group => {
        totalPendingCount++;
        const tr = document.createElement("tr");
        tr.style.borderBottom = "1px solid #f1f5f9";
        tr.innerHTML = `
            <td style="padding: 12px 8px;">
                <span style="color:var(--primary); font-weight:bold; cursor:pointer; text-decoration:underline;" 
                      onclick="window.viewProjectFromNotif('${group.ownerId}', '${group.ownerName || '人員'}', '${group.projId}', 'active')" 
                      title="點擊前往查看專案細項">
                    ${group.projTitle}
                </span>
            </td>
            <td style="padding: 12px 8px;">📦 ${group.subProjName}</td>
            <td style="padding: 12px 8px;"><span class="pill" style="background:#eff6ff; color:#1e40af;">${group.assignedByName}</span></td>
            <td style="padding: 12px 8px;"><span class="pill" style="background:#e0e7ff; color:#3730a3;">子專案指派</span></td>
            <td style="padding: 12px 8px;"><span style="font-size:12px; color:var(--text-muted);">${group.assignedAt}</span></td>
            <td style="padding: 12px 8px; color:var(--text-muted);">等待確認接收</td>
            <td style="padding: 12px 8px; text-align:center; white-space:nowrap;">
                <button class="action-btn" style="background:#10b981; color:#fff; border:none; margin-right:4px; padding:4px 8px;" onclick="acceptSubProjectAssignment('${group.projId}', '${group.subProjName}')">同意</button>
                <button class="action-btn danger" style="padding:4px 8px;" onclick="rejectSubProjectAssignment('${group.projId}', '${group.subProjName}')">拒絕</button>
            </td>
        `;
        tbody.appendChild(tr);
    });

    // ==========================================
    // 3. 渲染個人系統通知
    // ==========================================
    systemNotifs.forEach(notif => {
        totalPendingCount++;
        const tr = document.createElement("tr");
        tr.style.borderBottom = "1px solid #f1f5f9";
        tr.style.background = "#fef2f2";
        tr.innerHTML = `
            <td style="padding: 12px 8px;">
                <span style="color:var(--danger); font-weight:bold; cursor:pointer; text-decoration:underline;" 
                      onclick="window.viewProjectFromNotif('${notif.ownerId}', '${notif.ownerName || '人員'}', '${notif.projId}', 'active')" 
                      title="點擊前往查看專案細項">
                    ${notif.projTitle}
                </span>
            </td>
            <td style="padding: 12px 8px; color:var(--danger); font-weight:600;">🚨 ${notif.msg}</td>
            <td style="padding: 12px 8px;"><span class="pill" style="background:#fee2e2; color:#b91c1c;">${notif.assignedByName}</span></td>
            <td style="padding: 12px 8px;"><span class="pill" style="background:#fecaca; color:#991b1b;">系統通知</span></td>
            <td style="padding: 12px 8px;"><span style="font-size:12px; color:var(--text-muted);">${notif.assignedAt}</span></td>
            <td style="padding: 12px 8px; color:var(--text-muted);">請確認知悉</td>
            <td style="padding: 12px 8px; text-align:center;">
                <button class="action-btn" style="background:var(--danger); color:#fff; border:none; padding:4px 8px;" onclick="dismissSystemNotif('${notif.projId}', ${notif.taskIndex})">我知道了</button>
            </td>
        `;
        tbody.appendChild(tr);
    });

    // ==========================================
    // 4. 🌟 主管審核與協作指派（核心修復：精確比對責任人）
    // ==========================================
    const pendingApprovals = allProjectsData.filter(p => {
      // 暫停與恢復申請：最高主管與管理員負責
      if (p.status === 'pause_requested' || p.status === 'resume_requested') {
        return isTopOrAdmin;
      }
      
      // 專案開案簽核與協作申請
      if (p.status === 'pending_approval') {
        const cfg = p.approvalConfig || {};

        // 🌟 關鍵修正 1：如果已經指派給某人（currentAssigneeUid 存在），則「只有被指派者本人」才能看到！
        // 發出指派的主管（即使是最高主管/管理員）絕對不會再看到！
        if (cfg.currentAssigneeUid) {
          return cfg.currentAssigneeUid === myUid;
        }

        // 🌟 關鍵修正 2：如果尚未指派（第一道關卡，currentStage === 'top_manager' 且 currentAssigneeUid 為空）
        // 則由最高主管與管理員審核
        if (isTopOrAdmin && (cfg.currentStage === 'top_manager' || !cfg.currentStage)) {
          return true;
        }
      }
      return false;
    });

    totalPendingCount += pendingApprovals.length;

    pendingApprovals.forEach(p => {
      const isPauseResume = (p.status === 'pause_requested' || p.status === 'resume_requested');
      const isPendingApproval = (p.status === 'pending_approval');
      const isRejected = (p.status === 'rejected' || p.approvalConfig?.approvalStatus === 'rejected');
      const cfg = p.approvalConfig || {};

      let noticeMsg = '';
      let reqBy = p.ownerName || '未知';
      let reqAt = '-';
      let typeLabel = '';
      let reqReason = '';
      let actionButtons = '';

      // 🌟 1. 被退回專案的卡片顯示與重新送審按鈕
      if (isRejected && p.ownerId === myUid) {
        noticeMsg = `<span style="color:var(--danger); font-weight:bold;">❌ 專案已被退回，請修改後重新送審</span>`;
        typeLabel = '<span class="pill pill-danger">專案被退回</span>';
        reqBy = p.approvalHistory?.slice(-1)[0]?.operatorName || '主管';
        reqReason = p.approvalConfig?.rejectReason || p.approvalHistory?.slice(-1)[0]?.remark || '無備註原因';
        reqAt = p.approvalHistory?.slice(-1)[0]?.time || '-';
        actionButtons = `<button class="action-btn" style="background:#4f46e5; color:#fff; border:none; padding:4px 10px; font-size:12px; width:auto;" onclick="openResubmitModal('${p.id}')">🔄 重新送審</button>`;
      } 
      // 🌟 2. 暫停與恢復申請
      else if (isPauseResume) {
        let isResume = (p.status === 'resume_requested');
        noticeMsg = isResume ? '⏳ 專案恢復執行審核' : '⏸️ 專案暫停申請審核';
        typeLabel = isResume ? '<span class="pill" style="background:#dcfce7; color:#166534;">專案恢復申請</span>' : '<span class="pill" style="background:#fee2e2; color:#991b1b;">專案暫停申請</span>';
        reqReason = isResume ? '預計恢復執行' : (p.pauseReason || '');
        reqBy = isResume ? p.resumeRequestedBy : p.pauseRequestedBy;
        reqAt = isResume ? p.resumeRequestedAt : p.pauseRequestedAt;

        actionButtons = `
          <button class="btn-primary" style="background:var(--danger); border:none; padding:4px 8px; font-size:12px; width:auto; margin-right:4px;" onclick="approvePause('${p.id}')">同意</button>
          <button class="action-btn" style="padding:4px 8px; font-size:12px; width:auto;" onclick="rejectPause('${p.id}')">退回</button>
        `;
      } 
      // 🌟 3. 專案簽核中
      else if (isPendingApproval) {
        if (cfg.isApplyCollab) {
          noticeMsg = `<span style="color:var(--danger); font-weight:600;">🚨 您已被指派協作專案，請確認接收。</span>`;
          typeLabel = '<span class="pill" style="background:#dbeafe; color:#1e40af; font-weight:bold;">👑 協作指派審核</span>';
        } else {
          noticeMsg = `<span style="color:#d97706; font-weight:600;">👑 專案開案簽核申請</span>`;
          typeLabel = '<span class="pill" style="background:#fef3c7; color:#92400e; font-weight:bold;">👑 專案開案簽核</span>';
        }

        reqBy = p.ownerName || '未知';
        reqReason = cfg.approvalDesc || (p.approvalHistory && p.approvalHistory[0]?.remark) || p.title || '無說明';
        
        if (p.createdAt?.toDate) {
          reqAt = p.createdAt.toDate().toLocaleString('zh-TW', { hour12: false });
        } else {
          reqAt = p.approvalHistory && p.approvalHistory[0]?.time ? p.approvalHistory[0].time : '-';
        }

        if (cfg.isApplyCollab) {
          const dispatchBtn = (currentUserData.role !== 'staff') 
            ? `<button class="action-btn" style="background:#3b82f6; color:#fff; border:none; padding:4px 8px; font-size:12px; width:auto; margin-right:4px;" onclick="openDispatchModal('${p.id}')">指派</button>` 
            : '';

          actionButtons = `
            ${dispatchBtn}
            <button class="action-btn" style="background:#10b981; color:#fff; border:none; padding:4px 8px; font-size:12px; width:auto; margin-right:4px;" onclick="selfAcceptCollabProject('${p.id}')">承接</button>
            <button class="action-btn danger" style="padding:4px 8px; font-size:12px; width:auto;" onclick="rejectProjectApproval('${p.id}')">退回</button>
          `;
        } else {
          actionButtons = `
            <button class="action-btn" style="background:#10b981; color:#fff; border:none; padding:4px 8px; font-size:12px; width:auto; margin-right:4px;" onclick="approveProjectApproval('${p.id}')">同意</button>
            <button class="action-btn danger" style="padding:4px 8px; font-size:12px; width:auto;" onclick="rejectProjectApproval('${p.id}')">退回</button>
          `;
        }
      }

      // 產生表格行 (tr) 保持原樣
      const tr = document.createElement("tr");
      tr.style.borderBottom = "1px solid #f1f5f9";
      tr.style.backgroundColor = isRejected ? "#fff5f5" : "#fffbfb";
      tr.innerHTML = `
        <td style="padding: 12px 8px;">
            <span style="color:var(--primary); font-weight:bold; cursor:pointer; text-decoration:underline;" 
                  onclick="window.viewProjectFromNotif('${p.ownerId}', '${p.ownerName || '人員'}', '${p.id}', '${p.status}')" 
                  title="點擊前往查看專案細項">
                ${p.title}
            </span>
        </td>
        <td style="padding: 12px 8px;">${noticeMsg}</td>
        <td style="padding: 12px 8px;"><span class="pill" style="background:#eff6ff; color:#1e40af;">${reqBy}</span></td>
        <td style="padding: 12px 8px;">${typeLabel}</td>
        <td style="padding: 12px 8px;"><span style="font-size:12px; color:var(--text-muted);">${reqAt}</span></td>
        <td style="padding: 12px 8px; word-break: break-all; color: var(--text-muted);">${reqReason}</td>
        <td style="padding: 12px 8px; text-align: center; white-space: nowrap;">
          ${actionButtons}
        </td>
      `;
      tbody.appendChild(tr);
    });

    // 若無待處理事項
    if (totalPendingCount === 0 && tbody.children.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--text-muted); padding:30px;">🎉 目前沒有任何待處理或待審核的事項。</td></tr>`;
    }

    // 更新紅點
    if (badge) {
        badge.innerText = totalPendingCount;
        badge.style.display = totalPendingCount > 0 ? "inline-block" : "none";
    }

    // 渲染歷史紀錄清單
    allHistoryList.sort((a, b) => b.sortTime - a.sortTime);
    if (historyTbody) {
        if (allHistoryList.length === 0) {
            historyTbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--text-muted); padding:30px;">尚無歷史紀錄。</td></tr>`;
        } else {
            allHistoryList.forEach(h => {
                let actionStyle = 'color:var(--text-muted);';
                if (h.action.includes('同意') || h.action.includes('承接')) actionStyle = 'color:var(--success); font-weight:bold;';
                else if (h.action.includes('退回') || h.action.includes('拒絕') || h.action.includes('暫停')) actionStyle = 'color:var(--danger); font-weight:bold;';
                else if (h.action.includes('指派') || h.action.includes('送出')) actionStyle = 'color:var(--primary); font-weight:bold;';

                let delBtn = h.canDelete 
                  ? `<button class="action-btn danger" style="padding: 2px 6px; font-size: 11px;" onclick="deleteAuditLog('${h.projId}', '${h.rawLog.time}', '${h.rawLog.action}')">刪除</button>` 
                  : '-';

                const tr = document.createElement("tr");
                tr.style.borderBottom = "1px solid #f1f5f9";
                tr.innerHTML = `
                    <td style="padding: 10px 8px;"><span style="font-size:12px; color:#475569;">${h.time}</span></td>
                    <td style="padding: 10px 8px; font-weight:bold; color:var(--primary);">${h.projTitle}</td>
                    <td style="padding: 10px 8px;">${h.itemName}</td>
                    <td style="padding: 10px 8px;"><span style="${actionStyle}">${h.action}</span></td>
                    <td style="padding: 10px 8px;"><span class="pill" style="background:#f1f5f9; color:#334155;">${h.person}</span></td>
                    <td style="padding: 10px 8px; word-break:break-all; color:var(--text-muted); font-size:12px;">${h.note}</td>
                    <td style="padding: 10px 8px; text-align: center;">${delBtn}</td>
                `;
                historyTbody.appendChild(tr);
            });
        }
    }
};
// 🌟 點擊「我知道了」把未讀狀態消除
window.dismissSystemNotif = async (projId, taskIndex) => {
    const proj = allProjectsData.find(p => p.id === projId);
    if (!proj || !proj.tasks[taskIndex]) return;

    const tasks = [...proj.tasks];
    const targetTask = tasks[taskIndex];
    const ts = new Date().toLocaleString('zh-TW', { hour12: false });

    targetTask.isSystemNotifUnread = false;

    // 🌟 補入確認紀錄，確保歷史清單完整顯示
    if (!targetTask.history) targetTask.history = [];
    targetTask.history.push({
        timestamp: ts,
        progress: 100,
        type: 'update',
        daysPassed: 0,
        delayReason: '',
        remark: '✔️ 已確認知悉'
    });

    await updateDoc(doc(db, "projects", projId), { tasks });
};

// 🌟 同意整個子專案的所有細項
window.acceptSubProjectAssignment = async (projId, subProjName) => {
    const p = allProjectsData.find(x => x.id === projId);
    if(!p) return;
    const tasks = [...p.tasks];
    
    tasks.forEach(t => {
        if (t.isSubProjectTask && t.parentSubProject === subProjName && t.isPendingAcceptance) {
            t.isPendingAcceptance = false;
            if (!t.history) t.history = [];
            t.history.push({
                timestamp: new Date().toLocaleString('zh-TW', { hour12: false }),
                progress: t.progress, type: 'update', daysPassed: 0, delayReason: '',
                remark: '✅ 已同意指派'
            });
        }
    });

    await updateDoc(doc(db, "projects", projId), { tasks });
    alert(`已同意子專案 [${subProjName}]！所有相關細項已納入您的清單。`);
};

// 🌟 拒絕整個子專案的所有細項
window.rejectSubProjectAssignment = async (projId, subProjName) => {
    const reason = prompt(`請輸入拒絕子專案 [${subProjName}] 的原因：`, "");
    if (reason === null) return; 
    const p = allProjectsData.find(x => x.id === projId);
    if(!p) return;
    const tasks = [...p.tasks];
    
    tasks.forEach(t => {
        if (t.isSubProjectTask && t.parentSubProject === subProjName && t.isPendingAcceptance) {
            const assignerId = t.assignedByUid || p.ownerId;
            const assignerName = t.assignedByName || p.ownerName;
            
            t.isPendingAcceptance = false; 
            t.assigneeId = assignerId;
            t.assigneeName = assignerName;
            
            if (!t.history) t.history = [];
            t.history.push({
                timestamp: new Date().toLocaleString('zh-TW', { hour12: false }),
                progress: t.progress, type: 'update', daysPassed: 0, delayReason: '',
                remark: `❌ 退回指派 (原因: ${reason || '無'})`
            });
        }
    });
    
    await updateDoc(doc(db, "projects", projId), { tasks });
    alert(`已拒絕，子專案 [${subProjName}] 的細項已全數退回給開案者！`);
};

function loadProjects() {
  onSnapshot(query(collection(db, "projects")), (snapshot) => {
    allProjectsData = []; 
    snapshot.forEach(docSnap => allProjectsData.push({ id: docSnap.id, ...docSnap.data() })); 
    renderProjects(); 
    refreshAllWeeklyProjSelects();
    if (window.renderNotifications) window.renderNotifications(); 
  }); 
}

// 🌟 開啟編輯子專案彈窗
window.openEditSubProjectModal = (projId, subProjName) => {
    const proj = allProjectsData.find(p => p.id === projId);
    if (!proj) return;
    
    const sampleTask = (proj.tasks || []).find(t => t.isSubProjectTask && t.parentSubProject === subProjName);
    const currentAssigneeId = sampleTask ? sampleTask.assigneeId : "";

    let assigneeOptions = '<option value="">-- 指派給 (選填) --</option>';
    let purchasingUsers = allUsersList.filter(u => u.dept === '採購部');
    purchasingUsers.forEach(u => {
        const selected = (u.uid === currentAssigneeId) ? "selected" : "";
        assigneeOptions += `<option value="${u.uid}" ${selected}>${u.name} (採購部)</option>`;
    });

    currentEditData = { type: 'subproject_edit', projId, oldSubProjName: subProjName };

    document.getElementById("general-edit-title").innerText = `編輯子專案：${subProjName}`;
    const form = document.getElementById("general-edit-form");
    form.innerHTML = `
        <div class="form-group">
            <label class="form-label">子專案名稱</label>
            <input type="text" id="edit-subproj-name" class="input-control" value="${subProjName}">
        </div>
        <div class="form-group">
            <label class="form-label">指派人員 (採購部)</label>
            <select id="edit-subproj-assignee" class="input-control">
                ${assigneeOptions}
            </select>
        </div>
    `;

    document.getElementById("general-edit-modal").classList.add("active");
};

window.openApprovalLogModal = (projId) => {
  const proj = allProjectsData.find(p => p.id === projId);
  if (!proj || !proj.approvalHistory) return alert("此專案尚無簽核歷程！");

  let html = `
    <div class="panel-head" style="margin-bottom:12px;"><span>📜 專案簽核與指派歷程 [${proj.title}]</span></div>
    <div class="table-responsive" style="max-height:350px; overflow-y:auto;">
      <table style="width:100%;">
        <thead>
          <tr>
            <th style="width:20%">階段動作</th>
            <th style="width:18%">操作人員</th>
            <th style="width:22%">時間</th>
            <th style="width:40%">說明 / 備註</th>
          </tr>
        </thead>
        <tbody>
  `;

  proj.approvalHistory.forEach(h => {
    html += `
      <tr>
        <td style="font-weight:bold; color:var(--primary);">${h.step}</td>
        <td>${h.operatorName} <small style="color:#64748b;">(${h.role})</small></td>
        <td style="font-size:12px; color:#64748b;">${h.time}</td>
        <td style="word-break:break-all;">${h.remark || '-'}</td>
      </tr>
    `;
  });

  html += `</tbody></table></div>`;

  const form = document.getElementById("general-edit-form");
  document.getElementById("general-edit-title").innerText = "專案簽核歷程";
  form.innerHTML = html;
  document.getElementById("general-edit-modal").classList.add("active");
};

window.assignCollabProject = async (projId, nextAssigneeUid, note) => {
  const proj = allProjectsData.find(p => p.id === projId);
  const targetUser = allUsersList.find(u => u.uid === nextAssigneeUid);
  const ts = new Date().toLocaleString('zh-TW', { hour12: false });
  const myName = currentUserData.name || "主管";

  const isTargetStaff = (targetUser.role === 'staff');
  const nextStatus = isTargetStaff ? 'pending_staff_accept' : 'pending_collab_dispatch';

  const history = proj.approvalHistory || [];
  history.push({
    step: isTargetStaff ? '指派至執行人員 (待確認)' : '轉交指派',
    operatorName: myName,
    operatorUid: auth.currentUser.uid,
    role: roleNames[currentUserData.role],
    time: ts,
    remark: note || `指派給 ${targetUser.name}`
  });

  await updateDoc(doc(db, "projects", projId), {
    "approvalConfig.approvalStatus": nextStatus,
    "approvalConfig.currentAssigneeUid": targetUser.uid,
    approvalHistory: history
  });

  alert(`已成功指派給 ${targetUser.name}！`);
};

// 🌟 1. 同意開案簽核
window.approveProjectApproval = async (projId) => {
  if (!confirm("確定同意此專案開案簽核嗎？\n同意後專案將正式進入申請人的【未完成】清單中。")) return;
  const proj = allProjectsData.find(p => p.id === projId);
  if (!proj) return;

  const ts = new Date().toLocaleString('zh-TW', { hour12: false });
  const myName = currentUserData.name || "主管";
  const history = proj.approvalHistory || [];
  
  history.push({
    step: '✅ 同意開案簽核',
    operatorName: myName,
    operatorUid: auth.currentUser.uid,
    role: roleNames[currentUserData.role] || currentUserData.role,
    time: ts,
    remark: '主管已同意專案建立'
  });

  // 🌟 只更新狀態為 active，不改動 tasks 細項
  await updateDoc(doc(db, "projects", projId), {
    status: 'active',
    "approvalConfig.approvalStatus": 'approved',
    approvalHistory: history
  });

  alert("✅ 已成功同意開案，專案已加入未完成！");
  renderProjects();
};

// 🌟 2. 退回專案簽核
// 🌟 退回專案簽核
window.rejectProjectApproval = async (projId) => {
  const reason = prompt("【退回審核】請輸入退回原因 (必填)：", "");
  if (reason === null) return; 
  if (!reason.trim()) return alert("⚠️ 退回必須填寫具體原因，請重新操作！");

  const proj = allProjectsData.find(p => p.id === projId);
  if (!proj) return;

  const ts = new Date().toLocaleString('zh-TW', { hour12: false });
  const myName = currentUserData.name || auth.currentUser.email.split('@')[0];
  const history = proj.approvalHistory || [];
  
  history.push({
    step: '❌ 退回審核',
    operatorName: myName,
    operatorUid: auth.currentUser.uid,
    role: roleNames[currentUserData.role] || currentUserData.role,
    time: ts,
    remark: `退回原因: ${reason.trim()}`
  });

  // 🌟 將 status 設為 'rejected'，不再是 'active'，確保不會流入未完成
  await updateDoc(doc(db, "projects", projId), {
    status: 'rejected',
    "approvalConfig.approvalStatus": 'rejected',
    "approvalConfig.rejectReason": reason.trim(),
    approvalHistory: history
  });

  alert("✅ 已退回專案簽核，專案已退回給開案者！");
  renderProjects();
};

// 🌟 3. 主管自行承接協作專案
window.selfAcceptCollabProject = async (projId) => {
  if (!confirm("確定要自行承接此協作專案嗎？\n承接後專案將轉入您的【未完成】清單。")) return;
  const proj = allProjectsData.find(p => p.id === projId);
  if (!proj) return;

  const ts = new Date().toLocaleString('zh-TW', { hour12: false });
  const myName = currentUserData.name || "主管";
  const history = proj.approvalHistory || [];

  history.push({
    step: '💼 主管自行承接專案',
    operatorName: myName,
    operatorUid: auth.currentUser.uid,
    role: roleNames[currentUserData.role] || currentUserData.role,
    time: ts,
    remark: `${myName} 已親自承接此協作專案`
  });

  await updateDoc(doc(db, "projects", projId), {
    status: 'active',
    ownerId: auth.currentUser.uid,
    ownerName: myName,
    "approvalConfig.approvalStatus": 'approved',
    approvalHistory: history
  });

  alert("您已成功承接此專案！專案已移至您的未完成清單中。");
};

// 🌟 4. 階層指派彈窗與執行
window.openDispatchModal = (projId) => {
  const proj = allProjectsData.find(p => p.id === projId);
  if (!proj) return;

  const myRole = currentUserData.role;
  const myDept = currentUserData.dept || "設計部";
  const isTopOrAdmin = (myRole === 'admin' || myRole === 'top_manager');
  const isSenior = (myRole === 'senior_manager');

  let eligibleUsers = [];

  if (isTopOrAdmin) {
    // 第一關：最高主管 & 管理員 -> 可指派所有人 (排除自己)
    eligibleUsers = allUsersList.filter(u => u.uid !== auth.currentUser.uid);
  } else if (isSenior) {
    // 第二關：高級主管 -> 可指派主管與人員
    eligibleUsers = allUsersList.filter(u => u.uid !== auth.currentUser.uid && u.role !== 'top_manager' && u.role !== 'admin');
  } else {
    // 第三關：部門主管 -> 只能指派同單位人員
    eligibleUsers = allUsersList.filter(u => (u.dept || "設計部") === myDept && u.uid !== auth.currentUser.uid && (u.role === 'staff' || u.role === 'assistant_manager'));
  }

  if (eligibleUsers.length === 0) {
    return alert("目前沒有可供指派的下屬名單！若需執行請直接點選【承接】。");
  }

  let options = '<option value="">-- 請選擇指派對象 --</option>';
  eligibleUsers.forEach(u => {
    options += `<option value="${u.uid}">${u.name} (${u.dept || '設計部'} - ${roleNames[u.role] || u.role})</option>`;
  });

  const form = document.getElementById("general-edit-form");
  document.getElementById("general-edit-title").innerText = `👥 階層協作指派 [${proj.title}]`;
  form.innerHTML = `
    <div class="form-group">
      <label class="form-label">選擇被指派主管 / 人員</label>
      <select id="dispatch-target-uid" class="input-control">${options}</select>
    </div>
    <div class="form-group">
      <label class="form-label">指派備註說明 (選填)</label>
      <textarea id="dispatch-note" class="input-control" rows="3" placeholder="請填寫指派工作要求或說明..."></textarea>
    </div>
    <div style="display:flex; justify-content:flex-end; gap:8px; margin-top:16px;">
      <button type="button" class="action-btn" onclick="closeGeneralEditModal()">取消</button>
      <button type="button" class="btn-primary" style="width:auto; padding:6px 16px;" onclick="submitDispatchProject('${proj.id}')">確認指派</button>
    </div>
  `;

  document.getElementById("general-edit-modal").classList.add("active");
};

window.submitDispatchProject = async (projId) => {
  const targetUid = document.getElementById("dispatch-target-uid").value;
  const note = document.getElementById("dispatch-note").value.trim();
  if (!targetUid) return alert("請選擇指派對象！");

  const targetUser = allUsersList.find(u => u.uid === targetUid);
  const proj = allProjectsData.find(p => p.id === projId);
  const ts = new Date().toLocaleString('zh-TW', { hour12: false });
  const myName = currentUserData.name || "主管";

  const isStaff = (targetUser.role === 'staff');
  const history = proj.approvalHistory || [];

  history.push({
    step: isStaff ? '指派至執行人員 (待確認)' : '轉交主管指派',
    operatorName: myName,
    operatorUid: auth.currentUser.uid,
    role: roleNames[currentUserData.role] || currentUserData.role,
    time: ts,
    remark: note ? `${note} (指派給 ${targetUser.name})` : `指派給 ${targetUser.name}`
  });

  // 🌟 將原先已完成審核/指派的通知關閉，並將新的指派責任移交給 targetUser
  await updateDoc(doc(db, "projects", projId), {
    "approvalConfig.currentStage": isStaff ? 'staff' : 'manager', // 推進關卡
    "approvalConfig.currentAssigneeUid": targetUser.uid,          // 移交責任人給下一個人
    "approvalConfig.currentAssigneeName": targetUser.name,
    "approvalConfig.lastDispatchedByUid": auth.currentUser.uid,
    approvalHistory: history
  });

  closeGeneralEditModal();
  alert(`✅ 已成功指派給 ${targetUser.name}！該專案已自您的待辦清單移出。`);
  renderProjects();
};
// 🌟 點擊專案名稱直接前往專案看細項 (修正退回專案跳轉至 pending_approval)
window.viewProjectFromNotif = (ownerId, ownerName, projId, status) => {
    switchViewingUser(ownerId, ownerName);
    if (status === 'pending_approval' || status === 'rejected') {
        setProjectFilter('pending_approval');
    } else {
        setProjectFilter('ongoing');
    }
    switchNav('tab-projects', '專案進度', document.querySelector('li[onclick*="tab-projects"]'));
    setTimeout(() => {
        selectProject(projId);
    }, 150);
};

// 🌟 承接協作專案：按承接後，專案才正式變成 active 並轉入承接者的未完成
window.selfAcceptCollabProject = async (projId) => {
  if (!confirm("確定要承接此協作專案嗎？\n承接後專案將正式生效，並加入您的【未完成】專案清單中。")) return;
  const proj = allProjectsData.find(p => p.id === projId);
  if (!proj) return;

  const ts = new Date().toLocaleString('zh-TW', { hour12: false });
  const myName = currentUserData.name || auth.currentUser.email.split('@')[0];
  const history = proj.approvalHistory || [];

  history.push({
    step: '💼 承接專案',
    operatorName: myName,
    operatorUid: auth.currentUser.uid,
    role: roleNames[currentUserData.role] || currentUserData.role,
    time: ts,
    remark: `${myName} 已確認承接此協作專案`
  });

  // 將相關通知任務標記為已讀知悉
  const tasks = (proj.tasks || []).map(t => {
    if (t.name && t.name.includes("[系統通知]")) {
      return { ...t, isSystemNotifUnread: false };
    }
    return t;
  });

  await updateDoc(doc(db, "projects", projId), {
    status: 'active',
    ownerId: auth.currentUser.uid,
    ownerName: myName,
    "approvalConfig.approvalStatus": 'approved',
    approvalHistory: history,
    tasks: tasks
  });

  alert("🎉 您已成功承接此專案！專案已正式加入您的【未完成】專案清單。");
  renderProjects();
};
// 🌟 開啟「重新送審」彈窗（二選一：申請協作 / 簽核流程）
// 🌟 開啟「重新送審」彈窗
window.openResubmitModal = (projId) => {
  const proj = allProjectsData.find(p => p.id === projId);
  if (!proj) return;

  const lastRejectLog = (proj.approvalHistory || []).slice().reverse().find(h => h.step.includes('退回'));
  const rejectReasonDisplay = lastRejectLog ? `<div style="background:#fee2e2; color:#991b1b; padding:8px 12px; border-radius:6px; margin-bottom:12px; font-size:13px;"><b>主管退回原因：</b>${lastRejectLog.remark}</div>` : '';

  const form = document.getElementById("general-edit-form");
  document.getElementById("general-edit-title").innerText = `🔄 專案重新送審 [${proj.title}]`;
  
  const isPreviouslyCollab = proj.approvalConfig?.isApplyCollab || false;

  // 🌟 修正：文字改為「協作流程」與「專案簽核」，並將 textarea 改為 Quill 編輯器容器，且移除底部重複按鈕
  form.innerHTML = `
    ${rejectReasonDisplay}
    <div class="form-group" style="margin-bottom:14px;">
      <label class="form-label" style="font-weight:bold;">請選擇送審類型：</label>
      <div style="display:flex; gap:20px; margin-top:6px;">
        <label style="cursor:pointer; display:flex; align-items:center; gap:6px;">
          <input type="radio" name="resubmit_type" value="collab" ${isPreviouslyCollab ? 'checked' : ''} style="cursor:pointer;">
          <span>👥 協作流程</span>
        </label>
        <label style="cursor:pointer; display:flex; align-items:center; gap:6px;">
          <input type="radio" name="resubmit_type" value="approval" ${!isPreviouslyCollab ? 'checked' : ''} style="cursor:pointer;">
          <span>📝 專案簽核</span>
        </label>
      </div>
    </div>
    <div class="form-group">
      <label class="form-label" style="font-weight:bold;">送審說明 / 調整備註 (必填)：</label>
      <div id="resubmit-quill-container" style="background:#fff; min-height:120px;"></div>
    </div>
    <div style="display:flex; justify-content:flex-end; gap:8px; margin-top:16px;">
      <button type="button" class="action-btn" onclick="closeGeneralEditModal()">取消</button>
      <button type="button" class="btn-primary" style="width:auto; padding:6px 16px; background:#4f46e5;" onclick="submitProjectResubmit('${proj.id}')">重新送審</button>
    </div>
  `;

  document.getElementById("general-edit-modal").classList.add("active");

  // 🌟 延遲初始化 Quill 編輯器並帶入原本的說明內容
  setTimeout(() => {
    window.resubmitQuill = new Quill('#resubmit-quill-container', {
      modules: { toolbar: toolbarOptions },
      theme: 'snow',
      placeholder: '請說明已根據退回意見所做的修改，或重新送審的理由...'
    });
    window.resubmitQuill.root.innerHTML = proj.approvalConfig?.approvalDesc || '';
  }, 100);
};

// 🌟 送出「重新送審」
window.submitProjectResubmit = async (projId) => {
  // 🌟 從 Quill 抓取 HTML 內容
  const desc = window.resubmitQuill ? window.resubmitQuill.root.innerHTML.trim() : "";
  if (!desc || desc === '<p><br></p>') return alert("請填寫送審說明！");

  const selectedType = document.querySelector('input[name="resubmit_type"]:checked')?.value || 'approval';
  const isApplyCollab = (selectedType === 'collab');

  const proj = allProjectsData.find(p => p.id === projId);
  if (!proj) return;

  const ts = new Date().toLocaleString('zh-TW', { hour12: false });
  const myName = currentUserData.name || auth.currentUser.email.split('@')[0];
  const history = proj.approvalHistory || [];

  history.push({
    step: isApplyCollab ? '🔄 重新送審 (協作流程)' : '🔄 重新送審 (專案簽核)',
    operatorName: myName,
    operatorUid: auth.currentUser.uid,
    role: roleNames[currentUserData.role] || currentUserData.role,
    time: ts,
    remark: desc,
    targetRole: isApplyCollab ? '待最高級主管指派協作' : '待最高級主管簽核同意'
  });

  await updateDoc(doc(db, "projects", projId), {
    status: 'pending_approval', 
    approvalConfig: {
      isNeedApproval: true,
      isApplyCollab: isApplyCollab,
      approvalDesc: desc,
      currentStage: 'top_manager', 
      currentAssigneeUid: "",       
      approvalStatus: isApplyCollab ? 'pending_collab_dispatch' : 'pending_top_approval'
    },
    approvalHistory: history
  });

  closeGeneralEditModal();
  alert("🎉 專案已成功重新送審！已送交最高級主管。");
  renderProjects();
};
