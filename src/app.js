import { agentInfo, careers, challenges, questions, skills } from "./data.js";
import { analyzeCareer, analyzeSkills, executeCollaboration, mentorReply, runAgents } from "./agents/orchestrator.js";
import { clearStoredState, initialState, loadState, saveState } from "./store.js";

const app = document.querySelector("#app");
let curriculum = { path: {}, modules: [] };
let curriculumLoadError = "";
let careerCurricula = { tracks: [] };
let careerCurriculaLoadError = "";
try {
  const curriculumResponse = await fetch("./src/curriculum.json");
  if (!curriculumResponse.ok) throw new Error(`Curriculum request failed with status ${curriculumResponse.status}.`);
  curriculum = await curriculumResponse.json();
} catch (error) {
  console.error("Could not load CyberPath learning materials.", error);
  curriculumLoadError = "Learning materials could not be loaded. Refresh the page or check the local server.";
}
try {
  const careerCurriculaResponse = await fetch("./src/career-curricula.json");
  if (!careerCurriculaResponse.ok) throw new Error(`Career curriculum request failed with status ${careerCurriculaResponse.status}.`);
  careerCurricula = await careerCurriculaResponse.json();
} catch (error) {
  console.error("Could not load additional career learning materials.", error);
  careerCurriculaLoadError = "Additional career paths could not be loaded. The SOC Analyst curriculum is still available.";
}
const state = loadState();
let route = "dashboard";
let learningHubTrackId = null;
let learningHubModuleId = null;
let learningHubTopicId = null;
function decodeRoutePart(value = "") {
  try {
    return decodeURIComponent(value);
  } catch (error) {
    console.error("Could not decode a learning route.", error);
    return value;
  }
}
function setRouteFromHash(hash = location.hash.slice(1)) {
  const parts = hash.split("/");
  route = parts[0] || "dashboard";
  learningHubTrackId = null;
  learningHubModuleId = null;
  learningHubTopicId = null;
  if (route !== "learning-hub") return;
  const requestedPath = decodeRoutePart(parts[1] || "");
  const legacyModule = curriculum.modules.find((module) => module.id === requestedPath);
  if (legacyModule) {
    learningHubTrackId = curriculum.path.id || "soc-analyst";
    learningHubModuleId = legacyModule.id;
    learningHubTopicId = decodeRoutePart(parts[2] || "") || null;
    return;
  }
  learningHubTrackId = requestedPath || null;
  learningHubModuleId = decodeRoutePart(parts[2] || "") || null;
  learningHubTopicId = decodeRoutePart(parts[3] || "") || null;
}
setRouteFromHash();
let questionIndex = 0;
let assessmentAnswers = state.assessments.at(-1)?.answers ? { __submitted: true } : {};
let toastTimer;
let workflowInProgress = false;
let workflowQueue = Promise.resolve();
let accountEditMode = false;
let isSignedOut = false;
let accountMenuOpener = null;
try {
  isSignedOut = sessionStorage.getItem("cyberpath-signed-out") === "true";
} catch (error) {
  console.error("Could not read local demo session state.", error);
}

const escapeHtml = (value = "") => String(value).replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[char]));
const skillName = (id) => skills.find((item) => item.id === id)?.name || id;
const percent = (value) => `${Math.round(value || 0)}%`;
const initials = (name = "Learner") => name.trim().split(/\s+/).slice(0, 2).map((part) => part[0] || "").join("").toUpperCase() || "L";
const learningPathHref = (trackId, moduleId = "", topicId = "") => {
  const parts = ["learning-hub", trackId, moduleId, topicId].filter(Boolean).map(encodeURIComponent);
  return `#${parts.join("/")}`;
};

function getLearningTracks() {
  const socTrack = {
    id: curriculum.path.id || "soc-analyst",
    careerId: "soc",
    title: curriculum.path.title || "SOC Analyst Learning Path",
    description: curriculum.path.description || "",
    levels: [{ id: "beginner", label: "SOC Analyst Foundation", description: "The existing 12-module SOC Analyst curriculum." }],
    modules: (curriculum.modules || []).map((module) => ({ ...module, level: "beginner" })),
  };
  return [socTrack, ...(careerCurricula.tracks || [])];
}

function isLearningModuleAvailable(module, trackId) {
  const hasPublishedMaterial = Boolean(module && module.status === "available" && module.lessons?.length && module.quiz?.length && module.pdf);
  if (!hasPublishedMaterial || trackId === "soc-analyst" || module.number === 1) return hasPublishedMaterial;
  const topics = module.lessons.flatMap((lesson) => lesson.topics || []);
  const introduction = module.learningIntroduction;
  return Boolean(
    introduction?.meaning && introduction?.whyLearn && introduction?.jobUse && introduction?.outcomes
    && module.learningObjectives?.length >= 4 && module.learningObjectives.length <= 6
    && module.moduleSummary && module.glossary?.length >= 8
    && module.keyConcepts?.length >= 4 && module.interviewQuestions?.length >= 4
    && module.revisionTopics?.length >= 4
    && topics.length >= 8 && topics.length <= 12
    && topics.every((topic) => topic.explanation && topic.steps?.length >= 4 && topic.example && topic.cyberExample
      && topic.terms?.length >= 3 && topic.mistakes && topic.keyPoints?.length >= 3 && topic.summary)
    && module.quiz.length >= 10
    && module.quiz.every((question) => question.choices?.length === 4 && Number.isInteger(question.answer)
      && question.explanation && question.distractorNote)
  );
}

function learningProgressFor(trackId) {
  return state.learningProgress?.[trackId] || { studiedTopics: [], lastTopic: null, quizResults: {}, quizAttempts: [] };
}

function mutableLearningProgressFor(trackId) {
  if (!state.learningProgress || typeof state.learningProgress !== "object" || Array.isArray(state.learningProgress)) {
    state.learningProgress = {};
  }
  if (!state.learningProgress[trackId] || typeof state.learningProgress[trackId] !== "object") {
    state.learningProgress[trackId] = { studiedTopics: [], lastTopic: null, quizResults: {}, quizAttempts: [] };
  }
  const progress = state.learningProgress[trackId];
  if (!Array.isArray(progress.studiedTopics)) progress.studiedTopics = [];
  if (!progress.quizResults || typeof progress.quizResults !== "object" || Array.isArray(progress.quizResults)) progress.quizResults = {};
  if (!Array.isArray(progress.quizAttempts)) progress.quizAttempts = [];
  return progress;
}

function logActivity(text) {
  state.activities.unshift({ text, date: new Date().toISOString() });
  state.activities = state.activities.slice(0, 25);
}

function persist(message) {
  const saved = saveState(state);
  if (!saved) showToast("Could not save your progress. Check browser storage settings.");
  else if (message) showToast(message);
  updateShell();
}

function startAgentWorkflow(options) {
  const execute = async () => {
    workflowInProgress = true;
    try {
      return await executeCollaboration(state, {
        ...options,
        onUpdate: () => {
          if (!saveState(state)) console.error("Could not save agent execution history.");
          updateShell();
          if (route === "agents") render();
        },
      });
    } catch (error) {
      console.error("Agent collaboration failed.", error);
      showToast(`Agent workflow failed: ${error instanceof Error ? error.message : String(error)}`);
      if (route === "agents") render();
      return null;
    } finally {
      workflowInProgress = false;
    }
  };
  const queuedRun = workflowQueue.then(execute, execute);
  workflowQueue = queuedRun.catch(() => {});
  return queuedRun;
}

function showToast(message) {
  const toast = document.querySelector("#toast");
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("visible"), 2600);
}

function updateShell() {
  const name = state.profile.name || "Learner";
  const sidebarUser = document.querySelector("#sidebar-user");
  sidebarUser.innerHTML = `<span class="avatar">${escapeHtml(initials(name))}</span><span><strong>${escapeHtml(name)}</strong><small>${escapeHtml(careers.find((item) => item.id === state.profile.careerGoal)?.title || "Learner")}</small></span><span class="account-trigger-chevron" aria-hidden="true">⌄</span>`;
  sidebarUser.setAttribute("aria-label", `Account menu for ${name}`);
  document.querySelector("#header-avatar").textContent = initials(name);
  document.querySelectorAll(".navigation a").forEach((link) => link.classList.toggle("active", link.dataset.route === route));
  document.querySelector("#page-title").textContent = ({
    dashboard: "Dashboard", profile: "My Profile", careers: "Career Explorer", assessment: "Skill Assessment",
    agents: "AI Agent Center", roadmap: "Learning Roadmap", "learning-hub": "Learning Hub",
    lab: "Cyber Lab", progress: "Progress Tracker", mentor: "AI Mentor",
    account: "My Account", settings: "Settings", "account-info": "Account Information",
  })[route] || "Dashboard";
}

function closeAccountMenu(restoreFocus = false) {
  const menu = document.querySelector("#account-menu");
  menu.hidden = true;
  document.querySelectorAll(".account-trigger").forEach((trigger) => trigger.setAttribute("aria-expanded", "false"));
  if (restoreFocus && accountMenuOpener?.isConnected) accountMenuOpener.focus();
  accountMenuOpener = null;
}

function openAccountMenu(trigger, focusFirst = false) {
  const menu = document.querySelector("#account-menu");
  accountMenuOpener = trigger;
  menu.hidden = false;
  document.querySelectorAll(".account-trigger").forEach((item) => item.setAttribute("aria-expanded", String(item === trigger)));
  const bounds = trigger.getBoundingClientRect();
  const width = menu.offsetWidth;
  const height = menu.offsetHeight;
  const left = Math.max(8, Math.min(bounds.right - width, window.innerWidth - width - 8));
  const top = bounds.bottom + height + 8 < window.innerHeight || bounds.top < height + 8
    ? bounds.bottom + 8
    : bounds.top - height - 8;
  menu.style.left = `${left}px`;
  menu.style.top = `${Math.max(8, Math.min(top, window.innerHeight - height - 8))}px`;
  if (focusFirst) menu.querySelector('[role="menuitem"]')?.focus();
}

function toggleAccountMenu(trigger, focusFirst = false) {
  const menu = document.querySelector("#account-menu");
  if (!menu.hidden && accountMenuOpener === trigger) closeAccountMenu();
  else openAccountMenu(trigger, focusFirst);
}

function pageHeader(eyebrow, title, description, action = "") {
  return `<section class="page-heading"><div><div class="eyebrow">${eyebrow}</div><h1>${title}</h1><p>${description}</p></div>${action}</section>`;
}

function statCard(label, value, note, icon, tone = "blue") {
  return `<article class="stat-card"><div class="stat-top"><span>${label}</span><span class="stat-icon ${tone}">${icon}</span></div><strong class="stat-value">${value}</strong><small>${note}</small></article>`;
}

