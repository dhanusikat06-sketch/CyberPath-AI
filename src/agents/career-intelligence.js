import { careers } from "../data.js";

const clamp = (value) => Math.max(0, Math.min(100, Math.round(value)));

export function analyzeCareer(state, skillAnalysis) {
  const career = careers.find((item) => item.id === state.profile.careerGoal) || careers[0];
  const requiredSkills = Object.entries(career.skills).map(([id, required]) => {
    const skill = skillAnalysis.skills.find((item) => item.id === id);
    return { ...skill, required, gap: Math.max(0, required - skill.proficiency), achieved: skill.proficiency >= required };
  });
  const score = clamp(requiredSkills.reduce((sum, skill) => sum + Math.min(skill.proficiency / skill.required, 1) * 100, 0) / requiredSkills.length);
  return { career, score, skills: requiredSkills, achieved: requiredSkills.filter((skill) => skill.achieved), gaps: requiredSkills.filter((skill) => !skill.achieved) };
}
