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

let viewingUserId = null; 
let allProjectsData = [];
let allAdHocData = [];
let allWeeklyData = [];
let myCalendarTodos = [];

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
  if(document.getElementById('filter-all')) return; 

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
    .kpi-card { padding: 8px 12px !important; min-height: unset !important; }
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
        position: fixed !important;
        top: 60px !important;
        left: 0 !important;
        width: 100vw !important;
        height: calc(100vh - 60px) !important;
        background: #f1f5f9 !important;
        z-index: 999999 !important;
        display: flex !important;
        flex-direction: column;
        overflow-y: auto !important;
        padding: 20px !important;
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
}

document.getElementById('btn-toggle-create').addEventListener('click', () => {
  const form = document.getElementById('create-project-section');
  const isHidden = form.style.display === 'none';
  form.style.display = isHidden ? 'block' : 'none';

  if (isHidden) {
    document.getElementById("proj-name").value = "";
    document.getElementById("proj-color").value = "bar-primary";
    renderCollabCheckboxes([]);
    document.getElementById("task-list-container").innerHTML = "";
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

onAuthStateChanged(auth, async (user) => {
  if (user) {
    document.getElementById("auth-section").style.display = "none";
    document.getElementById("app-section").style.display = "flex";
    viewingUserId = user.uid;

    try {
      const userDoc = await getDoc(doc(db, "users", user.uid));
      if (userDoc.exists()) {
        currentUserData = userDoc.data();
      } else {
        currentUserData = { name: user.email.split('@')[0], dept: "設計部", role: "admin", canEdit: false };
        await setDoc(doc(db, "users", user.uid), currentUserData, { merge: true });
      }
    } catch (e) { 
      currentUserData = { name: user.email.split('@')[0], dept: "設計部", role: "admin", canEdit: false }; 
    }
    
    const displayName = currentUserData.name || user.email.split('@')[0];
    document.getElementById("user-display-name").innerText = displayName;
    document.getElementById("user-avatar").innerText = displayName.charAt(0).toUpperCase();
    document.getElementById("user-role-badge").innerText = roleNames[currentUserData.role] || (currentUserData.role || "STAFF").toUpperCase();

    if (currentUserData.role === "admin") {
      document.getElementById("nav-org-manage").style.display = "flex"; 
      document.getElementById("nav-divider-org").style.display = "block"; 
      loadOrgUsers();
    } else {
      document.getElementById("nav-org-manage").style.display = "none"; 
      document.getElementById("nav-divider-org").style.display = "none";
    }

    if (currentUserData.role !== 'staff') { 
      document.getElementById('nav-sub-wrapper').style.display = 'block'; 
      loadSidebarSubordinates(); 
    } else {
      document.getElementById('nav-sub-wrapper').style.display = 'none';
    }

    initWeeklyDateAndLeave(); 
    addTaskRow(); 
    addWeeklyRow(); 
    loadProjects(); 
    loadAdHocEvents(); 
    loadWeeklyReports();
    loadMyCalendarTodos(user.uid);
  } else {
    document.getElementById("auth-section").style.display = "flex"; 
    document.getElementById("app-section").style.display = "none";
  }
});

function loadSidebarSubordinates() {
  const rolePriority = { admin: 1, top_manager: 2, manager: 3, assistant_manager: 4, staff: 5 };

  onSnapshot(collection(db, "users"), (snapshot) => {
    const list = document.getElementById("nav-sub-list");
    if (!list) return;

    list.innerHTML = `<li class="nav-sub-item active" id="sub-li-${auth.currentUser.uid}" onclick="switchViewingUser('${auth.currentUser.uid}', '自己 (個人專案)')">個人專案</li>`;

    const visibleUsers = [];
    const myUid = auth.currentUser.uid;
    const myRole = currentUserData.role; 
    const myDept = currentUserData.dept || "設計部";

    // 🚀 全局快取人員名單，供所有部門檢視邏輯使用
    allUsersList = [];
    snapshot.forEach(docSnap => {
      allUsersList.push({ uid: docSnap.id, ...docSnap.data() });
    });

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

      if (myRole === 'admin' || myRole === 'top_manager') {
        canView = true;
      }
      else if (myRole === 'manager') {
        if (targetDept === myDept && (targetRole === 'assistant_manager' || targetRole === 'staff')) {
          canView = true;
        }
      }
      else if (myRole === 'assistant_manager') {
        if (targetDept === myDept && targetRole === 'staff') {
          canView = true;
        }
      }

      if (canView || isSubordinate(myUid, u.uid)) {
        visibleUsers.push(u);
      }
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
          <li class="nav-sub-item ${isActive}" id="sub-li-${u.uid}" onclick="switchViewingUser('${u.uid}', '${u.name}')">
            ${u.name || '未命名'} 
            <small style="color:#94a3b8; font-size:11px; margin-left:4px;">(${roleNames[u.role] || '人員'})</small>
          </li>
        `;
      });
      membersHtml += `</div>`;
      list.innerHTML += membersHtml;
    });

    // 🚀 當人員資料變動，觸發重新渲染以確保權限最新
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
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return d.toISOString().split('T')[0];
}

window.checkWorkingDay = (input) => { 
  if (!input.value) return; 
  const d = new Date(input.value); 
  if (d.getDay() === 0 || d.getDay() === 6) { 
    alert("系統規定只能點選工作日喔！"); 
    input.value = ''; 
  } 
};

window.onTaskStartChange = (startInput, targetEndId) => {
  window.checkWorkingDay(startInput);
  if (!startInput.value) return;
  const row = startInput.closest('.task-row') || startInput.closest('#general-edit-form') || startInput.closest('.modal-box');
  const endInput = typeof targetEndId === 'string' ? document.getElementById(targetEndId) : row?.querySelector('.task-end');
  const daysInput = row?.querySelector('.task-days') || row?.querySelector('#add-task-days') || row?.querySelector('#edit-val-days');

  if (endInput) {
    endInput.min = startInput.value;
    const days = daysInput ? parseInt(daysInput.value) || 1 : 1;
    endInput.value = calculateEndDateByDays(startInput.value, days);
  }
};

window.onTaskDaysChange = (daysInput, targetStartId, targetEndId) => {
  const row = daysInput.closest('.task-row') || daysInput.closest('#general-edit-form') || daysInput.closest('.modal-box');
  const startInput = typeof targetStartId === 'string' ? document.getElementById(targetStartId) : row?.querySelector('.task-start') || row?.querySelector('#add-task-start');
  const endInput = typeof targetEndId === 'string' ? document.getElementById(targetEndId) : row?.querySelector('.task-end') || row?.querySelector('#add-task-end');

  const days = parseInt(daysInput.value) || 1;
  if (startInput && startInput.value && endInput) {
    endInput.value = calculateEndDateByDays(startInput.value, days);
    endInput.min = startInput.value;
  }
};

window.onTaskEndChange = (endInput, targetStartId, targetDaysId) => {
  window.checkWorkingDay(endInput);
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
    <div class="form-group" style="margin:0; flex:2;"><input type="text" class="input-control task-name" placeholder="細項名稱"></div>
    <div class="form-group" style="margin:0; flex:1.2;"><input type="date" class="input-control task-start" value="${defaultStart}" onchange="onTaskStartChange(this, null)"></div>
    <div class="form-group" style="margin:0; width:65px; flex-shrink:0;"><input type="number" min="1" class="input-control task-days" value="1" placeholder="天數" title="工作天數" oninput="onTaskDaysChange(this, null, null)"></div>
    <div class="form-group" style="margin:0; flex:1.2;"><input type="date" class="input-control task-end" value="${defaultEnd}" min="${defaultStart}" onchange="onTaskEndChange(this, null, null)"></div>
    <div style="display:flex; gap:4px; margin:0; flex-shrink:0;">
      <button type="button" class="action-btn btn-sort" onclick="moveTaskRow(this, -1)" title="上移">↑</button>
      <button type="button" class="action-btn btn-sort" onclick="moveTaskRow(this, 1)" title="下移">↓</button>
      <button type="button" class="action-btn danger" onclick="this.closest('.task-row').remove()" style="padding:8px 10px;">X</button>
    </div>
  `;
  container.appendChild(div);
};

window.moveTaskRow = (btn, direction) => {
  const row = btn.closest('.task-row');
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
  return proj.tasks.map((t, i) => ({...t, index: i})).filter(t => {
    if (!t.isCompleted) return true; 
    if (t.reportedCompleted === true) return false; 
    const taskCompletedTime = t.completedAt ? new Date(t.completedAt.replace(/-/g, '/')).getTime() : 0;
    const alreadyReported = allWeeklyData.some(w => {
      if(w.ownerId !== auth.currentUser.uid) return false;
      const reportTime = w.createdAt ? w.createdAt.toDate().getTime() : Date.now();
      const hasTask = (w.items || []).some(item => item.projectId === proj.id && String(item.taskId) === String(t.index));
      return hasTask && reportTime > (taskCompletedTime - 60000);
    });
    return !alreadyReported;
  });
};

function loadProjects() {
  onSnapshot(query(collection(db, "projects")), (snapshot) => {
    allProjectsData = []; 
    snapshot.forEach(docSnap => allProjectsData.push({ id: docSnap.id, ...docSnap.data() })); 
    renderProjects(); 
    refreshAllWeeklyProjSelects();
  }); 
}

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

function renderProjects() {
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
    if (currentUserData.role === 'admin') return true; 
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

    if (isOwnerDept || currentUserData.role === 'admin') {
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

    if (isOwnerDept || currentUserData.role === 'admin') {
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

  // 🚀 為了讓重新載入資料時也能同步 KPI，直接更新 DOM
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
  tabsContainer.innerHTML = "";

  if (activeList.length === 0 && activeAdHocs.length === 0) { 
    detailView.style.display = "none"; 
    summaryView.style.display = "none"; 
    emptyState.style.display = "block"; 
    return; 
  }

  if (selectedProjectId !== 'SUMMARY') {
    const summaryBtn = document.createElement("button");
    summaryBtn.className = `proj-tab`;
    summaryBtn.style.border = "2px solid #8b5cf6"; 
    summaryBtn.style.color = "#8b5cf6";            
    summaryBtn.style.fontWeight = "bold";          
    summaryBtn.innerText = "🔙 返回總覽"; 
    summaryBtn.onclick = () => selectProject('SUMMARY'); 
    tabsContainer.appendChild(summaryBtn);
  }

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

  emptyState.style.display = "none"; 

  // ==========================================
  // ⭐ 顯示總覽畫面
  // ==========================================
  if (selectedProjectId === 'SUMMARY') {
    detailView.style.display = "none"; 
    summaryView.style.display = "block";
    
    let summaryLabel = "所有專案";
    if (currentFilter === 'ongoing') summaryLabel = "未完成";
    else if (currentFilter === 'completed') summaryLabel = "已完成";
    else if (currentFilter === 'delayed') summaryLabel = "Delay";
    else if (currentFilter === 'collab') summaryLabel = "協作專案";
    
    const panelHeadSpan = document.querySelector('#project-summary-view .panel-head span');
    if (panelHeadSpan) panelHeadSpan.innerText = `⭐ 專案與事件總覽排程 (${summaryLabel}清單)`;

    const sumLeftBody = document.getElementById("gantt-summary-left-body");
    sumLeftBody.innerHTML = "";
    const ganttTasksSum = [];
    
    let combinedItems = [];
    let sIdx = 0;

    activeList.forEach(p => {
      const ownerDept = getUserDept(p.ownerId);
      const isOwnerDept = (targetDept === ownerDept); 
      let relevantTasks = (isOwnerDept || currentUserData.role === 'admin') ? p.tasks : (p.tasks || []).filter(t => t.assigneeId === viewingUserId);
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
      sumLeftBody.appendChild(row);
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
  // ⭐ 顯示詳細專案畫面
  // ==========================================
  summaryView.style.display = "none"; 
  detailView.style.display = "block";
  const activeProj = activeList.find(p => p.id === selectedProjectId);
  if(!activeProj) return; 

  const ownerDept = getUserDept(activeProj.ownerId);
  const isProjOwnerDept = (currentUserData.dept === ownerDept); 
  const isProjOwner = (activeProj.ownerId === auth.currentUser.uid) || isProjOwnerDept;
  
  const hasCollab = (activeProj.collaborators && activeProj.collaborators.length > 0);
  const isCollabMember = hasCollab && activeProj.collaborators.includes(currentUserData.dept);
  
  const hasGlobalEdit = (currentUserData.role === 'admin' || currentUserData.canEdit === true);
  const isAuthorizedMaster = hasGlobalEdit || isProjOwner;
  const inGracePeriod = isWithin7DaysGracePeriod(activeProj);
  
  let canEditMainProj = isEditMode && (hasGlobalEdit || (isProjOwner && inGracePeriod));
  let editProjBtn = canEditMainProj ? `<button class="action-btn" onclick="openGeneralEdit('project', '${activeProj.id}')" style="margin-left:8px; padding:2px 6px; font-size:10px; border-color:var(--warning); color:var(--warning);">✏️ 編輯主資訊</button>` : '';
  
  let collabBadge = hasCollab ? `<span class="pill" style="background:#eff6ff; color:#0f172a; border:1px solid #cbd5e1; margin-left:8px;">👥 協作：<span style="color:#2563eb; font-weight:600;">${activeProj.collaborators.join(', ')}</span></span>` : '';
  
  let graceBadge = inGracePeriod ? `<span class="pill pill-success" style="font-size:11px; margin-left:8px;">🟢 自由編輯期 (剩餘 ${getGraceDaysLeft(activeProj)} 天)</span>` : '';

  let titlePrefixIcon = hasCollab ? '<span style="color:#2563eb; margin-right:4px;">👥</span>' : '';
  let titleDisplayName = `<span style="color:#2563eb; font-weight:700;">${titlePrefixIcon}${activeProj.title}</span>`;
  
  document.getElementById("current-gantt-title").innerHTML = `<span style="color:#0f172a; font-weight:700;">專案：</span>${titleDisplayName} ${collabBadge} ${graceBadge} ${editProjBtn}`;
  
  const btnProjectAddTask = document.getElementById("btn-project-add-task");
  const lockBtn = document.getElementById("btn-toggle-lock");
  const delProjBtn = document.getElementById("btn-delete-project");

  lockBtn.style.display = "none"; 

  // 🚀 新增細項：不需編輯模式，只要有權限(全局/協作者) 或是 (建立者在7天內) 就顯示
  const canAddTask = hasGlobalEdit || isCollabMember || (isProjOwner && inGracePeriod);

  if (canAddTask) {
    btnProjectAddTask.style.display = "inline-block";
    btnProjectAddTask.innerText = hasCollab ? "➕ 協作細項" : "➕ 新增細項";
  } else {
    btnProjectAddTask.style.display = "none";
  }

  // 🚀 刪除按鈕必須開啟編輯模式才顯示
  delProjBtn.style.display = (isEditMode && (hasGlobalEdit || (isProjOwner && inGracePeriod))) ? "inline-block" : "none";

  const leftBody = document.getElementById("gantt-left-body");
  const listBody = document.getElementById("project-list-tbody");
  leftBody.innerHTML = ""; 
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
    const isMyTask = (auth.currentUser.uid === taskAssigneeId);

    let taskCreatedTime = task.createdAt || (activeProj.createdAt && typeof activeProj.createdAt.toMillis === 'function' ? activeProj.createdAt.toMillis() : Date.now());
    let isTaskInGrace = ((Date.now() - taskCreatedTime) / (1000 * 60 * 60 * 24)) <= 7;

    const canOperateThisTask = (hasGlobalEdit || isMyTask || isProjOwnerDept);
    const isInputLocked = task.isCompleted || !canOperateThisTask; 
    
    let canEditTask = isEditMode && (
      hasGlobalEdit || ((isProjOwner || isMyTask) && isTaskInGrace)
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
    leftBody.appendChild(row);

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

  if (ganttTasks.length > 0) {
    const chartContainer = document.getElementById("gantt-chart-container");
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
      patchGanttVisuals(ganttInstance, '#gantt-chart-container');
      scrollToTodayMinus2Days(ganttInstance, '#gantt-chart-container'); 
    }, 100); 
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
  let isTaskInGrace = ((Date.now() - taskCreatedTime) / (1000 * 60 * 60 * 24)) <= 7;
  
  const ownerDept = getUserDept(proj.ownerId);
  const isProjOwnerDept = (currentUserData.dept === ownerDept); 

  let isAuthorized = currentUserData.role === 'admin' || currentUserData.canEdit || ((proj.ownerId === auth.currentUser.uid || task.assigneeId === auth.currentUser.uid || isProjOwnerDept) && isTaskInGrace);
  
  if (!isAuthorized) return alert("⚠️ 此細項已超過 7 天編輯期限，只能請管理員協助刪除！");

  const taskName = task.name;
  if (!confirm(`⚠️ 確定要刪除任務細項「${taskName}」嗎？刪除後無法復原。`)) return;

  const tasks = [...proj.tasks];
  tasks.splice(index, 1);

  if (tasks.length === 0) {
    if (!confirm("⚠️ 該專案已無任何細項，是否要直接刪除整個專案？")) {
      return;
    }
    await deleteDoc(doc(db, "projects", projId));
    selectedProjectId = 'SUMMARY';
    alert("專案已刪除！");
  } else {
    await updateDoc(doc(db, "projects", projId), { tasks });
    alert("已刪除該任務細項！");
  }
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
window.openCustomPrompt = (title, label, isRequired) => {
  return new Promise((resolve) => {
    document.getElementById('delay-reason-title').innerText = title;
    document.getElementById('delay-reason-label').innerText = label;
    document.getElementById('delay-reason-input').value = '';
    document.getElementById('delay-reason-input').dataset.required = isRequired;
    document.getElementById('delay-reason-input').placeholder = isRequired ? "請輸入原因 (必填)..." : "請輸入備註 (選填)...";
    
    document.getElementById('delay-reason-modal').classList.add('active');
    document.getElementById('delay-reason-input').focus();
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
  
  const ownerDept = getUserDept(proj.ownerId);
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
};

document.getElementById("btn-add-project").addEventListener("click", async () => {
  const title = document.getElementById("proj-name").value.trim();
  const color = document.getElementById("proj-color").value;
  if (!title) return alert("請填寫主專案名稱！");

  const collabCheckboxes = document.querySelectorAll('input[name="collab_dept"]:checked');
  const collaborators = Array.from(collabCheckboxes).map(cb => cb.value);

  const taskRows = document.querySelectorAll('.task-row'); 
  const tasks = [];
  const todayStr = getTodayStr(); 
  const ts = new Date().toLocaleString('zh-TW', { hour12: false });
  const myName = currentUserData.name || auth.currentUser.email.split('@')[0];

  for (let row of taskRows) {
    const name = row.querySelector('.task-name').value.trim(); 
    const start = row.querySelector('.task-start').value; 
    const end = row.querySelector('.task-end').value;
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

  document.getElementById("proj-name").value = ""; 
  document.getElementById("task-list-container").innerHTML = ""; 
  addTaskRow(); 
  document.getElementById('create-project-section').style.display = 'none';
  
  currentFilter = 'ongoing';
  document.getElementById('filter-ongoing').classList.add('active');
  document.getElementById('filter-completed').classList.remove('active');
  document.getElementById('filter-delayed').classList.remove('active');
  document.getElementById('filter-collab').classList.remove('active');
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

  const isAuthorizedEditor = (currentUserData.role === 'admin' || currentUserData.canEdit === true);

  filtered.forEach(evt => {
    let isOwner = (evt.ownerId === auth.currentUser.uid);
    let canEditUI = isEditMode && isAuthorizedEditor && isOwner;
    
    let editHtml = canEditUI ? `<button class="action-btn" style="margin-left:4px; border-color:var(--warning); color:var(--warning);" onclick="openGeneralEdit('adhoc', '${evt.id}')">✏️</button>` : '';
    let actionHtml = !evt.isCompleted && isOwner ? `<button class="action-btn" onclick="completeAdHoc('${evt.id}')">完成</button>` : '';
    let delHtml = (currentUserData.role === 'admin' || currentUserData.role === 'top_manager' || canEditUI) ? `<button class="action-btn danger" style="margin-left:4px;" onclick="deleteAdHoc('${evt.id}')">刪除</button>` : '';

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
  if(selectedProjectId === 'SUMMARY' && document.getElementById("tab-projects").style.display === "block") renderProjects(); 
}

document.getElementById("btn-add-adhoc").addEventListener("click", async () => {
  const title = document.getElementById("adhoc-title").value.trim(); 
  const reason = document.getElementById("adhoc-reason").value.trim(); 
  const start = document.getElementById("adhoc-start").value;
  if (!title || !reason || !start) return alert("請填寫完整名稱、開始日期與原因！");
  
  const targetUser = allUsersList.find(u => u.uid === viewingUserId) || { name: currentUserData.name };
  await addDoc(collection(db, "ad_hoc_events"), { 
    ownerId: viewingUserId, 
    ownerName: targetUser.name || '', 
    title, reason, startDate: start, startDateTime: new Date().toLocaleString(), isCompleted: false, createdAt: serverTimestamp() 
  });
  document.getElementById("adhoc-title").value = ""; 
  document.getElementById("adhoc-reason").value = ""; 
  document.getElementById("adhoc-start").value = ""; 
  alert("事件紀錄完成！");
});

window.completeAdHoc = async (id) => { 
  await updateDoc(doc(db, "ad_hoc_events", id), { isCompleted: true, completedAt: new Date().toLocaleString() }); 
};

window.deleteAdHoc = async (id) => { 
  if (currentUserData.role !== 'admin') return alert("權限不足！");
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
  selectElem.innerHTML = '<option value="">-- 請選擇主專案 --</option>';
  const myProjs = allProjectsData.filter(p => p.ownerId === viewingUserId);
  const availableProjs = myProjs.filter(p => window.getAvailableTasks(p.id).length > 0);
  availableProjs.forEach(p => { selectElem.innerHTML += `<option value="${p.id}">${p.title}</option>`; });
};

window.updateWeeklyTaskSelect = (selectElem) => {
  const taskSelect = selectElem.parentElement.querySelector('.weekly-task-select');
  taskSelect.innerHTML = '<option value="">-- 請選擇細項 --</option>';
  const projId = selectElem.value;
  if(!projId) return;
  const availableTasks = window.getAvailableTasks(projId);
  availableTasks.forEach(t => { taskSelect.innerHTML += `<option value="${t.index}">${t.name}</option>`; });
};

window.addWeeklyRow = () => {
  const container = document.getElementById("weekly-items-container");
  const div = document.createElement('div'); 
  div.className = "weekly-item-row"; 
  div.style.cssText = "display:flex; gap:16px; margin-bottom:12px; align-items:flex-start; border: 1px solid var(--border-light); padding: 14px; border-radius: 8px; background: #fafafa;";
  div.innerHTML = `<div style="flex:1; display:flex; flex-direction:column; gap:10px; border-right: 1px dashed var(--border); padding-right:16px;"><select class="input-control weekly-proj-select" onchange="updateWeeklyTaskSelect(this)" style="background:#fff;"></select><select class="input-control weekly-task-select" style="background:#fff;"><option value="">-- 請先選擇主專案 --</option></select></div><div style="flex:2.5;"><textarea class="input-control weekly-content" rows="3" placeholder="請填寫此任務的進度說明..." style="background:#fff;"></textarea></div><button class="action-btn danger" onclick="this.parentElement.remove()" style="padding: 10px; margin-left: 8px;">X</button>`;
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
      
      if (pSel.value || tSel.value || content) {
        if (pSel.value && tSel.value && content) {
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
  if (report.leaveType === 'leave') leaveTag = `<span class="pill pill-danger" style="margin-left:12px; font-size:12px;">📌 原因：請假</span>`;
  else if (report.leaveType === 'other') leaveTag = `<span class="pill pill-warning" style="margin-left:12px; font-size:12px;">📌 原因：${report.leaveReason}</span>`;

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
      html += `<div style="font-size:10px; color:var(--text-muted); text-align:right;">+${dayTodos.length - 3} 則...</div>`;
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
    uncompletedList.innerHTML = `<div style="font-size:12px; color:var(--text-muted); padding:8px 0;">尚無未完成事項</div>`;
  } else {
    uncompleted.forEach(todo => {
      const div = document.createElement("div");
      div.className = "cal-todo-item";
      div.innerHTML = `
        <label style="display:flex; align-items:center; gap:8px; cursor:pointer; flex:1;">
          <input type="checkbox" onchange="toggleCalTodoStatus('${todo.id}', true)">
          <span style="color:${todo.color || '#0f172a'}; font-weight:600;">${todo.title}</span>
        </label>
        <button class="btn-close" style="font-size:18px; color:var(--text-muted);" onclick="deleteCalendarTodo('${todo.id}')">×</button>
      `;
      uncompletedList.appendChild(div);
    });
  }

  if (completed.length === 0) {
    completedList.innerHTML = `<div style="font-size:12px; color:var(--text-muted); padding:8px 0;">尚無已完成事項</div>`;
  } else {
    completed.forEach(todo => {
      const div = document.createElement("div");
      div.className = "cal-todo-item done";
      div.innerHTML = `
        <label style="display:flex; align-items:center; gap:8px; cursor:pointer; flex:1;">
          <input type="checkbox" checked onchange="toggleCalTodoStatus('${todo.id}', false)">
          <span style="color:${todo.color || '#0f172a'};">${todo.title}</span>
        </label>
        <button class="btn-close" style="font-size:18px; color:var(--text-muted);" onclick="deleteCalendarTodo('${todo.id}')">×</button>
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
    { key: "manager", label: "👔 部門主管", roles: ["manager", "top_manager", "admin"] },
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
        const isMgr = tier.key === "manager";
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
          <span style="font-size:16px;">🏢</span>
          <span>${dept}</span>
        </div>
        <span style="font-size:12px; font-weight:600; background:#f1f5f9; color:#475569; padding:2px 8px; border-radius:12px;">共 ${deptUsers.length} 人</span>
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
        let tInGrace = ((Date.now() - tCreatedTime) / (1000 * 60 * 60 * 24)) <= 7;
        let isMyTask = (auth.currentUser.uid === (t.assigneeId || p.ownerId));
        const ownerDept = getUserDept(p.ownerId);
        let isOwnerDept = (currentUserData.dept === ownerDept);

        if ((isOwnerDept || isMyTask) && tInGrace) isAuthorized = true;
      } else if (type === 'project') {
        const ownerDept = getUserDept(p.ownerId);
        const isOwnerDept = (currentUserData.dept === ownerDept);
        if (isOwnerDept && isWithin7DaysGracePeriod(p)) isAuthorized = true;
      }
    }
  } else if (type === 'weekly') {
    const w = allWeeklyData.find(x => x.id === id);
    if ((currentUserData.role === 'admin' || currentUserData.canEdit) || (w && w.ownerId === auth.currentUser.uid && isWeeklyReportEditable(w))) {
      isAuthorized = true;
    }
  } else if (type === 'adhoc') {
    if (currentUserData.role === 'admin' || currentUserData.canEdit) isAuthorized = true;
  }

  if (!isAuthorized) {
    return alert("權限不足：您無法編輯此資料 (可能已超過 7 天寬限期)！");
  }

  currentEditData = { type, id, extra };
  const form = document.getElementById("general-edit-form"); 
  form.innerHTML = "";

  if (type === 'project') {
    const p = allProjectsData.find(x => x.id === id);
    document.getElementById("general-edit-title").innerText = "編輯主專案名稱與協作部門";
    let collabHtml = `<div class="form-group" style="margin-top:12px;"><label class="form-label">協作部門 (可複選)</label><div style="display:flex; flex-direction:column; gap:6px;">`;
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
    form.innerHTML = `
      <div class="form-group"><label class="form-label">細項名稱</label><input type="text" id="edit-val-name" class="input-control" value="${task.name}"></div>
      <div class="form-row">
        <div class="form-group" style="flex:1.2;"><label class="form-label">開始日期</label><input type="date" id="edit-val-start" class="input-control" value="${task.start}" onchange="onTaskStartChange(this, 'edit-val-end')"></div>
        <div class="form-group" style="width:65px; flex-shrink:0;"><label class="form-label">天數</label><input type="number" min="1" id="edit-val-days" class="input-control task-days" value="${taskDays}" oninput="onTaskDaysChange(this, 'edit-val-start', 'edit-val-end')"></div>
        <div class="form-group" style="flex:1.2;"><label class="form-label">結束日期</label><input type="date" id="edit-val-end" class="input-control" value="${task.end}" min="${task.start}" onchange="onTaskEndChange(this, 'edit-val-start', 'edit-val-days')"></div>
      </div>
    `;
  } else if (type === 'adhoc') {
    const adhoc = allAdHocData.find(a => a.id === id);
    document.getElementById("general-edit-title").innerText = "編輯事件紀錄";
    form.innerHTML = `
      <div class="form-group"><label class="form-label">事項名稱</label><input type="text" id="edit-val-title" class="input-control" value="${adhoc.title}"></div>
      <div class="form-group"><label class="form-label">開始日期</label><input type="date" id="edit-val-start" class="input-control" value="${adhoc.startDate || ''}"></div>
      <div class="form-group"><label class="form-label">原因說明</label><input type="text" id="edit-val-reason" class="input-control" value="${adhoc.reason}"></div>
    `;
  } else if (type === 'weekly') {
    const weekly = allWeeklyData.find(w => w.id === id);
    document.getElementById("general-edit-title").innerText = "編輯週報內容";
    
    let html = `<div style="display:flex; flex-direction:column; gap:12px; max-height:400px; overflow-y:auto;">`;
    const userProjects = allProjectsData.filter(p => p.ownerId === weekly.ownerId);

    if (weekly.items && weekly.items.length > 0) {
      weekly.items.forEach((item, idx) => {
        let projOptions = `<option value="">-- 請選擇專案 --</option>`;
        userProjects.forEach(p => {
          projOptions += `<option value="${p.id}" ${p.id === item.projectId ? 'selected' : ''}>${p.title}</option>`;
        });

        const activeProj = allProjectsData.find(p => p.id === item.projectId);
        let taskOptions = `<option value="">-- 請選擇細項 --</option>`;
        if (activeProj && activeProj.tasks) {
          activeProj.tasks.forEach((t, tIdx) => {
            taskOptions += `<option value="${tIdx}" ${String(tIdx) === String(item.taskId) ? 'selected' : ''}>${t.name}</option>`;
          });
        }

        html += `
          <div class="form-group" style="padding:12px; background:#f8fafc; border:1px solid var(--border); border-radius:8px; margin-bottom:0;">
            <div class="form-row" style="margin-bottom:8px;">
              <div class="form-group" style="flex:1; margin-bottom:0;">
                <label class="form-label" style="font-size:12px;">主專案</label>
                <select id="edit-weekly-proj-${idx}" class="input-control" style="font-size:12px; padding:6px 8px;" onchange="onEditWeeklyProjChange(${idx})">${projOptions}</select>
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
  document.getElementById("general-edit-modal").classList.add("active");
};

window.onEditWeeklyProjChange = (idx) => {
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
};

window.closeGeneralEditModal = () => document.getElementById("general-edit-modal").classList.remove("active");

window.saveGeneralEdit = async () => {
  const { type, id, extra } = currentEditData;

  try {
    if (type === 'project') {
      const title = document.getElementById("edit-val-proj-title").value.trim();
      const checkboxes = document.querySelectorAll('input[name="edit_collab"]:checked');
      const collaborators = Array.from(checkboxes).map(cb => cb.value);

      if(title) await updateDoc(doc(db, "projects", id), { title, collaborators });
      else return alert("專案名稱不可為空！");
    } else if (type === 'task') {
      const proj = allProjectsData.find(p => p.id === id); 
      const tasks = [...proj.tasks];
      tasks[extra].name = document.getElementById("edit-val-name").value.trim();
      tasks[extra].start = document.getElementById("edit-val-start").value;
      tasks[extra].end = document.getElementById("edit-val-end").value;
      await updateDoc(doc(db, "projects", id), { tasks });
    } else if (type === 'adhoc') {
      await updateDoc(doc(db, "ad_hoc_events", id), {
        title: document.getElementById("edit-val-title").value.trim(),
        startDate: document.getElementById("edit-val-start").value,
        reason: document.getElementById("edit-val-reason").value.trim()
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
          const tId = tSel ? tSel.value : weekly.items[idx].taskId;
          const tName = tSel && tSel.selectedIndex >= 0 ? tSel.options[tSel.selectedIndex].text : weekly.items[idx].taskName;

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
  const rolePriority = { admin: 1, top_manager: 2, manager: 3, assistant_manager: 4, staff: 5 };

  onSnapshot(collection(db, "users"), (snapshot) => {
    const tbody = document.getElementById("user-list-tbody"); 
    const supervisorSelect = document.getElementById("new-user-supervisor");
    tbody.innerHTML = ""; 
    supervisorSelect.innerHTML = '<option value="">-- 無 --</option>'; 
    allUsersList = [];
    
    snapshot.forEach(docSnap => {
      const u = docSnap.data(); 
      allUsersList.push({ uid: docSnap.id, ...u });
      if (["top_manager", "manager", "assistant_manager"].includes(u.role)) {
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
            <span style="font-size:12px;">開放</span>
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
        </td>`;
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
    if (user.uid !== uid && ["top_manager", "manager", "assistant_manager"].includes(user.role)) {
      supSelect.innerHTML += `<option value="${user.uid}">${user.name}</option>`;
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