function renderDashboard() {
  const result = runAgents(state);
  const latestAgentRun = state.agentRuns?.[0];
  const agentStatus = latestAgentRun?.status || "Waiting";
  const agentSummary = latestAgentRun
    ? `${latestAgentRun.summary || latestAgentRun.trigger} · ${latestAgentRun.agents.filter((agent) => agent.status === "Completed").length} of 5 agents completed.`
    : "No collaboration run has been recorded yet.";
  const completed = result.roadmap.filter((task) => task.completed).length;
  const roadmapProgress = result.roadmap.length ? Math.round(completed / result.roadmap.length * 100) : 0;
  const recentAssessment = state.assessments.at(-1);
  const nextTask = result.roadmap.find((task) => !task.completed);
  const recentActivity = state.activities.slice(0, 4);
  const gaps = [...result.career.gaps].sort((a, b) => b.gap - a.gap).slice(0, 4);
  return `${pageHeader("YOUR CYBERSECURITY JOURNEY", `Welcome back, ${escapeHtml(state.profile.name || "Learner")}`, "Your skill evidence, career fit and next steps — all in one place.", `<a class="button button-primary" href="#assessment">Take an assessment <span>→</span></a>`)}
    <section class="welcome-banner"><div><span class="pill pill-cyan">CURRENT CAREER GOAL</span><h2>${escapeHtml(result.career.career.title)}</h2><p>${escapeHtml(result.career.career.outlook)}</p><a href="#careers" class="text-link">Explore career paths <span>→</span></a></div><div class="banner-orbit"><div class="orbit-ring"></div><div class="orbit-core">✳</div><span class="orbit-label">LEARN<br>PROVE<br>GROW</span></div></section>
    <section class="stats-grid">${statCard("Overall skill score", percent(result.analysis.score), "Profile + demonstrated evidence", "◉", "purple")}${statCard("Career match", percent(result.career.score), `For ${escapeHtml(result.career.career.title)}`, "◎", "cyan")}${statCard("Skills mastered", `${result.analysis.strong.length}<span class="stat-denom"> / ${skills.length}</span>`, "At 70% estimated proficiency or above", "✦", "green")}${statCard("Roadmap progress", percent(roadmapProgress), `${completed} of ${result.roadmap.length} tasks complete`, "⌁", "orange")}</section>
    <section class="dashboard-grid"><article class="panel skill-panel"><div class="panel-heading"><div><span class="eyebrow">ROLE READINESS</span><h3>Skills to focus on</h3></div><a href="#careers" class="subtle-link">View career fit →</a></div>
    ${gaps.length ? gaps.map((item) => `<div class="skill-row"><div class="skill-row-title"><span>${escapeHtml(item.name)}</span><span>${percent(item.proficiency)} <small>/ ${item.required}% target</small></span></div><div class="progress-track"><span style="width:${Math.min(100, item.proficiency)}%"></span><i style="left:${Math.min(100, item.required)}%"></i></div></div>`).join("") : `<div class="empty-state compact">No role gaps identified yet. Complete an assessment to improve the evidence behind this estimate.</div>`}
    <div class="panel-action"><a href="#roadmap" class="button button-secondary">Open my learning roadmap</a></div></article>
    <article class="panel next-panel"><div class="panel-heading"><div><span class="eyebrow">YOUR NEXT STEP</span><h3>Keep moving forward</h3></div><span class="live-dot"></span></div>${nextTask ? `<div class="next-task-icon">↗</div><h4>${escapeHtml(nextTask.title)}</h4><p>${escapeHtml(nextTask.reason)}</p><a href="#roadmap" class="button button-primary button-wide">Continue learning <span>→</span></a>` : `<div class="empty-state compact">Your current roadmap is complete. Refresh your assessment or choose a new career goal to generate your next plan.</div><a href="#careers" class="button button-secondary">Explore careers</a>`}
    <div class="last-assessment"><span>Latest assessment</span><strong>${recentAssessment ? percent(recentAssessment.score) : "Not taken"}</strong>${recentAssessment ? `<small>${new Date(recentAssessment.date).toLocaleDateString()}</small>` : `<a href="#assessment">Start now →</a>`}</div></article></section>
    <section class="dashboard-grid lower-grid"><article class="panel"><div class="panel-heading"><div><span class="eyebrow">RECENT ACTIVITY</span><h3>Your learning trail</h3></div><a href="#progress" class="subtle-link">Full history →</a></div>${recentActivity.length ? `<div class="activity-list">${recentActivity.map((item) => `<div class="activity-item"><span class="activity-bullet"></span><div><strong>${escapeHtml(item.text)}</strong><small>${new Date(item.date).toLocaleString()}</small></div></div>`).join("")}</div>` : `<div class="empty-state compact">Your assessments, lab attempts and completed tasks will appear here.</div>`}</article>
    <article class="panel agent-summary"><div class="panel-heading"><div><span class="eyebrow">AGENT COLLABORATION</span><h3>Personalization status</h3></div><span class="execution-status status-${agentStatus.toLowerCase()}"><i></i>${escapeHtml(agentStatus)}</span></div><p>${escapeHtml(agentSummary)}</p><div class="agent-mini-grid">${agentInfo.map((agent) => `<span><i>✳</i>${escapeHtml(agent.title.replace(" Agent", ""))}</span>`).join("")}</div><a href="#agents" class="subtle-link">View agent outputs →</a></article></section>`;
}

function renderProfile() {
  const profile = state.profile;
  return `${pageHeader("YOUR LEARNER PROFILE", accountEditMode && route === "account" ? "Edit My Account" : "My Profile", "Your goals and experience help personalize career matching and learning recommendations.")}
    <form id="profile-form" class="profile-layout"><div class="panel form-panel"><div class="panel-heading"><div><span class="eyebrow">ABOUT YOU</span><h3>Learner details</h3></div></div>
      <div class="form-grid"><label>Full name<input name="name" required maxlength="80" value="${escapeHtml(profile.name)}" placeholder="Your name"></label><label>Email<input name="email" type="email" maxlength="160" value="${escapeHtml(profile.email)}" placeholder="you@example.com"></label>
      <label>Education<input name="education" maxlength="100" value="${escapeHtml(profile.education)}" placeholder="e.g. Bachelor's degree"></label><label>College or university<input name="institution" maxlength="120" value="${escapeHtml(profile.institution)}" placeholder="Institution name"></label>
      <label>Current learning level<select name="learningLevel">${["Beginner", "Intermediate", "Advanced"].map((item) => `<option ${profile.learningLevel === item ? "selected" : ""}>${item}</option>`).join("")}</select></label>
      <label>Learning preference<select name="preference">${["Hands-on practice", "Video lessons", "Reading and documentation", "Structured courses", "Mixed learning"].map((item) => `<option ${profile.preference === item ? "selected" : ""}>${item}</option>`).join("")}</select></label></div>
      <div class="form-divider"></div><label>Target cybersecurity career<select name="careerGoal">${careers.map((item) => `<option value="${item.id}" ${profile.careerGoal === item.id ? "selected" : ""}>${escapeHtml(item.title)}</option>`).join("")}</select><small class="field-help">Changing your goal recalculates your career match and roadmap.</small></label>
      <div class="form-divider"></div><div class="section-label"><div><strong>Existing cybersecurity skills</strong><small>Self-reported ratings are kept separate from verified assessment evidence.</small></div><span class="label-caption">0–100%</span></div>
      <div class="skill-input-grid">${skills.map((item) => `<label class="skill-input"><span>${escapeHtml(item.name)}</span><span class="range-wrap"><input type="range" min="0" max="100" step="5" name="skill-${item.id}" value="${Number(profile.skills[item.id] || 0)}"><output>${Number(profile.skills[item.id] || 0)}%</output></span></label>`).join("")}</div>
      <div class="form-grid extra-fields"><label>Certifications <small class="field-help">Separate entries with commas</small><input name="certifications" value="${escapeHtml((profile.certifications || []).join(", "))}" placeholder="e.g. CompTIA Security+ (in progress)"></label><label>Completed projects <small class="field-help">Separate entries with commas</small><input name="projects" value="${escapeHtml((profile.projects || []).join(", "))}" placeholder="e.g. Home lab log review"></label></div>
      <div class="form-footer"><span>Your profile is saved in this browser.</span><div class="form-actions"><button class="button button-secondary" type="button" id="cancel-profile">Cancel</button><button class="button button-primary" type="submit">Save changes <span>→</span></button></div></div>
    </div><aside class="panel profile-aside"><div class="profile-avatar">${escapeHtml(initials(profile.name))}</div><h3>${escapeHtml(profile.name || "Learner")}</h3><p>${escapeHtml(profile.email || "Add your email to your profile")}</p><div class="aside-divider"></div><div class="aside-fact"><span>Career goal</span><strong>${escapeHtml(careers.find((item) => item.id === profile.careerGoal)?.title)}</strong></div><div class="aside-fact"><span>Learning level</span><strong>${escapeHtml(profile.learningLevel)}</strong></div><div class="aside-fact"><span>Certifications</span><strong>${(profile.certifications || []).length}</strong></div><div class="aside-fact"><span>Projects</span><strong>${(profile.projects || []).length}</strong></div><div class="notice-box"><span>ⓘ</span> Self-reported skill ratings are not certifications or proof of job readiness.</div></aside></form>`;
}

function getProfileCompletion() {
  const profile = state.profile;
  const fields = [
    profile.name && profile.name !== "Learner",
    profile.email,
    profile.education,
    profile.institution,
    profile.learningLevel,
    profile.careerGoal,
    Object.values(profile.skills || {}).some((level) => Number(level) > 0),
    (profile.certifications || []).length > 0,
    (profile.projects || []).length > 0,
  ];
  const complete = fields.filter(Boolean).length;
  return { complete, total: fields.length, percent: Math.round(complete / fields.length * 100) };
}

function renderAccount() {
  if (accountEditMode) return renderProfile();
  const profile = state.profile;
  const completion = getProfileCompletion();
  const selectedCareer = careers.find((item) => item.id === profile.careerGoal);
  const claimedSkills = skills.filter((skill) => Number(profile.skills?.[skill.id] || 0) > 0);
  return `${pageHeader("LOCAL DEMO PROFILE", "My Account", "Review the learner information used by your personalized CyberPath experience.", `<button class="button button-primary" id="edit-account">Edit Profile <span>✎</span></button>`)}
    <section class="account-overview panel"><div class="account-identity"><div class="account-large-avatar">${escapeHtml(initials(profile.name))}</div><div><span class="pill pill-cyan">LOCAL DEMO PROFILE</span><h2>${escapeHtml(profile.name || "Learner")}</h2><p>${escapeHtml(profile.email || "Email not provided")}</p>${profile.name === "Learner" ? `<small class="field-help">“Learner” is the default demo label, not a supplied personal name.</small>` : ""}</div></div><div class="completion-meter"><div><span>Profile completion</span><strong>${completion.percent}%</strong></div><div class="progress-track"><span style="width:${completion.percent}%"></span></div><small>${completion.complete} of ${completion.total} profile fields provided</small></div></section>
    <section class="account-details-grid"><article class="panel account-detail-card"><div class="panel-heading"><div><span class="eyebrow">PERSONAL INFORMATION</span><h3>About you</h3></div></div><dl class="account-definition-list"><div><dt>Full name</dt><dd>${escapeHtml(profile.name || "Not provided")}</dd></div><div><dt>Email address</dt><dd>${escapeHtml(profile.email || "Not provided")} <small>Not verified</small></dd></div><div><dt>Education</dt><dd>${escapeHtml(profile.education || "Not provided")}</dd></div><div><dt>College / university</dt><dd>${escapeHtml(profile.institution || "Not provided")}</dd></div><div><dt>Learning level</dt><dd>${escapeHtml(profile.learningLevel || "Not provided")}</dd></div><div><dt>Profile created</dt><dd>${state.accountCreatedAt ? new Date(state.accountCreatedAt).toLocaleDateString() : "Not available"}</dd></div></dl></article>
    <article class="panel account-detail-card"><div class="panel-heading"><div><span class="eyebrow">CAREER & SKILLS</span><h3>Cybersecurity profile</h3></div></div><div class="account-career"><span>Selected career goal</span><strong>${escapeHtml(selectedCareer?.title || "Not selected")}</strong><p>${escapeHtml(selectedCareer?.description || "Choose a cybersecurity career in your profile.")}</p></div><div class="account-list-block"><strong>Self-reported cybersecurity skills</strong>${claimedSkills.length ? `<div class="tag-list">${claimedSkills.map((skill) => `<span>${escapeHtml(skill.name)} · ${Number(profile.skills[skill.id])}%</span>`).join("")}</div>` : `<p>No cybersecurity skills provided yet.</p>`}</div><div class="account-list-block"><strong>Certifications</strong><p>${(profile.certifications || []).length ? (profile.certifications || []).map(escapeHtml).join(", ") : "No certifications provided."}</p></div><div class="account-list-block"><strong>Projects</strong><p>${(profile.projects || []).length ? (profile.projects || []).map(escapeHtml).join(", ") : "No projects provided."}</p></div></article></section>
    <div class="notice-box account-disclaimer">This is a local demo profile stored in this browser. It is not a registered or authenticated account. Email addresses are not verified; skill ratings are self-reported unless supported by assessment or lab evidence.</div>`;
}

