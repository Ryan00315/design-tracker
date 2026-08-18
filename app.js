import { initializeApp } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-app.js";
import { 
  getAuth, 
  signInWithEmailAndPassword, 
  signOut, 
  onAuthStateChanged,
  updatePassword,
  createUserWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/10.9.0/firebase-auth.js";
import { 
  getFirestore, 
  doc, 
  getDoc, 
  setDoc,
  deleteDoc,
  collection, 
  addDoc, 
  updateDoc, 
  query, 
  where, 
  onSnapshot, 
  serverTimestamp 
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

// 職稱代碼轉換
const roleNames = {
  admin: "系統管理員",
  top_manager: "高級主管",
  manager: "主管",
  assistant_manager: "副主管",
  staff: "人員"
};

let currentUserData = { role: "staff", name: "" };
let allUsersList = [];

// 分頁切換
window.switchNav = (tabId, title, elem) => {
  document.querySelectorAll('.tab-pane').forEach(el => el.style.display = 'none');
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  document.getElementById(tabId).style.display = 'block';
  if (elem) elem.classList.add('active'); // 因為點擊齒輪時 elem 會傳入 null，所以加上檢查避免報錯
  document.getElementById('current-title').innerText = title;
};

// 登入狀態監聽
onAuthStateChanged(auth, async (user) => {
  if (user) {
    document.getElementById("auth-section").style.display = "none";
    document.getElementById("app-section").style.display = "flex";

    try {
      const userDoc = await getDoc(doc(db, "users", user.uid));
      if (userDoc.exists()) {
        currentUserData = userDoc.data();
      } else {
        currentUserData = { name: user.email.split('@')[0], role: "admin" };
        await setDoc(doc(db, "users", user.uid), currentUserData, { merge: true });
      }
    } catch (e) {
      console.warn("無法取得用戶特定角色，使用預設", e);
      currentUserData = { name: user.email.split('@')[0], role: "admin" };
    }

    const displayName = currentUserData.name || user.email.split('@')[0];
    document.getElementById("user-display-name").innerText = displayName;
    document.getElementById("user-avatar").innerText = displayName.charAt(0).toUpperCase();
    document.getElementById("user-role-badge").innerText = roleNames[currentUserData.role] || (currentUserData.role || "STAFF").toUpperCase();

    // 只有 Admin 顯示組織管理選單與分隔線
    if (currentUserData.role === "admin") {
      document.getElementById("nav-org-manage").style.display = "flex";
      document.getElementById("nav-divider-org").style.display = "block";
      loadOrgUsers();
    } else {
      document.getElementById("nav-org-manage").style.display = "none";
      document.getElementById("nav-divider-org").style.display = "none";
    }

    loadProjects();
    loadAdHocEvents();
  } else {
    document.getElementById("auth-section").style.display = "flex";
    document.getElementById("app-section").style.display = "none";
  }
});

// 登入事件
document.getElementById("btn-login").addEventListener("click", () => {
  const email = document.getElementById("login-email").value.trim();
  const pass = document.getElementById("login-password").value.trim();
  if (!email || !pass) return alert("請輸入信箱與密碼！");

  signInWithEmailAndPassword(auth, email, pass).catch(err => {
    alert("登入失敗: " + err.message);
  });
});

// 登出事件
document.getElementById("btn-logout").addEventListener("click", () => signOut(auth));

/* ================= 1. 個人帳號設定 (僅限改密碼) ================= */
document.getElementById("btn-update-password").addEventListener("click", async () => {
  const newPass = document.getElementById("profile-new-pass").value;
  const confirmPass = document.getElementById("profile-confirm-pass").value;

  if (!newPass || newPass.length < 6) return alert("新密碼長度至少需 6 碼！");
  if (newPass !== confirmPass) return alert("兩次輸入的新密碼不一致！");

  try {
    await updatePassword(auth.currentUser, newPass);
    document.getElementById("profile-new-pass").value = "";
    document.getElementById("profile-confirm-pass").value = "";
    alert("密碼變更成功！請妥善保存。");
  } catch (err) {
    alert("密碼更新失敗 (若登入時間過久需重新登入驗證): " + err.message);
  }
});

/* ================= 2. 組織架構與人員管理 (僅 Admin) ================= */
function loadOrgUsers() {
  onSnapshot(collection(db, "users"), (snapshot) => {
    const tbody = document.getElementById("user-list-tbody");
    const supervisorSelect = document.getElementById("new-user-supervisor");
    tbody.innerHTML = "";
    supervisorSelect.innerHTML = '<option value="">-- 無 (或由最高主管管轄) --</option>';
    allUsersList = [];

    snapshot.forEach(docSnap => {
      const u = docSnap.data();
      const uid = docSnap.id;
      allUsersList.push({ uid, ...u });

      if (["top_manager", "manager", "assistant_manager"].includes(u.role)) {
        supervisorSelect.innerHTML += `<option value="${uid}">${u.name} (${roleNames[u.role] || u.role})</option>`;
      }
    });

    allUsersList.forEach(u => {
      const supUser = allUsersList.find(x => x.uid === u.supervisorId);
      const supName = supUser ? `${supUser.name} (${roleNames[supUser.role]})` : "-";

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><strong>${u.name || '未命名'}</strong></td>
        <td>${u.email || '-'}</td>
        <td><span class="pill pill-role">${roleNames[u.role] || u.role}</span></td>
        <td>${supName}</td>
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
  const role = document.getElementById("new-user-role").value;
  const supervisorId = document.getElementById("new-user-supervisor").value;

  if (!name || !email || !pass) return alert("請完整填寫姓名、帳號與密碼！");
  if (pass.length < 6) return alert("密碼長度至少需 6 碼！");

  try {
    const secondaryApp = initializeApp(firebaseConfig, "Secondary");
    const secondaryAuth = getAuth(secondaryApp);
    const userCredential = await createUserWithEmailAndPassword(secondaryAuth, email, pass);
    const newUid = userCredential.user.uid;
    await signOut(secondaryAuth);

    await setDoc(doc(db, "users", newUid), {
      name, email, role,
      supervisorId: supervisorId || null,
      createdAt: serverTimestamp()
    });

    document.getElementById("new-user-name").value = "";
    document.getElementById("new-user-email").value = "";
    document.getElementById("new-user-pass").value = "";
    alert(`人員 ${name} (${roleNames[role]}) 建立成功！`);
  } catch (err) {
    alert("建立失敗: " + err.message);
  }
});

window.openEditModal = (uid) => {
  const u = allUsersList.find(x => x.uid === uid);
  if (!u) return;

  document.getElementById("edit-user-uid").value = u.uid;
  document.getElementById("edit-user-name").value = u.name || '';
  document.getElementById("edit-user-role").value = u.role || 'staff';

  const supSelect = document.getElementById("edit-user-supervisor");
  supSelect.innerHTML = '<option value="">-- 無 (或由最高主管管轄) --</option>';
  allUsersList.forEach(user => {
    if (user.uid !== uid && ["top_manager", "manager", "assistant_manager"].includes(user.role)) {
      supSelect.innerHTML += `<option value="${user.uid}">${user.name} (${roleNames[user.role]})</option>`;
    }
  });
  supSelect.value = u.supervisorId || '';
  document.getElementById("edit-user-modal").classList.add("active");
};

window.closeEditModal = () => {
  document.getElementById("edit-user-modal").classList.remove("active");
};

window.submitEditUser = async () => {
  const uid = document.getElementById("edit-user-uid").value;
  const name = document.getElementById("edit-user-name").value.trim();
  const role = document.getElementById("edit-user-role").value;
  const supervisorId = document.getElementById("edit-user-supervisor").value;

  if (!name) return alert("姓名不能為空！");

  try {
    await updateDoc(doc(db, "users", uid), {
      name, role, supervisorId: supervisorId || null
    });
    alert("人員資訊已成功更新！");
    closeEditModal();
  } catch (err) {
    alert("更新失敗: " + err.message);
  }
};

window.deleteUserDoc = async (uid, name) => {
  if (confirm(`確定要刪除人員「${name}」的系統資料與權限嗎？`)) {
    try {
      await deleteDoc(doc(db, "users", uid));
      alert(`已成功移除 ${name}！`);
    } catch (err) {
      alert("刪除失敗: " + err.message);
    }
  }
};

/* ================= 3. 專案進度、甘特圖與部屬權限過濾 ================= */
function loadProjects() {
  let q = query(collection(db, "projects"));

  onSnapshot(q, (snapshot) => {
    const tbody = document.getElementById("project-list-tbody");
    tbody.innerHTML = "";
    const ganttTasks = [];
    let ongoingCount = 0; let completedCount = 0; let delayCount = 0;

    snapshot.forEach(docSnap => {
      const proj = docSnap.data();
      const pId = docSnap.id;
      const task = proj.tasks ? proj.tasks[0] : null;
      if (!task) return;

      if (currentUserData.role === "staff" && proj.ownerId !== auth.currentUser.uid) {
        return;
      }

      if (task.isCompleted) {
        completedCount++;
        if (task.delayReason) delayCount++;
      } else {
        ongoingCount++;
      }

      ganttTasks.push({
        id: pId, name: `${proj.title} - ${task.name}`, start: task.start, end: task.end, progress: task.isCompleted ? 100 : 0
      });

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><strong>${proj.title}</strong><br><small style="color:var(--text-muted)">${task.name}</small></td>
        <td>${proj.ownerName || '未指定'} <small style="color:var(--text-muted)">(${roleNames[proj.ownerRole] || proj.ownerRole || '人員'})</small></td>
        <td>${task.start} 至 ${task.end}</td>
        <td>${task.isCompleted ? '<span class="pill pill-success">已完成</span>' : '<span class="pill pill-warning">進行中</span>'}</td>
        <td>${task.completedAt ? `<small>${task.completedAt}</small><br>` : ''}${task.delayReason ? `<span class="pill pill-danger">Delay: ${task.delayReason}</span>` : '-'}</td>
        <td>${!task.isCompleted ? `<button class="action-btn" onclick="completeTask('${pId}', '${task.end}')">完成任務</button>` : '<span style="color:#94a3b8;">已結案</span>'}</td>
      `;
      tbody.appendChild(tr);
    });

    document.getElementById("stat-ongoing").innerText = ongoingCount;
    document.getElementById("stat-completed").innerText = completedCount;
    document.getElementById("stat-delay").innerText = delayCount;

    if (ganttTasks.length > 0) {
      document.getElementById("gantt-chart").innerHTML = "";
      new Gantt("#gantt-chart", ganttTasks, { view_mode: 'Day', language: 'zh' });
    }
  });
}

document.getElementById("btn-add-project").addEventListener("click", async () => {
  const title = document.getElementById("proj-name").value.trim();
  const taskName = document.getElementById("task-name").value.trim();
  const start = document.getElementById("task-start").value;
  const end = document.getElementById("task-end").value;

  if (!title || !taskName || !start || !end) return alert("請完整填寫所有欄位！");

  await addDoc(collection(db, "projects"), {
    title, ownerId: auth.currentUser.uid, ownerName: currentUserData.name || auth.currentUser.email,
    ownerRole: currentUserData.role || "staff", isLocked: true,
    tasks: [{ id: "t_1", name: taskName, start, end, isCompleted: false, completedAt: null, delayReason: "" }],
    createdAt: serverTimestamp()
  });

  document.getElementById("proj-name").value = "";
  document.getElementById("task-name").value = "";
  alert("專案已成功建立並鎖定！");
});

window.completeTask = async (projId, plannedEnd) => {
  const today = new Date().toISOString().split('T')[0];
  let delayReason = "";

  if (today > plannedEnd) {
    delayReason = prompt("此任務已超出預計完成日，請填寫 Delay 原因：");
    if (!delayReason) return alert("必須填寫原因才能完成！");
  }

  const projRef = doc(db, "projects", projId);
  const projSnap = await getDoc(projRef);
  const tasks = projSnap.data().tasks;
  tasks[0].isCompleted = true;
  tasks[0].completedAt = new Date().toLocaleString();
  tasks[0].delayReason = delayReason;

  await updateDoc(projRef, { tasks });
};

/* ================= 4. 臨時事件與週報 ================= */
document.getElementById("btn-add-adhoc").addEventListener("click", async () => {
  const title = document.getElementById("adhoc-title").value.trim();
  const reason = document.getElementById("adhoc-reason").value.trim();
  if (!title || !reason) return alert("請完整填寫事項與原因！");

  await addDoc(collection(db, "ad_hoc_events"), {
    ownerId: auth.currentUser.uid, ownerName: currentUserData.name || auth.currentUser.email,
    title, reason, startDateTime: new Date().toLocaleString(), isCompleted: false, completedAt: null,
    createdAt: serverTimestamp()
  });

  document.getElementById("adhoc-title").value = "";
  document.getElementById("adhoc-reason").value = "";
  alert("臨時事件已登記！");
});

function loadAdHocEvents() {
  onSnapshot(query(collection(db, "ad_hoc_events")), (snapshot) => {
    const tbody = document.getElementById("adhoc-list-tbody");
    tbody.innerHTML = "";
    snapshot.forEach(docSnap => {
      const evt = docSnap.data();
      const id = docSnap.id;
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><strong>${evt.title}</strong></td><td>${evt.reason}</td><td>${evt.startDateTime}</td>
        <td>${evt.isCompleted ? '<span class="pill pill-success">已完成</span>' : '<span class="pill pill-warning">處理中</span>'}</td>
        <td>${!evt.isCompleted ? `<button class="action-btn" onclick="completeAdHoc('${id}')">點選完成</button>` : '<span style="color:#94a3b8;">已結案</span>'}</td>
      `;
      tbody.appendChild(tr);
    });
  });
}

window.completeAdHoc = async (id) => {
  await updateDoc(doc(db, "ad_hoc_events", id), {
    isCompleted: true, completedAt: new Date().toLocaleString()
  });
};

document.getElementById("btn-add-weekly").addEventListener("click", async () => {
  const start = document.getElementById("rep-start").value;
  const end = document.getElementById("rep-end").value;
  const content = document.getElementById("rep-content").value.trim();

  if (!start || !end || !content) return alert("請完整填寫週報內容！");

  await addDoc(collection(db, "weekly_reports"), {
    ownerId: auth.currentUser.uid, ownerName: currentUserData.name || auth.currentUser.email,
    startDate: start, endDate: end, content,
    createdAt: serverTimestamp()
  });

  document.getElementById("rep-content").value = "";
  alert("週報已送出！");
});
