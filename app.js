import { initializeApp } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-auth.js";
import { getFirestore, doc, getDoc, collection, addDoc, updateDoc, query, where, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-firestore.js";

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

let currentUserData = null;

// 分頁切換
window.switchTab = (tabId, element) => {
  document.querySelectorAll('.tab-pane').forEach(el => el.style.display = 'none');
  document.querySelectorAll('.menu-item').forEach(el => el.classList.remove('active'));
  document.getElementById(tabId).style.display = 'block';
  element.classList.add('active');
  document.getElementById("current-tab-title").innerText = element.innerText.trim();
};

// 身分驗證監聽
onAuthStateChanged(auth, async (user) => {
  if (user) {
    const userDoc = await getDoc(doc(db, "users", user.uid));
    currentUserData = userDoc.exists() ? userDoc.data() : { role: "designer", name: user.email };
    
    document.getElementById("user-display-name").innerText = currentUserData.name || user.email;
    document.getElementById("user-role-badge").innerText = currentUserData.role ? currentUserData.role.toUpperCase() : "STAFF";
    
    document.getElementById("auth-section").style.display = "none";
    document.getElementById("app-section").style.display = "flex";
    loadProjects();
  } else {
    document.getElementById("auth-section").style.display = "flex";
    document.getElementById("app-section").style.display = "none";
  }
});

// 登入
document.getElementById("btn-login").addEventListener("click", () => {
  const email = document.getElementById("login-email").value;
  const pass = document.getElementById("login-password").value;
  signInWithEmailAndPassword(auth, email, pass).catch(err => alert("登入失敗: " + err.message));
});

// 登出
document.getElementById("btn-logout").addEventListener("click", () => signOut(auth));

// 專案進度監聽與表格繪製
function loadProjects() {
  let q;
  if (currentUserData.role === "admin" || currentUserData.role === "top_manager") {
    q = query(collection(db, "projects"));
  } else {
    q = query(collection(db, "projects"), where("ownerId", "==", auth.currentUser.uid));
  }

  onSnapshot(q, (snapshot) => {
    const tbody = document.getElementById("project-list-tbody");
    tbody.innerHTML = "";
    const ganttTasks = [];

    snapshot.forEach(docSnap => {
      const proj = docSnap.data();
      const pId = docSnap.id;
      const task = proj.tasks ? proj.tasks[0] : null;
      if (!task) return;

      ganttTasks.push({
        id: pId,
        name: `${proj.title} - ${task.name}`,
        start: task.start,
        end: task.end,
        progress: task.isCompleted ? 100 : 0
      });

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><strong>${proj.title}</strong><br><small style="color:var(--text-muted)">${task.name}</small></td>
        <td>${proj.ownerName || '未指定'}</td>
        <td>${task.start} ~ ${task.end}</td>
        <td>${task.isCompleted ? '<span class="status-badge status-done">已完成</span>' : '<span class="status-badge status-ongoing">進行中</span>'}</td>
        <td>
          ${task.completedAt ? `完成於: ${task.completedAt}<br>` : ''}
          ${task.delayReason ? `<span class="status-badge status-delay">Delay: ${task.delayReason}</span>` : '-'}
        </td>
        <td>
          ${!task.isCompleted ? `<button class="btn btn-outline" style="padding:4px 8px; font-size:12px;" onclick="completeTask('${pId}', '${task.end}')">標記完成</button>` : '無'}
        </td>
      `;
      tbody.appendChild(tr);
    });

    if (ganttTasks.length > 0) {
      document.getElementById("gantt-chart").innerHTML = "";
      new Gantt("#gantt-chart", ganttTasks, { view_mode: 'Day', language: 'zh' });
    }
  });
}

// 建立專案
document.getElementById("btn-add-project").addEventListener("click", async () => {
  const title = document.getElementById("proj-name").value;
  const taskName = document.getElementById("task-name").value;
  const start = document.getElementById("task-start").value;
  const end = document.getElementById("task-end").value;

  if (!title || !taskName || !start || !end) return alert("請完整填寫專案欄位！");

  await addDoc(collection(db, "projects"), {
    title,
    ownerId: auth.currentUser.uid,
    ownerName: currentUserData.name,
    isLocked: true,
    tasks: [{
      id: "task_1",
      name: taskName,
      start,
      end,
      isCompleted: false,
      completedAt: null,
      delayReason: ""
    }],
    createdAt: serverTimestamp()
  });

  document.getElementById("proj-name").value = "";
  document.getElementById("task-name").value = "";
  alert("專案已建立並鎖定！");
});

// 完成任務
window.completeTask = async (projId, plannedEnd) => {
  const today = new Date().toISOString().split('T')[0];
  let delayReason = "";

  if (today > plannedEnd) {
    delayReason = prompt("已逾期，請填寫 Delay 原因：");
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