function renderSettings() {
  const settings = state.settings;
  const categories = [...new Set(skills.map((item) => item.category))];
  return `${pageHeader("PERSONALIZE YOUR EXPERIENCE", "Settings", "Save profile and learning preferences for this browser.")}
    <form id="settings-form" class="settings-layout"><section class="settings-main">
      <article class="panel settings-card"><div class="panel-heading"><div><span class="eyebrow">PROFILE PREFERENCES</span><h3>How we address and guide you</h3></div></div><div class="settings-fields"><label>Display name<input name="displayName" required maxlength="80" value="${escapeHtml(state.profile.name)}"></label><label>Learning level<select name="learningLevel">${["Beginner", "Intermediate", "Advanced"].map((item) => `<option ${state.profile.learningLevel === item ? "selected" : ""}>${item}</option>`).join("")}</select></label><label>Preferred cybersecurity learning category<select name="preferredCategory">${categories.map((category) => `<option value="${escapeHtml(category)}" ${settings.preferredCategory === category ? "selected" : ""}>${escapeHtml(category)}</option>`).join("")}</select><small class="field-help">Matching role gaps move higher in your roadmap; if none match, role requirements stay prioritized.</small></label></div></article>
      <article class="panel settings-card"><div class="panel-heading"><div><span class="eyebrow">LEARNING PREFERENCES</span><h3>Set your pace</h3></div></div><div class="settings-fields"><label>Preferred learning difficulty<select name="preferredDifficulty">${["Beginner", "Intermediate", "Advanced"].map((item) => `<option ${settings.preferredDifficulty === item ? "selected" : ""}>${item}</option>`).join("")}</select><small class="field-help">Used as your target level when viewing roadmap tasks; resource difficulty remains as published.</small></label><label>Preferred learning duration<select name="preferredDuration">${["1–2 hours/week", "3–5 hours/week", "6–10 hours/week", "10+ hours/week"].map((item) => `<option ${settings.preferredDuration === item ? "selected" : ""}>${item}</option>`).join("")}</select></label><label class="settings-full">Learning goals<textarea name="learningGoals" rows="3" maxlength="500" placeholder="What would you like to achieve?">${escapeHtml(settings.learningGoals)}</textarea><small class="field-help">Saved to your profile and included in exported learner data.</small></label></div></article>
      <article class="panel settings-card"><div class="panel-heading"><div><span class="eyebrow">APPEARANCE</span><h3>Theme</h3></div></div><div class="theme-setting"><span class="theme-swatch"></span><span><strong>Dark cybersecurity theme</strong><small>Current theme · the application currently supports this theme only.</small></span><span class="pill">ACTIVE</span></div></article>
      <div class="settings-save-row"><span>Preferences are saved locally in this browser.</span><button class="button button-primary" type="submit">Save Settings <span>→</span></button></div>
    </section>
    <aside class="panel data-management"><span class="eyebrow">DATA MANAGEMENT</span><h3>Your data stays local</h3><p>Export a JSON copy of this local demo profile or clear its saved profile and learning data from this browser.</p><button class="button button-secondary button-wide" type="button" id="export-data">⇩ Export learner data (JSON)</button><div class="data-divider"></div><strong>Clear demo data</strong><small>This removes saved profile details, Learning Hub progress and quiz history, assessments, lab results, agent history and preferences.</small><button class="button button-danger button-wide" type="button" id="clear-demo-data">Clear demo data</button><small class="storage-label">Storage: browser localStorage</small></aside></form>`;
}

function renderAccountInformation() {
  const profile = state.profile;
  const completion = getProfileCompletion();
  const selectedCareer = careers.find((item) => item.id === profile.careerGoal);
  const skillsCount = Object.values(profile.skills || {}).filter((level) => Number(level) > 0).length;
  const information = [
    ["Name", profile.name && profile.name !== "Learner" ? profile.name : "Not provided (default demo label)"],
    ["Email", profile.email || "Not provided"],
    ["Education", profile.education || "Not provided"],
    ["College / university", profile.institution || "Not provided"],
    ["Learning level", profile.learningLevel || "Not provided"],
    ["Career goal", selectedCareer?.title || "Not selected"],
    ["Self-reported skills", `${skillsCount} provided`],
    ["Certifications", `${(profile.certifications || []).length} provided`],
    ["Projects", `${(profile.projects || []).length} provided`],
    ["Profile created", state.accountCreatedAt ? new Date(state.accountCreatedAt).toLocaleString() : "Not available"],
  ];
  return `${pageHeader("TRANSPARENT ACCOUNT DETAILS", "Account Information", "Review the account type, data completeness and local storage details.", `<a class="button button-secondary" href="#account">Back to My Account</a>`)}
    <section class="account-info-grid"><article class="panel account-type-card"><span class="info-symbol">◉</span><span class="eyebrow">ACCOUNT TYPE</span><h2>Local demo profile</h2><p>This app has no authentication service or backend account system. Your profile is stored only in this browser.</p><span class="pill pill-cyan">NOT AUTHENTICATED</span></article><article class="panel completion-card"><span class="eyebrow">PROFILE COMPLETION</span><strong>${completion.percent}%</strong><div class="progress-track"><span style="width:${completion.percent}%"></span></div><small>${completion.complete} of ${completion.total} profile fields provided</small></article></section>
    <section class="panel account-detail-card available-info"><div class="panel-heading"><div><span class="eyebrow">AVAILABLE LEARNER INFORMATION</span><h3>Data currently saved</h3></div><span class="pill">LOCAL ONLY</span></div><dl class="account-definition-list">${information.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}</dl><div class="notice-box">Email is not verified. The profile does not represent a registered account, and the completion score is not a credential or readiness assessment.</div></section>
    <section class="account-info-grid"><article class="panel account-detail-card"><span class="eyebrow">STORAGE TYPE</span><h3>Browser localStorage</h3><p>Profile, settings and learning data are stored on this device and browser. They are not synchronized to a server.</p></article><article class="panel account-detail-card"><span class="eyebrow">SESSION TYPE</span><h3>Local demo session</h3><p>Sign Out ends the current tab's demo session. It does not erase the locally saved data; use Settings → Clear demo data to remove it.</p></article></section>`;
}

function renderSignedOut() {
  return `<section class="signed-out-screen"><div class="panel signed-out-card"><div class="signed-out-mark">↪</div><span class="eyebrow">LOCAL DEMO SESSION ENDED</span><h1>You’re signed out</h1><p>Your locally saved profile and learning data remain in this browser. CyberPath AI does not have a real authentication service.</p><button class="button button-primary" id="continue-local-session">Continue with local demo profile <span>→</span></button><small>To manage or clear data, continue to the local profile and open Settings.</small></div></section>`;
}

function renderCareers() {
  const result = runAgents(state);
  const selected = result.career;
  return `${pageHeader("FIND YOUR DIRECTION", "Career Explorer", "Compare your demonstrated skills with real cybersecurity role requirements.")}
    <div class="career-layout"><section class="career-list">${careers.map((career) => {
      const active = selected.career.id === career.id;
      const matchState = { ...state, profile: { ...state.profile, careerGoal: career.id } };
      const match = analyzeCareer(matchState, analyzeSkills(matchState));
      return `<button class="career-card ${active ? "selected" : ""}" data-career="${career.id}"><span class="career-card-icon">${career.id === "soc" ? "⌕" : career.id === "pentest" ? "⌘" : career.id === "cloud" ? "☁" : career.id === "forensics" ? "◈" : "⚙"}</span><span class="career-card-content"><strong>${escapeHtml(career.title)}</strong><small>${escapeHtml(career.level)}</small><span class="career-card-bottom"><span>${percent(match.score)} match</span><i class="mini-track"><b style="width:${match.score}%"></b></i></span></span><span class="career-chevron">›</span></button>`;
    }).join("")}</section>
    <section class="panel career-detail"><div class="career-detail-head"><div><span class="eyebrow">CAREER PROFILE</span><h2>${escapeHtml(selected.career.title)}</h2><span class="pill">${escapeHtml(selected.career.level)}</span></div><div class="match-ring" style="--score:${selected.score}"><span><strong>${selected.score}%</strong><small>MATCH</small></span></div></div>
    <p class="career-description">${escapeHtml(selected.career.description)}</p><div class="readiness-line"><span>Estimated career readiness</span><strong>${selected.score >= 75 ? "Building strong alignment" : selected.score >= 45 ? "In progress" : "Early learning stage"}</strong></div>
    <div class="career-tabs"><span>REQUIRED SKILLS</span><small>Estimated skill level vs. role target</small></div>${selected.skills.map((item) => `<div class="career-skill"><div><strong>${escapeHtml(item.name)}</strong><span>${item.achieved ? `<em class="positive">Meets target</em>` : `<em class="gap-label">Needs ${item.gap} pts</em>`}</span></div><div class="dual-progress"><span style="width:${item.proficiency}%"></span><i style="left:${item.required}%"></i></div><small>${percent(item.proficiency)} demonstrated estimate <b>·</b> ${item.required}% target</small></div>`).join("")}
    <div class="career-info-grid"><div><span class="eyebrow">TOOLS & TECHNOLOGIES</span><div class="tag-list">${selected.career.tools.map((tool) => `<span>${escapeHtml(tool)}</span>`).join("")}</div></div><div><span class="eyebrow">LEARNING PREREQUISITES</span><ul>${selected.career.prerequisites.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div></div>
    <div class="notice-box">This is an explainable skill-fit estimate based on your saved information and practice evidence—not a hiring prediction, certification or guarantee of job readiness.</div><a href="#roadmap" class="button button-primary">Build my learning plan <span>→</span></a></section></div>`;
}

function renderAssessment() {
  const question = questions[questionIndex];
  const complete = Boolean(state.assessments.length && state.assessments.at(-1).date && assessmentAnswers.__submitted);
  const prior = state.assessments.at(-1);
  if (complete) return `${pageHeader("CHECK YOUR KNOWLEDGE", "Skill Assessment", "A short, cross-domain check helps ground your skill profile in evidence.", `<button id="restart-assessment" class="button button-primary">Start new assessment <span>→</span></button>`)}<section class="panel result-panel"><div class="result-icon">✓</div><span class="eyebrow">ASSESSMENT COMPLETE</span><h2>${percent(prior.score)} overall score</h2><p>Your answers have updated skill evidence and your career-specific learning roadmap.</p><div class="result-categories">${Object.entries(prior.skillScores).map(([id, score]) => `<div><span>${escapeHtml(skillName(id))}</span><strong>${percent(score)}</strong></div>`).join("")}</div><details class="answer-review"><summary>Review answers and explanations</summary>${questions.map((item, index) => {
    const selected = Number(prior.answers?.[item.id]);
    const correct = selected === item.answer;
    return `<article class="answer-review-item"><strong>${index + 1}. ${escapeHtml(item.prompt)}</strong><span class="${correct ? "positive" : "gap-label"}">${correct ? "Correct" : "Review this concept"}</span><p>Your answer: ${escapeHtml(item.options[selected] ?? "No answer")} · Correct answer: ${escapeHtml(item.options[item.answer])}</p><small>${escapeHtml(item.explanation)}</small></article>`;
  }).join("")}</details><div class="result-actions"><a class="button button-secondary" href="#progress">View progress</a><a class="button button-primary" href="#roadmap">Review roadmap →</a></div></section>`;
  return `${pageHeader("CHECK YOUR KNOWLEDGE", "Skill Assessment", "12 questions across cybersecurity foundations, operations and secure engineering.")}
    <section class="assessment-layout"><div class="panel question-panel"><div class="question-top"><span class="pill pill-cyan">${escapeHtml(question ? skillName(question.skill) : "Assessment")}</span><span>QUESTION ${questionIndex + 1} <b>/ ${questions.length}</b></span></div>
    <div class="question-progress">${questions.map((_, i) => `<i class="${i < questionIndex ? "done" : i === questionIndex ? "current" : ""}"></i>`).join("")}</div>
    <h2>${escapeHtml(question.prompt)}</h2><div class="answer-options">${question.options.map((option, i) => `<label class="answer-option ${assessmentAnswers[question.id] === i ? "chosen" : ""}"><input type="radio" name="answer" value="${i}" ${assessmentAnswers[question.id] === i ? "checked" : ""}><span class="option-key">${String.fromCharCode(65 + i)}</span><span>${escapeHtml(option)}</span><span class="option-check">✓</span></label>`).join("")}</div>
    <div class="question-footer"><button id="question-prev" class="button button-secondary" ${questionIndex === 0 ? "disabled" : ""}>← Previous</button><span>Choose one answer to continue</span>${questionIndex < questions.length - 1 ? `<button id="question-next" class="button button-primary" ${assessmentAnswers[question.id] === undefined ? "disabled" : ""}>Next question →</button>` : `<button id="submit-assessment" class="button button-primary" ${assessmentAnswers[question.id] === undefined ? "disabled" : ""}>Finish assessment ✓</button>`}</div></div>
    <aside class="panel assessment-aside"><span class="eyebrow">ASSESSMENT GUIDE</span><h3>Show what you know</h3><p>This assessment checks foundational concepts. Results contribute evidence to your skill analysis.</p><div class="aside-divider"></div><div class="guide-item"><b>01</b><span><strong>Choose your answer</strong><small>One response per question</small></span></div><div class="guide-item"><b>02</b><span><strong>Review your result</strong><small>Scores update skill estimates</small></span></div><div class="guide-item"><b>03</b><span><strong>Use your roadmap</strong><small>Practice the areas to improve</small></span></div><div class="notice-box">This learning assessment is not a professional certification exam.</div></aside></section>`;
}

