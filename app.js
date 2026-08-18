import { initializeApp } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-app.js";
import { 
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged,
  updatePassword, createUserWithEmailAndPassword
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
let currentUserData = { role: "staff", name: "" };
let allUsersList = [];

// === 介面切換 ===
window.switchNav = (tabId, title, elem) => {
  document.querySelectorAll('.tab-pane').forEach(el => el.style.display = 'none');
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  document.getElementById(tabId).style.display = 'block';
  if (elem) elem.classList.add('active');
  document.getElementById('current-title').innerText = title;
};

// 顯示/隱藏 新增專案表單
document.getElementById('btn-toggle-create').addEventListener('click', () => {
  const form = document.getElementById('create-project-section');
  form.style.display = form.style.display === 'none' ? 'block' : 'none';
});

// === 登入監聽 ===
onAuthStateChanged(auth, async (user) => {
  if (user) {
    document.getElementById("auth-section").style.display = "none";
    document.getElementById("app-section").style.display = "flex";

    try {
      const userDoc = await getDoc(doc(db, "users", user.uid));
      if (userDoc.exists()) currentUserData = userDoc.data();
      else {
        currentUserData = { name: user.email.split('@')[0], role: "admin" };
        await setDoc(doc(db, "users", user.uid), currentUserData, { merge: true });
      }
    } catch (e) {
      currentUserData = { name: user.email.split('@')[0], role: "admin" };
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

    addTaskRow(); // 初始化一筆空白任務
    loadProjects();
    loadAdHocEvents();
  } else {
    document.getElementById("auth-section").style.display = "flex";
    document.getElementById("app-section").style.display = "none";
  }
});

document.getElementById("btn-login").addEventListener("click", () => {
  const email = document.getElementById("login-email").value.trim();
  const pass = document.getElementById("login-password").value.trim();
  if (!email || !pass) return alert("請輸入信箱與密碼！");
  signInWithEmailAndPassword(auth, email, pass).catch(err => alert("登入失敗: " + err.message));
});
document.getElementById("btn-logout").addEventListener("click", () => signOut(auth));

document.getElementById("btn-update-password").addEventListener("click", async () => {
  const newPass = document.getElementById("profile-new-pass").value;
  const confirmPass = document.getElementById("profile-confirm-pass").value;
  if (!newPass || newPass.length < 6) return alert("新密碼長度至少需 6 碼！");
  if (newPass !== confirmPass) return alert("兩次輸入的新密碼不一致！");
  try {
    await updatePassword(auth.currentUser, newPass);
    alert("密碼變更成功！請妥善保存。");
    document.getElementById("profile-new-pass").value = "";
    document.getElementById("profile-confirm-pass").value = "";
  } catch (err) { alert("密碼更新失敗: " + err.message); }
});

// === 動態任務細項與工作日檢查 ===
function getNextWorkingDay(dateStr) {
  if (!dateStr) return '';
  let d = new Date(dateStr);
  d.setDate(d.getDate() + 1); // 預設 +1 天
  while (d.getDay() === 0 || d.getDay() === 6) { d.setDate(d.getDate() + 1); } // 閃避週末
  return d.toISOString().split('T')[0];
}

window.checkWorkingDay = (input) => {
  if (!input.value) return;
  const d = new Date(input.value);
  if (d.getDay() === 0 || d.getDay() === 6) {
    alert("系統規定僅能選擇工作日 (週一至週五)！");
    input.value = '';
  }
};

window.addTaskRow = () => {
  const container = document.getElementById("task-list-container");
  const rows = container.querySelectorAll('.task-row');
  let defaultStart = "";
  
  if (rows.length > 0) {
    const lastEnd = rows[rows.length - 1].querySelector('.task-end').value;
    defaultStart = getNextWorkingDay(lastEnd);
  }

  const div = document.createElement('div');
  div.className = "form-row task-row";
  div.style.marginBottom = "8px";
  div.innerHTML = `
    <div class="form-group" style="margin:0; flex:2;"><input type="text" class="input-control task-name" placeholder="任務細項名稱"></div>
    <div class="form-group" style="margin:0; flex:1;"><input type="date" class="input-control task-start" value="${defaultStart}" onchange="checkWorkingDay(this)"></div>
    <div class="form-group" style="margin:0; flex:1;"><input type="date" class="input-control task-end" onchange="checkWorkingDay(this)"></div>
    <div class="form-group" style="margin:0; max-width: 40px;"><button class="action-btn danger" onclick="this.parentElement.parentElement.remove()" style="padding: 10px;">X</button></div>
  `;
  container.appendChild(div);
};

// === 專案過濾與渲染邏輯 ===
let allProjectsData = [];
let currentFilter = 'ongoing'; // 'ongoing' | 'completed'
let selectedProjectId = null;

window.setProjectFilter = (status) => {
  currentFilter = status;
  document.getElementById('filter-ongoing').classList.toggle('active', status === 'ongoing');
  document.getElementById('filter-completed').classList.toggle('active', status === 'completed');
  selectedProjectId = null; // 重置選擇
  renderProjects();
};

window.selectProject = (projId) => {
  selectedProjectId = projId;
  renderProjects();
};

function loadProjects() {
  onSnapshot(query(collection(db, "projects")), (snapshot) => {
    allProjectsData = [];
    snapshot.forEach(docSnap => {
      const proj = { id: docSnap.id, ...docSnap.data() };
      // 權限過濾：人員只能看到自己的專案
      if (currentUserData.role === "staff" && proj.ownerId !== auth.currentUser.uid) return;
      allProjectsData.push(proj);
    });
    renderProjects();
  });
}

function renderProjects() {
  const tabsContainer = document.getElementById("project-tabs-container");
  const detailView = document.getElementById("project-detail-view");
  const emptyState = document.getElementById("empty-state");
  tabsContainer.innerHTML = "";

  // 1. 分類過濾 (如果所有任務都 isCompleted = true 代表已完成)
  const filteredProjects = allProjectsData.filter(p => {
    if (!p.tasks || p.tasks.length === 0) return false;
    const isAllDone = p.tasks.every(t => t.isCompleted);
    return currentFilter === 'completed' ? isAllDone : !isAllDone;
  });

  if (filteredProjects.length === 0) {
    detailView.style.display = "none";
    emptyState.style.display = "block";
    return;
  }

  // 2. 確保有選中專案
  if (!selectedProjectId || !filteredProjects.find(p => p.id === selectedProjectId)) {
    selectedProjectId = filteredProjects[0].id;
  }

  // 3. 渲染按鈕 Tabs
  filteredProjects.forEach(p => {
    const btn = document.createElement("button");
    btn.className = `proj-tab ${p.id === selectedProjectId ? 'active' : ''}`;
    btn.innerText = p.title;
    btn.onclick = () => selectProject(p.id);
    tabsContainer.appendChild(btn);
  });

  emptyState.style.display = "none";
  detailView.style.display = "block";

  // 4. 渲染選中專案的細項與甘特圖
  const activeProj = filteredProjects.find(p => p.id === selectedProjectId);
  document.getElementById("current-gantt-title").innerText = `專案：${activeProj.title}`;
  
  // 最高主管/管理員 顯示解鎖按鈕
  const lockBtn = document.getElementById("btn-toggle-lock");
  if (currentUserData.role === "admin" || currentUserData.role === "top_manager") {
    lockBtn.style.display = "inline-block";
    lockBtn.innerText = activeProj.isLocked ? "目前鎖定中 (點擊解鎖編輯)" : "已開放編輯 (點擊鎖定)";
    lockBtn.className = activeProj.isLocked ? "action-btn" : "action-btn danger";
  } else {
    lockBtn.style.display = "none";
  }

  const tbody = document.getElementById("project-list-tbody");
  tbody.innerHTML = "";
  const ganttTasks = [];

  activeProj.tasks.forEach((task, index) => {
    ganttTasks.push({
      id: `t_${index}`,
      name: task.name,
      start: task.start,
      end: task.end,
      progress: task.isCompleted ? 100 : 0,
      custom_class: task.isCompleted ? 'bar-success' : ''
    });

    // 判斷是否可編輯任務預計日 (需解鎖)
    const canEditDates = !activeProj.isLocked;

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><strong>${task.name}</strong></td>
      <td>
        ${task.start} 至 ${task.end}
        ${canEditDates && !task.isCompleted ? `<br><button class="action-btn" style="padding:2px 6px; font-size:10px; margin-top:4px;" onclick="editTaskDate('${activeProj.id}', ${index}, '${task.end}')">修改日期</button>` : ''}
      </td>
      <td>${task.isCompleted ? '<span class="pill pill-success">已完成</span>' : '<span class="pill pill-warning">進行中</span>'}</td>
      <td>${task.completedAt ? `<small>${task.completedAt}</small><br>` : ''}${task.delayReason ? `<span class="pill pill-danger">Delay: ${task.delayReason}</span>` : '-'}</td>
      <td>${!task.isCompleted ? `<button class="action-btn" onclick="completeTask('${activeProj.id}', ${index}, '${task.end}')">標記完成</button>` : '<span style="color:#94a3b8;">結案</span>'}</td>
    `;
    tbody.appendChild(tr);
  });

  if (ganttTasks.length > 0) {
    document.getElementById("gantt-chart").innerHTML = "";
    new Gantt("#gantt-chart", ganttTasks, { view_mode: 'Day', language: 'zh' });
  }
}

// 提交新專案
document.getElementById("btn-add-project").addEventListener("click", async () => {
  const title = document.getElementById("proj-name").value.trim();
  if (!title) return alert("請填寫主專案名稱！");

  const taskRows = document.querySelectorAll('.task-row');
  const tasks = [];
  
  for (let row of taskRows) {
    const name = row.querySelector('.task-name').value.trim();
    const start = row.querySelector('.task-start').value;
    const end = row.querySelector('.task-end').value;
    if (!name || !start || !end) return alert("任務細項不可有空白欄位！");
    if (start > end) return alert(`任務 [${name}] 的起始日不可大於完成日！`);
    
    tasks.push({
      name, start, end,
      isCompleted: false, completedAt: null, delayReason: ""
    });
  }

  if (tasks.length === 0) return alert("請至少新增一筆任務細項！");

  await addDoc(collection(db, "projects"), {
    title, ownerId: auth.currentUser.uid, ownerName: currentUserData.name || auth.currentUser.email,
    ownerRole: currentUserData.role || "staff", isLocked: true,
    tasks: tasks,
    createdAt: serverTimestamp()
  });

  document.getElementById("proj-name").value = "";
  document.getElementById("task-list-container").innerHTML = "";
  addTaskRow(); // 補回預設的一行
  document.getElementById('create-project-section').style.display = 'none';
  alert("專案已成功建立並鎖定！");
});

// 解鎖/鎖定專案 (Admin / Top Manager)
window.toggleCurrentProjectLock = async () => {
  if (!selectedProjectId) return;
  const proj = allProjectsData.find(p => p.id === selectedProjectId);
  if (!proj) return;

  const newStatus = !proj.isLocked;
  await updateDoc(doc(db, "projects", proj.id), { isLocked: newStatus });
};

// 編輯預計完成日 (必須為解鎖狀態)
window.editTaskDate = async (projId, taskIndex, oldEnd) => {
  const newEnd = prompt("請輸入新的預計完成日期 (格式 YYYY-MM-DD)：", oldEnd);
  if (!newEnd || newEnd === oldEnd) return;
  
  const d = new Date(newEnd);
  if (isNaN(d.getTime())) return alert("日期格式錯誤！");
  if (d.getDay() === 0 || d.getDay() === 6) return alert("完成日僅能設定為工作日 (週一至週五)！");

  const proj = allProjectsData.find(p => p.id === projId);
  const tasks = [...proj.tasks];
  tasks[taskIndex].end = newEnd;

  await updateDoc(doc(db, "projects", projId), { tasks });
  alert("日期已更新！");
};

// 完成任務 (附帶 Delay 檢查)
window.completeTask = async (projId, taskIndex, plannedEnd) => {
  const today = new Date().toISOString().split('T')[0];
  let delayReason = "";

  if (today > plannedEnd) {
    delayReason = prompt("此任務已超出預計完成日，請填寫 Delay 原因：");
    if (!delayReason) return alert("必須填寫原因才能完成！");
  }

  const proj = allProjectsData.find(p => p.id === projId);
  const tasks = [...proj.tasks];
  tasks[taskIndex].isCompleted = true;
  tasks[taskIndex].completedAt = new Date().toLocaleString();
  tasks[taskIndex].delayReason = delayReason;

  await updateDoc(doc(db, "projects", projId), { tasks });
};


/* ================= 組織、事件、週報 (維持不變) ================= */
function loadOrgUsers() {
  onSnapshot(collection(db, "users"), (snapshot) => {
    const tbody = document.getElementById("user-list-tbody");
    const supervisorSelect = document.getElementById("new-user-supervisor");
    tbody.innerHTML = ""; supervisorSelect.innerHTML = '<option value="">-- 無 --</option>';
    allUsersList = [];

    snapshot.forEach(docSnap => {
      const u = docSnap.data();
      allUsersList.push({ uid: docSnap.id, ...u });
      if (["top_manager", "manager", "assistant_manager"].includes(u.role)) {
        supervisorSelect.innerHTML += `<option value="${docSnap.id}">${u.name} (${roleNames[u.role] || u.role})</option>`;
      }
    });

    allUsersList.forEach(u => {
      const supUser = allUsersList.find(x => x.uid === u.supervisorId);
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><strong>${u.name || '未命名'}</strong></td><td>${u.email || '-'}</td>
        <td><span class="pill pill-role">${roleNames[u.role] || u.role}</span></td>
        <td>${supUser ? `${supUser.name}` : "-"}</td>
        <td>
          <button class="action-btn" onclick="openEditModal('${u.uid}')" style="margin-right:6px;">編輯</button>
          ${u.uid !== auth.currentUser.uid ? `<button class="action-btn danger" onclick="deleteUserDoc('${u.uid}', '${u.name}')">刪除</button>` : ''}
        </td>
      `;
      tbody.appendChild(tr);
    });
  });
}

