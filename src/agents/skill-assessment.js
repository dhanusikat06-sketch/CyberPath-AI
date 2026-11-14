import { skills } from "../data.js";

const clamp = (value) => Math.max(0, Math.min(100, Math.round(value)));

export function analyzeSkills(state) {
  const analysis = skills.map((skill) => {
    const claimed = Number(state.profile.skills?.[skill.id] || 0);
    const evidence = [
      ...(state.assessments || []).map((item) => item.skillScores?.[skill.id]).filter(Number.isFinite),
      ...(state.challenges || []).filter((item) => item.skill === skill.id).map((item) => item.score),
    ];
    const demonstrated = evidence.length
      ? clamp(evidence.reduce((sum, score) => sum + score, 0) / evidence.length)
      : null;
    const proficiency = demonstrated === null ? claimed : clamp(claimed * 0.35 + demonstrated * 0.65);
    return {
      ...skill,
      claimed,
      demonstrated,
      proficiency,
      evidenceCount: evidence.length,
      mismatch: demonstrated !== null && claimed - demonstrated >= 20,
      evidenceSource: evidence.length ? "Assessment and practical exercises" : claimed ? "Self-reported only" : "No evidence yet",
      status: proficiency >= 70 ? "Strong" : proficiency >= 40 ? "Developing" : proficiency > 0 ? "Needs focus" : "Not assessed",
    };
  });
  const score = analysis.length ? clamp(analysis.reduce((sum, skill) => sum + skill.proficiency, 0) / analysis.length) : 0;
  return {
    skills: analysis,
    score,
    strong: analysis.filter((skill) => skill.proficiency >= 70),
    weak: analysis.filter((skill) => skill.proficiency > 0 && skill.proficiency < 40),
    missing: analysis.filter((skill) => skill.proficiency === 0),
    mismatches: analysis.filter((skill) => skill.mismatch),
  };
}

export function evaluateAssessment(answers, questionSet) {
  const correct = questionSet.filter((question) => answers[question.id] === question.answer).length;
  const skillScores = {};
  questionSet.forEach((question) => {
    const score = answers[question.id] === question.answer ? 100 : 0;
    if (!skillScores[question.skill]) skillScores[question.skill] = [];
    skillScores[question.skill].push(score);
  });
  const averagedSkills = Object.fromEntries(
    Object.entries(skillScores).map(([skill, scores]) => [skill, Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length)]),
  );
  return { correct, total: questionSet.length, score: questionSet.length ? Math.round(correct / questionSet.length * 100) : 0, skillScores: averagedSkills };
}