function renderAgents() {
  const result = runAgents(state);
  const runs = state.agentRuns || [];
  const latestRun = runs[0] || null;
  const latestRecords = new Map((latestRun?.executions || latestRun?.agents || []).map((agent) => [agent.id, agent]));
  const history = runs.flatMap((run) => (run.executions || run.agents || []).map((agent) => ({
    ...agent,
    workflowId: run.id,
    trigger: run.trigger,
  })));
  const renderStatus = (status) => `<span class="execution-status status-${String(status || "Waiting").toLowerCase()}"><i></i>${escapeHtml(status || "Waiting")}</span>`;
  const timestamp = (date) => date ? new Date(date).toLocaleString() : "Not started";
  const workflowSteps = [
    { id: "profile", title: "Learner Profile", record: null },
    ...agentInfo.map((agent) => ({ ...agent, record: latestRecords.get(agent.id) })),
  ];
  return `${pageHeader("EXPLAINABLE PERSONALIZATION", "AI Agent Center", "Five specialized rule-based agents collaborate using your locally saved profile and evidence.", `<button class="button button-secondary" id="run-agents" ${workflowInProgress ? "disabled" : ""}>↻ ${workflowInProgress ? "Workflow running" : "Run collaboration"}</button>`)}
    <div class="orchestrator-banner"><div class="orchestrator-symbol">✳</div><div><span class="eyebrow">CENTRAL ORCHESTRATOR · RULE-BASED</span><h3>Personalized learning workflow</h3><p>${latestRun ? `${escapeHtml(latestRun.summary || latestRun.trigger)} · Started ${escapeHtml(timestamp(latestRun.startedAt))}` : "No workflow has run yet. Save your profile, submit an assessment or start a collaboration to see real agent executions."} No external AI service is configured.</p></div>${renderStatus(latestRun?.status || "Waiting")}</div>
    <section class="panel live-workflow"><div class="panel-heading"><div><span class="eyebrow">EXECUTION PIPELINE</span><h3>Learner profile to adaptive guidance</h3></div><span class="workflow-trigger">${latestRun ? `Trigger: ${escapeHtml(latestRun.trigger)}` : "Awaiting first run"}</span></div><div class="workflow-column">${workflowSteps.map((step, index) => {
      const record = step.record;
      const status = step.id === "profile" ? (latestRun ? "Completed" : "Waiting") : record?.status || "Waiting";
      const title = step.id === "profile" ? step.title : step.title;
      const output = step.id === "profile"
        ? `${state.profile.name || "Learner"} · ${careers.find((career) => career.id === state.profile.careerGoal)?.title || ""}`
        : record?.output || step.responsibility;
      return `<div class="workflow-node ${status.toLowerCase()}"><span class="workflow-node-number">${step.id === "profile" ? "P" : String(index).padStart(2, "0")}</span><div class="workflow-node-main"><strong>${escapeHtml(title)}</strong><small>${escapeHtml(output)}</small></div>${renderStatus(status)}</div>${index < workflowSteps.length - 1 ? `<div class="workflow-connector ${status === "Completed" ? "connector-complete" : ""}" aria-hidden="true"></div>` : ""}`;
    }).join("")}</div><div class="workflow-footer"><span>Overall workflow status</span>${renderStatus(latestRun?.status || "Waiting")}${latestRun?.error ? `<span class="workflow-error">${escapeHtml(latestRun.error)}</span>` : ""}</div></section>
    <div class="agent-flow">${agentInfo.map((agent, index) => {
      const record = latestRecords.get(agent.id);
      return `<article class="agent-card"><div class="agent-card-top"><span class="agent-symbol">${["◉", "◎", "⌁", "⌘", "✧"][index]}</span>${renderStatus(record?.status || "Waiting")}</div><span class="agent-step">AGENT 0${index + 1} · ${escapeHtml(record?.completedAt ? timestamp(record.completedAt) : record?.startedAt ? timestamp(record.startedAt) : "Awaiting execution")}</span><h3>${escapeHtml(agent.title)}</h3><p>${escapeHtml(agent.responsibility)}</p><div class="agent-output"><span>${record ? "LATEST EXECUTION OUTPUT" : "NO EXECUTION RECORDED"}</span><p>${escapeHtml(record?.output || "Waiting for this agent to receive workflow input.")}</p></div></article>`;
    }).join("")}</div>
    <section class="panel workflow-panel"><div class="panel-heading"><div><span class="eyebrow">EXECUTION HISTORY</span><h3>Agent activity and collaboration timeline</h3></div><span class="workflow-trigger">${history.length} agent execution${history.length === 1 ? "" : "s"} · ${runs.length} workflow run${runs.length === 1 ? "" : "s"}</span></div>${history.length ? `<div class="execution-history">${history.map((record) => `<details class="execution-record" ${record.workflowId === latestRun?.id && record.status === "Running" ? "open" : ""}><summary><span class="execution-record-title">${escapeHtml(record.title)}</span>${renderStatus(record.status)}<span class="execution-trigger">${escapeHtml(record.trigger)}</span><time>${escapeHtml(timestamp(record.completedAt || record.startedAt))}</time></summary><div class="execution-details"><div><strong>Input received</strong><p>${escapeHtml(record.input || "—")}</p></div><div><strong>Task performed</strong><p>${escapeHtml(record.task || "—")}</p></div><div><strong>Analysis result</strong><p>${escapeHtml(record.analysis || "Awaiting analysis")}</p></div><div><strong>Output generated</strong><p>${escapeHtml(record.output || record.error || "Awaiting output")}</p></div><div><strong>Next agent receiving result</strong><p>${escapeHtml(record.next || "—")}</p></div><div><strong>Execution timestamps</strong><p>Started: ${escapeHtml(timestamp(record.startedAt))}<br>Finished: ${escapeHtml(timestamp(record.completedAt))}</p></div>${record.error ? `<div class="workflow-error"><strong>Execution error</strong><p>${escapeHtml(record.error)}</p></div>` : ""}</div></details>`).join("")}</div>` : `<div class="empty-state compact">Execution details will appear here after the first real workflow run.</div>`}<div class="notice-box">Agents run sequentially through the orchestrator and pass structured outputs to the next agent. Status and history are saved locally. Rule-based execution only; no external LLM is called.</div></section>`;
}

function renderRoadmap() {
  const result = runAgents(state);
  const completed = result.roadmap.filter((task) => task.completed).length;
  const progress = result.roadmap.length ? Math.round(completed / result.roadmap.length * 100) : 0;
  const grouped = [...new Set(result.roadmap.map((task) => task.phase))];
  return `${pageHeader("YOUR PERSONALIZED PLAN", "Learning Roadmap", `A prioritized plan for ${escapeHtml(result.career.career.title)}, based on your current skill gaps and learning evidence.`)}
    <section class="roadmap-overview panel"><div><span class="eyebrow">ROADMAP COMPLETION</span><strong>${progress}%</strong><small>${completed} of ${result.roadmap.length} tasks complete</small></div><div class="roadmap-progress"><div class="progress-track large"><span style="width:${progress}%"></span></div><p>${result.roadmap.length ? `${result.roadmap.length} recommended tasks · Category preference: ${escapeHtml(state.settings.preferredCategory)} · ${escapeHtml(state.settings.preferredDifficulty)} target · Weekly availability: ${escapeHtml(state.settings.preferredDuration)}` : "Take an assessment or select a career goal to create a roadmap."}</p></div><a class="button button-secondary" href="#careers">Change career goal</a></section>
    ${result.roadmap.length ? grouped.map((phase) => `<section class="roadmap-phase"><div class="phase-heading"><span class="phase-dot"></span><div><span class="eyebrow">LEARNING PHASE</span><h2>${escapeHtml(phase)}</h2></div></div><div class="roadmap-tasks">${result.roadmap.filter((task) => task.phase === phase).map((task) => `<article class="roadmap-task ${task.completed ? "completed" : ""}"><label class="task-check"><input type="checkbox" data-task="${task.id}" ${task.completed ? "checked" : ""}><span>✓</span></label><div class="task-content"><div class="task-meta"><span class="pill">${escapeHtml(task.skill)}</span><span>${escapeHtml(task.type)}</span><span>${escapeHtml(task.time)}</span><span>Resource: ${escapeHtml(task.difficulty)}</span><span>Target: ${escapeHtml(task.targetDifficulty)}</span></div><h3>${escapeHtml(task.title)}</h3><p>${escapeHtml(task.reason)}</p>${task.learnerGoal ? `<div class="practical-tip"><strong>Your learning goal:</strong> ${escapeHtml(task.learnerGoal)}</div>` : ""}<div class="practical-tip"><strong>Practice:</strong> ${escapeHtml(task.practical)}</div><a href="${escapeHtml(task.url)}" target="_blank" rel="noopener noreferrer" class="resource-link">Open free learning resource ↗</a></div><span class="task-status">${task.completed ? "COMPLETED" : "TO DO"}</span></article>`).join("")}</div></section>`).join("") : `<section class="panel empty-state"><h3>Your plan is ready to personalize</h3><p>Choose a cybersecurity career or complete the skill assessment to generate role-aligned steps.</p><a href="#assessment" class="button button-primary">Take assessment →</a></section>`}
    <p class="footnote">Resource links open third-party learning sites. Confirm their current terms and use intentionally vulnerable labs only within their documented safe environment.</p>`;
}

function formatStudyTime(minutes) {
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return [hours ? `${hours} hr` : "", remainingMinutes ? `${remainingMinutes} min` : ""].filter(Boolean).join(" ");
}