document.getElementById("btn-create-user").addEventListener("click", async () => {
  const name = document.getElementById("new-user-name").value.trim();
  const email = document.getElementById("new-user-email").value.trim();
  const pass = document.getElementById("new-user-pass").value.trim();
  if (!name || !email || pass.length < 6) return alert("資料填寫不全或密碼太短！");
  try {
    const secApp = initializeApp(firebaseConfig, "Secondary");
    const secAuth = getAuth(secApp);
    const userCred = await createUserWithEmailAndPassword(secAuth, email, pass);
    await signOut(secAuth);
    await setDoc(doc(db, "users", userCred.user.uid), {
      name, email, role: document.getElementById("new-user-role").value,
      supervisorId: document.getElementById("new-user-supervisor").value || null,
      createdAt: serverTimestamp()
    });
    alert(`人員 ${name} 建立成功！`);
  } catch (err) { alert("建立失敗: " + err.message); }
});

window.openEditModal = (uid) => {
  const u = allUsersList.find(x => x.uid === uid);
  document.getElementById("edit-user-uid").value = u.uid;
  document.getElementById("edit-user-name").value = u.name || '';
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
    await updateDoc(doc(db, "users", document.getElementById("edit-user-uid").value), {
      name: document.getElementById("edit-user-name").value.trim(),
      role: document.getElementById("edit-user-role").value,
      supervisorId: document.getElementById("edit-user-supervisor").value || null
    });
    closeEditModal(); alert("人員資訊更新成功！");
  } catch (err) { alert("更新失敗: " + err.message); }
};
window.deleteUserDoc = async (uid, name) => {
  if (confirm(`確定刪除 ${name} 嗎？`)) {
    try { await deleteDoc(doc(db, "users", uid)); alert(`已移除 ${name}！`); }
    catch (err) { alert("刪除失敗: " + err.message); }
  }
};

