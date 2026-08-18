import { initializeApp } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-app.js";
import { 
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged,
  updatePassword, createUserWithEmailAndPassword, sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/10.9.0/firebase-auth.js";
import { 
  getFirestore, doc, getDoc, setDoc, deleteDoc, collection, addDoc, updateDoc, 
  query, onSnapshot, serverTimestamp 
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
const db = getFirestore(app);

const roleNames = { admin: "系統管理員", top_manager: "高級主管", manager: "主管", assistant_manager: "副主管", staff: "人員" };
let currentUserData = { role: "staff", name: "", canEdit: false };
let allUsersList = [];

let viewingUserId = null; 
let allProjectsData = [];
let allAdHocData = [];
let allWeeklyData = [];
let currentFilter = 'ongoing'; 
let selectedProjectId = 'SUMMARY'; 
let ganttInstance = null;
let summaryGanttInstance = null;
let currentWeeklyReportId = null;

let isEditMode = false;

window.switchNav = (tabId, title, elem) => {
  document.querySelectorAll('.tab-pane').forEach(el => el.style.display = 'none');
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  document.getElementById(tabId).style.display = 'block';
  if (elem) elem.classList.add('active');
  document.getElementById('current-title').innerText = title;
  if (tabId === 'tab-projects') setTimeout(renderProjects, 100);
};

document.getElementById("btn-toggle-edit-mode").addEventListener("click", () => {
  isEditMode = !isEditMode;
  const btn = document.getElementById("btn-toggle-edit-mode");
  if (isEditMode) {
    btn.innerHTML = "❌ 關閉編輯模式"; btn.style.background = "var(--warning-bg)";
  } else {
    btn.innerHTML = "✏️ 開啟編輯模式"; btn.style.background = "transparent";
  }
  renderProjects(); renderAdHocEvents(); renderWeeklyReports();
});

function checkEditModeVisibility() {
  const btn = document.getElementById("btn-toggle-edit-mode");
  if (currentUserData.role === 'admin' || currentUserData.canEdit === true) {
    btn.style.display = "inline-block";
  } else {
    btn.style.display = "none";
    if (isEditMode) {
      isEditMode = false; btn.innerHTML = "✏️ 開啟編輯模式"; btn.style.background = "transparent";
    }
  }
}

document.getElementById('btn-toggle-create').addEventListener('click', () => {
  const form = document.getElementById('create-project-section');
  const isHidden = form.style.display === 'none';
  form.style.display = isHidden ? 'block' : 'none';

  if (isHidden && selectedProjectId && selectedProjectId !== 'SUMMARY') {
    const activeProj = allProjectsData.find(p => p.id === selectedProjectId);
    if (activeProj && activeProj.ownerId === viewingUserId) {
      document.getElementById("proj-name").value = activeProj.title;
      document.getElementById("proj-color").value = activeProj.color || "bar-primary";
    }
  }
});

window.toggleSubMenu = () => document.getElementById('nav-sub-wrapper').classList.toggle('nav-menu-open');

function getWorkingDays(startDate, endDate) {
  let count = 0; let curDate = new Date(startDate); let end = new Date(endDate);
  curDate.setHours(0,0,0,0); end.setHours(0,0,0,0);
  while (curDate <= end) {
    if (curDate.getDay() !== 0 && curDate.getDay() !== 6) count++;
    curDate.setDate(curDate.getDate() + 1);
  }
  return count;
}

function patchGanttVisuals(ganttInst, containerSelector) {
  if (!ganttInst || !ganttInst.dates || ganttInst.dates.length === 0) return;
  const svg = document.querySelector(`${containerSelector} .gantt`);
  if(!svg) return;

  const baseYear = ganttInst.dates[0].getFullYear();
  svg.querySelectorAll('.upper-text').forEach(el => {
      const t = el.textContent.trim();
      if (/^\d+月$/.test(t)) {
          el.textContent = `${baseYear}年 ${t}`;
      } else if (/^\d{4}\s+\d+月$/.test(t)) {
          el.textContent = t.replace(/^(\d{4})\s+(\d+月)$/, '$1年 $2');
      }
  });

  const holidays = [
    '01-01', '01-02', '02-16', '02-17', '02-18', '02-19', '02-20', 
    '02-28', '04-03', '04-04', '04-05', '04-06', '05-01', '06-19', '09-25', '10-10'
  ];
  
  const lowerTexts = Array.from(svg.querySelectorAll('.lower-text'));
  const dayTicks = Array.from(svg.querySelectorAll('.tick')).filter(t => !t.classList.contains('thick'));

  ganttInst.dates.forEach((date, i) => {
      if (i < lowerTexts.length) {
          const dStr = String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
          const isWeekend = date.getDay() === 0 || date.getDay() === 6;
          const isHoliday = holidays.includes(dStr);

          if (isWeekend || isHoliday) {
              lowerTexts[i].style.fill = '#ef4444'; 
              lowerTexts[i].style.fontWeight = 'bold';
              if (i < dayTicks.length) dayTicks[i].style.fill = 'rgba(239, 68, 68, 0.08)';
          }
      }
  });
}

onAuthStateChanged(auth, async (user) => {
  if (user) {
    document.getElementById("auth-section").style.display = "none";
    document.getElementById("app-section").style.display = "flex";
    viewingUserId = user.uid;

    try {
      const userDoc = await getDoc(doc(db, "users", user.uid));
      if (userDoc.exists()) currentUserData = userDoc.data();
      else {
        currentUserData = { name: user.email.split('@')[0], role: "admin", canEdit: false };
        await setDoc(doc(db, "users", user.uid), currentUserData, { merge: true });
      }
    } catch (e) { currentUserData = { name: user.email.split('@')[0], role: "admin", canEdit: false }; }

    document.getElementById("user-display-name").innerText = currentUserData.name || user.email.split('@')[0];
    document.getElementById("user-avatar").innerText = (currentUserData.name || user.email).charAt(0).toUpperCase();
    document.getElementById("user-role-badge").innerText = roleNames[currentUserData.role] || (currentUserData.role || "STAFF").toUpperCase();

    if (currentUserData.role === "admin") {
      document.getElementById("nav-org-manage").style.display = "flex"; document.getElementById("nav-divider-org").style.display = "block"; loadOrgUsers();
    } else {
      document.getElementById("nav-org-manage").style.display = "none"; document.getElementById("nav-divider-org").style.display = "none";
    }

    if (currentUserData.role !== 'staff') { document.getElementById('nav-sub-wrapper').style.display = 'block'; loadSidebarSubordinates(); } 
    else document.getElementById('nav-sub-wrapper').style.display = 'none';

    checkEditModeVisibility();
    addTaskRow(); addWeeklyRow(); loadProjects(); loadAdHocEvents(); loadWeeklyReports();
  } else {
    document.getElementById("auth-section").style.display = "flex"; document.getElementById("app-section").style.display = "none";
  }
});

function loadSidebarSubordinates() {
  onSnapshot(collection(db, "users"), (snapshot) => {
    const list = document.getElementById("nav-sub-list");
    list.innerHTML = `<li class="nav-sub-item active" id="sub-li-${auth.currentUser.uid}" onclick="switchViewingUser('${auth.currentUser.uid}', '自己 (我的資料)')">我的資料</li>`;
    snapshot.forEach(docSnap => {
      const u = { uid: docSnap.id, ...docSnap.data() };
      if (u.uid === auth.currentUser.uid) return;
      const myRole = currentUserData.role; const targetRole = u.role; let canView = false;
      if (myRole === 'admin') canView = true;
      else if (myRole === 'top_manager' && targetRole !== 'admin' && targetRole !== 'top_manager') canView = true;
      else if (myRole === 'manager' && (targetRole === 'assistant_manager' || targetRole === 'staff')) canView = true;
      else if (myRole === 'assistant_manager' && targetRole === 'staff') canView = true;
      if (canView || u.supervisorId === auth.currentUser.uid) {
        list.innerHTML += `<li class="nav-sub-item" id="sub-li-${u.uid}" onclick="switchViewingUser('${u.uid}', '${u.name}')">${u.name} <small style="color:#cbd5e1">(${roleNames[u.role]||'人員'})</small></li>`;
      }
    });
  });
}

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
  checkEditModeVisibility();
  renderProjects(); renderAdHocEvents(); renderWeeklyReports();
};

document.getElementById("btn-login").addEventListener("click", () => { signInWithEmailAndPassword(auth, document.getElementById("login-email").value.trim(), document.getElementById("login-password").value.trim()).catch(e=>alert(e.message)); });
document.getElementById("btn-logout").addEventListener("click", () => signOut(auth));

function getNextWorkingDayStr(dateStr) {
  if (!dateStr) return ''; let d = new Date(dateStr); d.setDate(d.getDate() + 1);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return d.toISOString().split('T')[0];
}
window.checkWorkingDay = (input) => { if (!input.value) return; const d = new Date(input.value); if (d.getDay() === 0 || d.getDay() === 6) { alert("系統規定只能點選工作日喔！"); input.value = ''; } };

window.addTaskRow = () => {
  const container = document.getElementById("task-list-container"); const rows = container.querySelectorAll('.task-row');
  let defaultStart = rows.length > 0 ? getNextWorkingDayStr(rows[rows.length - 1].querySelector('.task-end').value) : "";
  const div = document.createElement('div'); div.className = "form-row task-row"; div.style.marginBottom = "8px";
  div.innerHTML = `<div class="form-group" style="margin:0; flex:2;"><input type="text" class="input-control task-name" placeholder="細項名稱"></div><div class="form-group" style="margin:0; flex:1;"><input type="date" class="input-control task-start" value="${defaultStart}" onchange="checkWorkingDay(this)"></div><div class="form-group" style="margin:0; flex:1;"><input type="date" class="input-control task-end" onchange="checkWorkingDay(this)"></div><div class="form-group" style="margin:0; max-width: 40px;"><button class="action-btn danger" onclick="this.parentElement.parentElement.remove()" style="padding: 10px;">X</button></div>`;
  container.appendChild(div);
};

window.setProjectFilter = (status) => {
  currentFilter = status;
  document.getElementById('filter-ongoing').classList.toggle('active', status === 'ongoing');
  document.getElementById('filter-completed').classList.toggle('active', status === 'completed');
  document.getElementById('filter-delayed').classList.toggle('active', status === 'delayed');
  selectedProjectId = 'SUMMARY'; renderProjects();
};

window.selectProject = (projId) => { selectedProjectId = projId; renderProjects(); };

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

function updateProjectDatalist(userProjects) {
  const datalist = document.getElementById("project-names-list");
  if (!datalist) return;
  datalist.innerHTML = "";
  const activeProjects = userProjects.filter(p => {
    if (!p.tasks || p.tasks.length === 0) return true;
    return !p.tasks.every(t => t.isCompleted);
  });
  const uniqueNames = [...new Set(activeProjects.map(p => p.title))];
  uniqueNames.forEach(name => {
    const option = document.createElement("option"); option.value = name; datalist.appendChild(option);
  });
}

function loadProjects() {
  onSnapshot(query(collection(db, "projects")), (snapshot) => {
    allProjectsData = []; snapshot.forEach(docSnap => allProjectsData.push({ id: docSnap.id, ...docSnap.data() })); 
    renderProjects(); refreshAllWeeklyProjSelects();
  });
}

function formatDateSafe(dateObj) { const y = dateObj.getFullYear(); const m = String(dateObj.getMonth() + 1).padStart(2, '0'); const d = String(dateObj.getDate()).padStart(2, '0'); return `${y}-${m}-${d}`; }
function getAdHocDateStr(evt) {
  if (evt.startDate) return evt.startDate;
  if (evt.createdAt && evt.createdAt.toDate) return evt.createdAt.toDate().toISOString().split('T')[0];
  return new Date().toISOString().split('T')[0];
}

function renderProjects() {
  const userProjects = allProjectsData.filter(p => p.ownerId === viewingUserId);
  const userAdHocs = allAdHocData.filter(e => e.ownerId === viewingUserId);

  if (viewingUserId === auth.currentUser.uid) updateProjectDatalist(userProjects);

  let countOngoing = 0, countCompleted = 0, countDelayed = 0;
  userProjects.forEach(p => {
    if (!p.tasks || p.tasks.length === 0) return;
    const isAllDone = p.tasks.every(t => t.isCompleted);
    const hasDelay = p.tasks.some(t => t.delayReason || (!t.isCompleted && new Date() > new Date(t.end)));
    if (isAllDone) countCompleted++; else countOngoing++;
    if (hasDelay) countDelayed++;
  });
  document.getElementById('stat-ongoing').innerText = countOngoing; document.getElementById('stat-completed').innerText = countCompleted; document.getElementById('stat-delay').innerText = countDelayed;

  const filteredProjects = userProjects.filter(p => {
    if (!p.tasks || p.tasks.length === 0) return false;
    const isAllDone = p.tasks.every(t => t.isCompleted);
    const hasDelay = p.tasks.some(t => t.delayReason || (!t.isCompleted && new Date() > new Date(t.end)));
    if (currentFilter === 'completed') return isAllDone;
    if (currentFilter === 'delayed') return hasDelay;
    return !isAllDone;
  });

  const filteredAdHocs = userAdHocs.filter(e => {
    if (currentFilter === 'completed') return e.isCompleted;
    if (currentFilter === 'delayed') return false; 
    return !e.isCompleted;
  });

  if (selectedProjectId !== 'SUMMARY') {
    if (!filteredProjects.find(p => p.id === selectedProjectId)) selectedProjectId = 'SUMMARY';
  }

  const tabsContainer = document.getElementById("project-tabs-container");
  const detailView = document.getElementById("project-detail-view");
  const summaryView = document.getElementById("project-summary-view");
  const emptyState = document.getElementById("empty-state");
  tabsContainer.innerHTML = "";

  if (filteredProjects.length === 0 && filteredAdHocs.length === 0) { 
    detailView.style.display = "none"; summaryView.style.display = "none"; emptyState.style.display = "block"; return; 
  }

  const summaryBtn = document.createElement("button");
  summaryBtn.className = `proj-tab ${selectedProjectId === 'SUMMARY' ? 'active' : ''}`;
  summaryBtn.innerText = "⭐ 所有專案總覽"; summaryBtn.onclick = () => selectProject('SUMMARY'); tabsContainer.appendChild(summaryBtn);

  filteredProjects.forEach(p => {
    const btn = document.createElement("button"); btn.className = `proj-tab ${p.id === selectedProjectId ? 'active' : ''}`;
    btn.innerText = p.title; btn.onclick = () => selectProject(p.id); tabsContainer.appendChild(btn);
  });

  emptyState.style.display = "none"; 

  // 總覽
  if (selectedProjectId === 'SUMMARY') {
    detailView.style.display = "none"; summaryView.style.display = "block";
    const sumLeftBody = document.getElementById("gantt-summary-left-body");
    sumLeftBody.innerHTML = "";
    const ganttTasksSum = [];
    let sIdx = 0;

    userProjects.forEach(p => {
      if(!p.tasks || p.tasks.length === 0) return;
      let minStart = "9999-12-31"; let maxEnd = "0000-01-01"; let totalProg = 0;
      p.tasks.forEach(t => { if (t.start < minStart) minStart = t.start; if (t.end > maxEnd) maxEnd = t.end; totalProg += (t.progress || 0); });
      let avgProg = Math.round(totalProg / p.tasks.length);
      let isDone = p.tasks.every(t => t.isCompleted);
      
      let projColorClass = p.color || 'bar-primary';
      ganttTasksSum.push({ id: `s_p_${sIdx}`, name: p.title, start: minStart, end: maxEnd, progress: avgProg, custom_class: isDone ? 'bar-success' : projColorClass });
      
      let statusText = isDone ? '<span style="color:var(--success); font-weight:700;">完成</span>' : avgProg+'%';
      const row = document.createElement("div"); row.className = "gantt-row";
      row.innerHTML = `<div class="col-name" style="flex:2.5" title="${p.title}">📁 ${p.title}</div><div class="col-date" style="flex:1.5; text-align:left;">${minStart.substring(5)} ~ ${maxEnd.substring(5)}</div><div class="col-prog" style="flex:1; justify-content:center;">${statusText}</div>`;
      sumLeftBody.appendChild(row); sIdx++;
    });

    userAdHocs.forEach(evt => {
      let eDate = getAdHocDateStr(evt);
      let prog = evt.isCompleted ? 100 : 0;
      ganttTasksSum.push({ id: `s_e_${sIdx}`, name: evt.title, start: eDate, end: eDate, progress: prog, custom_class: 'bar-danger' });
      
      let statusText = evt.isCompleted ? '<span style="color:var(--success); font-weight:700;">完成</span>' : '處理中';
      const row = document.createElement("div"); row.className = "gantt-row";
      row.innerHTML = `<div class="col-name" style="flex:2.5; color:var(--danger);" title="${evt.title}">🚨 ${evt.title}</div><div class="col-date" style="flex:1.5; text-align:left;">${eDate.substring(5)}</div><div class="col-prog" style="flex:1; justify-content:center;">${statusText}</div>`;
      sumLeftBody.appendChild(row); sIdx++;
    });

    if (ganttTasksSum.length > 0) {
      document.getElementById("gantt-chart-summary-container").innerHTML = '<div id="gantt-chart-summary"></div>';
      setTimeout(() => {
        if (document.getElementById("tab-projects").style.display === "none") return;
        summaryGanttInstance = new Gantt("#gantt-chart-summary", ganttTasksSum, { view_mode: 'Day', language: 'zh', header_height: 50, bar_height: 20, padding: 18, readonly: true });
        patchGanttVisuals(summaryGanttInstance, '#gantt-chart-summary-container');
      }, 150); 
    } else { document.getElementById("gantt-chart-summary-container").innerHTML = ''; }
    return;
  }

  // 個別專案
  summaryView.style.display = "none"; detailView.style.display = "block";
  const activeProj = filteredProjects.find(p => p.id === selectedProjectId);
  if(!activeProj) return; 

  const isOwner = activeProj.ownerId === auth.currentUser.uid;
  let canEditUI = isEditMode && (isOwner || currentUserData.role === 'admin' || currentUserData.canEdit);
  
  let editProjBtn = canEditUI ? `<button class="action-btn" onclick="openGeneralEdit('project', '${activeProj.id}')" style="margin-left:8px; padding:2px 6px; font-size:10px; border-color:var(--warning); color:var(--warning);">✏️ 編輯專案</button>` : '';
  document.getElementById("current-gantt-title").innerHTML = `專案：${activeProj.title} ${editProjBtn}`;
  
  const lockBtn = document.getElementById("btn-toggle-lock");
  const delProjBtn = document.getElementById("btn-delete-project");
  
  if (currentUserData.role === "admin" || currentUserData.role === "top_manager") {
    lockBtn.style.display = "inline-block"; lockBtn.innerText = activeProj.isLocked ? "🔒 鎖定中" : "🔓 已開放 (點擊鎖定)";
    lockBtn.className = activeProj.isLocked ? "action-btn" : "action-btn danger"; delProjBtn.style.display = "inline-block";
  } else { lockBtn.style.display = "none"; delProjBtn.style.display = "none"; }

  const leftBody = document.getElementById("gantt-left-body");
  const listBody = document.getElementById("project-list-tbody");
  leftBody.innerHTML = ""; if(listBody) listBody.innerHTML = "";
  
  const ganttTasks = [];
  activeProj.tasks.forEach((task, index) => {
    const currentProgress = task.progress || 0;
    const workDays = getWorkingDays(task.start, task.end);
    let projColorClass = activeProj.color || 'bar-primary';
    ganttTasks.push({ id: `t_${index}`, name: task.name, start: task.start, end: task.end, progress: currentProgress, custom_class: task.isCompleted ? 'bar-success' : projColorClass });

    const isInputLocked = task.isCompleted || !isOwner; 
    let editHtml = canEditUI ? `<button class="action-btn" onclick="openGeneralEdit('task', '${activeProj.id}', ${index})" style="margin-left:6px; padding:2px 6px; font-size:10px; border-color:var(--warning); color:var(--warning);">✏️</button>` : '';

    const row = document.createElement("div"); row.className = "gantt-row";
    row.innerHTML = `
      <div class="col-name" title="${task.name}"><div style="display:flex; align-items:center;"><span style="overflow:hidden; text-overflow:ellipsis;">${task.name}</span>${editHtml}</div></div>
      <div class="col-date">${workDays} 天</div>
      <div class="col-prog"><input type="number" min="0" max="100" value="${currentProgress}" id="prog_input_${index}" ${isInputLocked ? 'disabled' : ''}> %</div>
      <div class="col-act"><button class="action-btn btn-sm" ${isInputLocked ? 'disabled' : ''} onclick="confirmProgress('${activeProj.id}', ${index}, '${task.end}')">${task.isCompleted ? '完成' : '確認'}</button></div>
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
      tr.innerHTML = `<td style="vertical-align: top; font-size: 14px;"><strong>${task.name}</strong></td><td style="vertical-align: top;">${statusHtml}</td><td colspan="2" style="padding: 0 16px; vertical-align: top;">${historyHtml}</td>`;
      listBody.appendChild(tr);
    }
  });

  if (ganttTasks.length > 0) {
    const chartContainer = document.getElementById("gantt-chart-container");
    chartContainer.className = "gantt-right-panel locked-gantt"; 
    chartContainer.innerHTML = '<div id="gantt-chart"></div>';
    setTimeout(() => {
      if (document.getElementById("tab-projects").style.display === "none") return;
      ganttInstance = new Gantt("#gantt-chart", ganttTasks, { 
        view_mode: 'Day', language: 'zh', header_height: 50, bar_height: 20, padding: 18, readonly: true
      });
      patchGanttVisuals(ganttInstance, '#gantt-chart-container');
    }, 150); 
  }
}

window.confirmProgress = async (projId, taskIndex, plannedEnd) => {
  const proj = allProjectsData.find(p => p.id === projId);
  const tasks = [...proj.tasks];
  const inputElem = document.getElementById(`prog_input_${taskIndex}`);
  let newProg = parseInt(inputElem.value); const oldProg = tasks[taskIndex].progress || 0;
  if (isNaN(newProg) || newProg < 0) newProg = 0; if (newProg > 100) newProg = 100;
  if (newProg < oldProg) { alert(`錯誤：進度不能往回倒扣！目前已達成 ${oldProg}%。`); inputElem.value = oldProg; return; }

  const todayStr = new Date().toISOString().split('T')[0];
  const ts = new Date().toLocaleString('zh-TW', { hour12: false });
  let passedDays = 0; if (todayStr >= tasks[taskIndex].start) passedDays = getWorkingDays(tasks[taskIndex].start, todayStr);

  let delayReason = tasks[taskIndex].delayReason || ""; let currentRemark = "";
  if (newProg === 100) {
    if (todayStr > plannedEnd && !delayReason) {
      delayReason = prompt("⚠️ 此任務已超出預計完成日，請填寫 Delay 原因 (必填)：");
      if (!delayReason) { inputElem.value = oldProg; return alert("必須填寫原因才能完成！"); }
    } else currentRemark = prompt("即將結案！可填寫結案備註 (選填)：") || "";
    tasks[taskIndex].isCompleted = true; tasks[taskIndex].completedAt = ts; tasks[taskIndex].delayReason = delayReason;
    alert("🎉 進度已達 100%！該任務已結案。");
  } else { 
    currentRemark = prompt("請輸入此次進度更新的備註事項 (選填)：") || "";
    tasks[taskIndex].isCompleted = false; tasks[taskIndex].completedAt = null; 
  }
  tasks[taskIndex].progress = newProg; tasks[taskIndex].lastUpdatedAt = ts;

  if (!tasks[taskIndex].history) tasks[taskIndex].history = [];
  tasks[taskIndex].history.push({ timestamp: ts, progress: newProg, type: newProg === 100 ? 'complete' : 'update', daysPassed: passedDays, remark: currentRemark, delayReason: delayReason || "" });

  await updateDoc(doc(db, "projects", projId), { tasks });
  if(newProg !== 100) alert(`進度已更新為 ${newProg}%`);
};

document.getElementById("btn-add-project").addEventListener("click", async () => {
  const title = document.getElementById("proj-name").value.trim();
  const color = document.getElementById("proj-color").value;
  if (!title) return alert("請填寫主專案名稱！");
  const taskRows = document.querySelectorAll('.task-row'); const tasks = [];
  const todayStr = new Date().toISOString().split('T')[0]; const ts = new Date().toLocaleString('zh-TW', { hour12: false });

  for (let row of taskRows) {
    const name = row.querySelector('.task-name').value.trim(); const start = row.querySelector('.task-start').value; const end = row.querySelector('.task-end').value;
    if (!name || !start || !end) return alert("任務細項不可有空白欄位！");
    if (start > end) return alert(`任務 [${name}] 的起始日不可大於完成日！`);
    let passedDays = 0; if (todayStr >= start) passedDays = getWorkingDays(start, todayStr);
    tasks.push({ name, start, end, progress: 0, isCompleted: false, completedAt: null, delayReason: "", lastUpdatedAt: ts, reportedCompleted: false, history: [{ timestamp: ts, progress: 0, type: 'create', daysPassed: passedDays, delayReason: '', remark: '專案建立' }] });
  }
  
  const targetUser = allUsersList.find(u => u.uid === viewingUserId) || { name: currentUserData.name, uid: auth.currentUser.uid };
  const ownerNameToSave = targetUser.name || currentUserData.name;

  const existingProj = allProjectsData.find(p => p.title === title && p.ownerId === viewingUserId);
  let newProjId = "";

  if (existingProj) {
    const updatedTasks = [...existingProj.tasks, ...tasks];
    await updateDoc(doc(db, "projects", existingProj.id), { tasks: updatedTasks, color: color });
    newProjId = existingProj.id;
    alert(`已成功將新細項附加至現有專案「${title}」底下！`);
  } else {
    const docRef = await addDoc(collection(db, "projects"), { 
      title, color, ownerId: viewingUserId, ownerName: ownerNameToSave, 
      isLocked: true, tasks: tasks, createdAt: serverTimestamp() 
    });
    newProjId = docRef.id;
    alert("新專案已建立並鎖定！");
  }

  document.getElementById("proj-name").value = ""; document.getElementById("task-list-container").innerHTML = ""; addTaskRow(); document.getElementById('create-project-section').style.display = 'none';
  
  currentFilter = 'ongoing';
  document.getElementById('filter-ongoing').classList.add('active');
  document.getElementById('filter-completed').classList.remove('active');
  document.getElementById('filter-delayed').classList.remove('active');
  selectedProjectId = newProjId;
  renderProjects(); 
});
window.toggleCurrentProjectLock = async () => { await updateDoc(doc(db, "projects", selectedProjectId), { isLocked: !allProjectsData.find(p => p.id === selectedProjectId).isLocked }); };
window.deleteCurrentProject = async () => { if (!confirm("⚠️ 確定要永久刪除此專案嗎？")) return; await deleteDoc(doc(db, "projects", selectedProjectId)); alert("專案已刪除！"); selectedProjectId = 'SUMMARY'; renderProjects(); };

// === 臨時事件 ===
function loadAdHocEvents() { onSnapshot(query(collection(db, "ad_hoc_events")), (snapshot) => { allAdHocData = []; snapshot.forEach(docSnap => allAdHocData.push({ id: docSnap.id, ...docSnap.data() })); renderAdHocEvents(); }); }

function renderAdHocEvents() {
  const tbody = document.getElementById("adhoc-list-tbody"); tbody.innerHTML = "";
  const filtered = allAdHocData.filter(e => e.ownerId === viewingUserId);
  
  // 🚀 核心修復：強制時間排序 (新到舊)
  filtered.sort((a, b) => {
    let tA = a.createdAt?.toMillis ? a.createdAt.toMillis() : Date.now();
    let tB = b.createdAt?.toMillis ? b.createdAt.toMillis() : Date.now();
    return tB - tA;
  });

  filtered.forEach(evt => {
    let isOwner = (evt.ownerId === auth.currentUser.uid);
    let canEditUI = isEditMode && (isOwner || currentUserData.role === 'admin' || currentUserData.canEdit);
    
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
  const title = document.getElementById("adhoc-title").value.trim(); const reason = document.getElementById("adhoc-reason").value.trim(); const start = document.getElementById("adhoc-start").value;
  if (!title || !reason || !start) return alert("請填寫完整名稱、開始日期與原因！");
  
  const targetUser = allUsersList.find(u => u.uid === viewingUserId) || { name: currentUserData.name };
  await addDoc(collection(db, "ad_hoc_events"), { 
    ownerId: viewingUserId, ownerName: targetUser.name || '', 
    title, reason, startDate: start, startDateTime: new Date().toLocaleString(), isCompleted: false, createdAt: serverTimestamp() 
  });
  document.getElementById("adhoc-title").value = ""; document.getElementById("adhoc-reason").value = ""; document.getElementById("adhoc-start").value = ""; alert("事件登記完成！");
});
window.completeAdHoc = async (id) => { await updateDoc(doc(db, "ad_hoc_events", id), { isCompleted: true, completedAt: new Date().toLocaleString() }); };
window.deleteAdHoc = async (id) => { if(confirm("確定刪除此紀錄？")) await deleteDoc(doc(db, "ad_hoc_events", id)); };


// === 週報系統 ===
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
  const div = document.createElement('div'); div.className = "weekly-item-row"; div.style.cssText = "display:flex; gap:16px; margin-bottom:12px; align-items:flex-start; border: 1px solid var(--border-light); padding: 14px; border-radius: 8px; background: #fafafa;";
  div.innerHTML = `<div style="flex:1; display:flex; flex-direction:column; gap:10px; border-right: 1px dashed var(--border); padding-right:16px;"><select class="input-control weekly-proj-select" onchange="updateWeeklyTaskSelect(this)" style="background:#fff;"></select><select class="input-control weekly-task-select" style="background:#fff;"><option value="">-- 請先選擇主專案 --</option></select></div><div style="flex:2.5;"><textarea class="input-control weekly-content" rows="3" placeholder="請填寫此任務的進度說明..." style="background:#fff;"></textarea></div><button class="action-btn danger" onclick="this.parentElement.remove()" style="padding: 10px; margin-left: 8px;">X</button>`;
  container.appendChild(div); populateWeeklyProjSelect(div.querySelector('.weekly-proj-select'));
};
function refreshAllWeeklyProjSelects() {
  const selects = document.querySelectorAll('.weekly-proj-select');
  selects.forEach(sel => { const currentVal = sel.value; populateWeeklyProjSelect(sel); sel.value = currentVal; });
}
function loadWeeklyReports() { 
  onSnapshot(query(collection(db, "weekly_reports")), (snapshot) => { 
    allWeeklyData = []; snapshot.forEach(docSnap => allWeeklyData.push({ id: docSnap.id, ...docSnap.data() })); 
    renderWeeklyReports(); refreshAllWeeklyProjSelects();
  }); 
}
function renderWeeklyReports() {
  const tbody = document.getElementById("weekly-list-tbody"); tbody.innerHTML = "";
  const filtered = allWeeklyData.filter(e => e.ownerId === viewingUserId);
  filtered.sort((a,b) => (b.createdAt?.toMillis() || 0) - (a.createdAt?.toMillis() || 0)); 
  filtered.forEach((w, index) => {
    let isOwner = (w.ownerId === auth.currentUser.uid);
    let canEditUI = isEditMode && (isOwner || currentUserData.role === 'admin' || currentUserData.canEdit);
    
    let editHtml = canEditUI ? `<button class="action-btn" style="margin-right:6px; border-color:var(--warning); color:var(--warning);" onclick="openGeneralEdit('weekly', '${w.id}')">✏️ 編輯</button>` : '';
    let delHtml = (currentUserData.role === 'admin' || currentUserData.role === 'top_manager' || canEditUI) ? `<button class="action-btn danger" onclick="deleteWeekly('${w.id}')">刪除</button>` : '';
    
    let supText = w.supervisorNoted ? '<span style="color:var(--success); font-weight:bold;">Noted</span>' : '<span style="color:var(--text-muted);">待閱</span>';
    let topText = w.topManagerNoted ? '<span style="color:var(--success); font-weight:bold;">Noted</span>' : '<span style="color:var(--text-muted);">待閱</span>';
    
    const tr = document.createElement("tr"); 
    tr.innerHTML = `<td>${index + 1}</td><td><strong>${w.ownerName}</strong></td><td>${w.reportDate || w.startDate || '-'}</td><td>${w.createdAt ? new Date(w.createdAt.toDate()).toLocaleString() : ''}</td><td>${supText}</td><td>${topText}</td><td><button class="action-btn" style="margin-right:6px;" onclick="openWeeklyModal('${w.id}')">瀏覽報告</button>${editHtml}${delHtml}</td>`; 
    tbody.appendChild(tr);
  });
}
document.getElementById("btn-add-weekly").addEventListener("click", async () => {
  const date = document.getElementById("rep-date").value; 
  if (!date) return alert("請選擇週報日期！");
  const rows = document.querySelectorAll('.weekly-item-row'); const items = [];
  rows.forEach(r => {
      const pSel = r.querySelector('.weekly-proj-select'); const tSel = r.querySelector('.weekly-task-select'); const content = r.querySelector('.weekly-content').value.trim();
      if(pSel.value && tSel.value && content) items.push({ projectId: pSel.value, projectName: pSel.options[pSel.selectedIndex].text, taskId: tSel.value, taskName: tSel.options[tSel.selectedIndex].text, content: content });
  });
  if (items.length === 0) return alert("請完整填寫至少一項任務進度說明！");

  const targetUser = allUsersList.find(u => u.uid === viewingUserId) || { name: currentUserData.name };
  const supervisorId = targetUser ? targetUser.supervisorId : null;

  await addDoc(collection(db, "weekly_reports"), { 
    ownerId: viewingUserId, ownerName: targetUser.name || '', 
    ownerSupervisorId: supervisorId, reportDate: date, items: items, 
    createdAt: serverTimestamp(), supervisorNoted: false, topManagerNoted: false 
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
  for (let pId in projectUpdates) updateDoc(doc(db, "projects", pId), { tasks: projectUpdates[pId] });
  
  document.getElementById("rep-date").value = ""; document.getElementById("weekly-items-container").innerHTML = ""; addWeeklyRow(); 
  alert("週報已送出！已結案(100%)的項目將不再出現在下次選單中。");
});
window.deleteWeekly = async (id) => { if(confirm("確定永久刪除此週報嗎？")) await deleteDoc(doc(db, "weekly_reports", id)); };

window.openWeeklyModal = (id) => {
  currentWeeklyReportId = id; const report = allWeeklyData.find(w => w.id === id); if(!report) return;
  let contentHtml = `<div style="margin-bottom:16px;"><div style="font-size:16px; font-weight:bold; margin-bottom:4px;">${report.ownerName} 的工作週報</div><div style="font-size:13px; color:var(--text-muted);">週報日期：${report.reportDate || report.startDate || '-'}</div></div>`;
  if (report.items && report.items.length > 0) {
    report.items.forEach((item, i) => { contentHtml += `<div style="display:flex; gap:16px; margin-bottom: 12px; padding: 14px; background: #f8fafc; border: 1px solid var(--border); border-radius: 8px; align-items:flex-start;"><div style="flex:1; font-size:13px; font-weight:600; color:var(--primary); border-right: 1px dashed var(--border-light); padding-right:12px;"><div style="margin-bottom:6px; word-break: break-all;">📁 ${item.projectName}</div><div style="word-break: break-all;">📌 ${item.taskName}</div></div><div style="flex:2.5; font-size:13px; white-space:pre-wrap; line-height:1.6; padding-left:4px;">${item.content}</div></div>`; });
  } else if (report.content) contentHtml += `<div style="padding: 12px; font-size:13px; white-space:pre-wrap; background: #f8fafc; border-radius: 8px; line-height:1.6;">${report.content}</div>`;
  document.getElementById('weekly-detail-content').innerHTML = contentHtml;

  const btnSup = document.getElementById('btn-supervisor-note'); const btnTop = document.getElementById('btn-topmanager-note');
  btnSup.style.display = 'none'; btnTop.style.display = 'none';
  const ownerUser = allUsersList.find(u => u.uid === report.ownerId);
  const isDirectSupervisor = ownerUser && (ownerUser.supervisorId === auth.currentUser.uid);
  const isTopManager = currentUserData.role === 'top_manager' || currentUserData.role === 'admin'; 
  if (isDirectSupervisor && !report.supervisorNoted) btnSup.style.display = 'inline-block';
  if (isTopManager && !report.topManagerNoted) btnTop.style.display = 'inline-block';
  document.getElementById('weekly-detail-modal').classList.add('active');
};
window.closeWeeklyModal = () => document.getElementById('weekly-detail-modal').classList.remove('active');
window.markWeeklyNoted = async (type) => {
  if(!currentWeeklyReportId) return; const updateData = {};
  if(type === 'supervisor') updateData.supervisorNoted = true; if(type === 'top_manager') updateData.topManagerNoted = true;
  await updateDoc(doc(db, "weekly_reports", currentWeeklyReportId), updateData);
  closeWeeklyModal(); alert('已成功標記為 Noted (已閱)！');
};

// ==========================================
// 🚀 全局編輯模式 Modal 邏輯
// ==========================================
let currentEditData = {};

window.openGeneralEdit = (type, id, extra) => {
  currentEditData = { type, id, extra };
  const form = document.getElementById("general-edit-form"); form.innerHTML = "";

  if (type === 'project') {
    const p = allProjectsData.find(x => x.id === id);
    document.getElementById("general-edit-title").innerText = "編輯主專案名稱";
    form.innerHTML = `<div class="form-group"><label class="form-label">專案名稱</label><input type="text" id="edit-val-proj-title" class="input-control" value="${p.title}"></div>`;
  } else if (type === 'task') {
    const proj = allProjectsData.find(p => p.id === id); const task = proj.tasks[extra];
    document.getElementById("general-edit-title").innerText = "編輯專案細項";
    form.innerHTML = `
      <div class="form-group"><label class="form-label">細項名稱</label><input type="text" id="edit-val-name" class="input-control" value="${task.name}"></div>
      <div class="form-group"><label class="form-label">開始日期</label><input type="date" id="edit-val-start" class="input-control" value="${task.start}"></div>
      <div class="form-group"><label class="form-label">結束日期</label><input type="date" id="edit-val-end" class="input-control" value="${task.end}"></div>
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
    document.getElementById("general-edit-title").innerText = "編輯週報";
    let html = `<div class="form-group"><label class="form-label">週報日期</label><input type="date" id="edit-val-date" class="input-control" value="${weekly.reportDate || weekly.startDate || ''}"></div>`;
    if (weekly.items && weekly.items.length > 0) {
      weekly.items.forEach((item, idx) => {
        html += `<div class="form-group" style="padding:10px; background:#f8fafc; border:1px solid var(--border); border-radius:8px;">
          <label class="form-label" style="color:var(--primary);">📁 ${item.projectName} - 📌 ${item.taskName}</label>
          <textarea id="edit-val-item-${idx}" class="input-control" rows="3">${item.content}</textarea>
        </div>`;
      });
    } else {
      html += `<div class="form-group"><label class="form-label">進度說明</label><textarea id="edit-val-content" class="input-control" rows="4">${weekly.content || ''}</textarea></div>`;
    }
    form.innerHTML = html;
  }
  document.getElementById("general-edit-modal").classList.add("active");
};

window.closeGeneralEditModal = () => document.getElementById("general-edit-modal").classList.remove("active");

window.saveGeneralEdit = async () => {
  const { type, id, extra } = currentEditData;
  try {
    if (type === 'project') {
      const title = document.getElementById("edit-val-proj-title").value.trim();
      if(title) await updateDoc(doc(db, "projects", id), { title });
      else return alert("專案名稱不可為空！");
    } else if (type === 'task') {
      const proj = allProjectsData.find(p => p.id === id); const tasks = [...proj.tasks];
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
      const updateData = { reportDate: document.getElementById("edit-val-date").value };
      if (weekly.items && weekly.items.length > 0) {
        const newItems = [...weekly.items];
        newItems.forEach((item, idx) => { item.content = document.getElementById(`edit-val-item-${idx}`).value.trim(); });
        updateData.items = newItems;
      } else updateData.content = document.getElementById("edit-val-content").value.trim();
      await updateDoc(doc(db, "weekly_reports", id), updateData);
    }
    closeGeneralEditModal(); alert("✅ 資料修改成功！");
  } catch (err) { alert("修改失敗：" + err.message); }
};

// ==========================================
// 🚀 組織管理與資料救援功能
// ==========================================
window.toggleUserEditPermission = async (uid, checked) => {
  if (currentUserData.role !== 'admin') return alert('權限不足！');
  try { await updateDoc(doc(db, "users", uid), { canEdit: checked }); } 
  catch(err) { alert('設定失敗：'+err.message); }
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
    for (let p of allProjectsData) { if (p.ownerName === userName && p.ownerId !== uid) { await updateDoc(doc(db, "projects", p.id), { ownerId: uid }); pCount++; } }
    for (let w of allWeeklyData) { if (w.ownerName === userName && w.ownerId !== uid) { await updateDoc(doc(db, "weekly_reports", w.id), { ownerId: uid }); wCount++; } }
    for (let a of allAdHocData) { if (a.ownerName === userName && a.ownerId !== uid) { await updateDoc(doc(db, "ad_hoc_events", a.id), { ownerId: uid }); } }
    alert(`🎉 救援成功！\n已為「${userName}」找回：\n- ${pCount} 個專案\n- ${wCount} 份週報\n請重新點擊左側人員檢視查看。`);
  } catch (err) { alert("救援失敗：" + err.message); }
};

function loadOrgUsers() {
  onSnapshot(collection(db, "users"), (snapshot) => {
    const tbody = document.getElementById("user-list-tbody"); const supervisorSelect = document.getElementById("new-user-supervisor");
    tbody.innerHTML = ""; supervisorSelect.innerHTML = '<option value="">-- 無 --</option>'; allUsersList = [];
    snapshot.forEach(docSnap => {
      const u = docSnap.data(); allUsersList.push({ uid: docSnap.id, ...u });
      if (["top_manager", "manager", "assistant_manager"].includes(u.role)) supervisorSelect.innerHTML += `<option value="${docSnap.id}">${u.name} (${roleNames[u.role] || u.role})</option>`;
    });
    allUsersList.forEach(u => {
      const supUser = allUsersList.find(x => x.uid === u.supervisorId); const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><strong>${u.name || '未命名'}</strong></td>
        <td>${u.email || '-'}</td>
        <td><span class="pill pill-role">${roleNames[u.role] || u.role}</span></td>
        <td>${supUser ? `${supUser.name}` : "-"}</td>
        <td>
          <label style="display:flex; align-items:center; gap:4px; cursor:pointer;">
            <input type="checkbox" onchange="toggleUserEditPermission('${u.uid}', this.checked)" ${u.canEdit ? 'checked' : ''} ${currentUserData.role === 'admin' ? '' : 'disabled'}>
            <span style="font-size:12px;">開放</span>
          </label>
        </td>
        <td>
          <button class="action-btn" onclick="openEditModal('${u.uid}')" style="margin-right:4px;">編輯</button>
          <button class="action-btn" onclick="resetUserPassword('${u.email}')" style="margin-right:4px;">重設密碼</button>
          <button class="action-btn" onclick="rescueUserProjects('${u.uid}', '${u.name}')" style="margin-right:4px; border-color:#f59e0b; color:#f59e0b;" title="找回建立錯ID的資料">找回資料</button>
          ${u.uid !== auth.currentUser.uid ? `<button class="action-btn danger" onclick="deleteUserDoc('${u.uid}', '${u.name}')">刪除</button>` : ''}
        </td>`;
      tbody.appendChild(tr);
    });
  });
}
document.getElementById("btn-create-user").addEventListener("click", async () => {
  const name = document.getElementById("new-user-name").value.trim(); const email = document.getElementById("new-user-email").value.trim(); const pass = document.getElementById("new-user-pass").value.trim();
  if (!name || !email || pass.length < 6) return alert("資料填寫不全或密碼太短！");
  try {
    const secApp = initializeApp(firebaseConfig, "Secondary"); const secAuth = getAuth(secApp);
    const userCred = await createUserWithEmailAndPassword(secAuth, email, pass); await signOut(secAuth);
    await setDoc(doc(db, "users", userCred.user.uid), { name, email, role: document.getElementById("new-user-role").value, supervisorId: document.getElementById("new-user-supervisor").value || null, createdAt: serverTimestamp() });
    alert(`人員 ${name} 建立成功！`);
  } catch (err) { alert("建立失敗: " + err.message); }
});
window.openEditModal = (uid) => {
  const u = allUsersList.find(x => x.uid === uid);
  document.getElementById("edit-user-uid").value = u.uid; document.getElementById("edit-user-name").value = u.name || ''; document.getElementById("edit-user-role").value = u.role || 'staff';
  const supSelect = document.getElementById("edit-user-supervisor"); supSelect.innerHTML = '<option value="">-- 無 --</option>';
  allUsersList.forEach(user => { if (user.uid !== uid && ["top_manager", "manager", "assistant_manager"].includes(user.role)) supSelect.innerHTML += `<option value="${user.uid}">${user.name}</option>`; });
  supSelect.value = u.supervisorId || ''; document.getElementById("edit-user-modal").classList.add("active");
};
window.closeEditModal = () => document.getElementById("edit-user-modal").classList.remove("active");
window.submitEditUser = async () => {
  try {
    await updateDoc(doc(db, "users", document.getElementById("edit-user-uid").value), { name: document.getElementById("edit-user-name").value.trim(), role: document.getElementById("edit-user-role").value, supervisorId: document.getElementById("edit-user-supervisor").value || null });
    closeEditModal(); alert("人員資訊更新成功！");
  } catch (err) { alert("更新失敗: " + err.message); }
};
window.deleteUserDoc = async (uid, name) => { if (confirm(`確定刪除 ${name} 嗎？`)) { try { await deleteDoc(doc(db, "users", uid)); alert(`已移除 ${name}！`); } catch (err) { alert("刪除失敗: " + err.message); } } };
