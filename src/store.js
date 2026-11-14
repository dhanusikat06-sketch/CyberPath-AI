import { skills } from "./data.js";

const STORAGE_KEY = "cyberpath-ai-state-v1";
const LEARNING_LEVELS = ["Beginner", "Intermediate", "Advanced"];
const LEARNING_DURATIONS = ["1–2 hours/week", "3–5 hours/week", "6–10 hours/week", "10+ hours/week"];

export function initialState() {
  return {
    accountCreatedAt: new Date().toISOString(),
    profile: {
      name: "Learner",
      email: "",
      education: "",
      institution: "",
      learningLevel: "Beginner",
      careerGoal: "soc",
      preference: "Hands-on practice",
      skills: {},
      certifications: [],
      projects: [],
    },
    settings: {
      preferredCategory: "Defensive Operations",
      preferredDifficulty: "Beginner",
      learningGoals: "",
      preferredDuration: "3–5 hours/week",
    },
    assessments: [],
    challenges: [],
    completedTasks: [],
    learningProgress: {},
    agentRuns: [],
    currentAgentRunId: null,
    agentMentorGuidance: null,
    mentorMessages: [{ role: "mentor", text: "Welcome! I can help you understand your skill evidence, career match and next learning steps. I use rule-based guidance in this local prototype." }],
    activities: [],
  };
}

export function loadState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) {
      const state = initialState();
      saveState(state);
      return state;
    }
    const parsed = JSON.parse(saved);
    const base = initialState();
    const savedSettings = parsed.settings && typeof parsed.settings === "object" ? parsed.settings : {};
    const savedProfile = parsed.profile && typeof parsed.profile === "object" ? parsed.profile : {};
    const savedCreatedAt = parsed.accountCreatedAt || savedProfile.createdAt;
    const categories = new Set(skills.map((skill) => skill.category));
    const state = {
      ...base,
      ...parsed,
      accountCreatedAt: typeof savedCreatedAt === "string" && Number.isFinite(Date.parse(savedCreatedAt)) ? savedCreatedAt : null,
      profile: {
        ...base.profile,
        ...savedProfile,
        skills: { ...(savedProfile.skills && typeof savedProfile.skills === "object" ? savedProfile.skills : {}) },
        certifications: Array.isArray(savedProfile.certifications) ? savedProfile.certifications : [],
        projects: Array.isArray(savedProfile.projects) ? savedProfile.projects : [],
      },
      settings: {
        ...base.settings,
        ...savedSettings,
        preferredCategory: categories.has(savedSettings.preferredCategory) ? savedSettings.preferredCategory : base.settings.preferredCategory,
        preferredDifficulty: LEARNING_LEVELS.includes(savedSettings.preferredDifficulty) ? savedSettings.preferredDifficulty : base.settings.preferredDifficulty,
        learningGoals: typeof savedSettings.learningGoals === "string" ? savedSettings.learningGoals : base.settings.learningGoals,
        preferredDuration: LEARNING_DURATIONS.includes(savedSettings.preferredDuration) ? savedSettings.preferredDuration : base.settings.preferredDuration,
      },
      assessments: Array.isArray(parsed.assessments) ? parsed.assessments : [],
      challenges: Array.isArray(parsed.challenges) ? parsed.challenges : [],
      completedTasks: Array.isArray(parsed.completedTasks) ? parsed.completedTasks : [],
      learningProgress: parsed.learningProgress && typeof parsed.learningProgress === "object" && !Array.isArray(parsed.learningProgress)
        ? Object.fromEntries(Object.entries(parsed.learningProgress)
          .filter(([, progress]) => progress && typeof progress === "object" && !Array.isArray(progress))
          .map(([trackId, progress]) => [trackId, {
            studiedTopics: Array.isArray(progress.studiedTopics) ? progress.studiedTopics.filter((id) => typeof id === "string") : [],
            lastTopic: progress.lastTopic && typeof progress.lastTopic.moduleId === "string" && typeof progress.lastTopic.topicId === "string"
              ? { moduleId: progress.lastTopic.moduleId, topicId: progress.lastTopic.topicId }
              : null,
            quizResults: progress.quizResults && typeof progress.quizResults === "object" && !Array.isArray(progress.quizResults)
              ? progress.quizResults
              : {},
            quizAttempts: Array.isArray(progress.quizAttempts) ? progress.quizAttempts.slice(0, 100) : [],
          }]))
        : {},
      agentRuns: Array.isArray(parsed.agentRuns) ? parsed.agentRuns.slice(0, 20) : [],
      currentAgentRunId: typeof parsed.currentAgentRunId === "string" ? parsed.currentAgentRunId : null,
      agentMentorGuidance: parsed.agentMentorGuidance && typeof parsed.agentMentorGuidance === "object" ? parsed.agentMentorGuidance : null,
      mentorMessages: Array.isArray(parsed.mentorMessages) && parsed.mentorMessages.length ? parsed.mentorMessages : base.mentorMessages,
      activities: Array.isArray(parsed.activities) ? parsed.activities : [],
    };
    if (state.accountCreatedAt !== parsed.accountCreatedAt || parsed.learningProgress === undefined) saveState(state);
    return state;
  } catch (error) {
    console.error("Could not read saved CyberPath AI data.", error);
    return initialState();
  }
}

export function saveState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch (error) {
    console.error("Could not save CyberPath AI data.", error);
    return false;
  }
}

export function clearStoredState() {
  try {
    localStorage.removeItem(STORAGE_KEY);
    return true;
  } catch (error) {
    console.error("Could not clear saved CyberPath AI data.", error);
    return false;
  }
}