document.getElementById("btn-add-adhoc").addEventListener("click", async () => {
  const title = document.getElementById("adhoc-title").value.trim();
  const reason = document.getElementById("adhoc-reason").value.trim();
  if (!title || !reason) return alert("請完整填寫！");
  await addDoc(collection(db, "ad_hoc_events"), {
    ownerId: auth.currentUser.uid, ownerName: currentUserData.name || auth.currentUser.email,
    title, reason, startDateTime: new Date().toLocaleString(), isCompleted: false, completedAt: null
  });
  alert("事件已登記！");
});
function loadAdHocEvents() {
  onSnapshot(query(collection(db, "ad_hoc_events")), (snapshot) => {
    const tbody = document.getElementById("adhoc-list-tbody");
    tbody.innerHTML = "";
    snapshot.forEach(docSnap => {
      const evt = docSnap.data();
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><strong>${evt.title}</strong></td><td>${evt.reason}</td><td>${evt.startDateTime}</td>
        <td>${evt.isCompleted ? '<span class="pill pill-success">已完成</span>' : '<span class="pill pill-warning">處理中</span>'}</td>
        <td>${!evt.isCompleted ? `<button class="action-btn" onclick="completeAdHoc('${docSnap.id}')">點選完成</button>` : '-'}</td>
      `;
      tbody.appendChild(tr);
    });
  });
}
window.completeAdHoc = async (id) => { await updateDoc(doc(db, "ad_hoc_events", id), { isCompleted: true, completedAt: new Date().toLocaleString() }); };

document.getElementById("btn-add-weekly").addEventListener("click", async () => {
  const start = document.getElementById("rep-start").value;
  const end = document.getElementById("rep-end").value;
  const content = document.getElementById("rep-content").value.trim();
  if (!start || !end || !content) return alert("請完整填寫週報內容！");
  await addDoc(collection(db, "weekly_reports"), {
    ownerId: auth.currentUser.uid, ownerName: currentUserData.name || auth.currentUser.email,
    startDate: start, endDate: end, content
  });
  alert("週報已送出！");
});
