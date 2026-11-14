import { resources } from "../data.js";

export function generateRoadmap(state, careerAnalysis) {
  const preferredCategory = state.settings?.preferredCategory;
  const sortedGaps = [...careerAnalysis.gaps].sort((a, b) => {
    const categoryPreference = Number(b.category === preferredCategory) - Number(a.category === preferredCategory);
    return categoryPreference || b.gap - a.gap;
  });
  const focusSkills = sortedGaps.length ? sortedGaps.slice(0, 5) : careerAnalysis.skills.slice(0, 3);
  return focusSkills.map((skill, index) => {
    const resource = resources[skill.id];
    const taskId = `learn-${careerAnalysis.career.id}-${skill.id}`;
    return {
      id: taskId,
      phase: index < 2 ? "Build foundations" : index < 4 ? "Practice and apply" : "Prepare for your role",
      skillId: skill.id,
      skill: skill.name,
      title: resource.title,
      type: resource.type,
      difficulty: resource.difficulty,
      targetDifficulty: state.settings?.preferredDifficulty || "Beginner",
      time: resource.time,
      url: resource.url,
      reason: skill.gap ? `Close a ${skill.gap}-point gap for ${careerAnalysis.career.title}.` : `Consolidate a core ${careerAnalysis.career.title} competency.`,
      completed: (state.completedTasks || []).includes(taskId),
      practical: skill.activity,
      learnerGoal: state.settings?.learningGoals?.trim() || "",
    };
  });
}