function renderLearningTopic(topic, index, track, module, progress) {
  const studied = progress.studiedTopics.includes(topic.id);
  return `<article class="panel learning-topic" id="topic-${escapeHtml(topic.id)}">
    <div class="learning-topic-heading"><span class="learning-topic-number">${String(index + 1).padStart(2, "0")}</span><div><span class="eyebrow">LESSON TOPIC</span><h3>${escapeHtml(topic.title)}</h3></div><button class="button button-secondary button-small study-toggle" type="button" data-mark-topic data-track-id="${escapeHtml(track.id)}" data-module-id="${escapeHtml(module.id)}" data-topic-id="${escapeHtml(topic.id)}" aria-pressed="${studied}">${studied ? "Studied ✓" : "Mark studied"}</button></div>
    ${topic.objectives?.length ? `<section class="learning-content-section learning-objectives"><h4>Learning objectives</h4><ul>${topic.objectives.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></section>` : ""}
    <div class="learning-definition"><strong>In simple words</strong><p>${escapeHtml(topic.definition)}</p></div>
    <section class="learning-content-section"><h4>How it works</h4><p>${escapeHtml(topic.explanation)}</p></section>
    <section class="learning-content-section"><h4>Why it matters</h4><p>${escapeHtml(topic.importance)}</p></section>
    <section class="learning-content-section"><h4>Step by step</h4><ol>${topic.steps.map((step) => `<li>${escapeHtml(step)}</li>`).join("")}</ol></section>
    <div class="learning-example-grid"><section><h4>Everyday example</h4><p>${escapeHtml(topic.example)}</p></section><section><h4>Cybersecurity connection</h4><p>${escapeHtml(topic.cyberExample)}</p></section></div>
    <section class="learning-content-section"><h4>Important terms</h4><dl class="learning-terms">${topic.terms.map((item) => `<div><dt>${escapeHtml(item.term)}</dt><dd>${escapeHtml(item.meaning)}</dd></div>`).join("")}</dl></section>
    <section class="learning-content-section"><h4>Visual guide</h4><pre class="learning-diagram">${escapeHtml(topic.diagram)}</pre></section>
    ${topic.demonstration ? `<section class="learning-content-section"><h4>Demonstration</h4><pre class="learning-code-sample">${escapeHtml(topic.demonstration)}</pre></section>` : ""}
    <div class="learning-activity"><strong>Safe practice</strong><p>${escapeHtml(topic.activity)}</p></div>
    ${topic.exercise?.length ? `<section class="learning-exercise"><h4>Step-by-step exercise</h4><ol>${topic.exercise.map((step) => `<li>${escapeHtml(step)}</li>`).join("")}</ol>${topic.expected ? `<p><strong>Expected observations:</strong> ${escapeHtml(topic.expected)}</p>` : ""}</section>` : ""}
    ${topic.keyPoints?.length ? `<section class="learning-key-points"><h4>Key points</h4><ul>${topic.keyPoints.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></section>` : ""}
    ${topic.mistakes ? `<section class="learning-topic-mistakes"><strong>Common beginner mistakes</strong><p>${escapeHtml(topic.mistakes)}</p></section>` : ""}
    ${topic.lab ? `<section class="learning-lab"><h4>Lab exercise</h4><p><strong>Objective:</strong> ${escapeHtml(topic.lab.objective)}</p><p><strong>Scenario:</strong> ${escapeHtml(topic.lab.background)}</p><p><strong>Tools:</strong> ${escapeHtml(topic.lab.tools)}</p><p><strong>Sample data</strong></p><pre class="learning-code-sample">${escapeHtml(topic.lab.data)}</pre><ol>${topic.lab.instructions.map((step) => `<li>${escapeHtml(step)}</li>`).join("")}</ol><p><strong>Expected observations</strong></p><ul>${topic.lab.observations.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul><p><strong>Findings:</strong> ${escapeHtml(topic.lab.findings)}</p><p><strong>Conclusion:</strong> ${escapeHtml(topic.lab.conclusion)}</p><p><strong>Defensive recommendations:</strong> ${escapeHtml(topic.lab.recommendations)}</p></section>` : ""}
    ${topic.interview ? `<section class="learning-content-section"><h4>Interview practice</h4>${topic.interview.map((item) => `<div class="learning-interview"><p><strong>Question:</strong> ${escapeHtml(item.question)}</p><p><strong>Sample answer:</strong> ${escapeHtml(item.answer)}</p></div>`).join("")}</section>` : ""}
    ${topic.summary ? `<section class="learning-topic-summary"><strong>Topic summary</strong><p>${escapeHtml(topic.summary)}</p></section>` : ""}
  </article>`;
}

function renderLearningQuiz(module, track, progress) {
  const result = progress.quizResults[module.id];
  const topicIds = new Set(module.lessons.flatMap((lesson) => lesson.topics.map((topic) => topic.id)));
  const incorrectQuestion = result && module.quiz.find((question) => result.answers?.[question.id] !== question.answer);
  const reviewTopicId = incorrectQuestion
    ? incorrectQuestion.topicId && topicIds.has(incorrectQuestion.topicId)
      ? incorrectQuestion.topicId
      : module.lessons[0]?.topics[0]?.id
    : null;
  const reviewTopic = module.lessons.flatMap((lesson) => lesson.topics).find((topic) => topic.id === reviewTopicId);
  return `<section class="panel learning-quiz" id="learning-quiz"><div class="panel-heading"><div><span class="eyebrow">CHECK YOUR UNDERSTANDING</span><h2>Knowledge check</h2></div><span class="pill">SCORED SELF-CHECK · NOT A CREDENTIAL</span></div><p>Answer every question to see your score, explanations, and a suggested topic to review. This learning score does not establish mastery.</p>
    <form data-learning-quiz data-track-id="${escapeHtml(track.id)}" data-module-id="${escapeHtml(module.id)}">
      ${module.quiz.map((question, index) => `<fieldset class="learning-quiz-question"><legend><span>Q${index + 1}</span>${escapeHtml(question.prompt)}</legend>${question.choices.map((choice, choiceIndex) => `<label class="${result?.answers?.[question.id] === choiceIndex ? "chosen" : ""}"><input type="radio" name="learning-answer-${escapeHtml(question.id)}" value="${choiceIndex}" required ${result?.answers?.[question.id] === choiceIndex ? "checked" : ""}><span class="option-key">${String.fromCharCode(65 + choiceIndex)}</span><span>${escapeHtml(choice)}</span></label>`).join("")}</fieldset>`).join("")}
      <button class="button button-primary" type="submit">${result ? "Retake knowledge check" : "Submit answers"} →</button>
    </form>
    ${result ? `<section class="learning-quiz-result ${result.passed ? "quiz-result-pass" : "quiz-result-review"}" aria-live="polite"><strong>${result.correct} / ${result.total} correct · ${percent(result.score)}${result.passed ? " — target reached" : " — review suggested"}</strong><p>Saved ${escapeHtml(new Date(result.completedAt).toLocaleString())}. This score is a study signal, not proof of mastery.</p>${reviewTopic ? `<p>Suggested review: <a href="${learningPathHref(track.id, module.id, reviewTopic.id)}" data-learning-topic data-track-id="${escapeHtml(track.id)}" data-module-id="${escapeHtml(module.id)}" data-topic-id="${escapeHtml(reviewTopic.id)}">${escapeHtml(reviewTopic.title)}</a></p>` : ""}<div class="learning-quiz-review">${module.quiz.map((question, index) => {
    const selected = result.answers?.[question.id];
    return `<article><strong>Q${index + 1}: ${selected === question.answer ? "Correct" : "Review"}</strong><p>Your answer: ${escapeHtml(question.choices[selected] ?? "No answer")}</p>${selected !== question.answer ? `<p>Suggested answer: ${escapeHtml(question.choices[question.answer])}</p>` : ""}<p>${escapeHtml(question.explanation)}</p>${selected !== question.answer && question.distractorNote ? `<p><strong>Why that choice is a common misconception:</strong> ${escapeHtml(question.distractorNote)}</p>` : ""}</article>`;
  }).join("")}</div></section>` : ""}
  </section>`;
}

function renderLearningModule(track, module) {
  const trackHref = `#learning-hub/${encodeURIComponent(track.id)}`;
  if (!module) {
    return `${pageHeader(`${escapeHtml(track.title.toUpperCase())} PATH`, "Module not found", "This module identifier is not part of the selected learning path.")}<a class="button button-secondary" href="${trackHref}">← Back to ${escapeHtml(track.title)}</a>`;
  }
  if (!isLearningModuleAvailable(module, track.id)) {
    return `${pageHeader(`${escapeHtml(track.title.toUpperCase())} PATH`, "Study material planned", "This module is listed in the curriculum, but lessons, quiz, and PDF are not published yet.")}<div class="notice-box">No study material or download is offered until the complete module is authored and validated.</div><a class="button button-secondary" href="${trackHref}">← Back to ${escapeHtml(track.title)}</a>`;
  }
  const topicCount = module.lessons.reduce((total, lesson) => total + lesson.topics.length, 0);
  if (!topicCount || !module.quiz.every((question) => Array.isArray(question.choices) && Number.isInteger(question.answer))) {
    return `${pageHeader(`${escapeHtml(track.title.toUpperCase())} PATH`, "Study material unavailable", "This module's lesson or quiz data is incomplete.")}<div class="notice-box">No download is offered for incomplete material. Please try again later.</div><a class="button button-secondary" href="${trackHref}">← Back to ${escapeHtml(track.title)}</a>`;
  }
  const progress = learningProgressFor(track.id);
  const studiedCount = module.lessons.flatMap((lesson) => lesson.topics).filter((topic) => progress.studiedTopics.includes(topic.id)).length;
  const difficulty = module.difficulty || module.level;
  const pdfPath = track.id === "soc-analyst"
    ? `./learning-materials/${encodeURIComponent(module.pdf)}`
    : `./learning-materials/${encodeURIComponent(track.id)}/${encodeURIComponent(module.pdf)}`;
  let topicIndex = 0;
  return `${pageHeader(`MODULE ${String(module.number).padStart(2, "0")} · ${escapeHtml(String(difficulty).toUpperCase())}`, escapeHtml(module.title), escapeHtml(module.description || `${track.title} learning material.`), `<a class="button button-secondary" href="${pdfPath}" download>Download study PDF ↓</a>`)}
    <section class="learning-module-meta panel"><div><span class="eyebrow">ESTIMATED STUDY TIME</span><strong>${formatStudyTime(module.estimatedMinutes)}</strong></div><div><span class="eyebrow">LESSON TOPICS STUDIED</span><strong>${studiedCount} / ${topicCount}</strong></div><div><span class="eyebrow">KNOWLEDGE CHECK</span><strong>${module.quiz.length} questions</strong></div><a class="subtle-link" href="${trackHref}">← ${escapeHtml(track.title)}</a></section>
    ${module.learningIntroduction ? `<section class="panel learning-module-overview"><div class="panel-heading"><div><span class="eyebrow">MODULE INTRODUCTION</span><h2>Start with the foundations</h2></div></div><div class="learning-example-grid"><section><h4>In simple terms</h4><p>${escapeHtml(module.learningIntroduction.meaning)}</p></section><section><h4>Why learn this</h4><p>${escapeHtml(module.learningIntroduction.whyLearn)}</p></section><section><h4>How it is used in the role</h4><p>${escapeHtml(module.learningIntroduction.jobUse)}</p></section><section><h4>After this module</h4><p>${escapeHtml(module.learningIntroduction.outcomes)}</p></section></div><section class="learning-content-section learning-objectives"><h4>Module learning objectives</h4><ul>${module.learningObjectives.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></section></section>` : ""}
    <section class="panel learning-toc"><div><span class="eyebrow">IN THIS MODULE</span><h2>Lesson contents</h2></div><nav aria-label="Module lesson contents">${module.lessons.map((lesson) => `<a href="${learningPathHref(track.id, module.id, lesson.topics[0].id)}" data-learning-topic data-track-id="${escapeHtml(track.id)}" data-module-id="${escapeHtml(module.id)}" data-topic-id="${escapeHtml(lesson.topics[0].id)}">${escapeHtml(lesson.title)}</a>${lesson.topics.map((topic) => `<a class="learning-toc-topic" href="${learningPathHref(track.id, module.id, topic.id)}" data-learning-topic data-track-id="${escapeHtml(track.id)}" data-module-id="${escapeHtml(module.id)}" data-topic-id="${escapeHtml(topic.id)}">${escapeHtml(topic.title)}</a>`).join("")}`).join("")}<a href="${learningPathHref(track.id, module.id, "quiz")}">Take the module diagnostic</a></nav></section>
    ${module.lessons.map((lesson) => `<section class="learning-lesson"><div class="learning-lesson-heading"><span class="eyebrow">LESSON</span><h2>${escapeHtml(lesson.title)}</h2></div>${lesson.topics.map((topic) => renderLearningTopic(topic, topicIndex++, track, module, progress)).join("")}</section>`).join("")}
    ${renderLearningQuiz(module, track, progress)}
    ${module.moduleSummary ? `<section class="panel learning-module-review"><div class="panel-heading"><div><span class="eyebrow">TAKEAWAYS</span><h2>Module summary</h2></div></div><p>${escapeHtml(module.moduleSummary)}</p><section class="learning-content-section"><h4>Key concepts</h4><ul>${module.keyConcepts.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></section><section class="learning-content-section"><h4>Glossary</h4><dl class="learning-terms">${module.glossary.map((item) => `<div><dt>${escapeHtml(item.term)}</dt><dd>${escapeHtml(item.meaning)}</dd></div>`).join("")}</dl></section><section class="learning-content-section"><h4>Career interview questions and sample answers</h4>${module.interviewQuestions.map((item) => `<div class="learning-interview"><p><strong>Question:</strong> ${escapeHtml(item.question)}</p><p><strong>Sample answer:</strong> ${escapeHtml(item.answer)}</p></div>`).join("")}</section><section class="learning-content-section"><h4>Revision topics</h4><ul>${module.revisionTopics.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></section></section>` : ""}
    <div class="learning-footer"><span>Examples are educational. Use only authorized systems and data. A topic marked studied is not marked mastered.</span><a class="button button-primary" href="${trackHref}">Return to ${escapeHtml(track.title)}</a></div>`;
}

function renderLearningTrack(track) {
  const modules = track.modules || [];
  const availableModules = modules.filter((module) => isLearningModuleAvailable(module, track.id));
  const progress = learningProgressFor(track.id);
  const allTopics = availableModules.flatMap((module) => module.lessons.flatMap((lesson) => lesson.topics));
  const studiedCount = allTopics.filter((topic) => progress.studiedTopics.includes(topic.id)).length;
  const progressPercent = allTopics.length ? Math.round((studiedCount / allTopics.length) * 100) : 0;
  const previousModule = progress.lastTopic && availableModules.find((module) => module.id === progress.lastTopic.moduleId);
  const previousTopic = previousModule?.lessons.flatMap((lesson) => lesson.topics).find((topic) => topic.id === progress.lastTopic.topicId);
  const firstModule = availableModules[0];
  const continueHref = previousTopic
    ? learningPathHref(track.id, previousModule.id, previousTopic.id)
    : firstModule ? learningPathHref(track.id, firstModule.id) : "";
  const currentCareer = state.profile.careerGoal === track.careerId;
  const pathEyebrow = track.id === "soc-analyst" ? "SOC ANALYST CURRICULUM" : `${track.title.toUpperCase()} LEARNING PATH`;
  const levelSections = (track.levels || []).map((level) => {
    const levelModules = modules.filter((module) => module.level === level.id);
    if (!levelModules.length) return "";
    return `<section class="learning-level-section"><div class="learning-level-heading"><div><span class="eyebrow">CAREER LEARNING LEVEL</span><h2>${escapeHtml(level.label)}</h2><p>${escapeHtml(level.description)}</p></div><span class="pill">${levelModules.length} modules</span></div><div class="learning-modules">${levelModules.map((module) => {
      const available = isLearningModuleAvailable(module, track.id);
      const topicCount = available ? module.lessons.reduce((total, lesson) => total + lesson.topics.length, 0) : 0;
      const moduleStudied = available ? module.lessons.flatMap((lesson) => lesson.topics).filter((topic) => progress.studiedTopics.includes(topic.id)).length : 0;
      const pdfPath = track.id === "soc-analyst"
        ? `./learning-materials/${encodeURIComponent(module.pdf || "")}`
        : `./learning-materials/${encodeURIComponent(track.id)}/${encodeURIComponent(module.pdf || "")}`;
      return `<article class="panel learning-module-card ${available ? "module-available" : "module-planned"}"><div class="learning-module-card-top"><span class="module-number">${String(module.number).padStart(2, "0")}</span><span class="pill ${available ? "pill-cyan" : ""}">${available ? "AVAILABLE" : "PLANNED"}</span></div><div class="learning-module-card-content"><h3>${escapeHtml(module.title)}</h3><p>${escapeHtml(module.description || "This module is planned; lessons and downloads are not yet published.")}</p><div class="learning-module-facts"><span>${escapeHtml(module.difficulty || level.label)}</span>${available ? `<span>${topicCount} topics</span><span>${moduleStudied}/${topicCount} studied</span><span>${formatStudyTime(module.estimatedMinutes)}</span>` : `<span>Material not published</span>`}</div></div>${available ? `<div class="learning-module-actions"><a class="button button-primary" href="${learningPathHref(track.id, module.id)}">Open study material →</a><a class="button button-secondary" href="${pdfPath}" download>Download PDF ↓</a></div>` : `<div class="learning-coming-soon">Lessons, quiz, and PDF are not published yet.</div>`}</article>`;
    }).join("")}</div></section>`;
  }).join("");
  return `${pageHeader(escapeHtml(pathEyebrow), escapeHtml(track.title), escapeHtml(track.description), currentCareer ? `<span class="pill pill-cyan">CURRENT CAREER GOAL</span>` : `<button class="button button-secondary" type="button" data-career="${escapeHtml(track.careerId)}">Set as career goal</button>`)}
    <section class="learning-path-banner panel"><div><span class="pill pill-cyan">${escapeHtml(track.title.toUpperCase())}</span><h2>Build skills in a clear sequence</h2><p>${escapeHtml(track.description)}</p><span class="learning-publish-status">${availableModules.length} of ${modules.length} modules have complete lessons, scored knowledge checks, and downloadable PDFs. Publication status does not indicate mastery.</span><div class="learning-progress-summary"><span>${studiedCount} of ${allTopics.length} available topics marked studied</span><div class="progress-track"><span style="width:${progressPercent}%"></span></div></div></div><div class="learning-path-mark" aria-hidden="true">${String(modules.length).padStart(2, "0")}</div></section>
    <div class="learning-path-actions">${continueHref ? `<a class="button button-primary" href="${continueHref}" ${previousTopic ? `data-learning-topic data-track-id="${escapeHtml(track.id)}" data-module-id="${escapeHtml(previousModule.id)}" data-topic-id="${escapeHtml(previousTopic.id)}"` : ""}>${previousTopic ? "Continue from last topic" : "Start available module"} →</a>` : ""}${firstModule ? `<a class="button button-secondary" href="${learningPathHref(track.id, firstModule.id, "quiz")}">Take baseline diagnostic</a>` : ""}<a class="subtle-link" href="#learning-hub">← All career paths</a></div>
    ${levelSections}
    <div class="notice-box learning-hub-note">Only authored and validated modules are available to study. Planned modules have no lesson or PDF yet. Topic checkmarks and quiz scores are saved locally and are not mastery or professional credentials.</div>`;
}

function renderLearningHub() {
  if (curriculumLoadError) {
    return `${pageHeader("CAREER LEARNING PATHS", "Learning Hub", "Structured cybersecurity career curricula with locally available lessons.")}<div class="notice-box">${escapeHtml(curriculumLoadError)}</div>`;
  }
  const tracks = getLearningTracks();
  if (learningHubTrackId) {
    const track = tracks.find((item) => item.id === learningHubTrackId);
    if (!track) return `${pageHeader("CAREER LEARNING PATHS", "Path not found", "This career path is not available in the loaded curriculum.")}<a class="button button-secondary" href="#learning-hub">← All career paths</a>`;
    if (learningHubModuleId) return renderLearningModule(track, track.modules.find((module) => module.id === learningHubModuleId));
    return renderLearningTrack(track);
  }
  return `${pageHeader("CAREER LEARNING PATHS", "Learning Hub", "Choose a cybersecurity role to see its curriculum, published lessons, progress, and planned modules.") }
    ${careerCurriculaLoadError ? `<div class="notice-box">${escapeHtml(careerCurriculaLoadError)}</div>` : ""}
    <div class="learning-track-grid">${tracks.map((track) => {
      const available = track.modules.filter((module) => isLearningModuleAvailable(module, track.id));
      const progress = learningProgressFor(track.id);
      const topics = available.flatMap((module) => module.lessons.flatMap((lesson) => lesson.topics));
      const studied = topics.filter((topic) => progress.studiedTopics.includes(topic.id)).length;
      const firstModule = available[0];
      const previousModule = progress.lastTopic && available.find((module) => module.id === progress.lastTopic.moduleId);
      const previousTopic = previousModule?.lessons.flatMap((lesson) => lesson.topics).find((topic) => topic.id === progress.lastTopic.topicId);
      const continueHref = previousTopic ? learningPathHref(track.id, previousModule.id, previousTopic.id) : firstModule ? learningPathHref(track.id) : learningPathHref(track.id);
      const isCareer = state.profile.careerGoal === track.careerId;
      return `<article class="panel learning-track-card ${isCareer ? "learning-track-current" : ""}"><div class="learning-track-card-head"><span class="pill ${isCareer ? "pill-cyan" : ""}">${isCareer ? "CURRENT CAREER GOAL" : "CAREER PATH"}</span><span class="learning-track-count">${available.length}/${track.modules.length} available</span></div><h2>${escapeHtml(track.title)}</h2><p>${escapeHtml(track.description)}</p><div class="learning-track-stats"><span>${track.modules.length} total modules</span><span>${studied}/${topics.length} topics studied</span></div><div class="progress-track"><span style="width:${topics.length ? Math.round((studied / topics.length) * 100) : 0}%"></span></div><div class="learning-track-actions"><a class="button button-primary" href="#learning-hub/${encodeURIComponent(track.id)}">Explore path →</a>${firstModule ? `<a class="button button-secondary" href="${continueHref}" ${previousTopic ? `data-learning-topic data-track-id="${escapeHtml(track.id)}" data-module-id="${escapeHtml(previousModule.id)}" data-topic-id="${escapeHtml(previousTopic.id)}"` : ""}>${previousTopic ? "Continue learning" : "Start learning"}</a>` : ""}</div></article>`;
    }).join("")}</div>
    <div class="notice-box learning-hub-note">Learning progress is saved in this browser. SOC Analyst retains its existing 12 published modules. The four additional career paths are being published in batches; unavailable modules remain clearly marked as planned.</div>`;
}

function renderLab() {
  return `${pageHeader("SAFE, SIMULATED PRACTICE", "Cyber Lab", "Build practical judgment with fictional examples. Nothing here sends traffic to real systems.", `<span class="pill pill-green">● ISOLATED EXERCISES</span>`)}
    <div class="lab-intro"><span class="lab-shield">⬡</span><div><strong>Practice safely. Learn defensively.</strong><p>Challenges use synthetic data and fixed answer choices. Submissions are scored in your browser and saved as learning evidence.</p></div></div>
    <div class="challenge-grid">${challenges.map((challenge, index) => {
      const attempts = state.challenges.filter((item) => item.challengeId === challenge.id);
      const best = attempts.length ? Math.max(...attempts.map((item) => item.score)) : null;
      return `<article class="panel challenge-card"><div class="challenge-card-head"><span class="challenge-number">${String(index + 1).padStart(2, "0")}</span><span class="pill">${escapeHtml(challenge.type)}</span></div><h3>${escapeHtml(challenge.title)}</h3><p>${escapeHtml(challenge.prompt)}</p><div class="sample-data"><span>SIMULATED SAMPLE</span><pre>${escapeHtml(challenge.sample)}</pre></div><fieldset class="challenge-options" aria-label="${escapeHtml(challenge.title)} answer">${challenge.options.map((option, i) => `<label><input type="radio" name="challenge-${challenge.id}" value="${i}"><span>${escapeHtml(option)}</span></label>`).join("")}</fieldset><div class="challenge-footer"><button class="button button-primary button-small" data-challenge="${challenge.id}">Submit answer</button><span>${best === null ? "Not attempted" : `Best: ${best}% · ${attempts.length} attempt${attempts.length === 1 ? "" : "s"}`}</span></div><div class="challenge-feedback" id="feedback-${challenge.id}"></div></article>`;
    }).join("")}</div><p class="footnote">All samples are fictional training data. The lab does not execute scans, exploit code, or connect to external systems.</p>`;
}

function renderProgress() {
  const analysis = analyzeSkills(state);
  const result = runAgents(state);
  const assessments = state.assessments.slice(-8);
  const completed = result.roadmap.filter((task) => task.completed).length;
  const learningTrackProgress = getLearningTracks().map((track) => {
    const progress = learningProgressFor(track.id);
    const availableTopics = track.modules.filter((module) => isLearningModuleAvailable(module, track.id))
      .flatMap((module) => module.lessons.flatMap((lesson) => lesson.topics));
    const studied = availableTopics.filter((topic) => progress.studiedTopics.includes(topic.id)).length;
    return {
      track,
      progress,
      studied,
      total: availableTopics.length,
      latestAttempt: progress.quizAttempts[0],
    };
  });
  const groupedSkills = Object.groupBy
    ? Object.groupBy(analysis.skills, (item) => item.category)
    : analysis.skills.reduce((groups, item) => {
      (groups[item.category] ||= []).push(item);
      return groups;
    }, {});
  const categoryScores = Object.entries(groupedSkills).map(([category, items]) => ({
    category,
    score: Math.round(items.reduce((sum, item) => sum + item.proficiency, 0) / items.length),
  }));
  const developing = analysis.skills.filter((item) => item.proficiency >= 40 && item.proficiency < 70);
  return `${pageHeader("YOUR LEARNING EVIDENCE", "Progress Tracker", "Track assessment results, practical performance, roadmap completion and skill evidence.")}
    <section class="stats-grid">${statCard("Assessments", state.assessments.length, "Completed knowledge checks", "▤", "purple")}${statCard("Lab attempts", state.challenges.length, "Simulated practical exercises", "⌘", "cyan")}${statCard("Tasks completed", completed, `Of ${result.roadmap.length} current roadmap tasks`, "✓", "green")}${statCard("Career match", percent(result.career.score), `Current ${escapeHtml(result.career.career.title)} goal`, "◎", "orange")}</section>
    <section class="panel analysis-panel"><div class="panel-heading"><div><span class="eyebrow">SKILL ANALYSIS</span><h3>Strengths, development areas and gaps</h3></div><span class="pill pill-cyan">OVERALL ${percent(analysis.score)}</span></div><div class="analysis-categories"><div><strong>${analysis.strong.length}</strong><span>Strong <small>70%+</small></span></div><div><strong>${developing.length}</strong><span>Developing <small>40–69%</small></span></div><div><strong>${analysis.weak.length}</strong><span>Needs focus <small>1–39%</small></span></div><div><strong>${analysis.missing.length}</strong><span>Not yet evidenced <small>0%</small></span></div></div><div class="category-score-grid">${categoryScores.map((item) => `<div><div><span>${escapeHtml(item.category)}</span><strong>${percent(item.score)}</strong></div><div class="progress-track"><span style="width:${item.score}%"></span></div></div>`).join("")}</div><div class="analysis-skill-list"><div><strong>Strong skills</strong><span>${analysis.strong.length ? analysis.strong.map((item) => escapeHtml(item.name)).join(" · ") : "No skills at this level yet"}</span></div><div><strong>Skills to develop</strong><span>${[...analysis.weak, ...analysis.missing].length ? [...analysis.weak, ...analysis.missing].map((item) => escapeHtml(item.name)).join(" · ") : "No immediate gaps identified"}</span></div></div></section>
    <section class="progress-grid"><article class="panel chart-panel"><div class="panel-heading"><div><span class="eyebrow">ASSESSMENT HISTORY</span><h3>Score over time</h3></div><span class="chart-legend"><i></i> Assessment score</span></div><div class="chart-area">${assessments.length ? `<canvas id="assessment-chart" aria-label="Assessment scores over time"></canvas>` : `<div class="empty-state compact">Complete an assessment to see your score history here.</div>`}</div></article>
    <article class="panel chart-panel"><div class="panel-heading"><div><span class="eyebrow">SKILL EVIDENCE</span><h3>Current proficiency by skill</h3></div><span class="chart-legend cyan-legend"><i></i> Estimated level</span></div><div class="skill-chart-list">${[...analysis.skills].sort((a, b) => b.proficiency - a.proficiency).slice(0, 8).map((item) => `<div class="skill-chart-row"><span>${escapeHtml(item.name)}</span><div class="progress-track"><span style="width:${item.proficiency}%"></span></div><strong>${percent(item.proficiency)}</strong></div>`).join("")}</div></article></section>
    <section class="progress-grid"><article class="panel history-panel"><div class="panel-heading"><div><span class="eyebrow">ASSESSMENT HISTORY</span><h3>Recent results</h3></div><a href="#assessment" class="subtle-link">Take assessment →</a></div>${state.assessments.length ? `<div class="table-wrap"><table><thead><tr><th>DATE</th><th>SCORE</th><th>QUESTIONS</th><th>CAREER GOAL</th></tr></thead><tbody>${[...state.assessments].reverse().slice(0, 8).map((item) => `<tr><td>${new Date(item.date).toLocaleDateString()}</td><td><span class="score-pill">${percent(item.score)}</span></td><td>${item.correct} / ${item.total}</td><td>${escapeHtml(careers.find((c) => c.id === item.careerGoal)?.title || "—")}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty-state compact">No assessment history yet.</div>`}</article>
    <article class="panel activity-panel"><div class="panel-heading"><div><span class="eyebrow">LEARNING ACTIVITY</span><h3>Recent milestones</h3></div></div>${state.activities.length ? `<div class="activity-list">${state.activities.slice(0, 7).map((item) => `<div class="activity-item"><span class="activity-bullet"></span><div><strong>${escapeHtml(item.text)}</strong><small>${new Date(item.date).toLocaleString()}</small></div></div>`).join("")}</div>` : `<div class="empty-state compact">Completed tasks and challenge results will appear here.</div>`}</article></section>
    <section class="panel learning-progress-panel"><div class="panel-heading"><div><span class="eyebrow">CAREER LEARNING PATHS</span><h3>Study progress and latest checks</h3></div><a href="#learning-hub" class="subtle-link">Open Learning Hub →</a></div><div class="learning-progress-list">${learningTrackProgress.map(({ track, progress, studied, total, latestAttempt }) => `<article><div><strong>${escapeHtml(track.title)}</strong><span>${studied} / ${total} topics studied · ${progress.quizAttempts.length} quiz attempt${progress.quizAttempts.length === 1 ? "" : "s"}</span></div><div class="progress-track"><span style="width:${total ? Math.round((studied / total) * 100) : 0}%"></span></div><span class="learning-latest-score">${latestAttempt ? `Latest: ${percent(latestAttempt.score)}` : "No quiz yet"}</span><a href="#learning-hub/${encodeURIComponent(track.id)}">View path →</a></article>`).join("")}</div></section>
    <section class="panel proof-panel"><div class="panel-heading"><div><span class="eyebrow">PROOF-OF-SKILL INTELLIGENCE</span><h3>Claimed vs. demonstrated</h3></div><span class="pill pill-cyan">EVIDENCE-BASED</span></div><p>Self-reported ratings are shown separately from assessment and simulated lab evidence. Scores are learning signals, not credentials.</p><div class="proof-table">${analysis.skills.filter((item) => item.claimed || item.demonstrated !== null).sort((a, b) => Math.abs((b.claimed || 0) - (b.demonstrated || 0)) - Math.abs((a.claimed || 0) - (a.demonstrated || 0))).slice(0, 6).map((item) => `<div class="proof-row"><strong>${escapeHtml(item.name)}</strong><span>${percent(item.claimed)}<small>claimed</small></span><span>${item.demonstrated === null ? "—" : percent(item.demonstrated)}<small>${item.evidenceCount ? "demonstrated" : "no evidence"}</small></span><span class="evidence-status ${item.mismatch ? "needs-check" : ""}">${item.mismatch ? "Review gap" : item.demonstrated === null ? "Self-reported" : "Evidence recorded"}</span></div>`).join("") || `<div class="empty-state compact">Add skill ratings or complete assessments and challenges to build your evidence profile.</div>`}</div></section>`;
}

function renderMentor() {
  const result = runAgents(state);
  return `${pageHeader("PERSONALIZED, EXPLAINABLE GUIDANCE", "AI Mentor", "Ask about your skill evidence, career goal, assessment performance or what to learn next.", `<span class="pill pill-purple">RULE-BASED · NO EXTERNAL LLM</span>`)}
    <section class="mentor-layout"><div class="panel mentor-chat"><div class="chat-header"><span class="mentor-avatar">✧</span><div><strong>CyberPath Mentor</strong><small><i></i> Context-aware guidance · local</small></div><span class="status-chip">ONLINE</span></div><div class="chat-messages" id="chat-messages">${state.mentorMessages.map((message) => `<div class="chat-message ${message.role === "user" ? "user-message" : "mentor-message"}">${message.role === "mentor" ? `<span class="chat-avatar">✧</span>` : ""}<div><p>${escapeHtml(message.text)}</p>${message.date ? `<small>${new Date(message.date).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</small>` : ""}</div></div>`).join("")}</div><div class="suggestion-chips"><button data-prompt="What should I learn next?">What next?</button><button data-prompt="Explain my career match">My career match</button><button data-prompt="Explain my proof of skill">Proof of skill</button><button data-prompt="How did I do on my assessment?">Assessment feedback</button></div><form id="mentor-form" class="chat-composer"><input name="message" maxlength="500" required placeholder="Ask your mentor a question..." autocomplete="off"><button type="submit" aria-label="Send message">➤</button></form></div>
    <aside class="mentor-context"><article class="panel context-card"><span class="eyebrow">YOUR CURRENT CONTEXT</span><h3>${escapeHtml(result.career.career.title)}</h3><div class="context-stat"><span>Career match</span><strong>${percent(result.career.score)}</strong></div><div class="context-stat"><span>Overall skill score</span><strong>${percent(result.analysis.score)}</strong></div><div class="context-stat"><span>Assessments</span><strong>${state.assessments.length}</strong></div><div class="context-stat"><span>Practical attempts</span><strong>${state.challenges.length}</strong></div><a href="#profile" class="subtle-link">Update your context →</a></article><div class="notice-box">Mentor replies are generated by deterministic local rules using your saved profile and results. They are educational guidance, not professional or certification advice.</div></aside></section>`;
}

const views = {
  dashboard: renderDashboard, profile: renderProfile, careers: renderCareers, assessment: renderAssessment,
  agents: renderAgents, roadmap: renderRoadmap, "learning-hub": renderLearningHub,
  lab: renderLab, progress: renderProgress, mentor: renderMentor,
  account: renderAccount, settings: renderSettings, "account-info": renderAccountInformation,
};

function drawAssessmentChart() {
  const canvas = document.querySelector("#assessment-chart");
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, rect.width * ratio);
  canvas.height = Math.max(1, rect.height * ratio);
  const ctx = canvas.getContext("2d");
  ctx.scale(ratio, ratio);
  const values = state.assessments.slice(-8).map((item) => item.score);
  const width = rect.width;
  const height = rect.height;
  const pad = { top: 16, right: 16, bottom: 30, left: 36 };
  const chartH = height - pad.top - pad.bottom;
  const chartW = width - pad.left - pad.right;
  ctx.font = "11px Inter, system-ui, sans-serif";
  ctx.fillStyle = "#77869b";
  ctx.strokeStyle = "rgba(133,154,180,.12)";
  ctx.lineWidth = 1;
  [0, 25, 50, 75, 100].forEach((value) => {
    const y = pad.top + chartH * (1 - value / 100);
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(width - pad.right, y); ctx.stroke();
    ctx.fillText(`${value}`, 4, y + 4);
  });
  const spacing = values.length > 1 ? chartW / (values.length - 1) : 0;
  ctx.strokeStyle = "#45c8ea"; ctx.lineWidth = 2.5; ctx.beginPath();
  values.forEach((value, index) => {
    const x = values.length === 1 ? pad.left + chartW / 2 : pad.left + spacing * index;
    const y = pad.top + chartH * (1 - value / 100);
    if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.stroke();
  values.forEach((value, index) => {
    const x = values.length === 1 ? pad.left + chartW / 2 : pad.left + spacing * index;
    const y = pad.top + chartH * (1 - value / 100);
    ctx.fillStyle = "#08111f"; ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#45c8ea"; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = "#77869b"; ctx.textAlign = "center"; ctx.fillText(`#${state.assessments.length - values.length + index + 1}`, x, height - 8);
  });
}

function render() {
  if (!views[route]) route = "dashboard";
  document.querySelector(".app-shell").classList.toggle("signed-out", isSignedOut);
  updateShell();
  if (isSignedOut) {
    closeAccountMenu();
    app.innerHTML = renderSignedOut();
    return;
  }
  app.innerHTML = views[route]();
  if (route === "learning-hub" && learningHubTopicId) {
    requestAnimationFrame(() => {
      const target = learningHubTopicId === "quiz"
        ? document.querySelector("#learning-quiz")
        : document.getElementById(`topic-${learningHubTopicId}`);
      target?.scrollIntoView({ block: "start" });
    });
  }
  if (route === "progress") requestAnimationFrame(drawAssessmentChart);
  if (route === "mentor") {
    const messages = document.querySelector("#chat-messages");
    messages.scrollTop = messages.scrollHeight;
  }
}

async function changeCareer(careerId) {
  if (!careers.some((item) => item.id === careerId)) return;
  state.profile.careerGoal = careerId;
  logActivity(`Career goal updated to ${careers.find((item) => item.id === careerId).title}; match and roadmap refreshed`);
  persist("Career match and roadmap updated.");
  render();
  await startAgentWorkflow({ trigger: "Career goal changed" });
}

function handleLearningQuiz(form) {
  const track = getLearningTracks().find((item) => item.id === form.dataset.trackId);
  const module = track?.modules.find((item) => item.id === form.dataset.moduleId);
  if (!track || !isLearningModuleAvailable(module, track.id)) {
    showToast("This learning check is unavailable. Reopen the module and try again.");
    return;
  }
  const formData = new FormData(form);
  const answers = {};
  for (const question of module.quiz) {
    const answer = formData.get(`learning-answer-${question.id}`);
    if (answer === null || !Number.isInteger(Number(answer)) || Number(answer) < 0 || Number(answer) >= question.choices.length) {
      showToast("Answer every question before submitting.");
      return;
    }
    answers[question.id] = Number(answer);
  }
  const correct = module.quiz.filter((question) => answers[question.id] === question.answer).length;
  const score = Math.round((correct / module.quiz.length) * 100);
  const result = {
    score,
    correct,
    total: module.quiz.length,
    passed: score >= (module.passScore || 70),
    answers,
    completedAt: new Date().toISOString(),
  };
  const progress = mutableLearningProgressFor(track.id);
  progress.quizResults[module.id] = result;
  progress.quizAttempts.unshift({ moduleId: module.id, ...result });
  progress.quizAttempts = progress.quizAttempts.slice(0, 100);
  const incorrectQuestion = module.quiz.find((question) => answers[question.id] !== question.answer);
  if (incorrectQuestion?.topicId) {
    progress.lastTopic = { moduleId: module.id, topicId: incorrectQuestion.topicId };
  }
  logActivity(`Completed ${track.title} module ${module.number} knowledge check with a ${score}% score`);
  persist("Knowledge-check result saved. Use the explanations to guide your review.");
  render();
}

async function submitAssessment() {
  if (questions.some((item) => assessmentAnswers[item.id] === undefined)) {
    showToast("Answer every question before finishing.");
    return;
  }
  const workflow = await startAgentWorkflow({
    trigger: "Assessment submitted",
    assessment: { answers: { ...assessmentAnswers }, questions },
  });
  if (!workflow?.assessment) return;
  logActivity(`Completed cybersecurity skill assessment with a ${workflow.assessment.score}% score`);
  assessmentAnswers = { __submitted: true };
  persist("Assessment saved. All five agents completed their analysis.");
  render();
}

async function handleChallengeSubmit(challengeId) {
  const challenge = challenges.find((item) => item.id === challengeId);
  if (!challenge) return;
  const chosen = document.querySelector(`input[name="challenge-${challengeId}"]:checked`);
  if (!chosen) { showToast("Choose an answer before submitting."); return; }
  const workflow = await startAgentWorkflow({
    trigger: `Cyber Lab completed: ${challenge.title}`,
    challengeSubmission: { challenge, answer: Number(chosen.value) },
  });
  if (!workflow?.practical?.challengeId) return;
  const evaluation = workflow.practical;
  logActivity(`${evaluation.correct ? "Solved" : "Attempted"} Cyber Lab: ${challenge.title} (${evaluation.score}%)`);
  persist("Challenge result saved. All five agents updated skill evidence and guidance.");
  render();
  const feedback = document.querySelector(`#feedback-${challengeId}`);
  if (!feedback) return;
  feedback.className = `challenge-feedback visible ${evaluation.correct ? "feedback-correct" : "feedback-incorrect"}`;
  feedback.innerHTML = `<strong>${evaluation.correct ? "Correct — 100%" : "Not quite — 0%"}</strong><p>${escapeHtml(evaluation.explanation)}</p>`;
  const best = document.querySelector(`input[name="challenge-${challengeId}"][value="${challenge.answer}"]`);
  if (!evaluation.correct && best) best.closest("label").classList.add("correct-answer");
}

app.addEventListener("input", (event) => {
  if (event.target.matches('input[type="range"]')) event.target.nextElementSibling.value = `${event.target.value}%`;
});

app.addEventListener("change", (event) => {
  if (event.target.name === "answer") {
    assessmentAnswers[questions[questionIndex].id] = Number(event.target.value);
    render();
  }
  if (event.target.matches('input[type="checkbox"][data-task]')) {
    const id = event.target.dataset.task;
    if (event.target.checked && !state.completedTasks.includes(id)) state.completedTasks.push(id);
    if (!event.target.checked) state.completedTasks = state.completedTasks.filter((taskId) => taskId !== id);
    logActivity(`${event.target.checked ? "Completed" : "Reopened"} roadmap task`);
    persist(event.target.checked ? "Roadmap task completed." : "Roadmap task marked as in progress.");
    render();
  }
});

app.addEventListener("click", (event) => {
  if (event.target.closest("#continue-local-session")) {
    try {
      sessionStorage.removeItem("cyberpath-signed-out");
    } catch (error) {
      console.error("Could not resume local demo session.", error);
      showToast("Could not resume the local session. Check browser session storage settings.");
      return;
    }
    isSignedOut = false;
    route = "dashboard";
    location.hash = "#dashboard";
    render();
    showToast("Local demo session resumed. Your saved data is unchanged.");
    return;
  }
  if (event.target.closest("#edit-account")) {
    accountEditMode = true;
    render();
    return;
  }
  if (event.target.closest("#cancel-profile")) {
    accountEditMode = false;
    render();
    return;
  }
  if (event.target.closest("#export-data")) {
    try {
      const exportData = { ...state, exportedAt: new Date().toISOString(), accountType: "Local demo profile" };
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `cyberpath-learner-data-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      showToast("Learner data exported as JSON.");
    } catch (error) {
      console.error("Could not export learner data.", error);
      showToast("Could not export learner data. Check browser download permissions.");
    }
    return;
  }
  if (event.target.closest("#clear-demo-data")) {
    const confirmed = window.confirm("Clear all CyberPath demo data stored in this browser? This removes the profile, preferences, Learning Hub progress and quiz history, assessment and lab history, agent history and mentor messages.");
    if (!confirmed) return;
    if (!clearStoredState()) {
      showToast("Could not clear browser storage. Check browser storage settings.");
      return;
    }
    Object.keys(state).forEach((key) => delete state[key]);
    Object.assign(state, initialState());
    assessmentAnswers = {};
    questionIndex = 0;
    accountEditMode = false;
    persist("Demo data cleared. A new empty local profile is ready.");
    render();
    return;
  }
  const careerButton = event.target.closest("[data-career]");
  if (careerButton) { changeCareer(careerButton.dataset.career); return; }
  const studyButton = event.target.closest("[data-mark-topic]");
  if (studyButton) {
    const progress = mutableLearningProgressFor(studyButton.dataset.trackId);
    const topicId = studyButton.dataset.topicId;
    const studiedIndex = progress.studiedTopics.indexOf(topicId);
    if (studiedIndex === -1) progress.studiedTopics.push(topicId);
    else progress.studiedTopics.splice(studiedIndex, 1);
    progress.lastTopic = { moduleId: studyButton.dataset.moduleId, topicId };
    logActivity(`${studiedIndex === -1 ? "Marked studied" : "Reopened"} learning topic: ${topicId}`);
    persist(studiedIndex === -1 ? "Topic marked studied. This is not a mastery claim." : "Topic marked for review.");
    render();
    return;
  }
  const learningTopicLink = event.target.closest("[data-learning-topic]");
  if (learningTopicLink) {
    const progress = mutableLearningProgressFor(learningTopicLink.dataset.trackId);
    progress.lastTopic = {
      moduleId: learningTopicLink.dataset.moduleId,
      topicId: learningTopicLink.dataset.topicId,
    };
    persist();
  }
  const challengeButton = event.target.closest("[data-challenge]");
  if (challengeButton) { handleChallengeSubmit(challengeButton.dataset.challenge); return; }
  const promptButton = event.target.closest("[data-prompt]");
  if (promptButton) {
    const form = document.querySelector("#mentor-form");
    form.elements.message.value = promptButton.dataset.prompt;
    form.requestSubmit();
    return;
  }
  if (event.target.closest("#question-prev") && questionIndex > 0) { questionIndex -= 1; render(); return; }
  if (event.target.closest("#question-next")) {
    if (assessmentAnswers[questions[questionIndex].id] !== undefined && questionIndex < questions.length - 1) questionIndex += 1;
    render(); return;
  }
  if (event.target.closest("#submit-assessment")) { submitAssessment(); return; }
  if (event.target.closest("#restart-assessment")) { questionIndex = 0; assessmentAnswers = {}; render(); return; }
  if (event.target.closest("#run-agents")) {
    void startAgentWorkflow({ trigger: "Manual collaboration run" });
    return;
  }
});

app.addEventListener("submit", (event) => {
  event.preventDefault();
  if (event.target.matches("form[data-learning-quiz]")) {
    handleLearningQuiz(event.target);
    return;
  }
  if (event.target.id === "profile-form") {
    const data = new FormData(event.target);
    state.profile.name = data.get("name").trim();
    state.profile.email = data.get("email").trim();
    state.profile.education = data.get("education").trim();
    state.profile.institution = data.get("institution").trim();
    state.profile.learningLevel = data.get("learningLevel");
    state.profile.preference = data.get("preference");
    const changedCareer = state.profile.careerGoal !== data.get("careerGoal");
    state.profile.careerGoal = data.get("careerGoal");
    state.profile.certifications = String(data.get("certifications") || "").split(",").map((item) => item.trim()).filter(Boolean);
    state.profile.projects = String(data.get("projects") || "").split(",").map((item) => item.trim()).filter(Boolean);
    skills.forEach((item) => { state.profile.skills[item.id] = Number(data.get(`skill-${item.id}`) || 0); });
    if (route === "account") accountEditMode = false;
    logActivity("Learner profile saved");
    if (changedCareer) logActivity(`Career goal changed to ${careers.find((item) => item.id === state.profile.careerGoal).title}; learning plan regenerated`);
    persist(changedCareer ? "Profile saved. Career match and roadmap regenerated." : "Profile saved successfully.");
    render();
    void startAgentWorkflow({ trigger: changedCareer ? "Learner profile and career goal updated" : "Learner profile updated" });
  }
  if (event.target.id === "settings-form") {
    const data = new FormData(event.target);
    const previousName = state.profile.name;
    const previousSettings = JSON.stringify(state.settings);
    state.profile.name = String(data.get("displayName") || "").trim();
    state.profile.learningLevel = String(data.get("learningLevel") || "Beginner");
    state.settings.preferredCategory = String(data.get("preferredCategory") || "Defensive Operations");
    state.settings.preferredDifficulty = String(data.get("preferredDifficulty") || "Beginner");
    state.settings.preferredDuration = String(data.get("preferredDuration") || "3–5 hours/week");
    state.settings.learningGoals = String(data.get("learningGoals") || "").trim();
    logActivity("Account and learning preferences saved");
    persist("Settings saved.");
    render();
    if (previousName !== state.profile.name || previousSettings !== JSON.stringify(state.settings)) {
      void startAgentWorkflow({ trigger: "Profile or learning preferences updated in settings" });
    }
  }
  if (event.target.id === "mentor-form") {
    const message = String(new FormData(event.target).get("message") || "").trim();
    if (!message) return;
    state.mentorMessages.push({ role: "user", text: message, date: new Date().toISOString() });
    state.mentorMessages.push({ role: "mentor", text: mentorReply(message, state, runAgents(state)), date: new Date().toISOString() });
    state.mentorMessages = state.mentorMessages.slice(-40);
    logActivity("Asked the CyberPath Mentor for guidance");
    persist();
    render();
  }
});

window.addEventListener("hashchange", () => {
  const hash = location.hash.slice(1);
  if (hash.startsWith("topic-")) return;
  setRouteFromHash(hash);
  document.querySelector("#sidebar").classList.remove("open");
  accountEditMode = false;
  closeAccountMenu();
  render();
});
document.querySelector("#menu-button").addEventListener("click", () => document.querySelector("#sidebar").classList.toggle("open"));
document.addEventListener("click", (event) => {
  const trigger = event.target.closest(".account-trigger");
  if (trigger) {
    event.preventDefault();
    toggleAccountMenu(trigger, event.detail === 0);
    return;
  }
  const item = event.target.closest("#account-menu [data-account-action]");
  if (item) {
    const action = item.dataset.accountAction;
    closeAccountMenu();
    if (action === "signout") {
      const confirmed = window.confirm("Sign out of this tab's local demo session? Your profile and learning data will remain saved in this browser.");
      if (!confirmed) return;
      try {
        sessionStorage.setItem("cyberpath-signed-out", "true");
      } catch (error) {
        console.error("Could not save local sign-out state.", error);
        showToast("Could not end the local session. Check browser session storage settings.");
        return;
      }
      isSignedOut = true;
      render();
    } else {
      route = action === "account" ? "account" : action === "settings" ? "settings" : "account-info";
      accountEditMode = false;
      location.hash = `#${route}`;
      render();
    }
    return;
  }
  if (!event.target.closest("#account-menu")) closeAccountMenu();
});
document.addEventListener("keydown", (event) => {
  const menu = document.querySelector("#account-menu");
  if (event.key === "Escape" && !menu.hidden) {
    event.preventDefault();
    closeAccountMenu(true);
    return;
  }
  if (menu.hidden || !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
  const items = [...menu.querySelectorAll('[role="menuitem"]')];
  const current = items.indexOf(document.activeElement);
  let next = current;
  if (event.key === "Home") next = 0;
  else if (event.key === "End") next = items.length - 1;
  else next = (current + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
  event.preventDefault();
  items[next].focus();
});
window.addEventListener("resize", () => { if (route === "progress") drawAssessmentChart(); });

render();
